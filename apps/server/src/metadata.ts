import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { LIMITS } from "@stash/shared";
export type Page = {
  status: number;
  location?: string;
  contentType: string;
  body: string;
};
export type Resolver = (
  host: string,
) => Promise<{ address: string; family: number }[]>;
export const publicAddress = (value: string) => {
  try {
    const parsed = ipaddr.process(value);
    return (
      parsed.range() === "unicast" &&
      !["168.63.129.16"].includes(parsed.toString())
    );
  } catch {
    return false;
  }
};
export async function resolveTarget(
  value: string,
  resolver: Resolver = (host) => lookup(host, { all: true }),
) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Unsafe URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = ipaddr.isValid(hostname)
    ? [
        {
          address: hostname,
          family: ipaddr.parse(hostname).kind() === "ipv6" ? 6 : 4,
        },
      ]
    : await resolver(hostname);
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Unsafe network destination");
  return { url, address: addresses[0] };
}
export function requestPage(
  url: URL,
  address: { address: string; family: number },
  timeout: number,
): Promise<Page> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      {
        // Pin the socket to the address already validated. No second DNS resolution is allowed.
        lookup: (_host, _options, callback) =>
          callback(null, address.address, address.family),
        agent: false,
        family: address.family,
        headers: { "User-Agent": "StashMetadata/0.1", Accept: "text/html" },
      },
      (response) => {
        const type = String(response.headers["content-type"] || "");
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400
        ) {
          response.resume();
          resolve({
            status: response.statusCode,
            location: response.headers.location,
            contentType: type,
            body: "",
          });
          return;
        }
        if (!type.toLowerCase().startsWith("text/html")) {
          response.destroy();
          reject(new Error("Not HTML"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > LIMITS.metadataBytes) {
            req.destroy(new Error("Metadata response too large"));
          } else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode || 0,
            contentType: type,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("Metadata timeout")),
      timeout,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
  });
}
export async function withDeadline<T>(
  operation: Promise<T>,
  timeout: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Metadata timeout")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function fetchMetadata(
  value: string,
  boundary: { resolver?: Resolver; request?: typeof requestPage } = {},
) {
  const started = Date.now();
  try {
    for (let redirects = 0; redirects <= LIMITS.redirects; redirects++) {
      const { url, address } = await withDeadline(
        resolveTarget(value, boundary.resolver),
        Math.max(1, LIMITS.metadataMs - (Date.now() - started)),
      );
      const remaining = LIMITS.metadataMs - (Date.now() - started);
      if (remaining <= 0) throw new Error("Timeout");
      const page = await (boundary.request || requestPage)(
        url,
        address,
        remaining,
      );
      if (page.status >= 300 && page.status < 400 && page.location) {
        value = new URL(page.location, url).toString();
        continue;
      }
      if (
        page.status !== 200 ||
        Buffer.byteLength(page.body) > LIMITS.metadataBytes ||
        !page.contentType.toLowerCase().startsWith("text/html")
      )
        throw new Error("Metadata unavailable");
      const $ = load(page.body);
      const clean = (value: string) =>
        value
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      return {
        title: clean(
          $('meta[property="og:title"]').attr("content") || $("title").text(),
        ).slice(0, 200),
        description: clean(
          $('meta[name="description"]').attr("content") ||
            $('meta[property="og:description"]').attr("content") ||
            "",
        ).slice(0, 1000),
        metadataStatus: "extracted" as const,
      };
    }
  } catch {
    /* Metadata is optional; failures do not block manual saving. */
  }
  return { description: "", metadataStatus: "unavailable" as const };
}
