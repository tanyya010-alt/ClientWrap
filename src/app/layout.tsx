import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CookieNotice } from "@/components/cookie-notice";

export const metadata: Metadata = {
  title: { default: "ClientWrap: results, invoices and next steps in one link", template: "%s · ClientWrap" },
  description: "Wrap up every client's month: results, invoices and next steps in one link.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#4f46e5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <CookieNotice />
      </body>
    </html>
  );
}
