"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Header nav link with WCAG-correct aria-current="page" when the current
 * route matches. Server layouts can't read the pathname directly, so this
 * is a tiny client component the layout drops in.
 *
 * `onNavigate` (optional) lets the parent close a mobile disclosure when
 * the user taps a link.
 */
export function NavLink({
  href,
  children,
  className,
  activeClassName,
  exact = false,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  activeClassName?: string;
  exact?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      onClick={onNavigate}
      className={`${className ?? ""} ${isActive ? activeClassName ?? "" : ""}`.trim()}
    >
      {children}
    </Link>
  );
}
