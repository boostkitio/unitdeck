/**
 * Headless Chromium for PDF routes: @sparticuz/chromium on Vercel, the
 * installed Chrome locally. Keep in sync with next.config.ts
 * (serverExternalPackages + outputFileTracingIncludes per route).
 */
export async function launchBrowser() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  return puppeteer.launch({ channel: "chrome", headless: true });
}
