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
 * Blockfrost mainnet client — fallback provider behind the Cardano façade.
 *
 * Mirrors the surface of `./koios.ts`. The façade in `./index` swaps to this
 * module when Koios fails or doesn't cover an endpoint. Authoritative source
 * for the DRep `expired` flag (Koios doesn't surface it directly).
 *
 * Set BLOCKFROST_PROJECT_ID as a Worker secret. Calls return null when the
 * secret is missing rather than throwing — the façade treats that as an
 * "unavailable provider" and surfaces the upstream Koios error to callers.
 */

const BASE = "https://cardano-mainnet.blockfrost.io/api/v0";

const TTL_ACCOUNT_INFO = 60 * 5;
const TTL_ACCOUNT_ASSETS = 60 * 5;
const TTL_ACCOUNT_HISTORY = 60 * 30;
const TTL_DREP_INFO = 60 * 10;
const TTL_DREP_METADATA = 60 * 10;
const TTL_POOL_INFO = 60 * 60;
const TTL_TX_INFO = 60 * 60 * 24 * 30;
const TTL_TX_STATUS = 30;

const UA = "learncardano-leaderboard/0.1 (+https://learncardano-leaderboard.learncardano.io)";

async function blockfrostGet<T>(path: string): Promise<T | null> {
  const { env } = getCloudflareContext();
  const projectId = env.BLOCKFROST_PROJECT_ID;
  if (!projectId) return null;
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "project_id": projectId,
      accept: "application/json",
      "user-agent": UA,
    },
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

// ---------- Accounts ----------

type BfAccount = {
  stake_address: string;
  active: boolean;
  controlled_amount: string;
  withdrawable_amount: string;
  pool_id: string | null;
  drep_id: string | null;
  active_epoch?: number | null;
};

export async function getAccountInfo(stakeAddress: string): Promise<AccountInfo | null> {
  return cached(`bf:account_info:${stakeAddress}`, async () => {
    const r = await blockfrostGet<BfAccount>(`/accounts/${stakeAddress}`);
    if (!r) return null;
    return {
      stake_address: r.stake_address,
      total_balance: r.controlled_amount,
      rewards_available: r.withdrawable_amount,
      delegated_pool: r.pool_id,
      delegated_drep: r.drep_id,
      registered: r.active,
      delegation_active_epoch_no: r.active_epoch ?? null,
    };
  }, TTL_ACCOUNT_INFO);
}

type BfAccountAsset = { unit: string; quantity: string };

export async function getAccountAssets(stakeAddress: string): Promise<AccountAsset[] | null> {
  return cached(`bf:account_assets:${stakeAddress}`, async () => {
    const rows = await blockfrostGet<BfAccountAsset[]>(`/accounts/${stakeAddress}/addresses/assets`);
    if (!rows) return null;
    return rows.map((r) => {
      const policy_id = r.unit.slice(0, 56);
      const asset_name = r.unit.slice(56);
      return {
        policy_id,
        asset_name,
        fingerprint: "", // not exposed by this endpoint
        quantity: r.quantity,
      };
    });
  }, TTL_ACCOUNT_ASSETS);
}

type BfAccountHistory = { active_epoch: number; amount: string; pool_id: string };

export async function getAccountHistory(stakeAddress: string): Promise<AccountHistoryEntry[] | null> {
  return cached(`bf:account_history:${stakeAddress}`, async () => {
    const rows = await blockfrostGet<BfAccountHistory[]>(`/accounts/${stakeAddress}/history`);
    if (!rows) return null;
    return rows.map((r) => ({
      epoch_no: r.active_epoch,
      active_stake: r.amount,
      pool_id: r.pool_id,
    }));
  }, TTL_ACCOUNT_HISTORY);
}

// ---------- DRep ----------

type BfDRep = {
  drep_id: string;
  hex: string;
  amount: string;
  active: boolean;
  active_epoch: number | null;
  has_script: boolean;
  last_active_epoch: number | null;
  retired: boolean;
  expired: boolean;
};

export async function getDRepInfo(drepId: string): Promise<DRepInfo | null> {
  return cached(`bf:drep_info:${drepId}`, async () => {
    const r = await blockfrostGet<BfDRep>(`/governance/dreps/${drepId}`);
    if (!r) return null;
    return {
      drep_id: r.drep_id,
      hex: r.hex,
      has_script: r.has_script,
      drep_status: r.retired ? "retired" : r.active ? "registered" : "unregistered",
      deposit: null,
      active: r.active,
      expired: r.expired,
      expires_epoch_no: null,
      amount: r.amount,
      last_active_epoch: r.last_active_epoch,
    };
  }, TTL_DREP_INFO);
}

type BfDRepMetadata = {
  drep_id: string;
  url: string | null;
  hash: string | null;
  json_metadata: Record<string, unknown> | null;
  bytes: string | null;
};

export async function getDRepMetadata(drepId: string): Promise<DRepMetadata | null> {
  return cached(`bf:drep_metadata:${drepId}`, async () => {
    const r = await blockfrostGet<BfDRepMetadata>(`/governance/dreps/${drepId}/metadata`);
    if (!r) return null;
    return {
      drep_id: r.drep_id,
      url: r.url,
      hash: r.hash,
      json_metadata: r.json_metadata,
      bytes: r.bytes,
      warning: null,
      language: null,
      comment: null,
      is_valid: true,
    };
  }, TTL_DREP_METADATA);
}

// ---------- Tx ----------

type BfTx = {
  hash: string;
  block: string;
  block_height: number;
  block_time: number;
};

type BfTxUtxoOutput = {
  address: string;
  amount: Array<{ unit: string; quantity: string }>;
  output_index?: number;
  data_hash?: string | null;
  inline_datum?: string | null;
  reference_script_hash?: string | null;
};

type BfTxUtxoInput = {
  address: string;
  amount: Array<{ unit: string; quantity: string }>;
  tx_hash?: string;
  output_index?: number;
  data_hash?: string | null;
  inline_datum?: string | null;
  reference?: boolean;
  reference_script_hash?: string | null;
};

type BfTxUtxos = {
  hash: string;
  inputs: BfTxUtxoInput[];
  outputs: BfTxUtxoOutput[];
};

type BfTxRedeemer = {
  tx_index: number;
  purpose: string;
  script_hash: string;
  redeemer_data_hash?: string;
  datum_hash?: string;
};

type BfTxMint = {
  unit?: string;
  policy_id?: string;
  asset_name?: string | null;
  quantity: string;
  action?: "minted" | "burned";
};

function bfPurposeToTag(p: string | undefined): import("./types").PlutusContract["redeemerTag"] | undefined {
  if (!p) return undefined;
  const v = p.toLowerCase();
  if (v === "spend" || v === "mint" || v === "cert" || v === "reward" || v === "vote" || v === "propose") return v;
  return undefined;
}

export async function getTxInfo(txHash: string): Promise<TxInfo | null> {
  return cached(`bf:tx_info:${txHash}`, async () => {
    const [tx, utxos, redeemers, mints] = await Promise.all([
      blockfrostGet<BfTx>(`/txs/${txHash}`),
      blockfrostGet<BfTxUtxos>(`/txs/${txHash}/utxos`),
      blockfrostGet<BfTxRedeemer[]>(`/txs/${txHash}/redeemers`),
      blockfrostGet<BfTxMint[]>(`/txs/${txHash}/mints`),
    ]);
    if (!tx || !utxos) return null;

    const plutusContracts: import("./types").PlutusContract[] = (redeemers ?? [])
      .filter((r) => r?.script_hash)
      .map((r) => {
        const out: import("./types").PlutusContract = {
          scriptHash: r.script_hash.toLowerCase(),
        };
        const tag = bfPurposeToTag(r.purpose);
        if (tag) out.redeemerTag = tag;
        // Blockfrost only exposes redeemer_data_hash, not the CBOR or
        // constructor. Verifiers tolerate undefined and surface
        // needs_review with reason `provider_data_missing:...`.
        if (r.datum_hash) out.datumHash = r.datum_hash.toLowerCase();
        return out;
      });

    const mintedAssets: import("./types").MintedAsset[] = (mints ?? []).map((m) => {
      let policyId = (m.policy_id ?? "").toLowerCase();
      let assetName = (m.asset_name ?? "").toLowerCase();
      if (!policyId && m.unit) {
        policyId = m.unit.slice(0, 56).toLowerCase();
        assetName = m.unit.slice(56).toLowerCase();
      }
      const qty = Number(m.quantity);
      return {
        policyId,
        assetName,
        quantity: m.action === "burned" && qty > 0 ? -qty : qty,
      };
    });

    const referenceInputs: import("./types").RefScriptUtxo[] = (utxos.inputs ?? [])
      .filter((i) => i.reference === true && i.reference_script_hash && i.tx_hash)
      .map((i) => ({
        txHash: (i.tx_hash as string).toLowerCase(),
        outputIndex: i.output_index ?? 0,
        scriptHash: (i.reference_script_hash as string).toLowerCase(),
      }));

    const outputDatums: import("./types").OutputDatum[] = (utxos.outputs ?? []).map((o, idx) => ({
      outputIndex: o.output_index ?? idx,
      datumHash: o.data_hash ? o.data_hash.toLowerCase() : null,
      inlineDatumCborHex: o.inline_datum ? o.inline_datum.toLowerCase() : null,
    }));

    return {
      hash: tx.hash,
      block_hash: tx.block,
      block_height: tx.block_height,
      block_time: tx.block_time,
      // Blockfrost doesn't expose confirmation count directly on /txs — caller
      // uses /tx/status or /tx/latest_block for that. Treat presence of a
      // block as >= 1 confirmation.
      num_confirmations: tx.block_height ? 1 : 0,
      inputs: (utxos.inputs ?? [])
        .filter((i) => i.reference !== true)
        .map((i) => ({ address: i.address, stake_address: null, amount: i.amount })),
      outputs: utxos.outputs.map((o) => ({ address: o.address, stake_address: null, amount: o.amount })),
      stake_addresses: [],
      plutusContracts,
      mintedAssets,
      referenceInputs,
      outputDatums,
    };
  }, TTL_TX_INFO);
}

export async function getTxStatus(txHash: string): Promise<TxStatus | null> {
  return cached(`bf:tx_status:${txHash}`, async () => {
    // No direct status endpoint — derive from /txs (404 if not on-chain).
    const tx = await blockfrostGet<BfTx>(`/txs/${txHash}`);
    if (!tx) return null;
    return { hash: tx.hash, num_confirmations: tx.block_height ? 1 : 0 };
  }, TTL_TX_STATUS);
}

// ---------- Pool ----------

type BfPool = {
  pool_id: string;
  hex: string;
  active_stake: string;
  live_stake: string;
};

export async function getPoolInfo(poolId: string): Promise<PoolInfo | null> {
  return cached(`bf:pool_info:${poolId}`, async () => {
    const r = await blockfrostGet<BfPool>(`/pools/${poolId}`);
    if (!r) return null;
    return {
      pool_id_bech32: r.pool_id,
      pool_id_hex: r.hex,
      active_stake: r.active_stake,
      live_stake: r.live_stake,
      ticker: null,
      meta_url: null,
    };
  }, TTL_POOL_INFO);
}

// ---------- Epoch ----------

const TTL_EPOCH = 60;

type BfEpochLatest = { epoch: number; start_time: number };

export async function getCurrentEpoch(): Promise<EpochInfo | null> {
  return cached("bf:epoch_latest", async () => {
    const r = await blockfrostGet<BfEpochLatest>(`/epochs/latest`);
    if (!r) return null;
    return { epoch_no: r.epoch, start_time: r.start_time };
  }, TTL_EPOCH);
}

// ---------- DRep votes ----------

const TTL_DREP_VOTES = 60 * 5;

type BfDRepVote = {
  tx_hash: string;
  cert_index: number;
  vote: string;
};

export async function getDRepVotes(drepId: string): Promise<DRepVote[] | null> {
  return cached(`bf:drep_votes:${drepId}`, async () => {
    // Blockfrost `/governance/dreps/{drep_id}/votes` returns the vote rows
    // with the action tx hash + cert index. `block_time` isn't on this
    // endpoint — verifiers fall back to the action_tx_hash match alone for
    // the in-window check.
    const rows = await blockfrostGet<BfDRepVote[]>(`/governance/dreps/${drepId}/votes`);
    if (!rows) return null;
    return rows.map((r) => ({
      proposal_tx_hash: r.tx_hash,
      proposal_index: r.cert_index,
      vote: r.vote,
      block_time: null,
    }));
  }, TTL_DREP_VOTES);
}
