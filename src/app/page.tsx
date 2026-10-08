import Link from "next/link";
import { Logo } from "@/components/logo";
import { HomeCta, HomeHeaderLink } from "@/components/marketing/home-auth";
import { JsonLd } from "@/components/marketing/json-ld";
import { MarketingLinks } from "@/components/marketing/marketing-links";
import { BRAND, SITE_URL } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const TITLE = `${BRAND.name}: video production management software`;

export const metadata = {
  ...pageMetadata({
    title: TITLE,
    description:
      "Production management software for video production companies: plan shoot days, book crew and kit, send call sheets, quote clients and get releases signed.",
    path: "/",
  }),
  // The brand is already in the title, so skip the layout's "· UnitDeck" suffix.
  title: { absolute: TITLE },
  alternates: { canonical: SITE_URL },
};

const FEATURES = [
  {
    title: "Projects and shoot days",
    body: "Paste the client email and the Brief Parser proposes the project, the client and the shoot days for you to approve and edit.",
  },
  {
    title: "Call sheets",
    body: "Call sheets assemble themselves from the project, with weather, sunrise, sunset, parking and the nearest A&E filled in. The PDF is printed from the same layout as the preview.",
  },
  {
    title: "Crew confirmations",
    body: "Every crew member gets a personal mobile page with their call time, maps and safety notes, and confirms with one tap. No login needed.",
  },
  {
    title: "Crew, kit and locations",
    body: "Keep the people you book, the equipment you use and the places you shoot in one place, and build a kit list for each project.",
  },
  {
    title: "Quotes",
    body: "Price a job for the client and send the quote as a clean PDF.",
  },
  {
    title: "Releases signed online",
    body: "Send talent and location releases as a link and get them signed on a phone, with a signed PDF to keep.",
  },
] as const;

const ORGANISATION = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organisation`,
  name: BRAND.name,
  url: SITE_URL,
};

const WEBSITE = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: BRAND.name,
  url: SITE_URL,
  publisher: { "@id": `${SITE_URL}/#organisation` },
};

const SOFTWARE = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: BRAND.name,
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: BRAND.description,
  publisher: { "@id": `${SITE_URL}/#organisation` },
};

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-50">
      <JsonLd data={ORGANISATION} />
      <JsonLd data={WEBSITE} />
      <JsonLd data={SOFTWARE} />
      {/* Background video. Decorative only: muted, looped, hidden from AT. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/hero-poster.jpg"
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-screen w-full object-cover"
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>
      {/* Legibility overlays: flat darken plus a grounding gradient */}
      <div className="absolute inset-x-0 top-0 h-screen bg-neutral-950/70" aria-hidden="true" />
      <div
        className="absolute inset-x-0 top-0 h-screen bg-gradient-to-t from-neutral-950 via-transparent to-neutral-950/60"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-end px-8 py-6">
          <HomeHeaderLink />
        </header>
        <section className="flex min-h-[calc(100vh-5rem)] flex-col items-center justify-center px-8 pb-20 text-center">
          <Logo size={32} className="mb-8" />
          <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {BRAND.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-balance text-neutral-300">
            {BRAND.name} is production management software for video production companies.{" "}
            {BRAND.description}
          </p>
          <div className="mt-8">
            <HomeCta />
          </div>
        </section>
        <section className="mx-auto w-full max-w-5xl px-8 pb-20">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            One place for the whole production, from client brief to wrap
          </h2>
          <p className="mt-3 max-w-2xl text-neutral-300">
            Built for corporate, branded and commercial video producers who shoot every week.
          </p>
          <ul className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-neutral-300">{feature.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 max-w-2xl text-sm text-neutral-300">
            Not ready for new software? Start with the{" "}
            <Link
              className="font-medium text-white underline underline-offset-4"
              href="/templates/call-sheet-template"
            >
              free call sheet template
            </Link>
            : fill it in online and download a PDF.
          </p>
        </section>
        <footer className="flex flex-col gap-4 px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-neutral-400">
            {BRAND.name} · {BRAND.domain}
          </span>
          <MarketingLinks className="text-sm text-neutral-300 hover:text-white" />
        </footer>
      </div>
    </main>
  );
}
