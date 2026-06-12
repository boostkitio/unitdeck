"use client";

import { MeshGradient } from "@paper-design/shaders-react";

/**
 * Animated brand-navy backdrop for the marketing CTA band.
 * Decorative only; sits behind content via absolute positioning.
 */
export function ShaderBand() {
  return (
    <MeshGradient
      colors={["#11182F", "#1F2747", "#34406B", "#6B7FBE"]}
      distortion={0.9}
      swirl={0.5}
      speed={0.25}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  );
}
