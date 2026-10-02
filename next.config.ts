import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Addresses that have moved. A shoot day used to be reached through
  // /shoot-days/<document id>/…; it is now addressed by its date, under the
  // page it belongs to. The new pages read an id as well as a date, so an old
  // bookmark lands on the right day and the address then tidies itself.
  async redirects() {
    return [
      {
        source: "/projects/:project/shoot-days/:day/call-sheet",
        destination: "/projects/:project/call-sheets/:day",
        permanent: true,
      },
      {
        source: "/projects/:project/shoot-days/:day/wrap",
        destination: "/projects/:project/wrap/:day",
        permanent: true,
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      // Paged.js's package points bundlers at its unbundled source, whose
      // es5-ext dependency breaks under Turbopack ("contains.call is not a
      // function"). Its own prebuilt ES module has that inlined and works.
      pagedjs: "./node_modules/pagedjs/dist/paged.esm.js",
    },
  },
  // Keep Chromium's binary assets out of the bundler so the PDF route can
  // load them from node_modules at runtime on Vercel.
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    "pdfjs-dist",
    "@napi-rs/canvas",
  ],
  // The tracer can't see chromium's dynamically-loaded brotli binaries;
  // include them explicitly or the function ships without a browser.
  outputFileTracingIncludes: {
    "/api/call-sheets/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/tools/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/documents/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/quotes/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    // pdfjs loads its font and character maps from disk at read time, and the
    // tracer cannot see a path it builds itself. Nor can it see the require()
    // pdfjs builds at runtime for @napi-rs/canvas — which is not optional:
    // pdfjs takes DOMMatrix from it at import, so without it the module
    // throws "DOMMatrix is not defined" before a single PDF is read.
    "/api/schedule/extract": [
      "./node_modules/pdfjs-dist/legacy/build/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
    ],
  },
};

export default nextConfig;
