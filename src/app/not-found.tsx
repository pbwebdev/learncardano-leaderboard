import Link from "next/link";

export const metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-[color:var(--fg-muted)]">
        404
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">
        That page is not here.
      </h1>
      <p className="mt-3 text-sm text-[color:var(--fg-muted)]">
        The URL might be wrong, the project might not be active yet, or that
        profile might be set to private. Your sign-in is still good — head
        back home and try again.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link
          href="/"
          className="rounded-[--radius-md] bg-[color:var(--accent-primary)] px-4 py-2 font-medium text-white hover:bg-[color:var(--accent-primary-strong)]"
        >
          Back to home
        </Link>
        <Link
          href="/leaderboard"
          className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-4 py-2 hover:bg-[color:var(--bg-elevated)]"
        >
          Leaderboard
        </Link>
        <Link
          href="/projects"
          className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-4 py-2 hover:bg-[color:var(--bg-elevated)]"
        >
          Projects
        </Link>
      </div>
    </main>
  );
}
