import type { Metadata, Viewport } from "next";
import { PwaRegister } from "./pwa-register";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#284d43",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  applicationName: "Library of Babel",
  title: "Library of Babel",
  description:
    "A descriptive shelf catalogue, commonplace book, and reading ledger for the Library of Babel.",
  appleWebApp: {
    capable: true,
    title: "Babel",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    title: "Library of Babel",
    description:
      "A descriptive shelf catalogue, commonplace book, and reading ledger for the Library of Babel.",
    siteName: "Library of Babel",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Library of Babel",
    description:
      "A descriptive shelf catalogue, commonplace book, and reading ledger for the Library of Babel.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
