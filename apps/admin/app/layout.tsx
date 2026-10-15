import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./pwa.css";
import { Pwa } from "./pwa";
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };
const body = localFont({ src: "../public/fonts/dm-sans.woff2", weight: "400 700", variable: "--body-font", display: "swap" });
export const metadata: Metadata = { title: "Stash Admin",
  appleWebApp: { capable: true, title: "Stash Admin", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" }, robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body className={body.variable}><Pwa name="Stash Admin">{children}</Pwa></body></html>; }
