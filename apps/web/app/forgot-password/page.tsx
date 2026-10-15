import { AuthPage } from "../../components/account/auth-page";
export const metadata = { title: "Reset your password · Stash" };
export default function Page() {
  return <AuthPage mode="forgot" />;
}
