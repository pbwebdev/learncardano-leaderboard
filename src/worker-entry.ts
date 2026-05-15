/**
 * Custom Cloudflare Worker entry. OpenNext's generated `.open-next/worker.js`
 * exports only `fetch` and a few Durable Object classes — it doesn't surface
 * `queue()` or `scheduled()`. This file re-exports OpenNext's fetch +DOs
 * verbatim and adds our own queue + scheduled handlers.
 *
 * Build flow:
 *   1. `opennextjs-cloudflare build` writes `.open-next/worker.js`.
 *   2. Wrangler reads `main` (= this file), runs esbuild over it. The
 *      `.open-next/...` imports below resolve cleanly post-build.
 *
 * Why dynamic-import init.js? `getCloudflareContext()` inside the Cardano
 * façade reads from an `AsyncLocalStorage` set up by OpenNext's init module.
 * For non-fetch handlers we wrap the body in `runWithCloudflareRequestContext`
 * with a synthetic Request — the same mechanism OpenNext uses for fetch.
 */

// @ts-ignore — resolved by wrangler post-build (path lives in .open-next/)
import openNextWorker from "../.open-next/worker.js";
// @ts-ignore — resolved by wrangler post-build
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";

import { handleVerifyQueue, type VerifyJob } from "./queues/verify-consumer";
import { handleScheduled } from "./queues/cron-handler";

// Minimal Cloudflare runtime shims — we don't pull @cloudflare/workers-types
// into this file's compile to avoid a global-types collision. The shapes are
// stable across recent workerd versions.
interface CfExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface CfScheduledEvent {
  cron: string;
  type: string;
  scheduledTime: number;
}
interface CfMessageBatch<T> {
  queue: string;
  messages: Array<{
    id: string;
    timestamp: Date;
    body: T;
    attempts: number;
    ack(): void;
    retry(opts?: { delaySeconds?: number }): void;
  }>;
  ackAll(): void;
  retryAll(opts?: { delaySeconds?: number }): void;
}

type WorkerEnv = Record<string, unknown> & {
  DB: unknown;
  KV: unknown;
};

/**
 * Wrap a handler in OpenNext's Cloudflare request context. The Cardano
 * façade + db client call `getCloudflareContext()` which reads from an
 * `AsyncLocalStorage` populated by OpenNext's `runWithCloudflareRequestContext`.
 * For non-fetch handlers we synthesise a minimal Request to satisfy init.js.
 */
async function withCloudflareContext<T>(
  env: WorkerEnv,
  ctx: CfExecutionContext,
  syntheticUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  // @ts-ignore — resolved by wrangler post-build (init lives in .open-next/cloudflare/init.js)
  const init = await import("../.open-next/cloudflare/init.js");
  const req = new Request(syntheticUrl, { method: "GET" });
  return init.runWithCloudflareRequestContext(req, env, ctx, fn);
}

export default {
  fetch: openNextWorker.fetch,

  async queue(batch: CfMessageBatch<VerifyJob>, env: WorkerEnv, ctx: CfExecutionContext): Promise<void> {
    await withCloudflareContext(env, ctx, "https://internal/queue", async () => {
      try {
        await handleVerifyQueue(batch, env as unknown as { DB: never });
      } catch (e) {
        console.error("[worker:queue] batch handler threw", e);
        throw e;
      }
    });
  },

  async scheduled(event: CfScheduledEvent, env: WorkerEnv, ctx: CfExecutionContext): Promise<void> {
    await withCloudflareContext(env, ctx, "https://internal/cron", async () => {
      try {
        await handleScheduled(event.cron, env as unknown as { DB: never });
      } catch (e) {
        console.error("[worker:scheduled] cron handler threw", { cron: event.cron, e });
        throw e;
      }
    });
  },
};
