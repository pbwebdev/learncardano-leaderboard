import type { MetadataRoute } from "next";

// Keep in sync with src/app/layout.tsx SITE_URL.
const SITE_URL = "https://learncardano-leaderboard.learncardano.io";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin/", "/me", "/me/onboarding"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
