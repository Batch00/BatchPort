// Mock travel data for the landing page hero. Unauthenticated visitors have no
// data of their own, so two Europe trips populate the globe. The shapes mirror
// the Postgres schema (snake_case columns); buildMockGlobeProps adapts them to
// the data-agnostic Globe component's prop shape.

import type { GlobeArc, GlobeDestination } from "@/components/map/globe";

export interface Category {
  id: string;
  slug: string;
  name: string;
  /** Hex color used to tint the destination pins for this category. */
  color: string;
}

export interface Trip {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface Destination {
  id: string;
  trip_id: string;
  name: string;
  country: string;
  /** ISO 3166-1 alpha-2, matched against ISO_A2_EH in the countries GeoJSON. */
  country_code: string;
  latitude: number;
  longitude: number;
  /** Visit order within the trip, used to draw arcs between stops. */
  order_index: number;
}

export interface Experience {
  id: string;
  destination_id: string;
  name: string;
  category_id: string;
  /** 1 to 5. */
  rating: number;
  notes?: string;
}

export const categories: Category[] = [
  { id: "cat-restaurant", slug: "restaurant", name: "Restaurant", color: "#f59e0b" },
  { id: "cat-museum", slug: "museum", name: "Museum", color: "#a855f7" },
  { id: "cat-attraction", slug: "attraction", name: "Attraction", color: "#22d3ee" },
  { id: "cat-nightlife", slug: "nightlife", name: "Nightlife", color: "#ec4899" },
  { id: "cat-nature", slug: "nature", name: "Nature", color: "#34d399" },
  { id: "cat-cafe", slug: "cafe", name: "Cafe", color: "#fb923c" },
];

export const trips: Trip[] = [
  {
    id: "trip-weu-2023",
    name: "Western Europe Summer 2023",
    start_date: "2023-06-10",
    end_date: "2023-06-24",
  },
  {
    id: "trip-med-2024",
    name: "Mediterranean Fall 2024",
    start_date: "2024-09-15",
    end_date: "2024-09-29",
  },
];

export const destinations: Destination[] = [
  // Trip 1: Western Europe Summer 2023
  {
    id: "dest-london",
    trip_id: "trip-weu-2023",
    name: "London",
    country: "United Kingdom",
    country_code: "GB",
    latitude: 51.5072,
    longitude: -0.1276,
    order_index: 0,
  },
  {
    id: "dest-paris",
    trip_id: "trip-weu-2023",
    name: "Paris",
    country: "France",
    country_code: "FR",
    latitude: 48.8566,
    longitude: 2.3522,
    order_index: 1,
  },
  {
    id: "dest-amsterdam",
    trip_id: "trip-weu-2023",
    name: "Amsterdam",
    country: "Netherlands",
    country_code: "NL",
    latitude: 52.3676,
    longitude: 4.9041,
    order_index: 2,
  },
  {
    id: "dest-berlin",
    trip_id: "trip-weu-2023",
    name: "Berlin",
    country: "Germany",
    country_code: "DE",
    latitude: 52.52,
    longitude: 13.405,
    order_index: 3,
  },
  // Trip 2: Mediterranean Fall 2024
  {
    id: "dest-barcelona",
    trip_id: "trip-med-2024",
    name: "Barcelona",
    country: "Spain",
    country_code: "ES",
    latitude: 41.3851,
    longitude: 2.1734,
    order_index: 0,
  },
  {
    id: "dest-nice",
    trip_id: "trip-med-2024",
    name: "Nice",
    country: "France",
    country_code: "FR",
    latitude: 43.7102,
    longitude: 7.262,
    order_index: 1,
  },
  {
    id: "dest-rome",
    trip_id: "trip-med-2024",
    name: "Rome",
    country: "Italy",
    country_code: "IT",
    latitude: 41.9028,
    longitude: 12.4964,
    order_index: 2,
  },
  {
    id: "dest-athens",
    trip_id: "trip-med-2024",
    name: "Athens",
    country: "Greece",
    country_code: "GR",
    latitude: 37.9838,
    longitude: 23.7275,
    order_index: 3,
  },
];

export const experiences: Experience[] = [
  // London
  { id: "exp-lon-1", destination_id: "dest-london", name: "British Museum", category_id: "cat-museum", rating: 5 },
  { id: "exp-lon-2", destination_id: "dest-london", name: "The Ritz Afternoon Tea", category_id: "cat-restaurant", rating: 5 },
  { id: "exp-lon-3", destination_id: "dest-london", name: "Tower of London", category_id: "cat-attraction", rating: 4 },
  // Paris
  { id: "exp-par-1", destination_id: "dest-paris", name: "Musee du Louvre", category_id: "cat-museum", rating: 5 },
  { id: "exp-par-2", destination_id: "dest-paris", name: "Le Comptoir du Relais", category_id: "cat-restaurant", rating: 4 },
  { id: "exp-par-3", destination_id: "dest-paris", name: "Eiffel Tower", category_id: "cat-attraction", rating: 4 },
  // Amsterdam
  { id: "exp-ams-1", destination_id: "dest-amsterdam", name: "Rijksmuseum", category_id: "cat-museum", rating: 5 },
  { id: "exp-ams-2", destination_id: "dest-amsterdam", name: "Foodhallen", category_id: "cat-restaurant", rating: 4 },
  { id: "exp-ams-3", destination_id: "dest-amsterdam", name: "Evening Canal Cruise", category_id: "cat-attraction", rating: 4 },
  // Berlin
  { id: "exp-ber-1", destination_id: "dest-berlin", name: "Pergamon Museum", category_id: "cat-museum", rating: 5 },
  { id: "exp-ber-2", destination_id: "dest-berlin", name: "Brandenburg Gate", category_id: "cat-attraction", rating: 4 },
  { id: "exp-ber-3", destination_id: "dest-berlin", name: "Berghain", category_id: "cat-nightlife", rating: 4 },
  // Barcelona
  { id: "exp-bcn-1", destination_id: "dest-barcelona", name: "Sagrada Familia", category_id: "cat-attraction", rating: 5 },
  { id: "exp-bcn-2", destination_id: "dest-barcelona", name: "El Xampanyet", category_id: "cat-restaurant", rating: 5 },
  { id: "exp-bcn-3", destination_id: "dest-barcelona", name: "Park Guell", category_id: "cat-nature", rating: 4 },
  // Nice
  { id: "exp-nce-1", destination_id: "dest-nice", name: "Promenade des Anglais", category_id: "cat-nature", rating: 4 },
  { id: "exp-nce-2", destination_id: "dest-nice", name: "Cours Saleya Market", category_id: "cat-cafe", rating: 4 },
  { id: "exp-nce-3", destination_id: "dest-nice", name: "Le Bistrot d'Antoine", category_id: "cat-restaurant", rating: 5 },
  // Rome
  { id: "exp-rom-1", destination_id: "dest-rome", name: "Colosseum", category_id: "cat-attraction", rating: 5 },
  { id: "exp-rom-2", destination_id: "dest-rome", name: "Vatican Museums", category_id: "cat-museum", rating: 5 },
  { id: "exp-rom-3", destination_id: "dest-rome", name: "Roscioli", category_id: "cat-restaurant", rating: 5 },
  // Athens
  { id: "exp-ath-1", destination_id: "dest-athens", name: "Acropolis", category_id: "cat-attraction", rating: 5 },
  { id: "exp-ath-2", destination_id: "dest-athens", name: "Acropolis Museum", category_id: "cat-museum", rating: 5 },
  { id: "exp-ath-3", destination_id: "dest-athens", name: "Ta Karamanlidika", category_id: "cat-restaurant", rating: 4 },
];

/** Lookup of category by id. */
export const categoriesById: Record<string, Category> = Object.fromEntries(
  categories.map((category) => [category.id, category]),
);

/** Lookup of trip by id. */
export const tripsById: Record<string, Trip> = Object.fromEntries(
  trips.map((trip) => [trip.id, trip]),
);

/**
 * Unique ISO alpha-2 codes for every country with at least one destination.
 * The country fill layer uses this to highlight visited countries.
 */
export const visitedCountryCodes: string[] = Array.from(
  new Set(destinations.map((destination) => destination.country_code)),
);

/**
 * The category a destination pin is colored by: the category of its highest
 * rated experience, falling back to the first experience, then attraction.
 */
export function getDestinationPrimaryCategory(destinationId: string): Category {
  const related = experiences
    .filter((experience) => experience.destination_id === destinationId)
    .sort((a, b) => b.rating - a.rating);
  const categoryId = related[0]?.category_id ?? "cat-attraction";
  return categoriesById[categoryId] ?? categories[0];
}

/**
 * Adapt the mock data into the Globe component's props. Kept here so the
 * landing page stays a thin server component and the Globe stays data-agnostic.
 */
export function buildMockGlobeProps(): {
  visitedCountryCodes: string[];
  destinations: GlobeDestination[];
  arcs: GlobeArc[];
} {
  const globeDestinations: GlobeDestination[] = destinations.map(
    (destination) => ({
      id: destination.id,
      tripId: destination.trip_id,
      tripName: tripsById[destination.trip_id]?.name ?? "Trip",
      name: destination.name,
      countryCode: destination.country_code,
      lat: destination.latitude,
      lng: destination.longitude,
      arrivalDate: null,
      departureDate: null,
      categoryColor: getDestinationPrimaryCategory(destination.id).color,
    }),
  );

  const byTrip = new Map<string, Destination[]>();
  for (const destination of destinations) {
    const list = byTrip.get(destination.trip_id) ?? [];
    list.push(destination);
    byTrip.set(destination.trip_id, list);
  }
  const arcs: GlobeArc[] = [];
  for (const list of byTrip.values()) {
    const ordered = [...list].sort((a, b) => a.order_index - b.order_index);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const source = ordered[i];
      const target = ordered[i + 1];
      arcs.push({
        sourcePosition: [source.longitude, source.latitude],
        targetPosition: [target.longitude, target.latitude],
        tripName: tripsById[source.trip_id]?.name ?? "Trip",
        sourceCity: source.name,
        targetCity: target.name,
      });
    }
  }

  return { visitedCountryCodes, destinations: globeDestinations, arcs };
}
