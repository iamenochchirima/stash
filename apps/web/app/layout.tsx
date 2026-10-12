import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const bodyFont = localFont({ src: "../public/fonts/dm-sans.woff2", weight: "400 700", variable: "--font-public-body", display: "swap" });
const headingFont = localFont({ src: "../public/fonts/manrope.woff2", weight: "400 700", variable: "--font-public-heading", display: "swap" });
export const metadata: Metadata = {
  title: "Stash · Save as you go",
  description:
    "Save useful links and notes as you chat or research. Retrieve them in your next conversation.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${headingFont.variable}`}>{children}</body>
    </html>
  );
}
