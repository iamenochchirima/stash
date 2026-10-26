import { TopicsPage } from "../../../components/topics/topics-page";
import { requireUser } from "../../../lib/server-session";
export const metadata = { title: "Topics · Stash" };
export default async function Page() {
  await requireUser("/topics");
  return <TopicsPage />;
}
