import type { Metadata } from "next";
import { Consent } from "./consent";
export const metadata: Metadata = {
  title: "Connect your agent · Stash",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <Consent />;
}
