import { LibraryPageClient } from "../../../../../components/library/library-page";
import {
  requireUser,
  withQuery,
  queryString,
  type PageQuery,
} from "../../../../../lib/server-session";
export const metadata = { title: "Collection · Stash" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireUser(withQuery(`/library/collections/${id}`, query));
  return (
    <LibraryPageClient initialQuery={queryString(query)} collectionId={id} />
  );
}
