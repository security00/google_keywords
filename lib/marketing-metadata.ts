import type { Metadata } from "next";

const SITE_URL = "https://discoverkeywords.co";

export function marketingPageMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: `${SITE_URL}${input.path}`,
    },
    openGraph: {
      type: "website",
      url: `${SITE_URL}${input.path}`,
      siteName: "Discover Keywords",
      title: input.title,
      description: input.description,
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
    },
  };
}
