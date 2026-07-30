import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { getHomeLocation } from "@/lib/home-location";
import { getShareSettings } from "@/lib/share-settings";
import { HomeLocationForm } from "@/components/settings/home-location-form";
import { ShareSettingsForm } from "@/components/settings/share-settings-form";
import { ExportSection } from "@/components/settings/export-section";

export const metadata = { title: "Settings" };

// Authenticated settings page: home location, public sharing, and data export.
export default async function SettingsPage() {
  const { user } = await requireUser();
  const [settings, home] = await Promise.all([
    getShareSettings(user.id),
    getHomeLocation(user.id),
  ]);
  const isDemo = isDemoUser(user.id);

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
        Your home base, how your travel map is shared, and your data.
      </p>

      <div className="flex flex-col gap-10">
        <HomeLocationForm initial={home} isDemo={isDemo} />

        <div className="border-t border-white/10 pt-8">
          <ShareSettingsForm initial={settings} isDemo={isDemo} />
        </div>

        <div className="border-t border-white/10 pt-8">
          <ExportSection />
        </div>
      </div>
    </div>
  );
}
