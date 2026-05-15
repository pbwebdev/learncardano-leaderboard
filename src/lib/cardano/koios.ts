import { getCloudflareContext } from "@opennextjs/cloudflare";
import type {
  AccountAsset,
  AccountHistoryEntry,
  AccountInfo,
  DRepInfo,
  DRepMetadata,
  DRepVote,
  EpochInfo,
  PoolInfo,
  TxInfo,
  TxStatus,
} from "./types";

/**
 * Koios mainnet client (https://api.koios.rest/). Ported from the DRep
 * Dashboard `src/lib/koios.ts` and extended with the account / tx / pool
 * endpoints the leaderboard verifiers need.
 *
 * Every read goes through `cached()` (KV with TTL). Verifiers never call
 * this module directly — see `./index` (the façade).
 */

const BASE = "https://api.koios.rest/api/v1";

// Per-endpoint TTLs (see CLAUDE.md § Extended port log).
const TTL_DREP_INFO = 60 * 10;        // 10 min
const TTL_DREP_METADATA = 60 * 10;
const TTL_DREP_PROFILE = 60 * 60 * 24; // 24h
const TTL_ACCOUNT_INFO = 60 * 5;       // 5 min — delegation can change
const TTL_ACCOUNT_ASSETS = 60 * 5;
const TTL_ACCOUNT_HISTORY = 60 * 30;
const TTL_POOL_INFO = 60 * 60;         // 1h
const TTL_TX_INFO = 60 * 60 * 24 * 30; // ~30 days — only cache confirmed tx
const TTL_TX_STATUS = 30;              // 30 sec — pre-confirmation poll

const UA = "learncardano-leaderboard/0.1 (+https://learncardano-leaderboard.learncardano.io)";

async function koiosPost<T>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": UA,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function cached<T>(
  key: string,
  fetcher: () => Promise<T | null>,
  ttlSeconds: number,
): Promise<T | null> {
  const { env } = getCloudflareContext();
  const hit = await env.KV.get<T>(key, "json");
  if (hit) return hit;
  const fresh = await fetcher();
  if (fresh) await env.KV.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
  return fresh;
}

// ---------- DRep endpoints (ported from sibling) ----------

type KoiosDRepInfoRow = {
  drep_id: string;
  hex: string;
  has_script: boolean;
  registered: boolean;
  deposit: string | null;
  active: boolean;
  expires_epoch_no: number | null;
  amount: string | null;
  meta_url: string | null;
  meta_hash: string | null;
};

export async function getDRepInfo(drepId: string): Promise<DRepInfo | null> {
  return cached(`koios:drep_info:${drepId}`, async () => {
    const rows = await koiosPost<KoiosDRepInfoRow[]>("/drep_info", { _drep_ids: [drepId] });
    const r = rows?.[0];
    if (!r) return null;
    return {
      drep_id: r.drep_id,
      hex: r.hex,
      has_script: r.has_script,
      drep_status: r.registered ? "registered" : "unregistered",
      deposit: r.deposit,
      active: r.active,
      expires_epoch_no: r.expires_epoch_no,
      amount: r.amount,
      meta_url: r.meta_url,
      meta_hash: r.meta_hash,
    } as DRepInfo;
  }, TTL_DREP_INFO);
}

export async function getDRepMetadata(drepId: string): Promise<DRepMetadata | null> {
  return cached(`koios:drep_metadata:${drepId}`, async () => {
    const rows = await koiosPost<DRepMetadata[]>("/drep_metadata", { _drep_ids: [drepId] });
    return rows?.[0] ?? null;
  }, TTL_DREP_METADATA);
}

export type DRepProfile = {
  given_name: string | null;
  image_url: string | null;
  motivations: string | null;
  objectives: string | null;
  qualifications: string | null;
  payment_address: string | null;
  do_not_list: boolean;
  references: Array<{ label: string; uri: string; kind: string }>;
};

type CIP119ImageBody = string | { contentUrl?: string } | undefined;
type CIP119Body = {
  givenName?: string;
  image?: CIP119ImageBody;
  motivations?: string;
  objectives?: string;
  qualifications?: string;
  paymentAddress?: string;
  doNotList?: boolean;
  references?: Array<{ label?: string; uri?: string; "@type"?: string }>;
};

