import { BlobReader, ZipReader, Writer, type FileEntry } from "@zip.js/zip.js";
import { BACKUP_LIMITS, backupManifest, portableItem, type BackupManifest, type PortableItem } from "@stash/shared";
class ArchiveError extends Error {}
class BoundedReader extends BlobReader {
  async readUint8Array(offset: number, length: number) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > BACKUP_LIMITS.directoryBytes
    )
      throw new ArchiveError("The archive index is too large or invalid.");
    return super.readUint8Array(offset, length);
  }
}
class BoundedWriter extends Writer<Uint8Array> {
  private parts: Uint8Array[] = [];
  private total = 0;
  constructor(private readonly limit: number) {
    super();
  }
  async writeUint8Array(part: Uint8Array) {
    this.total += part.length;
    if (this.total > this.limit)
      throw new ArchiveError("An archive entry expands beyond its size limit.");
    this.parts.push(part);
  }
  async getData() {
    const data = new Uint8Array(this.total);
    let offset = 0;
    for (const part of this.parts) {
      data.set(part, offset);
      offset += part.length;
    }
    this.parts = [];
    return data;
  }
}
export async function sha256(data: Uint8Array) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    data as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export type OpenBackup = {
  manifest: BackupManifest;
  manifestBytes: Uint8Array;
  readItem: (id: string) => Promise<{ item: PortableItem; bytes: Uint8Array }>;
  readOriginal: (id: string) => Promise<Uint8Array>;
  close: () => Promise<void>;
};
export async function openBackup(
  blob: Blob,
  signal?: AbortSignal,
): Promise<OpenBackup> {
  if (blob.size > BACKUP_LIMITS.archiveBytes)
    throw new ArchiveError("This backup exceeds the supported archive size.");
  const reader = new ZipReader(new BoundedReader(blob), {
    strictness: "strict",
    filenameValidation: "strict",
    useWebWorkers: false,
    checkSignature: true,
    checkLocalDirectory: true,
    checkOverlappingEntry: true,
  });
  const entries = new Map<string, FileEntry>();
  let totalBytes = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (signal?.aborted)
        throw new ArchiveError("Backup reading was cancelled.");
      if (
        entries.size >= BACKUP_LIMITS.entries ||
        entry.directory ||
        entry.symlink ||
        entry.executable ||
        entry.encrypted ||
        entry.comment ||
        !/^(manifest\.json|items\/[a-f0-9-]{36}\.json|originals\/[a-f0-9-]{36}\.pdf)$/.test(
          entry.filename,
        ) ||
        entries.has(entry.filename)
      )
        throw new ArchiveError(
          "This backup contains an unsupported or unsafe entry.",
        );
      const limit =
        entry.filename === "manifest.json"
          ? BACKUP_LIMITS.manifestBytes
          : entry.filename.endsWith(".pdf")
            ? BACKUP_LIMITS.pdfBytes
            : BACKUP_LIMITS.itemBytes;
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize > limit ||
        entry.uncompressedSize < 1
      )
        throw new ArchiveError("An archive entry is too large or empty.");
      totalBytes += entry.uncompressedSize;
      if (totalBytes > BACKUP_LIMITS.uncompressedBytes)
        throw new ArchiveError(
          "The expanded backup exceeds the supported size.",
        );
      entries.set(entry.filename, entry);
    }
    async function read(path: string, limit: number) {
      try {
        const entry = entries.get(path);
        if (!entry)
          throw new ArchiveError("A required backup entry is missing.");
        const stop = AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(60000),
        ]);
        const data = await entry.getData(new BoundedWriter(limit), {
          signal: stop,
          checkSignature: true,
          useWebWorkers: false,
          checkLocalDirectory: true,
          checkOverlappingEntry: true,
        });
        if (data.length !== entry.uncompressedSize)
          throw new ArchiveError("An archive entry has an incorrect size.");
        return data;
      } catch (e) {
        if (e instanceof ArchiveError) throw e;
        throw new ArchiveError(
          signal?.aborted
            ? "Backup reading was cancelled."
            : "A backup entry is damaged or unreadable.",
        );
      }
    }
    const manifestBytes = await read(
        "manifest.json",
        BACKUP_LIMITS.manifestBytes,
      ),
      manifest = backupManifest.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
        ),
      );
    const expected = new Set([
      "manifest.json",
      ...manifest.items.flatMap((row) => [
        row.path,
        ...(row.original ? [row.original.path] : []),
      ]),
    ]);
    if (
      expected.size !== entries.size ||
      [...entries.keys()].some((path) => !expected.has(path))
    )
      throw new ArchiveError("The backup index does not match its files.");
    async function readItem(id: string) {
      try {
        const ref = manifest.items.find((row) => row.id === id);
        if (!ref) throw new ArchiveError("Item is not in this backup.");
        const bytes = await read(ref.path, BACKUP_LIMITS.itemBytes);
        if ((await sha256(bytes)) !== ref.sha256)
          throw new ArchiveError("An item failed its backup checksum.");
        const item = portableItem.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
        if (
          item.id !== id ||
          (!!ref.original && item.kind !== "pdf") ||
          (item.projectId &&
            !manifest.projects.some((p) => p.id === item.projectId))
        )
          throw new ArchiveError(
            "An item does not match its backup identity or project.",
          );
        if (
          ref.original &&
          (item.pdf?.byteSize !== ref.original.byteSize ||
            (item.pdf.sha256 && item.pdf.sha256 !== ref.original.sha256))
        )
          throw new ArchiveError("PDF metadata does not match its original.");
        return { item, bytes };
      } catch (e) {
        if (e instanceof ArchiveError) throw e;
        throw new ArchiveError(
          "A backup item is damaged or has an unsupported format.",
        );
      }
    }
    async function readOriginal(id: string) {
      const ref = manifest.items.find((row) => row.id === id);
      if (!ref?.original)
        throw new ArchiveError(
          "This backup does not include the original PDF.",
        );
      const bytes = await read(ref.original.path, BACKUP_LIMITS.pdfBytes);
      if (
        bytes.length !== ref.original.byteSize ||
        (await sha256(bytes)) !== ref.original.sha256
      )
        throw new ArchiveError("A PDF failed its backup checksum.");
      return bytes;
    }
    return {
      manifest,
      manifestBytes,
      readItem,
      readOriginal,
      close: () => reader.close(),
    };
  } catch (e) {
    await reader.close();
    if (e instanceof ArchiveError) throw e;
    throw new ArchiveError(
      "This backup is damaged or has an unsupported format.",
    );
  }
}
