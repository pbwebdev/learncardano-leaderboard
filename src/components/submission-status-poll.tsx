"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Client-side poller for /projects/[slug]?submitted=<id>.
 *
 * Polls /api/submissions/[id] every 2 seconds for up to 60 seconds, or
 * until the submission reaches a terminal state (verified, rejected,
 * paid, reward_verified). After the cap it stops polling and surfaces a
 * "Still pending — refresh to check again" prompt rather than hammering
 * the worker indefinitely.
 *
 * The banner colour + copy update live so the user sees pending →
 * verifying → verified (with points) or rejected (with reason) without
 * refreshing the page.
 */
interface SubmissionState {
  id: string;
  status: string;
  submittedAt: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
  pointsOnVerify: number;
  taskTitle: string;
}

const TERMINAL = new Set(["verified", "rejected", "paid", "reward_verified"]);
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_MS = 60_000;

export function SubmissionStatusPoll({ submissionId }: { submissionId: string }) {
  const [state, setState] = useState<SubmissionState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/submissions/${encodeURIComponent(submissionId)}`, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 404) {
            setErr("Submission not found.");
            return true; // stop polling
          }
          if (res.status === 401 || res.status === 403) {
            setErr("You don't have access to this submission's status.");
            return true;
          }
          // Treat 5xx as transient; keep polling.
          return false;
        }
        const body = (await res.json()) as SubmissionState;
        if (cancelled) return true;
        setState(body);
        if (TERMINAL.has(body.status)) return true;
        return false;
      } catch {
        // Network blip — keep polling.
        return false;
      }
    }

    async function loop() {
      // Immediate first fetch — don't wait 2s for the user to see "pending".
      const done = await tick();
      if (done || cancelled) return;
      const interval = setInterval(async () => {
        if (cancelled) {
          clearInterval(interval);
          return;
        }
        const elapsed = Date.now() - startedAtRef.current;
        if (elapsed >= POLL_MAX_MS) {
          clearInterval(interval);
          setGaveUp(true);
          return;
        }
        const stop = await tick();
        if (stop) clearInterval(interval);
      }, POLL_INTERVAL_MS);
    }

    void loop();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  // ─────────── Banner copy by status ───────────
  const status = state?.status ?? "pending";
  const ui = uiForStatus(status, state, gaveUp, err);

  return (
    <div
      role={ui.role}
      className={`mb-6 rounded-[--radius-md] border p-4 text-sm ${ui.classes}`}
    >
      <p className="font-semibold">{ui.title}</p>
      <p className="mt-1 opacity-90">
        {ui.body}{" "}
        <Link href="/me" className="underline">My dashboard</Link> shows your full history.
      </p>
      {ui.showSpinner && (
        <p className="mt-2 inline-flex items-center gap-2 text-xs opacity-80">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
          Checking again every 2 seconds…
        </p>
      )}
    </div>
  );
}

interface UiConfig {
  title: string;
  body: string;
  role: "status" | "alert";
  classes: string;
  showSpinner: boolean;
}

function uiForStatus(
  status: string,
  state: SubmissionState | null,
  gaveUp: boolean,
  err: string | null,
): UiConfig {
  const muted = "text-[color:var(--fg-muted)]";
  if (err) {
    return {
      title: "Could not load status",
      body: err,
      role: "alert",
      classes: `border-[color:var(--status-amber)]/40 bg-[color:var(--status-amber-bg)] ${muted}`,
      showSpinner: false,
    };
  }
  if (status === "verified" || status === "paid" || status === "reward_verified") {
    const pts = state?.pointsOnVerify ?? 0;
    return {
      title: `Verified — +${pts} pts`,
      body: state?.taskTitle
        ? `"${state.taskTitle}" verified and added to your total.`
        : "Verified and added to your total.",
      role: "status",
      classes: "border-[color:var(--status-green)]/40 bg-[color:var(--status-green-bg)] text-[color:var(--status-green)]",
      showSpinner: false,
    };
  }
  if (status === "rejected") {
    const reason = state?.rejectionReason ? `Reason: ${state.rejectionReason}.` : "";
    return {
      title: "Rejected",
      body: `${reason} If you think this is wrong, contact an admin and they can reset the submission.`,
      role: "alert",
      classes: "border-[color:var(--status-red)]/40 bg-[color:var(--status-red-bg)] text-[color:var(--status-red)]",
      showSpinner: false,
    };
  }
  // pending or verifying — both render the same "in progress" state
  if (gaveUp) {
    return {
      title: "Still verifying",
      body: "Verification is taking longer than usual. The job is still queued — your status will appear on your dashboard once it completes.",
      role: "status",
      classes: `border-[color:var(--status-amber)]/40 bg-[color:var(--status-amber-bg)] ${muted}`,
      showSpinner: false,
    };
  }
  return {
    title: status === "verifying" ? "Verifying your submission…" : "Submission received",
    body: "We're checking your proof. This usually takes under 10 seconds.",
    role: "status",
    classes: `border-[color:var(--accent-primary)]/40 bg-[color:var(--bg-elevated)] ${muted}`,
    showSpinner: true,
  };
}
