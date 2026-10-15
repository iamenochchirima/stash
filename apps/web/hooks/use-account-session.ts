"use client";
import { useEffect } from "react";
import { listenForAccountChange } from "../lib/draft-storage";
export function useAccountSession(userId: string) {
  useEffect(() => {
    if (userId)
      return listenForAccountChange(userId, () => {
        window.dispatchEvent(new Event("stash-session-ended"));
        location.replace("/signin");
      });
  }, [userId]);
}
