import { redirect } from "next/navigation";
import { Landing } from "../components/landing/landing";
import { currentUser, withQuery, type PageQuery } from "../lib/server-session";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  const query = await searchParams;
  if (typeof query.verify === "string")
    redirect(withQuery("/account/verify", { verify: query.verify }));
  if (typeof query.reset === "string")
    redirect(withQuery("/account/reset", { reset: query.reset }));
  if (await currentUser()) {
    const path =
      typeof query.collectionId === "string" &&
      /^[a-f0-9-]{36}$/.test(query.collectionId)
        ? `/library/collections/${query.collectionId}`
        : query.favourite === "true"
          ? "/library/favourites"
          : ["archive", "trash"].includes(String(query.location))
            ? `/library/${query.location}`
            : "/library";
    const { collectionId, favourite, location, ...filters } = query;
    redirect(withQuery(path, filters));
  }
  return <Landing />;
}
