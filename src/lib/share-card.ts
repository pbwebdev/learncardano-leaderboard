/**
 * SVG share-card generator. Phase 3.
 *
 * 1200x630 SVGs designed to read well as Open Graph images on X,
 * Discord, Telegram. All inline — no font imports, no rasterisation
 * pass. Modern social scrapers render SVG fine as og:image; a PNG
 * conversion (via resvg-wasm) is the documented upgrade path if we
 * later need to support older clients.
 *
 * Cached in R2 under `share-cards/profile/<stakeAddress>.svg` and
 * `share-cards/task/<taskId>.svg`. Regen on every read for v1
 * (cheap — just string interpolation); the R2 cache key still
 * accelerates the second hit because we skip the regen-and-store
 * step when an unchanged object exists.
 */

export interface ProfileCardInput {
  stakeAddress: string;
  points: number;
  rank?: number | null;
  verified: number;
  projectsEngaged: number;
}

export interface TaskCardInput {
  projectName: string;
  taskTitle: string;
  points: number;
}

/**
 * Render a profile-scoped share card. SVG attribute values are
 * escaped via xmlEscape so user-supplied strings (xHandle, etc.)
 * can't inject XML.
 */
export function renderProfileCard(input: ProfileCardInput): string {
  const shortStake = `${input.stakeAddress.slice(0, 12)}…${input.stakeAddress.slice(-6)}`;
  const rankLabel = input.rank ? `#${input.rank}` : "—";
  return baseCard({
    eyebrow: "Learn Cardano · Leaderboard",
    headline: rankLabel === "—" ? "Cardano leaderboard player" : `Rank ${rankLabel}`,
    subhead: shortStake,
    stats: [
      { label: "Points", value: String(input.points || 0) },
      { label: "Verified tasks", value: String(input.verified || 0) },
      { label: "Projects engaged", value: String(input.projectsEngaged || 0) },
    ],
    footer: "leaderboard.learncardano.io",
  });
}

export function renderTaskCard(input: TaskCardInput): string {
  // Pass raw — baseCard escapes inside the text node interpolation.
  return baseCard({
    eyebrow: input.projectName,
    headline: input.taskTitle,
    subhead: `${input.points} pts on completion`,
    stats: [],
    footer: "leaderboard.learncardano.io",
  });
}

function baseCard(opts: {
  eyebrow: string;
  headline: string;
  subhead: string;
  stats: Array<{ label: string; value: string }>;
  footer: string;
}): string {
  const stats = opts.stats
    .map((s, i) => {
      const x = 80 + i * 360;
      return `
    <g transform="translate(${x},420)">
      <text font-family="ui-monospace, Menlo, Consolas, monospace" font-size="56" fill="#f4f1ea">${xmlEscape(s.value)}</text>
      <text y="40" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="22" fill="#a39684">${xmlEscape(s.label)}</text>
    </g>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1c1815"/>
      <stop offset="100%" stop-color="#0f0d0b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="32" fill="none" stroke="#33291c" stroke-width="2"/>
  <text x="80" y="120" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="26" fill="#c98c33" letter-spacing="2">${xmlEscape(opts.eyebrow.toUpperCase())}</text>
  <text x="80" y="210" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="80" font-weight="700" fill="#f4f1ea">${xmlEscape(opts.headline)}</text>
  <text x="80" y="280" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="28" fill="#a39684">${xmlEscape(opts.subhead)}</text>
  ${stats}
  <text x="80" y="570" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="22" fill="#a39684">${xmlEscape(opts.footer)}</text>
</svg>`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
