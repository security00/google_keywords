import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { GoogleAnalytics } from "@/components/google-analytics";
import { ProductJsonLd } from "@/components/product-json-ld";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://discoverkeywords.co"),
  title: "Discover Keywords | Reviewed Keyword Opportunity Platform",
  description: "Find reviewed keyword opportunities from multi-source signals, trends, SERP checks, and guarded discovery workflows.",
  icons: {
    icon: [{ url: "/favicon.ico" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://discoverkeywords.co",
    siteName: "Discover Keywords",
    title: "Discover Keywords | Reviewed Keyword Opportunity Platform",
    description:
      "Find reviewed keyword opportunities from multi-source signals, trends, SERP checks, and guarded discovery workflows.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Discover Keywords | Reviewed Keyword Opportunity Platform",
    description:
      "Find reviewed keyword opportunities from multi-source signals, trends, SERP checks, and guarded discovery workflows.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ProductJsonLd />
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
