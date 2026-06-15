import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const MARK_PATH =
  "M0 83.6663L66.672 100.333L133.333 83.6663V100.333L66.672 117L0 100.333V83.6663ZM0 50.333L66.672 66.9997L133.333 50.333V66.9997L66.672 83.6663L0 66.9997V50.333ZM0 16.9997L66.672 0.333008L133.333 16.9997V33.6663L66.672 50.333L0 33.6663V16.9997Z";

export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "180px",
          height: "180px",
          background: "#11182F",
        }}
      >
        <svg
          viewBox="0 0 134 117"
          width="110"
          height="96"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={MARK_PATH} fill="#ffffff" />
        </svg>
      </div>
    ),
    size,
  );
}
