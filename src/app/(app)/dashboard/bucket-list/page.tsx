import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import {
  getBucketList,
  getBucketListStats,
  getCountries,
} from "@/lib/bucket-list";
import { getTripDestinationOptions, getTripOptions } from "@/lib/trips";
import { placeKey } from "@/lib/geo";
import { BucketListBoard } from "@/components/bucket-list/bucket-list-board";
import { DiscoveryProvider } from "@/components/discover/discovery-host";

export const metadata = { title: "Bucket List" };

// The bucket list page. Server component: it resolves the current user (the demo
// account when signed in as the demo) and hands the data to the client board.
export default async function BucketListPage() {
  const { user } = await requireUser();
  const [items, stats, countries, tripOptions, tripDestinationOptions] =
    await Promise.all([
      getBucketList(user.id),
      getBucketListStats(user.id),
      getCountries(),
      getTripOptions(),
      getTripDestinationOptions(),
    ]);

  // Identities for the discovery panel's "on your bucket list" states: place
  // keys for city views, country codes for country views (a place item's
  // country is not itself on the list unless added separately).
  const toVisit = items.filter((item) => !item.fulfilled_at);
  const bucketCountryCodes = toVisit
    .filter((item) => item.type === "country")
    .map((item) => item.country_code)
    .filter((code): code is string => Boolean(code));
  const bucketPlaceKeys = toVisit
    .filter((item) => item.type === "place" && item.place_name)
    .map((item) => placeKey(item.place_name as string, item.country_code));

  return (
    <DiscoveryProvider
      bucketCountryCodes={bucketCountryCodes}
      bucketPlaceKeys={bucketPlaceKeys}
      tripOptions={tripDestinationOptions}
    >
      <div className="mx-auto w-full max-w-5xl p-6 sm:p-8">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to dashboard
        </Link>

        <BucketListBoard
          items={items}
          countries={countries}
          trips={tripOptions}
          stats={stats}
          isDemo={isDemoUser(user.id)}
        />
      </div>
    </DiscoveryProvider>
  );
}
