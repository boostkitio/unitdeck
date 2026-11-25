import type { Metadata } from "next";
import { BRAND, SITE_URL } from "@/lib/brand";

/** The hero still from the homepage, used as the share image on marketing pages. */
const SHARE_IMAGE = {
  url: `${SITE_URL}/hero-poster.jpg`,
  width: 1280,
  height: 720,
  alt: "A video production crew setting up a shot on a studio set",
};

/**
 * Canonical, Open Graph and Twitter tags for a public marketing page.
 * Only the marketing pages use this; app and share-link routes keep their own.
 */
export function marketingMetadata({
  title,
  description,
  path,
}: {
  /** Page title without the brand; the layout template appends it. Omit for the homepage. */
  title?: string;
  description: string;
  /** Path from the site root, "" for the homepage. */
  path: string;
}): Metadata {
  const url = `${SITE_URL}${path}`;
  const shareTitle = title ? `${title} · ${BRAND.name}` : `${BRAND.name} · ${BRAND.tagline}`;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: BRAND.name,
      locale: "en_GB",
      title: shareTitle,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [SHARE_IMAGE.url],
    },
  };
}

/** A JSON-LD script tag. Content is built from constants, never from user input. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [{ name: BRAND.name, path: "" }, ...items].map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}
