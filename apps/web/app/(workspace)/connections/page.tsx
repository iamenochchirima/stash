import { ConnectionsPageClient } from "../../../components/connections/connections-page";
import { requireUser } from "../../../lib/server-session";
export const metadata = { title: "Agent connections · Stash" };
export default async function Page() {
  await requireUser("/connections");
  return <ConnectionsPageClient />;
}
