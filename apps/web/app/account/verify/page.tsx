import { AccountLinkPage } from "../../../components/account/account-link-page";
import type { PageQuery } from "../../../lib/server-session";
export const metadata = { title: "Verify your email · Stash" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  const query = await searchParams;
  return (
    <AccountLinkPage
      purpose="verify"
      token={typeof query.verify === "string" ? query.verify : ""}
    />
  );
}
