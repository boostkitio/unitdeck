import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Chromium's binary assets out of the bundler so the PDF route can
  // load them from node_modules at runtime on Vercel.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
