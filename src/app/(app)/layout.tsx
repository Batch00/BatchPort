import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { isDemoUser } from "@/lib/demo";
import { AppNav } from "@/components/app-nav";
import { signOut } from "./actions";

// Every route in this group reads the session via cookies() and is inherently
// per-request. Forcing dynamic here (it propagates to all child pages) avoids
// Next.js attempting a static prerender pass that throws an InvariantError
// when cookies()-based data fetching runs outside a request work store.
export const dynamic = "force-dynamic";

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
      <AppNav email={user.email ?? ""} signOut={signOut} />

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
