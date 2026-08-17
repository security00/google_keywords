import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create account | Discover Keywords",
  description: "Create a Discover Keywords account. Public signup stays invite-gated until enabled; invite codes still unlock a longer trial.",
  robots: { index: true, follow: true },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
