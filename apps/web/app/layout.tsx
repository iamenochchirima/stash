import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import "./pwa.css";
import "./appearance.css";
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
    <html
      lang="en"
      data-theme="light"
      data-theme-preference="system"
      suppressHydrationWarning
    >
      <body className={`${bodyFont.variable} ${headingFont.variable}`}>
        <Script id="stash-theme" strategy="beforeInteractive">
          {`(() => {
            const key = "stash-theme";
            const root = document.documentElement;
            const media = window.matchMedia("(prefers-color-scheme: dark)");
            const apply = () => {
              let preference = "system";
              try {
                const saved = window.localStorage.getItem(key);
                if (saved === "light" || saved === "dark" || saved === "system")
                  preference = saved;
              } catch {}
              root.dataset.themePreference = preference;
              root.dataset.theme =
                preference === "system"
                  ? media.matches ? "dark" : "light"
                  : preference;
            };
            apply();
            media.addEventListener("change", apply);
            window.addEventListener("storage", (event) => {
              if (event.key === key || event.key === null) apply();
            });
          })();`}
        </Script>
        <Pwa name="Stash">{children}</Pwa>
      </body>
    </html>
  );
}
