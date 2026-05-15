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
  // Epoch in which the current pool delegation became active. Used by the
  // `pool_delegation` verifier to enforce the tx-age guard (reject if the
  // delegation predates `task.startsAt`). Nullable when the provider doesn't
  // surface it.
  delegation_active_epoch_no?: number | null;
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

/**
 * Plutus script interaction surfaced on a tx. One entry per redeemer in the
 * tx — i.e. a script-locked input being spent, a minting policy being
 * exercised, a stake/vote/propose certificate using a script witness, etc.
 *
 * Provider variance: Koios surfaces these directly under `plutus_contracts`
 * including the decoded redeemer when it can. Blockfrost surfaces them via
 * `/txs/{hash}/redeemers` and only gives a redeemer_data_hash — the
 * constructor / cbor are NOT exposed by Blockfrost, so `redeemerConstructor`
 * and `redeemerCborHex` will be undefined on Blockfrost-sourced TxInfo.
 */
export type PlutusContract = {
  scriptHash: string;     // lowercase hex
  redeemerTag?: "spend" | "mint" | "cert" | "reward" | "vote" | "propose";
  redeemerConstructor?: number;
  redeemerCborHex?: string;
  datumHash?: string;     // lowercase hex
  datumCborHex?: string;
};

export type MintedAsset = {
  policyId: string;       // lowercase hex
  assetName: string;      // lowercase hex
  quantity: number;       // signed; negative on burn
};

export type RefScriptUtxo = {
  txHash: string;
  outputIndex: number;
  scriptHash: string;     // lowercase hex
};

export type OutputDatum = {
  outputIndex: number;
  datumHash: string | null;       // lowercase hex
  inlineDatumCborHex: string | null;
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
  // Optional advanced fields surfaced when the provider supports them. All
  // hex values are lower-cased inside the provider module so verifiers can
  // compare without re-normalising.
  plutusContracts?: PlutusContract[];
  mintedAssets?: MintedAsset[];
  referenceInputs?: RefScriptUtxo[];
  outputDatums?: OutputDatum[];
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

/**
 * Current tip epoch + slot. Verifiers use this for tx-age guards and the
 * `requireActiveLastEpochs` check on `drep_registered`. TTL 1 minute via the
 * provider modules — fresh enough for any verifier decision.
 */
export type EpochInfo = {
  epoch_no: number;
  // Unix seconds at which this epoch started. Optional — Blockfrost surfaces
  // it but Koios doesn't always.
  start_time?: number | null;
};

/**
 * DRep vote record — flattened across providers. Koios `/vote_list` (filtered
 * to the DRep) and Blockfrost `/governance/dreps/{drep_id}/votes` both
 * surface the action tx hash + vote choice; we normalise to this shape.
 */
export type DRepVote = {
  // The governance action this vote was cast on. The action is identified by
  // the tx that PROPOSED it; CIP-1694 calls this the `govActionId`.
  proposal_tx_hash: string;
  proposal_index: number;
  vote: "yes" | "no" | "abstain" | string;
  // Block time of the vote (unix seconds) when the provider exposes it.
  block_time?: number | null;
};
