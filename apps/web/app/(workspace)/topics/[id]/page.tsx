import { LibraryPageClient } from "../../../../components/library/library-page";
import {
  requireUser,
  withQuery,
  queryString,
  type PageQuery,
} from "../../../../lib/server-session";
export const metadata = { title: "Topic · Stash" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  const { id } = await params,
    query = await searchParams;
  await requireUser(withQuery(`/topics/${id}`, query));
  return (
    <LibraryPageClient
      key={id}
      initialQuery={queryString(query)}
      topicId={id}
    />
  );
}
