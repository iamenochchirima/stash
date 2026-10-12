import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Stash · Your research, within reach",
  description:
    "A private research library you can use from your favorite AI agents.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
