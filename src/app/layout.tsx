/*

███╗   ███╗███████╗███████╗██╗  ██╗    ██╗    ██╗██╗████████╗██╗  ██╗    ██╗   ██╗███████╗
████╗ ████║██╔════╝██╔════╝██║  ██║    ██║    ██║██║╚══██╔══╝██║  ██║    ██║   ██║██╔════╝
██╔████╔██║█████╗  ███████╗███████║    ██║ █╗ ██║██║   ██║   ███████║    ██║   ██║███████╗
██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║    ██║███╗██║██║   ██║   ██╔══██║    ██║   ██║╚════██║
██║ ╚═╝ ██║███████╗███████║██║  ██║    ╚███╔███╔╝██║   ██║   ██║  ██║    ╚██████╔╝███████║
╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝     ╚══╝╚══╝ ╚═╝   ╚═╝   ╚═╝  ╚═╝     ╚═════╝ ╚══════╝

Built by Mesh With Us
https://meshwithus.com.au

*/
import type { Metadata } from "next";
import { Roboto_Slab, Roboto } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { WalletButton } from "@/components/wallet-button-client";
import { NavLink } from "@/components/nav-link";
import { LocalTime } from "@/components/local-time";
import { ScammerEasterEgg, ScammerEasterEggTrigger } from "@/components/scammer-easter-egg";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";

// Smashing-Magazine-inspired font pairing (open-license substitutes for the
// proprietary Elena/Mija stacks) — same choice as the sibling DRep dashboard.
const serif = Roboto_Slab({
  variable: "--font-serif",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const sans = Roboto({
  variable: "--font-sans",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

// Placeholder — Peter will confirm the production subdomain (likely
// `leaderboard.learncardano.io` matching the sibling pattern).
const SITE_URL = "https://leaderboard.learncardano.io";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Learn Cardano Leaderboard | Earn ADA Rewards Across Cardano Projects",
    template: "%s | Learn Cardano Leaderboard",
  },
  description:
    "Complete on-chain and social tasks across partnered Cardano projects, earn points and token rewards, and climb a transparent community leaderboard.",
  keywords: [
    "Cardano",
    "Cardano leaderboard",
    "Learn Cardano",
    "Cardano rewards",
    "Cardano tasks",
    "ADA rewards",
    "Cardano referral",
    "Cardano bounties",
    "Cardano governance",
    "Cardano DRep",
  ],
  openGraph: {
    type: "website",
    siteName: "Learn Cardano",
    title: "Learn Cardano Leaderboard",
    description:
      "Complete on-chain and social tasks across partnered Cardano projects, earn points and token rewards.",
    images: [
      {
        url: OG_IMAGE,
        width: 1731,
        height: 909,
        alt: "Learn Cardano Leaderboard - earn rewards by completing tasks across Cardano projects",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@astroboysoup",
    creator: "@astroboysoup",
    title: "Learn Cardano Leaderboard",
    description:
      "Complete on-chain and social tasks across partnered Cardano projects, earn points and token rewards.",
    images: [
      {
        url: OG_IMAGE,
        alt: "Learn Cardano Leaderboard",
      },
    ],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const stakeAddress = await getCurrentStakeAddressOrNull();
  const signedIn = !!stakeAddress;
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a href="#main" className="skip-to-content">Skip to main content</a>
        <header className="border-b border-[color:var(--rule)] bg-[color:var(--surface)] font-sans">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/" className="font-semibold tracking-tight text-[color:var(--fg-heading)]">
                Learn Cardano Leaderboard
              </Link>
              <NavLink
                href="/leaderboard"
                className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
                activeClassName="text-[color:var(--fg)]"
              >
                Leaderboard
              </NavLink>
              <NavLink
                href="/projects"
                className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
                activeClassName="text-[color:var(--fg)]"
              >
                Projects
              </NavLink>
              <NavLink
                href="/me"
                className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
                activeClassName="text-[color:var(--fg)]"
              >
                My dashboard
              </NavLink>
            </nav>
            <WalletButton signedIn={signedIn} stakeAddress={stakeAddress} />
          </div>
        </header>
        <div id="main" className="flex-1">{children}</div>
        <footer className="mt-12 border-t border-[color:var(--rule)] py-6 font-sans text-xs text-[color:var(--fg-muted)]">
          <div className="mx-auto max-w-6xl px-6 flex flex-wrap items-center justify-between gap-2">
            <span>Built with ❤️ on Cardano</span>
            <span>
              A site by{" "}
              <a
                href="https://learncardano.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--fg)] hover:text-[color:var(--accent-info)] hover:underline"
              >
                LearnCardano
              </a>{" "}
              · Built by{" "}
              <a
                href="https://meshwithus.com.au"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--fg)] hover:text-[color:var(--accent-info)] hover:underline"
              >
                Mesh With Us
              </a>
              <ScammerEasterEggTrigger />
            </span>
            <span>
              Build:{" "}
              {process.env.NEXT_PUBLIC_BUILD_HASH && process.env.NEXT_PUBLIC_BUILD_HASH !== "unknown" ? (
                <a
                  href={`https://github.com/pbwebdev/learncardano-leaderboard/commit/${process.env.NEXT_PUBLIC_BUILD_HASH}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[color:var(--accent-info)] hover:underline"
                  title="View commit on GitHub"
                >
                  <code className="font-mono text-[color:var(--fg)]">
                    {process.env.NEXT_PUBLIC_BUILD_HASH}
                  </code>
                </a>
              ) : (
                <code className="font-mono text-[color:var(--fg)]">unknown</code>
              )}
              <span className="ml-2 opacity-80">
                {process.env.NEXT_PUBLIC_BUILD_TIME ? (
                  <LocalTime iso={process.env.NEXT_PUBLIC_BUILD_TIME} />
                ) : null}
              </span>
            </span>
          </div>
        </footer>
        <ScammerEasterEgg />
      </body>
    </html>
  );
}
