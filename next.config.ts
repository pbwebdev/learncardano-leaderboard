import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function gitShortHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_HASH: process.env.NEXT_PUBLIC_BUILD_HASH ?? gitShortHash(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;

// Initialize OpenNext Cloudflare bindings for `next dev` (so getCloudflareContext()
// works in local dev against wrangler.jsonc bindings).
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
