// Only known private routes may be resumed after authentication.
export function accountReturnPath(value: string): string {
  if (/^\/oauth\/consent\?request=[A-Za-z0-9_-]{43}$/.test(value)) return value;
  if (
    /^\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return value;
  if (/^\/projects(?:\/[0-9a-f-]{36})?$/i.test(value)) return value;
  try {
    const url = new URL(value, "http://stash.local");
    if (
      url.origin !== "http://stash.local" ||
      value.startsWith("//") ||
      url.hash
    )
      return "";
    if (
      /^\/(?:library(?:\/(?:archive|trash|favourites|collections\/[a-f0-9-]{36}))?|todos|connections|profile)$/.test(
        url.pathname,
      )
    )
      return url.pathname + url.search;
    if (
      /^\/(?:items\/[a-f0-9-]{36}|topics(?:\/[a-f0-9-]{36})?|projects(?:\/[a-f0-9-]{36})?)$/.test(
        url.pathname,
      )
    )
      return url.pathname + url.search;
  } catch {}
  return "";
}
