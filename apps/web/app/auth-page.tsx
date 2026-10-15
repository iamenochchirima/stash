"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Auth } from "./account-ui";
import { accountReturnPath } from "./return-path";

export function AuthPage({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState("");
  useEffect(() => {
    const next = new URLSearchParams(location.search).get("next") || "";
    setReturnTo(accountReturnPath(next));
  }, []);
  return (
    <Auth
      initialMode={mode}
      returnTo={returnTo}
      onUser={() => router.replace(returnTo || "/")}
    />
  );
}
