"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SECRET = "beware";
const CLICK_WINDOW_MS = 3000;
const CLICK_THRESHOLD = 5;
const VISIBLE_MS = 8000;
const BUFFER_LEN = SECRET.length;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Hidden easter egg — Pete peeks in from the bottom-right.
 *
 * Triggers:
 *   1. 5 clicks within 3 seconds on the small padlock in the footer.
 *   2. Typing the word "beware" anywhere on the page (when not focused
 *      inside a text input / textarea / contenteditable).
 *
 * Stays for 8 seconds then slides back out. Close button dismisses early.
 * Pointer-events are constrained to the image + close button so the page
 * underneath remains fully interactive.
 */
export function ScammerEasterEgg() {
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const clickTimes = useRef<number[]>([]);
  const keyBuffer = useRef<string>("");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
    }, VISIBLE_MS);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  useEffect(() => {
    function onPadlockClick() {
      const now = Date.now();
      clickTimes.current.push(now);
      clickTimes.current = clickTimes.current.filter((t) => now - t <= CLICK_WINDOW_MS);
      if (clickTimes.current.length >= CLICK_THRESHOLD) {
        clickTimes.current = [];
        reveal();
      }
    }
    window.addEventListener("scammer-padlock-click", onPadlockClick);
    return () => window.removeEventListener("scammer-padlock-click", onPadlockClick);
  }, [reveal]);

  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key.length !== 1) return;
      keyBuffer.current = (keyBuffer.current + e.key.toLowerCase()).slice(-BUFFER_LEN);
      if (keyBuffer.current === SECRET) {
        keyBuffer.current = "";
        reveal();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reveal]);

  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    setReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const transition = reducedMotion ? "none" : "transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1)";
  const transform = visible ? "translateX(0)" : "translateX(105%)";

  return (
    <div
      aria-hidden={visible ? "false" : "true"}
      style={{
        position: "fixed",
        right: 0,
        bottom: 0,
        zIndex: 200,
        pointerEvents: "none",
        transform,
        transition,
      }}
    >
      <div
        style={{
          position: "relative",
          pointerEvents: visible ? "auto" : "none",
        }}
        className="w-[220px] sm:w-[320px]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pete.webp"
          alt="Anime character saying you found me, now beware of scammers"
          width={320}
          height={320}
          draggable={false}
          className="block h-auto w-full select-none"
        />
        <button
          type="button"
          onClick={hide}
          aria-label="Close easter egg"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-base font-bold text-white shadow-lg shadow-black/40 hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/**
 * Small subtle padlock button — emits a CustomEvent the egg component listens
 * for. Lives in the footer next to the studio credit. Real <button> so it's
 * keyboard-accessible; clicks accumulate via the egg's rolling-window logic.
 */
export function ScammerEasterEggTrigger() {
  return (
    <button
      type="button"
      aria-label="Hidden easter egg trigger"
      title=""
      onClick={() => {
        window.dispatchEvent(new CustomEvent("scammer-padlock-click"));
      }}
      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--fg-muted)] opacity-30 hover:opacity-100 focus-visible:opacity-100"
    >
      <span aria-hidden="true">🔒</span>
    </button>
  );
}
