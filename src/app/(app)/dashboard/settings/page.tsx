import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { getShareSettings } from "@/lib/share-settings";
import { ShareSettingsForm } from "@/components/settings/share-settings-form";

// Authenticated settings page. For now it covers public sharing: enabling the
// public link and choosing a slug.
export default async function SettingsPage() {
  const { user } = await requireUser();
  const settings = await getShareSettings(user.id);

  return (
    <div className="mx-auto w-full max-w-2xl p-6 sm:p-8">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to dashboard
      </Link>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Manage how your travel map is shared.
      </p>

      <ShareSettingsForm
        initial={settings}
        isDemo={isDemoUser(user.id)}
      />
    </div>
  );
}
