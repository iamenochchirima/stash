import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./pwa.css";
import { Pwa } from "../components/pwa/pwa";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};
const bodyFont = localFont({
  src: "../public/fonts/dm-sans.woff2",
  weight: "400 700",
  variable: "--font-public-body",
  display: "swap",
});
const headingFont = localFont({
  src: "../public/fonts/manrope.woff2",
  weight: "400 700",
  variable: "--font-public-heading",
  display: "swap",
});
export const metadata: Metadata = {
  title: "Stash · Save as you go",
  appleWebApp: { capable: true, title: "Stash", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
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
      <body className={`${bodyFont.variable} ${headingFont.variable}`}>
        <Pwa name="Stash">{children}</Pwa>
      </body>
    </html>
  );
}
