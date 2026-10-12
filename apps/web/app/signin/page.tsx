import type { Metadata } from "next";
import { AuthPage } from "../auth-page";

export const metadata: Metadata = { title: "Sign in · Stash" };

export default function Page() {
  return <AuthPage mode="login" />;
}
