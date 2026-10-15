import type { Metadata } from "next";
import { AuthPage } from "../../components/account/auth-page";

export const metadata: Metadata = { title: "Create your account · Stash" };

export default function Page() {
  return <AuthPage mode="signup" />;
}
