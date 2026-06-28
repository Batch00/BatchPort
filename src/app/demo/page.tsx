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
  const profile = await getSharedProfile(userId);

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a]">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
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
        You are viewing a demo of BatchPort. Request your own account at
        batch-apps.com
      </div>

      <main className="flex-1">
        <SharedProfileView profile={profile} />
      </main>
    </div>
  );
}
