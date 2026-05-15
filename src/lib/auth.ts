import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Returns the bech32 stake address of the signed-in user, or null.
 *
 * Order of resolution:
 *   1. Verified HMAC-signed session cookie set by /api/auth/verify.
 *   2. (Dev only) OWNER_STAKE_ADDRESS env, when ALLOW_ENV_AUTH=true. Stays
 *      false in production — sibling-proven posture (CLAUDE.md § Auth).
 */
export async function getCurrentStakeAddressOrNull(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(raw);
  if (session) return session.stake_address;

  const { env } = getCloudflareContext();
  // The wrangler.jsonc default is "false". A deployed override (Worker secret
  // or env edit) can set it to "true" in dev environments. Compare as a wide
  // string so TS doesn't narrow against the literal default.
  if ((env.ALLOW_ENV_AUTH as string) === "true" && env.OWNER_STAKE_ADDRESS) {
    return env.OWNER_STAKE_ADDRESS;
  }
  return null;
}

/**
 * Synchronous-feeling variant — throws `not_authenticated` if not signed in.
 * Use in server actions / route handlers that require a user.
 */
export async function getCurrentStakeAddress(): Promise<string> {
  const id = await getCurrentStakeAddressOrNull();
  if (!id) throw new Error("not_authenticated");
  return id;
}
