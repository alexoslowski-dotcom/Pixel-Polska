import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: "https://pixelpolska.pl/sitemap.xml",
    host: "https://pixelpolska.pl",
  };
}
