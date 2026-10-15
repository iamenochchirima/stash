import { ProfilePageClient } from "../../../components/account/profile-page";
import { requireUser } from "../../../lib/server-session";
export const metadata = { title: "Profile · Stash" };
export default async function Page() {
  await requireUser("/profile");
  return <ProfilePageClient />;
}
