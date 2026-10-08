import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MARK_PATH =
  "M0 83.6663L66.672 100.333L133.333 83.6663V100.333L66.672 117L0 100.333V83.6663ZM0 50.333L66.672 66.9997L133.333 50.333V66.9997L66.672 83.6663L0 66.9997V50.333ZM0 16.9997L66.672 0.333008L133.333 16.9997V33.6663L66.672 50.333L0 33.6663V16.9997Z";

// Shared by every public page: child routes inherit it unless they define
// their own.
export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "1200px",
          height: "630px",
          padding: "90px",
          background: "#11182F",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <svg viewBox="0 0 134 117" width="92" height="80" xmlns="http://www.w3.org/2000/svg">
            <path d={MARK_PATH} fill="#ffffff" />
          </svg>
          <div style={{ marginLeft: "28px", fontSize: "64px", fontWeight: 700 }}>{BRAND.name}</div>
        </div>
        <div style={{ marginTop: "48px", fontSize: "54px", lineHeight: 1.2, maxWidth: "900px" }}>
          {BRAND.tagline}
        </div>
      </div>
    ),
    size,
  );
}
