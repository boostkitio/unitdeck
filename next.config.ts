import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Chromium's binary assets out of the bundler so the PDF route can
  // load them from node_modules at runtime on Vercel.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // The tracer can't see chromium's dynamically-loaded brotli binaries;
  // include them explicitly or the function ships without a browser.
  outputFileTracingIncludes: {
    "/api/call-sheets/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/tools/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
