"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Auth } from "./auth-form";
import { accountReturnPath } from "../../lib/return-path";

export function AuthPage({ mode }: { mode: "signup" | "login" | "forgot" }) {
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
      onUser={() => {
        window.location.assign(returnTo || "/library");
      }}
    />
  );
}
