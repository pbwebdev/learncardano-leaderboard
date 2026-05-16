/**
 * Partnered Cardano content creators surfaced on the landing page.
 *
 * Source: Cardano Content Creators Consortium roster provided by Peter.
 * Each entry is just a public X handle + the URL to that profile. No
 * fabricated bios, no scraped avatars — keep it transparent so creators
 * can verify what we say about them at a glance.
 *
 * Adding / removing creators: edit this file + deploy. (If the list
 * starts changing frequently, lift into a `content_creators` D1 table
 * with an admin CRUD — for now the list is small enough to live here.)
 */

export interface ContentCreator {
  handle: string;     // without the @ prefix
  url: string;        // canonical X profile URL
  displayName?: string; // optional friendly name; falls back to @handle
}

export const CONTENT_CREATORS: ContentCreator[] = [
  { handle: "astroboysoup",  url: "https://x.com/astroboysoup" },
  { handle: "Cryptofly777",  url: "https://x.com/Cryptofly777" },
  { handle: "bigpey",        url: "https://x.com/bigpey" },
  { handle: "cwpaulm",       url: "https://x.com/cwpaulm" },
  { handle: "DaveXCrypto",   url: "https://x.com/DaveXCrypto" },
  { handle: "lapetiteada",   url: "https://x.com/lapetiteada" },
];
