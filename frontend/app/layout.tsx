import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AidLedger · Transparent Aid Funding",
  description: "Explore transparent aid funding with fictional campaigns, milestone evidence, and accountable demo releases.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