export async function getDRepProfile(drepId: string, metaUrl: string | null): Promise<DRepProfile | null> {
  if (!metaUrl) return null;
  return cached(`koios:drep_profile:v2:${drepId}`, async () => {
    let res: Response;
    try {
      res = await fetch(metaUrl, {
        headers: {
          accept: "application/ld+json, application/json;q=0.9, text/plain;q=0.5",
          "user-agent": UA,
        },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    let json: { body?: CIP119Body };
    try {
      json = (await res.json()) as { body?: CIP119Body };
    } catch {
      return null;
    }
    const body = json?.body;
    if (!body) return null;
    const imageRaw: CIP119ImageBody = body.image;
    const imageUrl =
      typeof imageRaw === "string" ? imageRaw : (imageRaw && imageRaw.contentUrl) || null;
    return {
      given_name: body.givenName ?? null,
      image_url: imageUrl,
      motivations: body.motivations ?? null,
      objectives: body.objectives ?? null,
      qualifications: body.qualifications ?? null,
      payment_address: body.paymentAddress ?? null,
      do_not_list: body.doNotList === true,
      references: (body.references ?? [])
        .filter((r): r is { label?: string; uri?: string; "@type"?: string } => !!r?.uri)
        .map((r) => ({
          label: r.label ?? r.uri!,
          uri: r.uri!,
          kind: r["@type"] ?? "Other",
        })),
    };
  }, TTL_DREP_PROFILE);
}

// ---------- Account endpoints (new for leaderboard) ----------

type KoiosAccountInfoRow = {
  stake_address: string;
  status: string; // 'registered' | 'not registered'
  delegated_pool: string | null;
  delegated_drep: string | null;
  total_balance: string;
  rewards_available: string;
  delegation_active_epoch_no?: number | null;
};

export async function getAccountInfo(stakeAddress: string): Promise<AccountInfo | null> {
  return cached(`koios:account_info:${stakeAddress}`, async () => {
    const rows = await koiosPost<KoiosAccountInfoRow[]>("/account_info", {
      _stake_addresses: [stakeAddress],
    });
    const r = rows?.[0];
    if (!r) return null;
    return {
      stake_address: r.stake_address,
      total_balance: r.total_balance,
      rewards_available: r.rewards_available,
      delegated_pool: r.delegated_pool,
      delegated_drep: r.delegated_drep,
      registered: r.status === "registered",
      delegation_active_epoch_no: r.delegation_active_epoch_no ?? null,
    };
  }, TTL_ACCOUNT_INFO);
}

type KoiosAccountAssetRow = {
  stake_address: string;
  policy_id: string;
  asset_name: string;
  fingerprint: string;
  quantity: string;
};

export async function getAccountAssets(stakeAddress: string): Promise<AccountAsset[] | null> {
  return cached(`koios:account_assets:${stakeAddress}`, async () => {
    const rows = await koiosPost<KoiosAccountAssetRow[]>("/account_assets", {
      _stake_addresses: [stakeAddress],
    });
    if (!rows) return null;
    return rows.map((r) => ({
      policy_id: r.policy_id,
      asset_name: r.asset_name,
      fingerprint: r.fingerprint,
      quantity: r.quantity,
    }));
  }, TTL_ACCOUNT_ASSETS);
}

type KoiosAccountHistoryRow = {
  stake_address: string;
  epoch_no: number;
  active_stake: string;
  pool_id: string | null;
};

export async function getAccountHistory(stakeAddress: string): Promise<AccountHistoryEntry[] | null> {
  return cached(`koios:account_history:${stakeAddress}`, async () => {
    const rows = await koiosPost<KoiosAccountHistoryRow[]>("/account_history", {
      _stake_addresses: [stakeAddress],
    });
    if (!rows) return null;
    return rows.map((r) => ({
      epoch_no: r.epoch_no,
      active_stake: r.active_stake,
      pool_id: r.pool_id,
    }));
  }, TTL_ACCOUNT_HISTORY);
}

// ---------- Tx endpoints ----------

type KoiosTxIoOut = {
  payment_addr?: { bech32?: string };
  stake_addr?: string | null;
  value?: string;
  asset_list?: Array<{ policy_id: string; asset_name: string; quantity: string }>;
};

type KoiosTxInfoRow = {
  tx_hash: string;
  block_hash: string | null;
  block_height: number | null;
  block_time: number | null;
  num_confirmations: number;
  inputs?: KoiosTxIoOut[];
  outputs?: KoiosTxIoOut[];
};

function normaliseIo(row: KoiosTxIoOut) {
  const amount: Array<{ unit: string; quantity: string }> = [];
  if (row.value) amount.push({ unit: "lovelace", quantity: row.value });
  for (const a of row.asset_list ?? []) {
    amount.push({ unit: `${a.policy_id}${a.asset_name}`, quantity: a.quantity });
  }
  return {
    address: row.payment_addr?.bech32 ?? "",
    stake_address: row.stake_addr ?? null,
    amount,
  };
}

export async function getTxInfo(txHash: string): Promise<TxInfo | null> {
  // Only cache long-term once confirmed. Pre-confirmation, fall through to a
  // short-TTL cache via getTxStatus.
  const { env } = getCloudflareContext();
  const longKey = `koios:tx_info:${txHash}`;
  const hit = await env.KV.get<TxInfo>(longKey, "json");
  if (hit) return hit;

  const rows = await koiosPost<KoiosTxInfoRow[]>("/tx_info", { _tx_hashes: [txHash] });
  const r = rows?.[0];
  if (!r) return null;

  const inputs = (r.inputs ?? []).map(normaliseIo);
  const outputs = (r.outputs ?? []).map(normaliseIo);
  const stake_addresses = Array.from(
    new Set(
      [...inputs, ...outputs]
        .map((io) => io.stake_address)
        .filter((s): s is string => !!s),
    ),
  );

  const info: TxInfo = {
    hash: r.tx_hash,
    block_hash: r.block_hash,
    block_height: r.block_height,
    block_time: r.block_time,
    num_confirmations: r.num_confirmations,
    inputs,
    outputs,
    stake_addresses,
  };
  if (info.num_confirmations > 0) {
    await env.KV.put(longKey, JSON.stringify(info), { expirationTtl: TTL_TX_INFO });
  }
  return info;
}

type KoiosTxStatusRow = { tx_hash: string; num_confirmations: number };

export async function getTxStatus(txHash: string): Promise<TxStatus | null> {
  return cached(`koios:tx_status:${txHash}`, async () => {
    const rows = await koiosPost<KoiosTxStatusRow[]>("/tx_status", { _tx_hashes: [txHash] });
    const r = rows?.[0];
    if (!r) return null;
    return { hash: r.tx_hash, num_confirmations: r.num_confirmations };
  }, TTL_TX_STATUS);
}

// ---------- Pool endpoint ----------

type KoiosPoolInfoRow = {
  pool_id_bech32: string;
  pool_id_hex: string;
  active_stake: string | null;
  live_stake: string | null;
  meta_json?: { ticker?: string } | null;
  meta_url?: string | null;
};

export async function getPoolInfo(poolId: string): Promise<PoolInfo | null> {
  return cached(`koios:pool_info:${poolId}`, async () => {
    const rows = await koiosPost<KoiosPoolInfoRow[]>("/pool_info", { _pool_bech32_ids: [poolId] });
    const r = rows?.[0];
    if (!r) return null;
    return {
      pool_id_bech32: r.pool_id_bech32,
      pool_id_hex: r.pool_id_hex,
      active_stake: r.active_stake,
      live_stake: r.live_stake,
      ticker: r.meta_json?.ticker ?? null,
      meta_url: r.meta_url ?? null,
    };
  }, TTL_POOL_INFO);
}

// ---------- Epoch endpoint ----------

const TTL_EPOCH = 60; // 1 min — epoch boundaries are 5 days apart but we want
                      // fresh enough that verifiers don't make decisions on a
                      // multi-hour stale value.

type KoiosTipRow = { epoch_no: number; block_time: number };

export async function getCurrentEpoch(): Promise<EpochInfo | null> {
  return cached("koios:tip", async () => {
    // /tip returns the latest block — block_time is a unix epoch seconds value
    // that we surface as a coarse "epoch start time" approximation. Verifiers
    // that need the precise epoch boundary should call /epoch_info, which we
    // don't currently need.
    const rows = await koiosPost<KoiosTipRow[]>("/tip", {});
    const r = rows?.[0];
    if (!r) return null;
    return { epoch_no: r.epoch_no, start_time: r.block_time };
  }, TTL_EPOCH);
}

// ---------- Governance vote list (filtered to a DRep) ----------

const TTL_DREP_VOTES = 60 * 5;

type KoiosDRepVoteRow = {
  proposal_tx_hash: string;
  proposal_index: number;
  vote: string;
  block_time?: number | null;
};

export async function getDRepVotes(drepId: string): Promise<DRepVote[] | null> {
  return cached(`koios:drep_votes:${drepId}`, async () => {
    // /vote_list?_voter_role=drep&_voter_id=<drepId> — Koios surfaces an
    // array of vote rows. We pass through proposal_tx_hash + vote choice
    // unchanged; callers compare against `config.actionTxHash`.
    const rows = await koiosPost<KoiosDRepVoteRow[]>("/vote_list", {
      _voter_role: "drep",
      _voter_id: drepId,
    });
    if (!rows) return null;
    return rows.map((r) => ({
      proposal_tx_hash: r.proposal_tx_hash,
      proposal_index: r.proposal_index,
      vote: r.vote,
      block_time: r.block_time ?? null,
    }));
  }, TTL_DREP_VOTES);
}

// ---------- Utility ----------

export function formatAda(lovelace: string | null): string {
  if (!lovelace) return "—";
  // Avoid BigInt literals (ES2020+) — TS target is ES2017.
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1_000_000) return `${(ada / 1_000_000).toFixed(2)}M ₳`;
  if (ada >= 1_000) return `${(ada / 1_000).toFixed(1)}K ₳`;
  return `${ada.toFixed(0)} ₳`;
}
