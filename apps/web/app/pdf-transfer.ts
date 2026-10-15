import { api, ApiError } from "./api";
import type { Item } from "@stash/shared";
export async function uploadPdf(file: File, progress: (percent: number) => void, details: { projectId?: string; title: string; notes: string; tags: string[]; collectionIds: string[]; status: string; requestId: string },expectedUserId?:string): Promise<Item> {
  const ticket = await api<{ token: string; uploadUrl: string; item?: Item }>("/items/uploads", { method: "POST", headers:expectedUserId?{"X-Stash-Account":expectedUserId}:undefined, body: JSON.stringify({ filename: file.name, byteSize: file.size, ...details }) });
  if (ticket.item) return ticket.item;
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", ticket.uploadUrl); request.timeout = 120000;
    request.setRequestHeader("Content-Type", "application/pdf"); request.setRequestHeader("Authorization", `Bearer ${ticket.token}`);
    request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new Error("Upload interrupted. Choose the file and try again."));
    request.ontimeout = () => reject(new Error("Upload timed out. Try again."));
    request.onload = () => {
      let data; try { data = JSON.parse(request.responseText); } catch { reject(new Error("The upload could not be confirmed. Check your library before retrying.")); return; }
      if (request.status >= 200 && request.status < 300) resolve(data.item);
      else reject(new ApiError(data.error || "Could not upload this file.", request.status));
    };
    request.send(file);
  });
}
export async function downloadPdf(item: Item) {
  const ticket = await api<{ token: string; downloadUrl: string }>(`/items/${item.id}/download`, { method: "POST", body: "{}" });
  const response = await fetch(ticket.downloadUrl, { headers: { Authorization: `Bearer ${ticket.token}` }, credentials: "omit" });
  if (!response.ok) throw new Error("Could not download this PDF. Try again.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = item.pdf?.filename || "document.pdf"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
