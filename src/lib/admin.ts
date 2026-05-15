import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCurrentStakeAddress } from "./auth";

/**
 * Allow-list admin check. ADMIN_STAKE_ADDRESSES is a comma-separated list of
 * bech32 stake addresses, set as a Worker secret. Every admin server action
 * and route handler starts with `const adminId = await requireAdmin();`.
 *
 * Throws `not_authenticated` if no session, `not_authorised` if the session
 * stake address is not on the list.
 */
export async function requireAdmin(): Promise<string> {
  const stake = await getCurrentStakeAddress();
  const list = parseAdminList();
  if (!list.includes(stake)) throw new Error("not_authorised");
  return stake;
}

export function parseAdminList(): string[] {
  const { env } = getCloudflareContext();
  return (env.ADMIN_STAKE_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
