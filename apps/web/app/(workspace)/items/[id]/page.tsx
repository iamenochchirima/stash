import { ItemDetail } from "../../../../components/items/item-detail";
import {
  requireUser,
  withQuery,
  type PageQuery,
} from "../../../../lib/server-session";
export const metadata = { title: "Saved item · Stash" };
export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  const { id } = await params;
  await requireUser(withQuery(`/items/${id}`, await searchParams));
  return <ItemDetail id={id} />;
}
