import { ImageResponse } from "next/og";

export const alt = "Discover Keywords";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(180deg, #ffffff 0%, #f3f8ff 100%)",
          padding: "72px",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.03em",
          }}
        >
          Discover Keywords
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.04em",
              maxWidth: 920,
            }}
          >
            Find buildable keyword opportunities before the market sees them.
          </div>
          <div style={{ fontSize: 28, color: "#475569", maxWidth: 820 }}>
            Reviewed signals, trend checks, and SERP-aware scores for tool sites,
            AI products, game pages, and SEO operators.
          </div>
        </div>
      </div>
    ),
    size
  );
}
