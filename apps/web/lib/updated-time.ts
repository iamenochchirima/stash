const day = 86400_000;
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});
export function updatedTime(value: string, now?: number) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Updated date unavailable";
  const date = dateFormat.format(timestamp);
  if (now === undefined) return `Updated ${date}`;
  const age = Math.max(0, now - timestamp);
  const days = Math.floor(age / day);
  if (days > 30) return `Updated ${date}`;
  if (age < 60000) return `Updated ${Math.floor(age / 1000)} sec ago`;
  if (age < 3600000) return `Updated ${Math.floor(age / 60000)} min ago`;
  if (age < day) {
    const hours = Math.floor(age / 3600000);
    return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
}
