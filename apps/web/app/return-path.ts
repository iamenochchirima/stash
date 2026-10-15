// Only known private routes may be resumed after authentication.
export function accountReturnPath(value: string): string {
  if (/^\/oauth\/consent\?request=[A-Za-z0-9_-]{43}$/.test(value)) return value;
  if (/^\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  if (/^\/projects(?:\/[0-9a-f-]{36})?$/i.test(value)) return value;
  return "";
}
