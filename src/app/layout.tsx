import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Knowledge Hub",
  description: "Ask questions about company SOPs, policies and onboarding material, with cited answers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
