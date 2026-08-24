import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TNW Photos",
  description: "Lightweight photo ingest, rank & share for The New World",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
