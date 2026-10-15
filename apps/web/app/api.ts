import { announceBrowserAccount,endBrowserSession } from "./draft-storage";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method=(options.method||"GET").toUpperCase(),headers=new Headers(options.headers);
  if(options.body!==undefined&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");
  if(!["GET","HEAD","OPTIONS"].includes(method)&&!path.startsWith("/auth/")&&!headers.has("X-Stash-Account")){
    try{const owner=sessionStorage.getItem("stash-active-user");if(owner)headers.set("X-Stash-Account",owner);}catch{/* Editors also send their explicit owner. */}
  }
  const response=await fetch(`/api${path}`,{...options,headers});
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "The server is unavailable. Please try again.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error || "Could not complete this request.",
      response.status,
    );
  if(method==="POST"&&["/auth/signin","/auth/signup"].includes(path)&&data.user?.id)announceBrowserAccount(data.user.id);
  if(method==="POST"&&["/auth/logout","/auth/reset"].includes(path)||method==="DELETE"&&path==="/me")endBrowserSession();
  return data;
}
