import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { DestinationForm } from "@/components/destinations/destination-form";
import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { parseEwkbPoint } from "@/lib/geo";
import { chronologicalDestinations } from "@/lib/trip-dates";

export default async function NewDestinationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireUser();

  // Context for the map picker (existing stops center the map, bucket place
  // pins are pickable) and for the smart arrival default. Narrow columns; RLS
  // scopes everything to the current user.
  const [tripResult, destResult, bucketResult] = await Promise.all([
    supabase
      .from("trips")
      .select("start_date")
      .eq("id", id)
      .maybeSingle<{ start_date: string | null }>(),
    supabase
      .from("destinations")
      .select("id, name, country_code, latitude, longitude, arrival_date, departure_date, order_index")
      .eq("trip_id", id)
      .order("order_index", { ascending: true }),
    supabase
      .from("bucket_list")
      .select("id, place_name, country_code, geom")
      .eq("user_id", user.id)
      .eq("type", "place")
      .is("fulfilled_at", null),
  ]);

  const stops = (destResult.data ?? []) as {
    id: string;
    name: string;
    country_code: string | null;
    latitude: number | null;
    longitude: number | null;
    arrival_date: string | null;
    departure_date: string | null;
    order_index: number;
  }[];

  const pickerDestinations = stops
    .filter((stop) => stop.latitude !== null && stop.longitude !== null)
    .map((stop) => ({
      id: stop.id,
      name: stop.name,
      countryCode: stop.country_code,
      lat: stop.latitude as number,
      lng: stop.longitude as number,
    }));

  const pickerBucketPlaces = ((bucketResult.data ?? []) as {
    id: string;
    place_name: string | null;
    country_code: string | null;
    geom: string | null;
  }[])
    .flatMap((row) => {
      if (!row.place_name || !row.geom) return [];
      const point = parseEwkbPoint(row.geom);
      if (!point) return [];
      return [
        {
          id: row.id,
          name: row.place_name,
          countryCode: row.country_code,
          lat: point.lat,
          lng: point.lng,
        },
      ];
    });

  // Smart default: the next stop usually starts where the previous one ended,
  // so prefill arrival with the last stop's departure (falling back to its
  // arrival, then the trip start). Just a default; freely editable.
  //
  // "Last" is the last stop in VISIT order, which is what the query's
  // order_index gives once the schedule sync has run, but is derived here
  // anyway so a trip written before that still prefills from its real end.
  const ordered = chronologicalDestinations(stops);
  const lastStop = ordered[ordered.length - 1];
  const defaultArrival =
    lastStop?.departure_date ??
    lastStop?.arrival_date ??
    tripResult.data?.start_date ??
    "";

  return (
    <div className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Link
        href={`/trips/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trip
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Add destination
      </h1>
      <DestinationForm
        mode="create"
        tripId={id}
        userId={user.id}
        isDemo={isDemoUser(user.id)}
        defaultArrival={defaultArrival}
        pickerDestinations={pickerDestinations}
        pickerBucketPlaces={pickerBucketPlaces}
      />
    </div>
  );
}
