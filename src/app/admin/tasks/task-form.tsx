"use client";

import { useState } from "react";
import { ALL_TASK_TYPES, isAdminCreatableTaskType, taskTypeLabelSuffix } from "@/lib/verification";

/**
 * Shared task form fields. Rendered inside a <SaveForm> on the parent page
 * so the full-reload pattern (save-form.tsx) handles submission. Client
 * component so the visible config fieldset switches with the selected type.
 *
 * Every cfg_* field name corresponds to a typed field on the relevant
 * config interface in src/lib/verification/<type>.ts. The server action
 * (admin/tasks/actions.ts) assembles them into a JSON object based on
 * taskType and re-validates via parseTaskConfigByType.
 */
export function TaskFormFields(props: {
  defaults: {
    id?: string;
    projectId: string;
    title: string;
    descriptionMd: string;
    taskType: string;
    taskConfig: unknown;
    points: number;
    startsAt: Date | null;
    endsAt: Date | null;
    maxCompletionsPerUser: number;
    totalCompletionCap: number;
    displayOrder: number;
    status: string;
  };
  projects: ReadonlyArray<{ id: string; name: string }>;
  lockProject?: boolean;
}) {
  const d = props.defaults;
  const initialType = d.taskType || "manual_review";
  const [taskType, setTaskType] = useState<string>(initialType);
  const cfg = (d.taskConfig ?? {}) as Record<string, unknown>;

  function dateStr(x: Date | null): string {
    if (!x) return "";
    return x.toISOString().slice(0, 16);
  }

  return (
    <>
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <label className="flex flex-col gap-1">
        <span>Project</span>
        <select name="projectId" defaultValue={d.projectId} required disabled={props.lockProject} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 disabled:opacity-60">
          {!d.projectId && <option value="">— pick a project —</option>}
          {props.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {props.lockProject && <input type="hidden" name="projectId" value={d.projectId} />}
      </label>
      <label className="flex flex-col gap-1">
        <span>Title</span>
        <input name="title" defaultValue={d.title} required className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span>Description (markdown shown on the public task card)</span>
        <textarea name="descriptionMd" rows={4} defaultValue={d.descriptionMd} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>

      <label className="flex flex-col gap-1">
        <span>Task type</span>
        <select
          name="taskType"
          value={taskType}
          onChange={(e) => setTaskType(e.target.value)}
          required
          className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1"
        >
          {ALL_TASK_TYPES.map((t) => (
            <option key={t} value={t} disabled={!isAdminCreatableTaskType(t)}>
              {t}{taskTypeLabelSuffix(t)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>Status</span>
        <select name="status" defaultValue={d.status || "draft"} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
          {["draft","active","paused","ended"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <ConfigFieldset taskType={taskType} cfg={cfg} />

      <label className="flex flex-col gap-1">
        <span>Points</span>
        <input name="points" type="number" defaultValue={d.points} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Display order</span>
        <input name="displayOrder" type="number" defaultValue={d.displayOrder} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Max completions per user</span>
        <input name="maxCompletionsPerUser" type="number" min={1} defaultValue={d.maxCompletionsPerUser} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Total completion cap (0 = no cap)</span>
        <input name="totalCompletionCap" type="number" min={0} defaultValue={d.totalCompletionCap} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Starts at</span>
        <input name="startsAt" type="datetime-local" defaultValue={dateStr(d.startsAt)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Ends at (optional)</span>
        <input name="endsAt" type="datetime-local" defaultValue={dateStr(d.endsAt)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
    </>
  );
}

// ─────────────────────────── Per-type config fieldsets ───────────────────────────

function ConfigFieldset({ taskType, cfg }: { taskType: string; cfg: Record<string, unknown> }) {
  return (
    <fieldset className="md:col-span-2 rounded border border-dashed border-[color:var(--border)] p-3">
      <legend className="px-1 text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
        {taskType} config
      </legend>
      {taskType === "manual_review" && <ManualReviewFields cfg={cfg} />}
      {taskType === "pool_delegation" && <PoolDelegationFields cfg={cfg} />}
      {taskType === "drep_delegation" && <DRepDelegationFields cfg={cfg} />}
      {taskType === "drep_registered" && <DRepRegisteredFields cfg={cfg} />}
      {taskType === "tx_swap" && <TxSwapFields cfg={cfg} />}
      {taskType === "asset_purchase" && <AssetPurchaseFields cfg={cfg} />}
      {taskType === "governance_vote" && <GovernanceVoteFields cfg={cfg} />}
      {taskType === "x_tweet" && <XTweetFields cfg={cfg} />}
      {taskType === "x_retweet" && <XRetweetFields cfg={cfg} />}
      {taskType === "youtube_comment" && <YoutubeCommentFields cfg={cfg} />}
      {taskType === "bounty_completion" && <BountyCompletionFields cfg={cfg} />}
    </fieldset>
  );
}

function s(v: unknown): string { return v == null ? "" : String(v); }
function n(v: unknown): string { return typeof v === "number" ? String(v) : ""; }
function arr(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : "";
}
function arrLines(v: unknown): string {
  return Array.isArray(v) ? v.join("\n") : "";
}

function ManualReviewFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>Instructions (shown to the user on the submission page)</span>
        <textarea name="cfg_instructions" rows={3} defaultValue={s(cfg.instructions)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="cfg_requiresProofUrl" defaultChecked={cfg.requiresProofUrl !== false} /> requires proof URL</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="cfg_requiresScreenshot" defaultChecked={Boolean(cfg.requiresScreenshot)} /> requires screenshot</label>
      </div>
    </>
  );
}

function PoolDelegationFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>Pool ID (bech32 <code>pool1…</code>, optional — leave blank to accept any pool)</span>
        <input name="cfg_poolId" defaultValue={s(cfg.poolId)} placeholder="pool1abc…" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" name="cfg_clawbackOnUndelegate" defaultChecked={Boolean(cfg.clawbackOnUndelegate)} />
        clawback points if the user un-delegates (cron re-checks every 6h)
      </label>
    </>
  );
}

function DRepDelegationFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>DRep ID (bech32 <code>drep1…</code>, optional)</span>
        <input name="cfg_drepId" defaultValue={s(cfg.drepId)} placeholder="drep1abc…" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" name="cfg_mustBeActive" defaultChecked={Boolean(cfg.mustBeActive)} />
        require the DRep to be active (non-expired)
      </label>
    </>
  );
}

function DRepRegisteredFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <label className="flex flex-col gap-1">
      <span>Require active in last N epochs (optional, blank = registered is enough)</span>
      <input name="cfg_requireActiveLastEpochs" type="number" min={1} defaultValue={n(cfg.requireActiveLastEpochs)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
    </label>
  );
}

function TxSwapFields({ cfg }: { cfg: Record<string, unknown> }) {
  const mintedAsset = (cfg.requiredMintedAsset ?? {}) as Record<string, unknown>;
  const hasAdvanced =
    (Array.isArray(cfg.requiredScriptHashes) && (cfg.requiredScriptHashes as unknown[]).length > 0) ||
    !!cfg.requiredRedeemerTag ||
    cfg.requiredRedeemerConstructor != null ||
    !!cfg.requiredMintedAsset ||
    !!cfg.requiredReferenceScriptHash ||
    !!cfg.requiredOutputDatumHash;
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>Script addresses (one per line — e.g. Minswap V2 batcher)</span>
        <textarea name="cfg_scriptAddresses" rows={4} defaultValue={arrLines(cfg.scriptAddresses)} placeholder="addr1z…&#10;addr1w…" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span>Minimum ADA in (optional, lovelace — 1 ADA = 1_000_000)</span>
        <input name="cfg_minAdaIn" type="number" min={0} defaultValue={n(cfg.minAdaIn)} placeholder="1000000" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>

      <details className="mt-3 rounded border border-[color:var(--border)] p-2" open={hasAdvanced}>
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
          Advanced verification (optional — pin to a specific contract interaction)
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>Required script hashes (one per line, 56 hex chars each)</span>
            <span className="text-xs text-[color:var(--fg-muted)]">
              Ask the partner for the Plutus script hash(es) of the contract a user interacts with.
              The tx must spend from / mint via at least one matching script.
            </span>
            <textarea name="cfg_requiredScriptHashes" rows={2} defaultValue={arrLines(cfg.requiredScriptHashes)} placeholder="56-char hex script hash" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Required redeemer tag</span>
            <span className="text-xs text-[color:var(--fg-muted)]">
              Ask the partner which redeemer purpose this action uses (usually <code>spend</code> for DEX orders, <code>mint</code> for minting).
            </span>
            <select name="cfg_requiredRedeemerTag" defaultValue={s(cfg.requiredRedeemerTag)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
              <option value="">— any —</option>
              {["spend","mint","cert","reward","vote","propose"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>Required redeemer constructor index</span>
            <span className="text-xs text-[color:var(--fg-muted)]">
              Ask the partner for the constructor index — e.g. <code>0</code> for &quot;place order&quot;, <code>1</code> for cancel. Leave blank to accept any.
            </span>
            <input name="cfg_requiredRedeemerConstructor" type="number" min={0} defaultValue={n(cfg.requiredRedeemerConstructor)} placeholder="0" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
          </label>
          <fieldset className="rounded border border-dashed border-[color:var(--border)] p-2">
            <legend className="px-1 text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
              Required minted asset (optional — for &quot;tx mints a LP / receipt token&quot;)
            </legend>
            <label className="flex flex-col gap-1">
              <span>Policy ID (56 hex chars)</span>
              <input name="cfg_requiredMintedAsset_policyId" defaultValue={s(mintedAsset.policyId)} placeholder="56-char hex" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
            </label>
            <label className="mt-2 flex flex-col gap-1">
              <span>Asset name (hex, optional)</span>
              <input name="cfg_requiredMintedAsset_assetName" defaultValue={s(mintedAsset.assetName)} placeholder="hex" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
            </label>
            <label className="mt-2 flex flex-col gap-1">
              <span>Minimum quantity (default 1)</span>
              <input name="cfg_requiredMintedAsset_minQuantity" type="number" min={1} defaultValue={n(mintedAsset.minQuantity)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
            </label>
          </fieldset>
          <label className="flex flex-col gap-1">
            <span>Required reference script hash (56 hex chars)</span>
            <span className="text-xs text-[color:var(--fg-muted)]">
              Ask the partner if their contract uses a reference script. If so, the tx must reference a UTxO carrying that script.
            </span>
            <input name="cfg_requiredReferenceScriptHash" defaultValue={s(cfg.requiredReferenceScriptHash)} placeholder="56-char hex" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Required output datum hash (64 hex chars)</span>
            <span className="text-xs text-[color:var(--fg-muted)]">
              For tasks pinned to a single datum shape — at least one tx output must carry this exact datum hash.
            </span>
            <input name="cfg_requiredOutputDatumHash" defaultValue={s(cfg.requiredOutputDatumHash)} placeholder="64-char hex" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
          </label>
        </div>
      </details>
    </>
  );
}

function AssetPurchaseFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>Policy ID (56 hex chars, required)</span>
        <input name="cfg_policyId" defaultValue={s(cfg.policyId)} required={false} placeholder="56-char hex policy id" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span>Asset name (hex, optional — match any asset under the policy if blank)</span>
        <input name="cfg_assetName" defaultValue={s(cfg.assetName)} placeholder="hex" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span>Minimum quantity (default 1)</span>
        <input name="cfg_minQuantity" type="number" min={1} defaultValue={n(cfg.minQuantity)} placeholder="1" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
    </>
  );
}

function GovernanceVoteFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <label className="flex flex-col gap-1">
      <span>Governance action tx hash (64 hex chars, optional — any vote within task window if blank)</span>
      <input name="cfg_actionTxHash" defaultValue={s(cfg.actionTxHash)} placeholder="64-char hex tx hash" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
    </label>
  );
}

function XTweetFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>Required hashtags (comma-separated, without #)</span>
        <input name="cfg_requiredHashtags" defaultValue={arr(cfg.requiredHashtags)} placeholder="LearnCardano, Cardano" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span>Required mentions (comma-separated, without @)</span>
        <input name="cfg_requiredMentions" defaultValue={arr(cfg.requiredMentions)} placeholder="astroboysoup, LearnCardano" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
    </>
  );
}

function XRetweetFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <label className="flex flex-col gap-1">
      <span>Target tweet ID (required — the tweet users must retweet)</span>
      <input name="cfg_targetTweetId" defaultValue={s(cfg.targetTweetId)} placeholder="19-digit tweet id" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
    </label>
  );
}

function YoutubeCommentFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <label className="flex flex-col gap-1">
      <span>YouTube video ID (required — the part after <code>v=</code> in the URL)</span>
      <input name="cfg_videoId" defaultValue={s(cfg.videoId)} placeholder="dQw4w9WgXcQ" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
    </label>
  );
}

function BountyCompletionFields({ cfg }: { cfg: Record<string, unknown> }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>Bounty ID (matches the Learn Cardano Bounty platform&apos;s identifier)</span>
        <input name="cfg_bountyId" defaultValue={s(cfg.bountyId)} placeholder="bounty-2026-001" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>
      <p className="mt-2 text-xs text-[color:var(--fg-muted)]">
        Users don&apos;t submit this type — the Bounty platform POSTs to
        <code className="ml-1">/api/webhooks/bounty</code> with a verified HMAC
        when a user completes the bounty.
      </p>
    </>
  );
}
