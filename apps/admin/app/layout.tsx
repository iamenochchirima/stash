import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const body = localFont({ src: "../public/fonts/dm-sans.woff2", weight: "400 700", variable: "--body-font", display: "swap" });
export const metadata: Metadata = { title: "Stash Admin", robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body className={body.variable}>{children}</body></html>; }
