import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { isDemoUser } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

// Layout for every authenticated route. Guards access at the server: an
// unauthenticated visitor is hard-redirected to the landing page rather than
// being shown an empty shell.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const demo = isDemoUser(user.id);

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a]">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
        <nav className="flex items-center gap-5">
          <Link
            href="/dashboard"
            className="text-sm font-semibold tracking-tight"
          >
            Batch<span className="text-brand">Port</span>
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/bucket-list"
            className="text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Bucket List
          </Link>
          <Link
            href="/dashboard/stats"
            className="text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Stats
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-foreground/60 sm:inline">
            {user.email}
          </span>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {demo ? (
        <div className="border-b border-brand/20 bg-brand/10 px-4 py-2 text-center text-xs text-foreground/70 sm:px-6">
          You are viewing a demo. Data is read-only. Request access at
          batch-apps.com
        </div>
      ) : null}

      <main className="flex-1">{children}</main>
    </div>
  );
}
