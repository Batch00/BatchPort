import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import {
  getBucketList,
  getBucketListStats,
  getCountries,
} from "@/lib/bucket-list";
import { getTripOptions } from "@/lib/trips";
import { getPhotosByIds } from "@/lib/photos-data";
import { getPhotoUrl } from "@/lib/photos";
import { BucketListBoard } from "@/components/bucket-list/bucket-list-board";
import type { BucketTripCover } from "@/components/bucket-list/bucket-card";

export const metadata = { title: "Bucket List" };

// The bucket list page. Server component: it resolves the current user (the demo
// account when signed in as the demo) and hands the data to the client board.
export default async function BucketListPage() {
  const { user } = await requireUser();
  const [items, stats, countries, tripOptions] = await Promise.all([
    getBucketList(user.id),
    getBucketListStats(user.id),
    getCountries(),
    getTripOptions(),
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

  return (
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
  );
}
