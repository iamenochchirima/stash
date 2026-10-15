"use client";

import { AccountLink } from "./account-link-form";
export function AccountLinkPage({
  purpose,
  token,
}: {
  purpose: "verify" | "reset";
  token: string;
}) {
  return (
    <AccountLink
      purpose={purpose}
      token={token}
      onDone={() => {
        window.location.assign(purpose === "reset" ? "/signin" : "/library");
      }}
    />
  );
}
