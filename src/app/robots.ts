import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/projects",
        "/quotes",
        "/people",
        "/talent",
        "/clients",
        "/locations",
        "/equipment",
        "/settings",
        "/feedback",
        "/s/",
        "/sign/",
        "/print/",
        "/api/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
