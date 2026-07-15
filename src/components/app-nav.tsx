"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, SettingsIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Links shown in the full mobile menu. The desktop bar shows the first three
// plus a settings gear; the mobile sheet lists all of them.
const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/bucket-list", label: "Bucket List" },
  { href: "/dashboard/stats", label: "Stats" },
  { href: "/dashboard/settings", label: "Settings" },
];

interface AppNavProps {
  email: string;
  signOut: () => Promise<void>;
}

// The authenticated top navigation. On desktop it is a single row; on phones it
// collapses to a brand mark plus a hamburger that opens a stacked menu.
export function AppNav({ email, signOut }: AppNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Exact match only: /dashboard/stats should highlight Stats, not Dashboard.
  function isActive(href: string): boolean {
    return pathname === href;
  }

  return (
    // pt: with viewport-fit=cover (and black-translucent status bar in the
    // installed PWA) the page starts under the iPhone status bar; the safe
    // area inset pushes the nav below it. Zero everywhere else.
    <header className="border-b border-white/10 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-5">
          <Link
            href="/dashboard"
            className="text-sm font-semibold tracking-tight"
          >
            Batch<span className="text-brand">Port</span>
          </Link>
          <nav className="hidden items-center gap-5 sm:flex">
            {NAV_LINKS.slice(0, 3).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "text-sm transition-colors hover:text-foreground",
                  isActive(link.href)
                    ? "font-medium text-foreground"
                    : "text-foreground/60",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-foreground/60 lg:inline">
            {email}
          </span>
          <Link
            href="/dashboard/settings"
            aria-label="Settings"
            className="hidden size-8 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground sm:flex"
          >
            <SettingsIcon className="size-4" />
          </Link>
          <form action={signOut} className="hidden sm:block">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex size-10 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-white/5 hover:text-foreground sm:hidden"
          >
            {open ? (
              <XIcon className="size-5" />
            ) : (
              <MenuIcon className="size-5" />
            )}
          </button>
        </div>
      </div>

      {open ? (
        <nav className="flex flex-col gap-1 border-t border-white/10 px-2 py-2 sm:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-white/5 hover:text-foreground",
                isActive(link.href)
                  ? "bg-white/5 font-medium text-foreground"
                  : "text-foreground/70",
              )}
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/10 px-3 pt-2">
            <span className="min-w-0 truncate text-xs text-foreground/50">
              {email}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
