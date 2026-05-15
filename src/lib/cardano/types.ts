/**
 * Provider-agnostic Cardano types — what verifiers and page loaders see.
 *
 * Both `koios.ts` and `blockfrost.ts` normalise their provider-native
 * responses to these shapes inside their own module. Verifiers import only
 * from `./index` (the façade) and never see provider-specific field names.
 */

export type AccountInfo = {
  stake_address: string;
  total_balance: string;   // lovelace, string-encoded
  rewards_available: string;
  delegated_pool: string | null; // bech32 pool ID (pool1...) or null
  delegated_drep: string | null; // bech32 drep ID (drep1...) or null
  // True when the stake credential is registered on-chain (has delegated at
  // least once). Both providers expose this via slightly different fields.
  registered: boolean;
};

export type AccountAsset = {
  policy_id: string;
  asset_name: string;       // hex-encoded asset name
  fingerprint: string;
  quantity: string;         // string-encoded bigint
};

export type AccountHistoryEntry = {
  epoch_no: number;
  active_stake: string;
  pool_id: string | null;
};

export type DRepInfo = {
  drep_id: string;
  hex: string;
  has_script: boolean;
  drep_status: "registered" | "retired" | "unregistered" | string;
  deposit: string | null;
  active: boolean;
  // Authoritative `expired` flag — sourced from Blockfrost when available
  // (Koios doesn't surface this directly).
  expired?: boolean;
  expires_epoch_no: number | null;
  amount: string | null;
  meta_url?: string | null;
  meta_hash?: string | null;
  last_active_epoch?: number | null;
};

export type DRepMetadata = {
  drep_id: string;
  url: string | null;
  hash: string | null;
  json_metadata: Record<string, unknown> | null;
  bytes: string | null;
  warning: string | null;
  language: string | null;
  comment: string | null;
  is_valid: boolean;
};

export type TxIo = {
  address: string;
  stake_address?: string | null;
  amount: Array<{ unit: string; quantity: string }>;
};

export type TxInfo = {
  hash: string;
  block_hash: string | null;
  block_height: number | null;
  block_time: number | null; // unix seconds
  num_confirmations: number;
  inputs: TxIo[];
  outputs: TxIo[];
  // Stake credentials touched by this tx (withdrawal / delegation / etc.).
  stake_addresses: string[];
};

export type TxStatus = {
  hash: string;
  num_confirmations: number;
};

export type PoolInfo = {
  pool_id_bech32: string;
  pool_id_hex: string;
  active_stake: string | null;
  live_stake: string | null;
  ticker: string | null;
  meta_url: string | null;
};
