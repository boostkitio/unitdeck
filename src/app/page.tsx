import type { Metadata } from "next";
import Link from "next/link";
import { HeaderAuthLink, HeroAuthAction } from "./home-auth";
import { Logo } from "@/components/logo";
import { BRAND, SITE_URL } from "@/lib/brand";
import { JsonLd, marketingMetadata } from "@/lib/marketing-metadata";

export const metadata: Metadata = marketingMetadata({
  description: BRAND.description,
  path: "",
});

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-50">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE_URL}/#organization`,
              name: BRAND.name,
              url: SITE_URL,
              logo: `${SITE_URL}/icon.svg`,
            },
            {
              "@type": "WebSite",
              "@id": `${SITE_URL}/#website`,
              name: BRAND.name,
              url: SITE_URL,
              description: BRAND.description,
              inLanguage: "en-GB",
              publisher: { "@id": `${SITE_URL}/#organization` },
            },
          ],
        }}
      />
      {/* Background video. Decorative only: muted, looped, hidden from AT. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/hero-poster.jpg"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>
      {/* Legibility overlays: flat darken plus a grounding gradient */}
      <div className="absolute inset-0 bg-neutral-950/70" aria-hidden="true" />
      <div
        className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-transparent to-neutral-950/60"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-end px-8 py-6">
          <HeaderAuthLink />
        </header>
        <section className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <Logo size={32} className="mb-8" />
          <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {BRAND.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-balance text-neutral-300">{BRAND.description}</p>
          <div className="mt-8">
            <HeroAuthAction />
          </div>
        </section>
        <footer className="flex flex-col gap-4 px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-neutral-400">
            {BRAND.name} · {BRAND.domain}
          </span>
          <nav aria-label="Compare and free tools">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <li>
                <Link
                  className="text-neutral-300 hover:text-white"
                  href="/compare/studiobinder-alternative"
                >
                  StudioBinder alternative
                </Link>
              </li>
              <li>
                <Link className="text-neutral-300 hover:text-white" href="/compare/yamdu-alternative">
                  Yamdu alternative
                </Link>
              </li>
              <li>
                <Link
                  className="text-neutral-300 hover:text-white"
                  href="/templates/call-sheet-template"
                >
                  Free call sheet maker
                </Link>
              </li>
            </ul>
          </nav>
        </footer>
      </div>
    </main>
  );
}
