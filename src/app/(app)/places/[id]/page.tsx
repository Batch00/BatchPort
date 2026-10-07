import { notFound } from "next/navigation";

import { PlaceDetail } from "@/components/places/place-detail";
import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { PLACES_ENABLED } from "@/lib/features";
import { getCatalogItem, getOccasions, getPlace } from "@/lib/places";

// One place and every visit to it.
//
// getPlace filters on user_id as well as the id from the URL, so a uuid
// belonging to a shared profile 404s here rather than rendering. RLS alone
// would hand it over: the policy admits is_shared(user_id).

export default async function PlaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!PLACES_ENABLED) notFound();

  const { id } = await params;
  const [{ user }, place, occasions] = await Promise.all([
    requireUser(),
    getPlace(id),
    getOccasions(),
  ]);
  if (!place) notFound();

  // Only a tracked venue has tenants to offer the game chips, and only then is
  // there a catalog badge to draw.
  const catalogItem = place.catalog_item_id ? await getCatalogItem(place.catalog_item_id) : null;

  return (
    <PlaceDetail
      place={place}
      occasions={occasions}
      tenants={catalogItem?.tenants ?? []}
      catalogs={catalogItem?.catalogs ?? []}
      readOnly={isDemoUser(user.id)}
    />
  );
}
