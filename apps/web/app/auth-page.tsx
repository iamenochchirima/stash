"use client";
import { useRouter } from "next/navigation";
import { Auth } from "./account-ui";

export function AuthPage({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  return <Auth initialMode={mode} onUser={() => router.replace("/")} />;
}
