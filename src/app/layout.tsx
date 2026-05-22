import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Library of Babel",
  description: "A shelf catalogue for the Library of Babel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
