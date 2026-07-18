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
import { getPhotosByIds } from "@/lib/photos-data";
import { getPhotoUrl } from "@/lib/photos";
import { placeKey } from "@/lib/geo";
import { BucketListBoard } from "@/components/bucket-list/bucket-list-board";
import { DiscoveryProvider } from "@/components/discover/discovery-host";
import type { BucketTripCover } from "@/components/bucket-list/bucket-card";

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

  // Fulfilled cards prefer the fulfilling trip's cover photo (the memory)
  // over the Wikimedia stock image. Resolve those covers in one query.
  const coverPhotoIds = Array.from(
    new Set(
      items
        .map((item) => item.fulfilled_trip_cover_photo_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const coverPhotos = await getPhotosByIds(coverPhotoIds);
  const photoById = new Map(coverPhotos.map((photo) => [photo.id, photo]));
  const tripCovers: Record<string, BucketTripCover> = {};
  for (const item of items) {
    if (!item.fulfilled_trip_cover_photo_id) continue;
    const photo = photoById.get(item.fulfilled_trip_cover_photo_id);
    if (!photo) continue;
    tripCovers[item.id] = {
      url: getPhotoUrl(photo),
      position: item.fulfilled_trip_cover_position,
    };
  }

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
          tripCovers={tripCovers}
          countries={countries}
          trips={tripOptions}
          stats={stats}
          isDemo={isDemoUser(user.id)}
        />
      </div>
    </DiscoveryProvider>
  );
}
