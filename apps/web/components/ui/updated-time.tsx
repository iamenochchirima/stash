"use client";
import { useSyncExternalStore } from "react";
import { updatedTime } from "../../lib/updated-time";

let now: number | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function tick() {
  now = Date.now();
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) { tick(); timer = setInterval(tick, 1000); }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(timer); timer = undefined; now = undefined; }
  };
}
const snapshot = () => now;
const serverSnapshot = () => undefined;
export function UpdatedTime({ value }: { value: string }) {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <time dateTime={value} title={value}>{updatedTime(value, current)}</time>;
}
