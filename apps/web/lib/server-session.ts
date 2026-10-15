import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Profile } from "@stash/shared";
export const currentUser = cache(async (): Promise<Profile | null> => {
  const session = (await cookies()).get("stash_session");
  if (!session) return null;
  const response = await fetch(
    `${process.env.API_URL || "http://127.0.0.1:4000"}/api/me`,
    {
      headers: { cookie: `stash_session=${encodeURIComponent(session.value)}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if ([401, 403].includes(response.status)) return null;
  if (!response.ok)
    throw Error("Could not check your session. Please try again.");
  return (await response.json()).user;
});
export async function requireUser(path: string) {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(path)}`);
  return user;
}
export type PageQuery = Record<string, string | string[] | undefined>;
export function queryString(query: PageQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (typeof value === "string") params.set(key, value);
  return params.toString();
}
export function withQuery(path: string, query: PageQuery) {
  const value = queryString(query);
  return value ? `${path}?${value}` : path;
}
