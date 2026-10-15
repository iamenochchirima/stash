import { LibraryPageClient } from "../../../../components/library/library-page";
import {
  requireUser,
  withQuery,
  queryString,
  type PageQuery,
} from "../../../../lib/server-session";
export const metadata = { title: "Archive · Stash" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  const query = await searchParams;
  await requireUser(withQuery("/library/archive", query));
  return (
    <LibraryPageClient initialQuery={queryString(query)} location="archive" />
  );
}
