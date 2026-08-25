import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Chromium's binary assets out of the bundler so the PDF route can
  // load them from node_modules at runtime on Vercel.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "pdfjs-dist"],
  // The tracer can't see chromium's dynamically-loaded brotli binaries;
  // include them explicitly or the function ships without a browser.
  outputFileTracingIncludes: {
    "/api/call-sheets/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/tools/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/documents/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    // pdfjs loads its font and character maps from disk at read time, and the
    // tracer cannot see a path it builds itself.
    "/api/schedule/extract": [
      "./node_modules/pdfjs-dist/legacy/build/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
    ],
  },
};

export default nextConfig;
