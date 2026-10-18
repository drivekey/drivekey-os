import './feature-navigation.css';

import type { Metadata } from "next";
import "./globals.css";
import "./offline.css";
import "./terminal.css";
import "./holder-benefits.css";
import "./character-field.css";
import "./payment-route.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://drivekey.info"),
  title: "DriveKey — Robinhood Chain",
  icons: { icon: [{ url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/brand/favicon-192.png", sizes: "192x192", type: "image/png" }], apple: "/brand/favicon-192.png" },
  description: "Prepare Robinhood Chain transfers online and approve them in a separate offline USB signing session. Windows prototype.",
  openGraph: {
    title: "DriveKey — Robinhood Chain",
    description: "An online dashboard and a separately booted offline signer for Robinhood Chain ETH.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
