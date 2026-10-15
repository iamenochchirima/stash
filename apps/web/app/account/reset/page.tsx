import { AccountLinkPage } from "../../../components/account/account-link-page";
import type { PageQuery } from "../../../lib/server-session";
export const metadata = { title: "Reset your password · Stash" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  const query = await searchParams;
  return (
    <AccountLinkPage
      purpose="reset"
      token={typeof query.reset === "string" ? query.reset : ""}
    />
  );
}
