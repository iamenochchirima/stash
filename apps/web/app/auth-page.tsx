"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Auth } from "./account-ui";

export function AuthPage({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState("");
  useEffect(() => {
    const next = new URLSearchParams(location.search).get("next") || "";
    if (/^\/oauth\/consent\?request=[A-Za-z0-9_-]{43}$/.test(next))
      setReturnTo(next);
  }, []);
  return (
    <Auth
      initialMode={mode}
      returnTo={returnTo}
      onUser={() => router.replace(returnTo || "/")}
    />
  );
}
