import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock both modules admin.ts pulls from. We swap env values per-test by
// reassigning the `env` reference the mock returns.
const envRef = { ADMIN_STAKE_ADDRESSES: "", AUTH_SESSION_SECRET: "test", ALLOW_ENV_AUTH: "false", OWNER_STAKE_ADDRESS: "" };
let currentStake: string | null = null;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: envRef }),
}));

vi.mock("./auth", () => ({
  getCurrentStakeAddress: async () => {
    if (!currentStake) throw new Error("not_authenticated");
    return currentStake;
  },
  getCurrentStakeAddressOrNull: async () => currentStake,
}));

import { parseAdminList, requireAdmin } from "./admin";

const ADMIN = "stake1u9adminaddress0000000000000000000000000000000000000000000";
const OTHER = "stake1u9otheruser000000000000000000000000000000000000000000000";

beforeEach(() => {
  envRef.ADMIN_STAKE_ADDRESSES = "";
  currentStake = null;
});

describe("admin: requireAdmin allow-list", () => {
  it("parseAdminList trims and filters empty entries", () => {
    envRef.ADMIN_STAKE_ADDRESSES = `${ADMIN}, , ${OTHER} ,`;
    expect(parseAdminList()).toEqual([ADMIN, OTHER]);
  });

  it("returns the stake address when it is on the list", async () => {
    envRef.ADMIN_STAKE_ADDRESSES = ADMIN;
    currentStake = ADMIN;
    expect(await requireAdmin()).toBe(ADMIN);
  });

  it("throws not_authorised when stake address is not on the list", async () => {
    envRef.ADMIN_STAKE_ADDRESSES = ADMIN;
    currentStake = OTHER;
    await expect(requireAdmin()).rejects.toThrow("not_authorised");
  });

  it("throws not_authenticated when no session", async () => {
    envRef.ADMIN_STAKE_ADDRESSES = ADMIN;
    currentStake = null;
    await expect(requireAdmin()).rejects.toThrow("not_authenticated");
  });

  it("throws not_authorised when the list is empty", async () => {
    envRef.ADMIN_STAKE_ADDRESSES = "";
    currentStake = ADMIN;
    await expect(requireAdmin()).rejects.toThrow("not_authorised");
  });
});
