import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
          color: "#f8fafc",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 74, fontWeight: 800, letterSpacing: 1.5 }}>PIXELARNIA</div>
        <div style={{ fontSize: 42, opacity: 0.96 }}>1 000 000 pixel. 1 zl = 1 pixel.</div>
        <div style={{ fontSize: 30, opacity: 0.9 }}>
          Kup miejsce dla swojej marki i zostaw slad w internecie.
        </div>
      </div>
    ),
    size
  );
}


