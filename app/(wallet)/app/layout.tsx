import {APP_ORIGIN} from "@/core/app-origin";
import type { Metadata } from "next";
import "./globals.css";
import "./offline.css";
import "./terminal.css";
import "./character-field.css";
import "./payment-route.css";
import "./wallet.css";
import "./drivekey-theme.css";
import {WalletProvider} from '@/components/wallet-context';

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: "DriveKey Wallet — r21 beta",
  icons: { icon: [{ url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/brand/favicon-192.png", sizes: "192x192", type: "image/png" }], apple: "/brand/favicon-192.png" },
  description: "Your wallet dashboard for Ethereum, Robinhood Chain and Solana, with separate offline transaction approval. r21 beta.",
  openGraph: {
    title: "DriveKey Wallet — r21 beta",
    description: "Prepare online. Review and sign in a separate offline session. r21 beta.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><WalletProvider>{children}</WalletProvider></body></html>;
}
