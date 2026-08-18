import { describe, expect, test } from "vitest";

import { marketingPageMetadata } from "./marketing-metadata";

describe("marketingPageMetadata", () => {
  test("sets per-page canonical and open graph fields", () => {
    const metadata = marketingPageMetadata({
      title: "Game Keyword Research | Discover Keywords",
      description: "Find reviewed game keyword opportunities.",
      path: "/game-keyword-research",
    });

    expect(metadata.alternates).toEqual({
      canonical: "https://discoverkeywords.co/game-keyword-research",
    });
    expect(metadata.openGraph).toMatchObject({
      url: "https://discoverkeywords.co/game-keyword-research",
      title: "Game Keyword Research | Discover Keywords",
    });
  });
});
