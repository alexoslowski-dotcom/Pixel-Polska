import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: "https://pixelarnia.pl/sitemap.xml",
    host: "https://pixelarnia.pl",
  };
}

