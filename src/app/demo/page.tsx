import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { getDemoUserId, getSharedProfile } from "@/lib/share-data";
import { SharedProfileView } from "@/components/share/shared-profile-view";

// Sessionless, read-only demo. It renders the demo user's shared profile via the
// anon client (gated by is_shared() RLS), so no sign-in happens here.
export const metadata = {
  title: "Demo",
  description: "Explore a read-only demo of BatchPort, a personal travel tracker.",
};

export default async function DemoPage() {
  const userId = await getDemoUserId();
  // THE ONLY PLACE THE EXPENSES FLAG IS PASSED. /demo is the surface expenses
  // are allowed on; /share/[slug] is not, INCLUDING when its slug resolves to
  // this same demo account, which it does ("demo"). RLS permits that read, so
  // the route is the only thing that refuses it. See getSharedProfile.
  const profile = await getSharedProfile(userId, { expenses: true });

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a]">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          <span>
            Back to Batch<span className="text-brand">Port</span>
          </span>
        </Link>
        <a
          href="https://www.batch-apps.com"
          className="text-sm text-brand underline-offset-4 transition-colors hover:underline"
        >
          Sign up
        </a>
      </header>

      <div className="border-b border-brand/20 bg-brand/10 px-4 py-2 text-center text-xs text-foreground/70 sm:px-6">
        You are viewing a demo of BatchPort. Request your own account at{" "}
        <a
          href="https://www.batch-apps.com"
          className="font-medium text-brand underline underline-offset-4 transition-colors hover:text-brand/80"
        >
          batch-apps.com
        </a>
      </div>

      <main className="flex-1">
        <SharedProfileView profile={profile} />
      </main>
    </div>
  );
}
