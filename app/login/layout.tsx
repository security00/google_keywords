import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log in | Discover Keywords",
  description: "Sign in to Discover Keywords to open Opportunity Radar, manage billing, and continue a tax-inclusive Founding Member subscription.",
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
