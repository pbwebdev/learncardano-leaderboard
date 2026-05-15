import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { parseAdminList } from "@/lib/admin";
import { NavLink } from "@/components/nav-link";

export const dynamic = "force-dynamic";

/**
 * Admin chrome. Every page under /admin is gated here — we resolve the
 * session manually rather than calling requireAdmin() (which throws) so
 * we can redirect rather than return a stack trace. Individual server
 * actions and route handlers MUST still call requireAdmin() at the top
 * of their bodies; the layout gate is a UX nicety, not a security
 * boundary (CLAUDE.md § Admin allow-list).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const stake = await getCurrentStakeAddressOrNull();
  if (!stake) redirect("/");
  const allowList = parseAdminList();
  if (!allowList.includes(stake)) {
    // Soft 404-ish — the admin surface deliberately does not advertise
    // its existence to non-admins. Redirecting to / is fine.
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-[color:var(--rule)] pb-3">
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <span className="font-mono text-xs text-[color:var(--fg-muted)]">
          {stake.slice(0, 12)}…{stake.slice(-6)}
        </span>
      </header>
      <nav className="mb-6 flex flex-wrap gap-4 text-sm font-sans">
        <NavLink href="/admin" className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]" activeClassName="text-[color:var(--fg)] font-medium">Home</NavLink>
        <NavLink href="/admin/submissions" className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]" activeClassName="text-[color:var(--fg)] font-medium">Submissions</NavLink>
        <NavLink href="/admin/projects" className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]" activeClassName="text-[color:var(--fg)] font-medium">Projects</NavLink>
        <NavLink href="/admin/tasks" className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]" activeClassName="text-[color:var(--fg)] font-medium">Tasks</NavLink>
        <NavLink href="/admin/audit" className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]" activeClassName="text-[color:var(--fg)] font-medium">Audit</NavLink>
        <Link href="/" className="ml-auto text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]">
          ← Back to site
        </Link>
      </nav>
      <div>{children}</div>
    </div>
  );
}
