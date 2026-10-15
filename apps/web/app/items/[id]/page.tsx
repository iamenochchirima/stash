import { ItemDetail } from "../../item-detail";
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  return <ItemDetail id={(await params).id} />;
}
