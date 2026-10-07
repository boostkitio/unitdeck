/**
 * IndexNow submission script, manually invoked when content meaningfully changes.
 *
 * Usage:  npm run indexnow                  (the main pages in DEFAULT_URLS)
 *         npm run indexnow -- --dry-run     (no network)
 *         npm run indexnow:all              (full sitemap, only for major refreshes)
 *
 * IMPORTANT: do not wire this into postbuild. IndexNow has a per-host soft
 * quota. Submitting every sitemap URL on every Vercel deploy gets the host
 * added to Bing's UserForbiddedToAccessSite banlist. That state survives
 * key rotation and only lifts via a Bing Webmaster Tools support ticket.
 *
 * IndexNow notifies Bing, Yandex, Seznam, and Naver. Google does not use it.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// --- Per-project config (set during add-project bootstrap) ---
const INDEXNOW_KEY = "90dabd2ce76735f20f0cf5f2bd0e5a7a"
const HOST = "unitdeck.app"
const SITEMAP_URL = `https://${HOST}/sitemap.xml`
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`

// The homepage by default; add hub pages, eight at most. Lets Bing's natural
// crawl handle deep pages and keeps us well under the spam threshold.
const DEFAULT_URLS = [`https://${HOST}/`]

// --- Submission logic (do not edit per-project) ---
const ENDPOINT = "https://api.indexnow.org/IndexNow"

async function fetchSitemapUrls() {
  const res = await fetch(SITEMAP_URL, { cache: "no-store" })
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`)
  const xml = await res.text()
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g))
    .map((m) => m[1].trim())
    .filter((u) => u.includes(HOST))
}

async function submit() {
  const dryRun = process.argv.includes("--dry-run")
  const all = process.argv.includes("--all")

  let urls = DEFAULT_URLS
  if (all) {
    try {
      urls = await fetchSitemapUrls()
      console.log(`[IndexNow] Pulled ${urls.length} URLs from ${SITEMAP_URL}`)
    } catch (e) {
      console.error(`[IndexNow] Sitemap fetch failed (non-blocking):`, e.message)
      return
    }
  }

  if (urls.length === 0) {
    console.warn(`[IndexNow] No URLs to submit, skipping.`)
    return
  }

  if (dryRun) {
    console.log(`[IndexNow] Dry run, would submit ${urls.length} URLs:`)
    for (const u of urls) console.log("  " + u)
    return
  }

  console.log(`[IndexNow] Submitting ${urls.length} URLs to ${ENDPOINT}...`)
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: KEY_LOCATION,
        urlList: urls,
      }),
    })

    if (response.status === 200 || response.status === 202) {
      console.log(`[IndexNow] Success, ${urls.length} URLs accepted (${response.status}).`)
      return
    }

    if (response.status === 403) {
      console.log(`[IndexNow] Skipped, host is in Bing's UserForbiddedToAccessSite state. Open a Bing Webmaster Tools support ticket to lift it.`)
      return
    }

    const text = await response.text().catch(() => "")
    console.warn(`[IndexNow] Unexpected response ${response.status}: ${text}`)
  } catch (e) {
    console.warn(`[IndexNow] Submission failed (non-blocking):`, e.message)
  }
}

submit()
