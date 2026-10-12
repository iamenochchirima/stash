import type { Metadata } from "next";
import { AuthPage } from "../auth-page";

export const metadata: Metadata = { title: "Create your account · Stash" };

export default function Page() {
  return <AuthPage mode="signup" />;
}
