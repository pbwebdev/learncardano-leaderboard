import { afterEach, describe, expect, it, vi } from "vitest";

describe("short-io: not configured", () => {
  it("isShortIoConfigured reports false when API key absent", async () => {
    vi.resetModules();
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({ env: {} }),
    }));
    const m = await import("./short-io");
    expect(m.isShortIoConfigured()).toBe(false);
    await expect(m.createShortLink({ originalURL: "https://example.com" })).rejects.toThrow(/short_io_not_configured/);
    vi.doUnmock("@opennextjs/cloudflare");
  });
});

describe("short-io: configured", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadModule(env: Record<string, string> = { SHORTIO_API_KEY: "test-key" }) {
    vi.resetModules();
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({ env }),
    }));
    return await import("./short-io");
  }

  it("createShortLink posts /links with the raw API key as Authorization", async () => {
    const m = await loadModule();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 123, idString: "abc123", shortURL: "https://link.learncardano.io/x", originalURL: "https://x.test" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const link = await m.createShortLink({ originalURL: "https://x.test", externalId: "project:foo", tags: ["leaderboard"] });
    expect(link).toEqual({ id: "abc123", shortURL: "https://link.learncardano.io/x", originalURL: "https://x.test" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.short.io/links");
    expect(init.headers.authorization).toBe("test-key");
    expect(init.headers["content-type"]).toBe("application/json");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      originalURL: "https://x.test",
      allowDuplicates: false,
      domain: "link.learncardano.io",
    });
    expect(sent.tags).toContain("leaderboard");
    expect(sent.tags).toContain("ext:project:foo");
  });

  it("createShortLink respects SHORTIO_DOMAIN override", async () => {
    const m = await loadModule({ SHORTIO_API_KEY: "k", SHORTIO_DOMAIN: "stg.example.com" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", shortURL: "https://stg.example.com/y", originalURL: "https://y.test" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m.createShortLink({ originalURL: "https://y.test" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.domain).toBe("stg.example.com");
  });

  it("createShortLink surfaces non-2xx as short_io_api_error", async () => {
    const m = await loadModule();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 400 })));
    await expect(m.createShortLink({ originalURL: "https://x.test" })).rejects.toThrow(/short_io_api_error:400/);
  });

  it("getShortLink returns null on 404", async () => {
    const m = await loadModule();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    expect(await m.getShortLink("missing")).toBeNull();
  });

  it("throws on malformed link payload", async () => {
    const m = await loadModule();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ foo: "bar" }), { status: 200 })));
    await expect(m.createShortLink({ originalURL: "https://x.test" })).rejects.toThrow(/short_io_link_malformed/);
  });
});
