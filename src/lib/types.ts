// Shared domain types mirroring the batchport Postgres schema. Snake_case
// matches the columns returned by PostgREST so query results map directly.

export type TripStatus = "completed" | "ongoing" | "planned";

export interface Trip {
  id: string;
  user_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: TripStatus;
  cover_photo_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// A trip plus the lightweight aggregates the dashboard cards need.
export interface TripSummary extends Trip {
  destination_count: number;
  country_count: number;
  // First destination's country code, used for the card placeholder when the
  // trip has no cover photo.
  primary_country_code: string | null;
}

export interface Destination {
  id: string;
  trip_id: string;
  user_id: string;
  name: string;
  country_code: string | null;
  admin_region: string | null;
  // Generated columns derived from the geom geography point.
  latitude: number | null;
  longitude: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  order_index: number;
  cover_photo_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Experience {
  id: string;
  destination_id: string;
  user_id: string;
  name: string;
  category_id: string | null;
  // smallint 1 to 10, where each step is half a star (10 = five full stars).
  rating: number | null;
  visited_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
}

// Photos attach to either a trip or a destination. A photo is one of three
// sources: a user upload in Supabase Storage, an auto-fetched Wikimedia Commons
// image referenced by external_url, or an arbitrary external url.
export type PhotoOwnerType = "trip" | "destination";
export type PhotoSource = "upload" | "wikimedia" | "url";

export interface Photo {
  id: string;
  user_id: string;
  owner_type: PhotoOwnerType;
  owner_id: string;
  source: PhotoSource;
  storage_path: string | null;
  external_url: string | null;
  attribution: string | null;
  order_index: number;
  created_at: string;
}

export interface DestinationWithExperiences extends Destination {
  experiences: Experience[];
}

export interface TripWithDestinations extends Trip {
  destinations: DestinationWithExperiences[];
}

// The canonical location shape produced by the geocoding endpoints and consumed
// by the location search component and destination forms.
export interface GeoLocation {
  name: string;
  country: string | null;
  country_code: string | null;
  admin_region: string | null;
  lat: number;
  lng: number;
}
