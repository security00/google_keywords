import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legacy discovery | Discover Keywords",
  robots: { index: false, follow: false },
};

export default function DiscoveryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
