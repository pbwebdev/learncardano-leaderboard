import { afterEach, describe, expect, it, vi } from "vitest";

// First test: confirm "not configured" behaviour BEFORE we mock with a key.
describe("dub: not configured", () => {
  it("isDubConfigured reports false when API key absent", async () => {
    vi.resetModules();
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({ env: {} }),
    }));
    const m = await import("./dub");
    expect(m.isDubConfigured()).toBe(false);
    await expect(m.createLink({ url: "https://example.com" })).rejects.toThrow(/dub_not_configured/);
    vi.doUnmock("@opennextjs/cloudflare");
  });
});

describe("dub: configured", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadModule() {
    vi.resetModules();
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({ env: { DUB_API_KEY: "test-key" } }),
    }));
    return await import("./dub");
  }

  it("createLink posts to /links with auth + bearer", async () => {
    const m = await loadModule();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "lnk_1", shortLink: "https://dub.sh/abc", url: "https://x.test" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const link = await m.createLink({ url: "https://x.test", externalId: "project:foo", tags: ["leaderboard"] });
    expect(link).toEqual({ id: "lnk_1", shortLink: "https://dub.sh/abc", url: "https://x.test", externalId: null });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer test-key");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ url: "https://x.test", externalId: "project:foo", tagNames: ["leaderboard"] });
  });

  it("createLink falls back to getLinkByExternalId on 409 conflict", async () => {
    const m = await loadModule();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("conflict", { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "lnk_dup", shortLink: "https://dub.sh/dup", url: "https://x.test", externalId: "project:foo" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const link = await m.createLink({ url: "https://x.test", externalId: "project:foo" });
    expect(link.id).toBe("lnk_dup");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getLink returns null on 404", async () => {
    const m = await loadModule();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    expect(await m.getLink("missing")).toBeNull();
  });

  it("throws on malformed link payload", async () => {
    const m = await loadModule();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ foo: "bar" }), { status: 200 })));
    await expect(m.createLink({ url: "https://x.test" })).rejects.toThrow(/dub_link_malformed/);
  });
});
