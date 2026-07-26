// Reset and reseed the public demo account with a fictional showcase dataset.
//
// The /demo page is the shop window: it renders one hardcoded account's data
// sessionlessly. This script wipes that account and rebuilds it from the
// fixture below, which is designed to exercise every surface of the app
// (multi-continent globe fills, a multi-year replay, the full category and
// rating spread, an ongoing trip with a live Today state, planned trips with
// day plans and countdowns, and a partly completed bucket list).
//
// This is a seed script, not application code. It talks to Supabase with the
// service-role key (bypasses RLS) and to the running dev server for geocoding
// and Wikimedia photo lookups.
//
// Safety:
//   - It refuses to run against any user id other than the demo account.
//   - It refuses to run without the --reset flag, because it deletes first.
//   - It leaves user_settings alone (is_demo, public_slug, projection).
//   - It counts every non-demo row before and after and reports the delta, so
//     an accidental blast radius is visible immediately.
//
// Prerequisites:
//   - The dev server is running at http://localhost:3000 (npm run dev).
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run seed-demo -- --reset

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "http://localhost:3000";
const PHOTO_BUCKET = "batchport";
const THUMB_SUFFIX = "_thumb";

// The only user id this script is ever allowed to touch. Mirrors
// src/lib/constants.ts DEMO_USER_ID; duplicated rather than imported so the
// guard cannot be widened by an app-side edit.
const DEMO_USER_ID = "703fbe07-db8a-41bd-bdee-928c2fa88107";

// --- Types -----------------------------------------------------------------

type TripStatus = "completed" | "ongoing" | "planned";
type ExperienceStatus = "planned" | "done";

interface SeedExperience {
  name: string;
  /** Category slug from batchport.categories. */
  slug: string;
  /** Half stars, 1 to 10. Omitted for planned ideas. */
  rating?: number;
  notes?: string;
  /** Defaults to "done". */
  status?: ExperienceStatus;
  /** Day slot, 1 = the destination's arrival date. */
  day?: number;
  /** POI coordinates, which light up the planner's proximity hints. */
  lat?: number;
  lng?: number;
}

interface SeedDestination {
  city: string;
  country: string;
  /** Authored coordinates: the source of truth, sanity-checked against the
   * geocoder rather than replaced by it. */
  lat: number;
  lng: number;
  code: string;
  arrival: string;
  departure: string;
  notes?: string;
  /** Wikimedia lookup override for places whose bare name has no Wikidata P18
   * image (a nearby landmark or the fuller place name usually does). */
  photoQuery?: string;
  experiences: SeedExperience[];
}

interface SeedTrip {
  name: string;
  start: string;
  end: string;
  status: TripStatus;
  notes?: string;
  destinations: SeedDestination[];
}

interface SeedBucketItem {
  type: "country" | "place";
  country_code: string | null;
  place_name?: string;
  lat?: number;
  lng?: number;
  priority: number;
  target_date?: string;
  notes?: string;
  /** Trip name from TRIPS that fulfilled this item. */
  fulfilled_by?: string;
  fulfilled_at?: string;
}

interface GeoResult {
  name: string;
  country: string | null;
  country_code: string | null;
  admin_region: string | null;
  lat: number;
  lng: number;
}

interface WikimediaResult {
  url: string | null;
  attribution: string | null;
  license: string | null;
}

// --- Environment -----------------------------------------------------------

// Parse .env.local by hand so the script stays free of extra dependencies.
function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // No .env.local: fall back to whatever is already in process.env.
  }
  return env;
}

// --- Helpers ---------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Mirror of the app's formatWikimediaAttribution so stored credit reads the same.
function formatAttribution(
  attribution: string | null,
  license: string | null,
): string {
  const credit = attribution ?? "Unknown author";
  const tail = license ? `${credit} (${license})` : credit;
  return `${tail} via Wikimedia Commons`;
}

async function geocode(
  city: string,
  country: string,
): Promise<GeoResult | null> {
  const q = encodeURIComponent(`${city},${country}`);
  try {
    const res = await fetch(`${BASE_URL}/api/geocode/search?q=${q}`);
    if (!res.ok) return null;
    const results = (await res.json()) as GeoResult[];
    return Array.isArray(results) && results.length > 0 ? results[0] : null;
  } catch {
    return null;
  }
}

// Query by place name only. Wikidata entity search does not match
// comma-separated "city,country" strings, so passing the country breaks it.
async function wikimedia(city: string): Promise<WikimediaResult | null> {
  const q = encodeURIComponent(city);
  try {
    const res = await fetch(`${BASE_URL}/api/photos/wikimedia?q=${q}`);
    if (!res.ok) return null;
    return (await res.json()) as WikimediaResult;
  } catch {
    return null;
  }
}

// Build the service-role client. Wrapped in a factory so its inferred type
// (scoped to the batchport schema) can be reused for helper parameters.
function makeSupabase(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type SeedClient = ReturnType<typeof makeSupabase>;

// --- Showcase dataset ------------------------------------------------------

// A fictional travel history. Eight completed trips across six continents from
// 2019 to early 2026 (2020 is empty and 2021 holds one short trip, which is
// what the years actually looked like), one ongoing trip straddling today, and
// two planned trips ahead of it.

const TRIPS: SeedTrip[] = [
  {
    name: "Interrail Summer",
    start: "2019-07-27",
    end: "2019-08-14",
    status: "completed",
    notes:
      "Three weeks, one rail pass, five countries, and a backpack that was far too heavy for the first week.",
    destinations: [
      {
        city: "Amsterdam",
        country: "Netherlands",
        lat: 52.3676,
        lng: 4.9041,
        code: "NL",
        arrival: "2019-07-27",
        departure: "2019-07-31",
        notes: "Rented bikes on day one and never used the trams again.",
        experiences: [
          {
            name: "Van Gogh Museum",
            slug: "museum",
            rating: 10,
            notes: "First entry slot, worth the early alarm",
          },
          { name: "Anne Frank House", slug: "museum", rating: 10 },
          { name: "Canal boat at dusk", slug: "activity", rating: 9 },
          { name: "Vondelpark picnic", slug: "nature", rating: 8 },
          { name: "Foodhallen", slug: "restaurant", rating: 7 },
          {
            name: "Red Light District walk",
            slug: "nightlife",
            rating: 4,
            notes: "Loud and grim, one lap was enough",
          },
        ],
      },
      {
        city: "Berlin",
        country: "Germany",
        lat: 52.52,
        lng: 13.405,
        code: "DE",
        arrival: "2019-07-31",
        departure: "2019-08-04",
        experiences: [
          { name: "East Side Gallery", slug: "attraction", rating: 9 },
          { name: "Pergamon Museum", slug: "museum", rating: 8 },
          {
            name: "Reichstag dome",
            slug: "viewpoint",
            rating: 9,
            notes: "Register online days ahead, they turn walk-ups away",
          },
          {
            name: "Mustafas Gemuse Kebap",
            slug: "restaurant",
            rating: 10,
            notes: "Cash only",
          },
          { name: "Tempelhofer Feld", slug: "nature", rating: 8 },
          {
            name: "Berghain queue",
            slug: "nightlife",
            rating: 2,
            notes: "Turned away at 2am, no hard feelings",
          },
        ],
      },
      {
        city: "Prague",
        country: "Czechia",
        lat: 50.0755,
        lng: 14.4378,
        code: "CZ",
        arrival: "2019-08-04",
        departure: "2019-08-07",
        experiences: [
          {
            name: "Charles Bridge at sunrise",
            slug: "viewpoint",
            rating: 9,
            notes: "Empty at five, mobbed by seven",
          },
          { name: "Prague Castle", slug: "attraction", rating: 7 },
          {
            name: "Astronomical Clock show",
            slug: "attraction",
            rating: 5,
            notes: "Underwhelming show, lovely square",
          },
          { name: "Letna Beer Garden", slug: "nightlife", rating: 9 },
          { name: "Lokal U Bile kuzelky", slug: "restaurant", rating: 8 },
          { name: "Kafka Museum", slug: "museum", rating: 6 },
        ],
      },
      {
        city: "Vienna",
        country: "Austria",
        lat: 48.2082,
        lng: 16.3738,
        code: "AT",
        arrival: "2019-08-07",
        departure: "2019-08-11",
        experiences: [
          { name: "Kunsthistorisches Museum", slug: "museum", rating: 9 },
          {
            name: "State Opera standing room",
            slug: "activity",
            rating: 10,
            notes: "Standing tickets go on sale 80 minutes before curtain",
          },
          { name: "Schonbrunn gardens", slug: "nature", rating: 8 },
          { name: "Naschmarkt", slug: "shopping", rating: 7 },
          {
            name: "Cafe Central",
            slug: "restaurant",
            rating: 6,
            notes: "Forty minute queue for average cake",
          },
        ],
      },
      {
        city: "Budapest",
        country: "Hungary",
        lat: 47.4979,
        lng: 19.0402,
        code: "HU",
        arrival: "2019-08-11",
        departure: "2019-08-14",
        experiences: [
          { name: "Szechenyi Thermal Baths", slug: "activity", rating: 9 },
          { name: "Gellert Hill at sunset", slug: "viewpoint", rating: 10 },
          { name: "Fishermans Bastion", slug: "viewpoint", rating: 9 },
          { name: "Ruin bar crawl", slug: "nightlife", rating: 8 },
          { name: "Parliament tour", slug: "attraction", rating: 8 },
          { name: "Great Market Hall", slug: "shopping", rating: 7 },
        ],
      },
    ],
  },
  {
    name: "Dia de Muertos Long Weekend",
    start: "2021-10-29",
    end: "2021-11-04",
    status: "completed",
    notes:
      "Six days squeezed around a Friday off. The first trip after everything reopened, and it felt like it.",
    destinations: [
      {
        city: "Mexico City",
        country: "Mexico",
        lat: 19.4326,
        lng: -99.1332,
        code: "MX",
        arrival: "2021-10-29",
        departure: "2021-10-31",
        experiences: [
          {
            name: "Museo Nacional de Antropologia",
            slug: "museum",
            rating: 10,
            notes: "Give it half a day, not two hours",
          },
          {
            name: "Frida Kahlo Museum",
            slug: "museum",
            rating: 7,
            notes: "Timed tickets sell out a week out",
          },
          { name: "Lucha libre at Arena Mexico", slug: "activity", rating: 9 },
          { name: "Tostadas at Mercado de Coyoacan", slug: "restaurant", rating: 9 },
          { name: "Xochimilco trajinera", slug: "activity", rating: 6 },
        ],
      },
      {
        city: "Puebla",
        country: "Mexico",
        lat: 19.0414,
        lng: -98.2063,
        code: "MX",
        arrival: "2021-10-31",
        departure: "2021-11-01",
        experiences: [
          { name: "Capilla del Rosario", slug: "attraction", rating: 9 },
          { name: "Biblioteca Palafoxiana", slug: "museum", rating: 8 },
          { name: "Mole poblano at Casa Reyna", slug: "restaurant", rating: 8 },
          { name: "Callejon de los Sapos", slug: "shopping", rating: 5 },
        ],
      },
      {
        city: "Oaxaca",
        country: "Mexico",
        lat: 17.0732,
        lng: -96.7266,
        code: "MX",
        arrival: "2021-11-01",
        departure: "2021-11-04",
        notes: "Booked eleven months ahead. Do that, or do not come this week.",
        photoQuery: "Oaxaca City",
        experiences: [
          {
            name: "Panteon General at midnight",
            slug: "activity",
            rating: 10,
            notes: "Bring flowers, sit down, do not photograph everything",
          },
          { name: "Monte Alban", slug: "attraction", rating: 9 },
          { name: "Mercado 20 de Noviembre grill", slug: "restaurant", rating: 9 },
          { name: "Mezcal tasting in Matatlan", slug: "activity", rating: 8 },
          {
            name: "Hierve el Agua",
            slug: "nature",
            rating: 7,
            notes: "Two hours each way on a rough road",
          },
        ],
      },
    ],
  },
  {
    name: "Slow Loop Through Southeast Asia",
    start: "2022-02-05",
    end: "2022-03-02",
    status: "completed",
    notes:
      "Four weeks, overland wherever it was possible, and one very regrettable overnight bus.",
    destinations: [
      {
        city: "Bangkok",
        country: "Thailand",
        lat: 13.7563,
        lng: 100.5018,
        code: "TH",
        arrival: "2022-02-05",
        departure: "2022-02-10",
        experiences: [
          { name: "Wat Pho", slug: "attraction", rating: 9 },
          { name: "Chao Phraya express ferry", slug: "transport", rating: 8 },
          { name: "Chatuchak Weekend Market", slug: "shopping", rating: 7 },
          {
            name: "Jay Fai",
            slug: "restaurant",
            rating: 6,
            notes: "Three hour wait for one very good omelette",
          },
          {
            name: "Rooftop at Lebua",
            slug: "nightlife",
            rating: 5,
            notes: "Dress code enforced, drinks cost more than the day did",
          },
        ],
      },
      {
        city: "Chiang Mai",
        country: "Thailand",
        lat: 18.7883,
        lng: 98.9853,
        code: "TH",
        arrival: "2022-02-10",
        departure: "2022-02-15",
        experiences: [
          {
            name: "Elephant Nature Park",
            slug: "nature",
            rating: 10,
            notes: "A sanctuary, no riding, and all the better for it",
          },
          { name: "Doi Suthep", slug: "attraction", rating: 9 },
          {
            name: "Khao soi at Khao Soi Khun Yai",
            slug: "restaurant",
            rating: 10,
            notes: "Closes when the pot is empty, go before noon",
          },
          { name: "Thai cooking class", slug: "activity", rating: 9 },
          { name: "Sunday Walking Street", slug: "shopping", rating: 8 },
        ],
      },
      {
        city: "Luang Prabang",
        country: "Laos",
        lat: 19.8834,
        lng: 102.1347,
        code: "LA",
        arrival: "2022-02-15",
        departure: "2022-02-20",
        experiences: [
          { name: "Kuang Si Falls", slug: "nature", rating: 10 },
          {
            name: "Alms giving at dawn",
            slug: "activity",
            rating: 8,
            notes: "Watch from across the street, no flash",
          },
          { name: "Mekong sunset cruise", slug: "activity", rating: 8 },
          {
            name: "Mount Phousi at sunset",
            slug: "viewpoint",
            rating: 7,
            notes: "Crowded, worth it anyway",
          },
          { name: "Night market", slug: "shopping", rating: 7 },
        ],
      },
      {
        city: "Hanoi",
        country: "Vietnam",
        lat: 21.0278,
        lng: 105.8342,
        code: "VN",
        arrival: "2022-02-20",
        departure: "2022-02-25",
        experiences: [
          { name: "Old Quarter street food walk", slug: "restaurant", rating: 10 },
          { name: "Bia hoi corner", slug: "nightlife", rating: 8 },
          { name: "Temple of Literature", slug: "attraction", rating: 8 },
          { name: "Hoan Kiem Lake at 6am", slug: "nature", rating: 7 },
          { name: "Water puppet theatre", slug: "activity", rating: 6 },
          {
            name: "Train Street",
            slug: "attraction",
            rating: 4,
            notes: "Barricaded half the time, mostly cafes now",
          },
        ],
      },
      {
        city: "Siem Reap",
        country: "Cambodia",
        lat: 13.3671,
        lng: 103.8448,
        code: "KH",
        arrival: "2022-02-25",
        departure: "2022-03-02",
        experiences: [
          {
            name: "Angkor Wat at sunrise",
            slug: "attraction",
            rating: 10,
            notes: "Book the sunrise slot and arrange the tuk tuk the night before",
          },
          { name: "Ta Prohm", slug: "attraction", rating: 9 },
          { name: "Bayon", slug: "attraction", rating: 9 },
          {
            name: "Tonle Sap floating villages",
            slug: "nature",
            rating: 5,
            notes: "Felt staged, and the boat price kept moving",
          },
          { name: "Pub Street", slug: "nightlife", rating: 5 },
        ],
      },
    ],
  },
  {
    name: "Andes Adventure",
    start: "2023-04-08",
    end: "2023-04-29",
    status: "completed",
    notes:
      "Sea level to 4,800 metres and back down again. Take the acclimatisation days seriously.",
    destinations: [
      {
        city: "Lima",
        country: "Peru",
        lat: -12.0464,
        lng: -77.0428,
        code: "PE",
        arrival: "2023-04-08",
        departure: "2023-04-12",
        experiences: [
          {
            name: "Central",
            slug: "restaurant",
            rating: 10,
            notes: "Booked four months out, still the best meal of the year",
          },
          { name: "Ceviche at El Mercado", slug: "restaurant", rating: 9 },
          { name: "Museo Larco", slug: "museum", rating: 8 },
          { name: "Malecon cliff walk", slug: "viewpoint", rating: 8 },
          { name: "Barranco bar crawl", slug: "nightlife", rating: 7 },
        ],
      },
      {
        city: "Cusco",
        country: "Peru",
        lat: -13.5319,
        lng: -71.9675,
        code: "PE",
        arrival: "2023-04-12",
        departure: "2023-04-18",
        notes: "Two full days doing nothing before anything at altitude.",
        experiences: [
          {
            name: "Machu Picchu",
            slug: "attraction",
            rating: 10,
            notes: "Circuit 2, first entry of the day, no regrets",
          },
          { name: "Sacsayhuaman", slug: "attraction", rating: 8 },
          { name: "San Pedro Market", slug: "shopping", rating: 7 },
          {
            name: "Coca tea and a slow first day",
            slug: "activity",
            rating: 7,
            notes: "Altitude is real, plan to do nothing on day one",
          },
          {
            name: "Rainbow Mountain",
            slug: "nature",
            rating: 6,
            notes: "Brutal climb, twenty minutes at the top, then hail",
          },
        ],
      },
      {
        city: "La Paz",
        country: "Bolivia",
        lat: -16.4897,
        lng: -68.1193,
        code: "BO",
        arrival: "2023-04-18",
        departure: "2023-04-22",
        experiences: [
          {
            name: "Mi Teleferico across the city",
            slug: "transport",
            rating: 9,
            notes: "The cheapest viewpoint in South America",
          },
          { name: "Death Road descent", slug: "activity", rating: 9 },
          { name: "Gustu", slug: "restaurant", rating: 8 },
          { name: "Valle de la Luna", slug: "nature", rating: 7 },
          { name: "Witches Market", slug: "shopping", rating: 6 },
        ],
      },
      {
        city: "Uyuni",
        country: "Bolivia",
        lat: -20.4597,
        lng: -66.825,
        code: "BO",
        arrival: "2023-04-22",
        departure: "2023-04-25",
        experiences: [
          { name: "Salar de Uyuni at sunrise", slug: "nature", rating: 10 },
          {
            name: "Night sky on the salt flat",
            slug: "viewpoint",
            rating: 10,
            notes: "No moon, no cloud, no words",
          },
          { name: "Isla Incahuasi", slug: "nature", rating: 8 },
          { name: "Train cemetery", slug: "attraction", rating: 6 },
        ],
      },
      {
        city: "Buenos Aires",
        country: "Argentina",
        lat: -34.6037,
        lng: -58.3816,
        code: "AR",
        arrival: "2023-04-25",
        departure: "2023-04-29",
        experiences: [
          { name: "Parrilla dinner in Palermo", slug: "restaurant", rating: 9 },
          {
            name: "Tango at a milonga",
            slug: "nightlife",
            rating: 9,
            notes: "Stay for the beginners class beforehand",
          },
          { name: "Recoleta Cemetery", slug: "attraction", rating: 8 },
          { name: "Teatro Colon tour", slug: "attraction", rating: 8 },
          { name: "San Telmo Sunday market", slug: "shopping", rating: 7 },
          { name: "MALBA", slug: "museum", rating: 7 },
        ],
      },
    ],
  },
  {
    name: "Golden Week in Japan",
    start: "2024-04-26",
    end: "2024-05-14",
    status: "completed",
    notes:
      "Everyone warned us about travelling during Golden Week. Everyone was right, and we would do it again.",
    destinations: [
      {
        city: "Tokyo",
        country: "Japan",
        lat: 35.6762,
        lng: 139.6503,
        code: "JP",
        arrival: "2024-04-26",
        departure: "2024-05-01",
        experiences: [
          {
            name: "Shibuya Sky",
            slug: "viewpoint",
            rating: 10,
            notes: "Sunset slots sell out a month ahead",
          },
          {
            name: "teamLab Planets",
            slug: "museum",
            rating: 9,
            notes: "Wear shorts, there is actual water",
          },
          { name: "Tsukiji outer market breakfast", slug: "restaurant", rating: 9 },
          { name: "Golden Gai", slug: "nightlife", rating: 8 },
          { name: "Meiji Jingu", slug: "attraction", rating: 8 },
          { name: "Yanaka backstreets walk", slug: "activity", rating: 7 },
        ],
      },
      {
        city: "Hakone",
        country: "Japan",
        lat: 35.2324,
        lng: 139.1069,
        code: "JP",
        arrival: "2024-05-01",
        departure: "2024-05-03",
        experiences: [
          { name: "Onsen ryokan stay", slug: "lodging", rating: 10 },
          { name: "Hakone Open Air Museum", slug: "museum", rating: 9 },
          { name: "Owakudani black eggs", slug: "restaurant", rating: 6 },
          {
            name: "Lake Ashi pirate ship",
            slug: "transport",
            rating: 5,
            notes: "Pure kitsch, but the Fuji view held",
          },
        ],
      },
      {
        city: "Kanazawa",
        country: "Japan",
        lat: 36.5613,
        lng: 136.6562,
        code: "JP",
        arrival: "2024-05-03",
        departure: "2024-05-06",
        photoQuery: "Kanazawa Castle",
        experiences: [
          { name: "Kenrokuen", slug: "nature", rating: 10 },
          { name: "Omicho Market", slug: "restaurant", rating: 9 },
          { name: "21st Century Museum", slug: "museum", rating: 8 },
          { name: "Higashi Chaya district", slug: "attraction", rating: 8 },
          { name: "Gold leaf workshop", slug: "activity", rating: 7 },
        ],
      },
      {
        city: "Kyoto",
        country: "Japan",
        lat: 35.0116,
        lng: 135.7681,
        code: "JP",
        arrival: "2024-05-06",
        departure: "2024-05-11",
        experiences: [
          {
            name: "Fushimi Inari before dawn",
            slug: "attraction",
            rating: 10,
            notes: "Start at 5:30 and the gates are yours",
          },
          { name: "Kiyomizudera", slug: "attraction", rating: 9 },
          { name: "Nishiki Market", slug: "restaurant", rating: 8 },
          { name: "Philosophers Path", slug: "nature", rating: 8 },
          { name: "Gion in the evening", slug: "activity", rating: 7 },
          {
            name: "Arashiyama bamboo grove",
            slug: "nature",
            rating: 6,
            notes: "Ten metres of bamboo and two hundred people",
          },
        ],
      },
      {
        city: "Osaka",
        country: "Japan",
        lat: 34.6937,
        lng: 135.5023,
        code: "JP",
        arrival: "2024-05-11",
        departure: "2024-05-14",
        experiences: [
          { name: "Dotonbori at night", slug: "nightlife", rating: 9 },
          {
            name: "Okonomiyaki at Mizuno",
            slug: "restaurant",
            rating: 9,
            notes: "Cash only, one hour queue, still worth it",
          },
          { name: "Kuromon Ichiba Market", slug: "restaurant", rating: 8 },
          { name: "Umeda Sky Building", slug: "viewpoint", rating: 8 },
          { name: "Osaka Castle", slug: "attraction", rating: 7 },
        ],
      },
    ],
  },
  {
    name: "Serengeti and the Swahili Coast",
    start: "2024-09-06",
    end: "2024-09-22",
    status: "completed",
    notes:
      "Saved for this one for three years. Two weeks of dust and dawn starts, then a week of doing nothing on a beach.",
    destinations: [
      {
        city: "Nairobi",
        country: "Kenya",
        lat: -1.2921,
        lng: 36.8219,
        code: "KE",
        arrival: "2024-09-06",
        departure: "2024-09-09",
        experiences: [
          {
            name: "Nairobi National Park",
            slug: "nature",
            rating: 9,
            notes: "Lions with a city skyline behind them",
          },
          { name: "Nyama choma at Mama Oliech", slug: "restaurant", rating: 9 },
          { name: "Giraffe Centre", slug: "activity", rating: 7 },
          { name: "Karen Blixen Museum", slug: "museum", rating: 6 },
        ],
      },
      {
        city: "Arusha",
        country: "Tanzania",
        lat: -3.3869,
        lng: 36.683,
        code: "TZ",
        arrival: "2024-09-09",
        departure: "2024-09-12",
        experiences: [
          { name: "Mount Meru viewpoint", slug: "viewpoint", rating: 8 },
          { name: "Coffee farm tour", slug: "activity", rating: 7 },
          {
            name: "Safari kit check",
            slug: "other",
            rating: 6,
            notes: "Soft bags only, hard cases do not fit on the roof",
          },
          { name: "Cultural Heritage Centre", slug: "shopping", rating: 5 },
        ],
      },
      {
        city: "Serengeti National Park",
        country: "Tanzania",
        lat: -2.3333,
        lng: 34.8333,
        code: "TZ",
        arrival: "2024-09-12",
        departure: "2024-09-17",
        notes: "Five nights under canvas, no wifi, no complaints.",
        experiences: [
          {
            name: "Great Migration river crossing",
            slug: "nature",
            rating: 10,
            notes: "Four hours of waiting for ninety seconds of chaos",
          },
          {
            name: "Balloon flight at sunrise",
            slug: "activity",
            rating: 10,
            notes: "Absurdly expensive, absolutely do it",
          },
          { name: "Leopard in a sausage tree", slug: "nature", rating: 9 },
          { name: "Tented camp at Seronera", slug: "lodging", rating: 9 },
          { name: "Bush dinner under the stars", slug: "restaurant", rating: 8 },
        ],
      },
      {
        city: "Stone Town",
        country: "Tanzania",
        lat: -6.1659,
        lng: 39.1917,
        code: "TZ",
        arrival: "2024-09-17",
        departure: "2024-09-22",
        experiences: [
          { name: "Nungwi Beach", slug: "beach", rating: 10 },
          { name: "Dhow sunset sail", slug: "activity", rating: 9 },
          { name: "Forodhani night market", slug: "restaurant", rating: 8 },
          { name: "Spice farm tour", slug: "activity", rating: 7 },
          {
            name: "Old Fort museum",
            slug: "museum",
            rating: 5,
            notes: "One room and a gift shop",
          },
        ],
      },
    ],
  },
  {
    name: "Down Under and Across the Ditch",
    start: "2025-11-28",
    end: "2025-12-20",
    status: "completed",
    notes:
      "Summer in December still does not compute. Three weeks, two countries, one very long flight home.",
    destinations: [
      {
        city: "Sydney",
        country: "Australia",
        lat: -33.8688,
        lng: 151.2093,
        code: "AU",
        arrival: "2025-11-28",
        departure: "2025-12-03",
        photoQuery: "Sydney Opera House",
        experiences: [
          { name: "Bondi to Coogee coastal walk", slug: "nature", rating: 10 },
          {
            name: "Harbour Bridge climb",
            slug: "activity",
            rating: 9,
            notes: "Book the twilight climb, not the midday one",
          },
          { name: "Manly ferry", slug: "transport", rating: 9 },
          { name: "Opera House tour", slug: "attraction", rating: 8 },
          { name: "Icebergs pool", slug: "beach", rating: 8 },
          { name: "Newtown dinner crawl", slug: "restaurant", rating: 7 },
        ],
      },
      {
        city: "Melbourne",
        country: "Australia",
        lat: -37.8136,
        lng: 144.9631,
        code: "AU",
        arrival: "2025-12-03",
        departure: "2025-12-08",
        experiences: [
          { name: "Coffee at Patricia", slug: "restaurant", rating: 10 },
          {
            name: "Great Ocean Road day trip",
            slug: "nature",
            rating: 9,
            notes: "Leave at six or you meet every tour bus in Victoria",
          },
          { name: "Hosier Lane street art", slug: "attraction", rating: 8 },
          { name: "Rooftop bars on Flinders Lane", slug: "nightlife", rating: 8 },
          { name: "Queen Victoria Market", slug: "shopping", rating: 7 },
        ],
      },
      {
        city: "Queenstown",
        country: "New Zealand",
        lat: -45.0312,
        lng: 168.6626,
        code: "NZ",
        arrival: "2025-12-08",
        departure: "2025-12-13",
        experiences: [
          { name: "Nevis bungy", slug: "activity", rating: 10 },
          {
            name: "Milford Sound day trip",
            slug: "nature",
            rating: 10,
            notes: "Twelve hours of bus for two hours of fjord, still yes",
          },
          { name: "Ben Lomond track", slug: "viewpoint", rating: 9 },
          { name: "Skyline luge", slug: "activity", rating: 8 },
          {
            name: "Fergburger",
            slug: "restaurant",
            rating: 7,
            notes: "Good burger, absurd queue",
          },
        ],
      },
      {
        city: "Rotorua",
        country: "New Zealand",
        lat: -38.1368,
        lng: 176.2497,
        code: "NZ",
        arrival: "2025-12-13",
        departure: "2025-12-16",
        experiences: [
          { name: "Te Puia geothermal evening", slug: "activity", rating: 9 },
          { name: "Wai-O-Tapu", slug: "nature", rating: 8 },
          { name: "Polynesian Spa", slug: "activity", rating: 8 },
          { name: "Redwoods treewalk", slug: "nature", rating: 7 },
          {
            name: "Hangi dinner",
            slug: "restaurant",
            rating: 6,
            notes: "More show than food",
          },
        ],
      },
      {
        city: "Auckland",
        country: "New Zealand",
        lat: -36.8485,
        lng: 174.7633,
        code: "NZ",
        arrival: "2025-12-16",
        departure: "2025-12-20",
        experiences: [
          { name: "Waiheke Island wineries", slug: "activity", rating: 9 },
          {
            name: "Piha Beach",
            slug: "beach",
            rating: 9,
            notes: "Swim between the flags, the rips here are serious",
          },
          { name: "Auckland Museum", slug: "museum", rating: 8 },
          { name: "Ponsonby Road dinner", slug: "restaurant", rating: 8 },
          { name: "Sky Tower", slug: "viewpoint", rating: 7 },
        ],
      },
    ],
  },
  {
    name: "Iceland Ring Road",
    start: "2026-03-14",
    end: "2026-03-24",
    status: "completed",
    notes:
      "Ten days, one 4x4, and weather that changed its mind every forty minutes.",
    destinations: [
      {
        city: "Reykjavik",
        country: "Iceland",
        lat: 64.1466,
        lng: -21.9426,
        code: "IS",
        arrival: "2026-03-14",
        departure: "2026-03-17",
        experiences: [
          {
            name: "Sky Lagoon",
            slug: "activity",
            rating: 9,
            notes: "Late slot, fewer people, better sky",
          },
          { name: "Braud and Co cinnamon buns", slug: "restaurant", rating: 9 },
          { name: "Hallgrimskirkja tower", slug: "viewpoint", rating: 8 },
          { name: "Perlan ice cave exhibit", slug: "museum", rating: 6 },
          {
            name: "Northern lights hunt",
            slug: "nature",
            rating: 3,
            notes: "Cloud all night, refunded, tried again two days later",
          },
        ],
      },
      {
        city: "Vik",
        country: "Iceland",
        lat: 63.4187,
        lng: -19.006,
        code: "IS",
        arrival: "2026-03-17",
        departure: "2026-03-19",
        photoQuery: "Vik i Myrdal",
        experiences: [
          { name: "Skogafoss", slug: "nature", rating: 10 },
          {
            name: "Reynisfjara black sand beach",
            slug: "beach",
            rating: 9,
            notes: "Sneaker waves kill people here, stay well back",
          },
          { name: "Dyrholaey arch", slug: "viewpoint", rating: 9 },
          { name: "Solheimajokull glacier walk", slug: "activity", rating: 9 },
        ],
      },
      {
        city: "Hofn",
        country: "Iceland",
        lat: 64.2539,
        lng: -15.2082,
        code: "IS",
        arrival: "2026-03-19",
        departure: "2026-03-21",
        experiences: [
          { name: "Jokulsarlon glacier lagoon", slug: "nature", rating: 10 },
          {
            name: "Vestrahorn at blue hour",
            slug: "viewpoint",
            rating: 10,
            notes: "Pay the gate fee at the cafe, it is worth it",
          },
          { name: "Diamond Beach", slug: "beach", rating: 9 },
          { name: "Langoustine at Pakkhus", slug: "restaurant", rating: 8 },
        ],
      },
      {
        city: "Akureyri",
        country: "Iceland",
        lat: 65.6835,
        lng: -18.0878,
        code: "IS",
        arrival: "2026-03-21",
        departure: "2026-03-24",
        experiences: [
          { name: "Godafoss", slug: "nature", rating: 9 },
          { name: "Myvatn Nature Baths", slug: "activity", rating: 9 },
          {
            name: "Whale watching from Husavik",
            slug: "nature",
            rating: 8,
            notes: "Bring more layers than you think you need",
          },
          {
            name: "Akureyri Botanical Garden",
            slug: "nature",
            rating: 5,
            notes: "Mostly still asleep in March",
          },
        ],
      },
    ],
  },
  {
    name: "Fjords and Midnight Sun",
    start: "2026-07-18",
    end: "2026-08-02",
    status: "ongoing",
    notes:
      "Two weeks up the coast, chasing daylight that never quite goes away.",
    destinations: [
      {
        city: "Oslo",
        country: "Norway",
        lat: 59.9139,
        lng: 10.7522,
        code: "NO",
        arrival: "2026-07-18",
        departure: "2026-07-21",
        experiences: [
          { name: "Munch Museum", slug: "museum", rating: 9 },
          { name: "Vigeland Sculpture Park", slug: "attraction", rating: 8 },
          { name: "Opera House roof", slug: "viewpoint", rating: 8 },
          { name: "Salmon at Vippa", slug: "restaurant", rating: 7 },
        ],
      },
      {
        city: "Bergen",
        country: "Norway",
        lat: 60.3913,
        lng: 5.3221,
        code: "NO",
        arrival: "2026-07-21",
        departure: "2026-07-25",
        experiences: [
          { name: "Floibanen funicular", slug: "viewpoint", rating: 9 },
          { name: "Bryggen wharf", slug: "attraction", rating: 9 },
          { name: "Mount Ulriken hike", slug: "nature", rating: 8 },
          {
            name: "Fish market lunch",
            slug: "restaurant",
            rating: 6,
            notes: "Tourist prices, decent crab",
          },
        ],
      },
      {
        city: "Flam",
        country: "Norway",
        lat: 60.8631,
        lng: 7.1136,
        code: "NO",
        arrival: "2026-07-25",
        departure: "2026-07-28",
        notes: "Base for the fjord days. Everything here is uphill.",
        photoQuery: "Aurlandsfjord",
        experiences: [
          { name: "Flam Railway", slug: "transport", rating: 10, day: 1 },
          {
            name: "Naeroyfjord kayak",
            slug: "activity",
            status: "planned",
            day: 2,
            lat: 60.8626,
            lng: 7.1116,
          },
          {
            name: "Stegastein viewpoint",
            slug: "viewpoint",
            status: "planned",
            day: 2,
            notes: "Bus leaves at 10:15 from the pier",
            lat: 60.9083,
            lng: 7.2075,
          },
          {
            name: "Aegir Brewpub dinner",
            slug: "restaurant",
            status: "planned",
            day: 2,
            lat: 60.8632,
            lng: 7.1141,
          },
          {
            name: "Brekkefossen hike",
            slug: "nature",
            status: "planned",
            day: 3,
          },
        ],
      },
      {
        city: "Tromso",
        country: "Norway",
        lat: 69.6492,
        lng: 18.9553,
        code: "NO",
        arrival: "2026-07-28",
        departure: "2026-08-02",
        experiences: [
          {
            name: "Midnight sun at Fjellheisen",
            slug: "viewpoint",
            status: "planned",
            day: 1,
            notes: "Go near midnight, that is the entire point",
            lat: 69.6353,
            lng: 18.9986,
          },
          {
            name: "Arctic Cathedral",
            slug: "attraction",
            status: "planned",
            day: 1,
            lat: 69.6501,
            lng: 18.9905,
          },
          {
            name: "Whale safari",
            slug: "nature",
            status: "planned",
            day: 2,
          },
          {
            name: "Sami reindeer camp",
            slug: "activity",
            status: "planned",
            day: 3,
          },
          {
            name: "Emmas Drommekjokken",
            slug: "restaurant",
            status: "planned",
            day: 4,
            notes: "Book ahead, it is a very small room",
          },
        ],
      },
    ],
  },
  {
    name: "Silk Road Autumn",
    start: "2026-10-03",
    end: "2026-10-21",
    status: "planned",
    notes:
      "Istanbul overland as far east as the visas allow. Flights booked, everything else is still a list.",
    destinations: [
      {
        city: "Istanbul",
        country: "Turkey",
        lat: 41.0082,
        lng: 28.9784,
        code: "TR",
        arrival: "2026-10-03",
        departure: "2026-10-08",
        experiences: [
          {
            name: "Hagia Sophia",
            slug: "attraction",
            status: "planned",
            day: 1,
            lat: 41.0086,
            lng: 28.9802,
          },
          {
            name: "Basilica Cistern",
            slug: "attraction",
            status: "planned",
            day: 1,
            lat: 41.0084,
            lng: 28.9779,
          },
          {
            name: "Topkapi Palace",
            slug: "museum",
            status: "planned",
            day: 2,
            lat: 41.0115,
            lng: 28.9834,
          },
          {
            name: "Grand Bazaar",
            slug: "shopping",
            status: "planned",
            day: 2,
            lat: 41.0106,
            lng: 28.9681,
          },
          {
            name: "Bosphorus ferry to Kadikoy",
            slug: "transport",
            status: "planned",
            day: 3,
            lat: 40.9925,
            lng: 29.0242,
          },
          {
            name: "Karakoy meyhane dinner",
            slug: "restaurant",
            status: "planned",
            day: 3,
            notes: "Long table, many small plates, no rush",
          },
          {
            name: "Suleymaniye Mosque",
            slug: "attraction",
            status: "planned",
          },
        ],
      },
      {
        city: "Tbilisi",
        country: "Georgia",
        lat: 41.7151,
        lng: 44.8271,
        code: "GE",
        arrival: "2026-10-08",
        departure: "2026-10-12",
        experiences: [
          {
            name: "Narikala Fortress",
            slug: "viewpoint",
            status: "planned",
            day: 1,
            lat: 41.6879,
            lng: 44.8065,
          },
          {
            name: "Sulphur baths in Abanotubani",
            slug: "activity",
            status: "planned",
            day: 1,
            lat: 41.6893,
            lng: 44.8092,
          },
          {
            name: "Chronicle of Georgia",
            slug: "attraction",
            status: "planned",
            day: 2,
          },
          {
            name: "Kakheti wine day trip",
            slug: "activity",
            status: "planned",
            day: 3,
            notes: "Full day, hire a driver, do not plan an evening",
          },
          {
            name: "Shavi Lomi supra dinner",
            slug: "restaurant",
            status: "planned",
          },
        ],
      },
      {
        city: "Samarkand",
        country: "Uzbekistan",
        lat: 39.627,
        lng: 66.975,
        code: "UZ",
        arrival: "2026-10-12",
        departure: "2026-10-17",
        experiences: [
          {
            name: "Registan at night",
            slug: "attraction",
            status: "planned",
            day: 1,
            notes: "Light show starts around eight",
            lat: 39.6547,
            lng: 66.9758,
          },
          {
            name: "Shah-i-Zinda",
            slug: "attraction",
            status: "planned",
            day: 2,
            lat: 39.6626,
            lng: 66.9852,
          },
          {
            name: "Gur-e-Amir",
            slug: "attraction",
            status: "planned",
            day: 2,
            lat: 39.6484,
            lng: 66.9686,
          },
          {
            name: "Siab Bazaar",
            slug: "shopping",
            status: "planned",
            day: 3,
          },
          {
            name: "Plov at Osh Markazi",
            slug: "restaurant",
            status: "planned",
            day: 3,
          },
          {
            name: "Ulugh Beg Observatory",
            slug: "museum",
            status: "planned",
          },
        ],
      },
      {
        city: "Bukhara",
        country: "Uzbekistan",
        lat: 39.7747,
        lng: 64.4286,
        code: "UZ",
        arrival: "2026-10-17",
        departure: "2026-10-21",
        experiences: [
          {
            name: "Poi Kalyan complex",
            slug: "attraction",
            status: "planned",
            day: 1,
            lat: 39.7758,
            lng: 64.4145,
          },
          {
            name: "Ark of Bukhara",
            slug: "museum",
            status: "planned",
            day: 1,
            lat: 39.7758,
            lng: 64.4094,
          },
          {
            name: "Lyabi Hauz in the evening",
            slug: "nightlife",
            status: "planned",
            day: 2,
          },
          {
            name: "Silk carpet workshop",
            slug: "shopping",
            status: "planned",
            day: 3,
          },
          { name: "Chor Minor", slug: "attraction", status: "planned" },
        ],
      },
    ],
  },
  {
    name: "Southern Summer in Patagonia",
    start: "2026-12-27",
    end: "2027-01-11",
    status: "planned",
    notes:
      "New Year at the bottom of the world. Refugios are the whole planning problem.",
    destinations: [
      {
        city: "Santiago",
        country: "Chile",
        lat: -33.4489,
        lng: -70.6693,
        code: "CL",
        arrival: "2026-12-27",
        departure: "2026-12-30",
        experiences: [
          {
            name: "Cerro San Cristobal",
            slug: "viewpoint",
            status: "planned",
            day: 1,
          },
          {
            name: "Mercado Central",
            slug: "restaurant",
            status: "planned",
            day: 1,
          },
          {
            name: "Museo de la Memoria",
            slug: "museum",
            status: "planned",
            day: 2,
          },
          {
            name: "Valparaiso day trip",
            slug: "activity",
            status: "planned",
            day: 3,
            notes: "Ascensores first, murals after",
          },
        ],
      },
      {
        city: "Puerto Natales",
        country: "Chile",
        lat: -51.7236,
        lng: -72.4875,
        code: "CL",
        arrival: "2026-12-30",
        departure: "2027-01-04",
        notes: "Base for the W. Everything hinges on the refugio bookings.",
        experiences: [
          {
            name: "Cerveceria Baguales",
            slug: "restaurant",
            status: "planned",
            day: 1,
          },
          {
            name: "Torres del Paine W trek",
            slug: "nature",
            status: "planned",
            day: 2,
            notes: "Refugios booked in August or not at all",
          },
          {
            name: "Base of the Towers at sunrise",
            slug: "viewpoint",
            status: "planned",
            day: 3,
          },
          {
            name: "Grey Glacier boat",
            slug: "nature",
            status: "planned",
            day: 4,
          },
        ],
      },
      {
        city: "El Calafate",
        country: "Argentina",
        lat: -50.3379,
        lng: -72.2648,
        code: "AR",
        arrival: "2027-01-04",
        departure: "2027-01-08",
        experiences: [
          {
            name: "Perito Moreno Glacier",
            slug: "nature",
            status: "planned",
            day: 1,
          },
          {
            name: "Parrilla La Tablita",
            slug: "restaurant",
            status: "planned",
            day: 1,
          },
          {
            name: "Big Ice trek",
            slug: "activity",
            status: "planned",
            day: 2,
            notes: "Upper age limit is 50, book early",
          },
          {
            name: "Laguna Nimez birds",
            slug: "nature",
            status: "planned",
            day: 3,
          },
        ],
      },
      {
        city: "Ushuaia",
        country: "Argentina",
        lat: -54.8019,
        lng: -68.303,
        code: "AR",
        arrival: "2027-01-08",
        departure: "2027-01-11",
        experiences: [
          {
            name: "Tierra del Fuego National Park",
            slug: "nature",
            status: "planned",
            day: 1,
          },
          {
            name: "Beagle Channel sail",
            slug: "activity",
            status: "planned",
            day: 2,
          },
          {
            name: "End of the World Train",
            slug: "transport",
            status: "planned",
            day: 2,
          },
          {
            name: "King crab at Volver",
            slug: "restaurant",
            status: "planned",
            day: 3,
          },
        ],
      },
    ],
  },
];

const BUCKET_ITEMS: SeedBucketItem[] = [
  {
    type: "country",
    country_code: "JP",
    priority: 100,
    notes: "Ever since the first Ghibli film. Two weeks minimum, no day trips.",
    fulfilled_by: "Golden Week in Japan",
    fulfilled_at: "2024-05-14",
  },
  {
    type: "country",
    country_code: "TZ",
    priority: 95,
    notes: "The migration, in person, whatever it costs.",
    fulfilled_by: "Serengeti and the Swahili Coast",
    fulfilled_at: "2024-09-22",
  },
  {
    type: "place",
    country_code: "BO",
    place_name: "Salar de Uyuni",
    lat: -20.1338,
    lng: -67.4891,
    priority: 90,
    notes: "Mirror season if the timing works, dry season if it does not.",
    fulfilled_by: "Andes Adventure",
    fulfilled_at: "2023-04-25",
  },
  {
    type: "country",
    country_code: "IN",
    priority: 85,
    target_date: "2027-02-01",
    notes: "Rajasthan in winter, slowly, by train.",
  },
  {
    type: "place",
    country_code: "TR",
    place_name: "Cappadocia",
    lat: 38.6431,
    lng: 34.8289,
    priority: 80,
    target_date: "2026-10-22",
    notes: "Balloons at sunrise. Tacked onto the Silk Road trip if the dates hold.",
  },
  {
    type: "country",
    country_code: "EG",
    priority: 75,
    notes: "Abu Simbel at opening, and a slow boat between Luxor and Aswan.",
  },
  {
    type: "country",
    country_code: "NP",
    priority: 60,
    target_date: "2027-10-15",
    notes: "Annapurna circuit rather than Everest base camp.",
  },
  {
    type: "place",
    country_code: "SE",
    place_name: "Abisko",
    lat: 68.3496,
    lng: 18.83,
    priority: 55,
    notes: "Aurora in February, with enough nights booked to survive one cloudy week.",
  },
  {
    type: "country",
    country_code: "CA",
    priority: 45,
  },
  {
    type: "place",
    country_code: "US",
    place_name: "Antelope Canyon",
    lat: 36.8619,
    lng: -111.3743,
    priority: 35,
  },
];

// --- Guards ----------------------------------------------------------------

// Resolve the target user and refuse anything that is not the demo account.
// The demo id is the only value this script accepts; --user and SEED_USER_ID
// exist purely so an explicit mistake fails loudly instead of silently
// targeting the wrong account.
function resolveTargetUser(argv: string[], env: Record<string, string>): string {
  const flagIndex = argv.indexOf("--user");
  const requested =
    (flagIndex !== -1 ? argv[flagIndex + 1] : undefined) ??
    process.env.SEED_USER_ID ??
    env.SEED_USER_ID ??
    DEMO_USER_ID;

  const userId = requested.trim();
  if (userId !== DEMO_USER_ID) {
    throw new Error(
      `Refusing to run: this script only ever touches the demo account (${DEMO_USER_ID}). Got "${userId}".`,
    );
  }
  return userId;
}

// A second, independent check against the database itself: the target row must
// be flagged is_demo. If someone ever repoints the constant, this still stops.
async function assertIsDemoAccount(
  supabase: SeedClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_id, is_demo, public_slug")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_demo !== true) {
    throw new Error(
      "Refusing to run: the target user has no user_settings row flagged is_demo.",
    );
  }
  console.log(
    `Target confirmed: demo account, slug "${data.public_slug ?? "(none)"}".`,
  );
}

const COUNTED_TABLES = [
  "trips",
  "destinations",
  "experiences",
  "photos",
  "bucket_list",
] as const;

type TableCounts = Record<string, number>;

// Row counts for every user except the demo account. Compared before and
// after the run so any collateral damage is impossible to miss.
async function countOtherUsers(
  supabase: SeedClient,
  userId: string,
): Promise<TableCounts> {
  const counts: TableCounts = {};
  for (const table of COUNTED_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .neq("user_id", userId);
    if (error) throw error;
    counts[table] = count ?? 0;
  }
  return counts;
}

function reportOtherUserDelta(before: TableCounts, after: TableCounts): boolean {
  let clean = true;
  for (const table of COUNTED_TABLES) {
    const delta = after[table] - before[table];
    const flag = delta === 0 ? "unchanged" : `CHANGED BY ${delta}`;
    if (delta !== 0) clean = false;
    console.log(`  other users, ${table}: ${before[table]} -> ${after[table]} (${flag})`);
  }
  return clean;
}

// --- Reset -----------------------------------------------------------------

// Wipe every piece of demo travel data. user_settings is deliberately left
// alone: it carries is_demo and the public slug that /demo resolves through.
async function resetDemoData(
  supabase: SeedClient,
  userId: string,
): Promise<void> {
  // 1. Photos first, following the app's cleanup ordering: clear cover
  //    pointers, delete the rows, then best-effort Storage removal. Only
  //    upload-sourced objects are removed; wikimedia rows reference a shared
  //    cache path that other users' rows may still point at.
  const { data: photoRows, error: photoReadError } = await supabase
    .from("photos")
    .select("id, source, storage_path")
    .eq("user_id", userId);
  if (photoReadError) throw photoReadError;
  const photos = (photoRows ?? []) as {
    id: string;
    source: string;
    storage_path: string | null;
  }[];

  const clearTrips = await supabase
    .from("trips")
    .update({ cover_photo_id: null })
    .eq("user_id", userId)
    .not("cover_photo_id", "is", null);
  if (clearTrips.error) throw clearTrips.error;

  const clearDests = await supabase
    .from("destinations")
    .update({ cover_photo_id: null })
    .eq("user_id", userId)
    .not("cover_photo_id", "is", null);
  if (clearDests.error) throw clearDests.error;

  const deletePhotos = await supabase
    .from("photos")
    .delete()
    .eq("user_id", userId);
  if (deletePhotos.error) throw deletePhotos.error;

  const removablePaths = photos
    .filter((photo) => photo.source === "upload" && photo.storage_path)
    .flatMap((photo) => [
      photo.storage_path as string,
      `${photo.storage_path}${THUMB_SUFFIX}`,
    ]);
  if (removablePaths.length > 0) {
    try {
      await supabase.storage.from(PHOTO_BUCKET).remove(removablePaths);
    } catch {
      // Orphaned Storage objects are acceptable; the rows are already gone.
    }
  }
  console.log(
    `  photos: ${photos.length} row(s) deleted, ${removablePaths.length} storage object(s) attempted.`,
  );

  // 2. Bucket list, before trips: fulfilled items reference a trip id.
  const deleteBucket = await supabase
    .from("bucket_list")
    .delete()
    .eq("user_id", userId);
  if (deleteBucket.error) throw deleteBucket.error;
  console.log("  bucket_list: cleared.");

  // 3. Trips, which cascade to destinations and their experiences.
  const deleteTrips = await supabase.from("trips").delete().eq("user_id", userId);
  if (deleteTrips.error) throw deleteTrips.error;
  console.log("  trips: cleared (destinations and experiences cascade).");

  // 4. Belt and braces: anything left that did not hang off a trip.
  await supabase.from("experiences").delete().eq("user_id", userId);
  await supabase.from("destinations").delete().eq("user_id", userId);

  for (const table of COUNTED_TABLES) {
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) !== 0) {
      throw new Error(`Reset left ${count} row(s) in ${table}.`);
    }
  }
  console.log("  verified: no demo rows remain in any travel table.");
}

// --- Seed ------------------------------------------------------------------

// Spread done experiences across the stay instead of stacking every one on the
// arrival date, which makes the replay and the trip timeline read naturally.
function visitedDateFor(
  dest: SeedDestination,
  index: number,
  total: number,
): string {
  const stay = Math.max(1, daysBetween(dest.arrival, dest.departure));
  if (total <= 1) return dest.arrival;
  const offset = Math.min(stay - 1, Math.floor((index * stay) / total));
  return addDays(dest.arrival, Math.max(0, offset));
}

interface SeedTotals {
  trips: number;
  destinations: number;
  experiences: number;
  photos: number;
  covers: number;
}

async function seedTrips(
  supabase: SeedClient,
  userId: string,
  categoryMap: Map<string, string>,
): Promise<{ totals: SeedTotals; tripIds: Map<string, string> }> {
  const totals: SeedTotals = {
    trips: 0,
    destinations: 0,
    experiences: 0,
    photos: 0,
    covers: 0,
  };
  const tripIds = new Map<string, string>();

  for (const trip of TRIPS) {
    console.log(`\n=== ${trip.name} (${trip.status}) ===`);

    const { data: tripRow, error: tripError } = await supabase
      .from("trips")
      .insert({
        user_id: userId,
        name: trip.name,
        start_date: trip.start,
        end_date: trip.end,
        status: trip.status,
        notes: trip.notes ?? null,
      })
      .select("id")
      .single();
    if (tripError || !tripRow) {
      console.error(`Failed to insert trip "${trip.name}":`, tripError);
      continue;
    }
    const tripId = tripRow.id as string;
    tripIds.set(trip.name, tripId);
    totals.trips += 1;

    let tripCoverPhotoId: string | null = null;

    for (let i = 0; i < trip.destinations.length; i++) {
      const dest = trip.destinations[i];

      // Authored coordinates are the source of truth. The geocoder is used to
      // enrich admin_region and to sanity-check placement; a result more than
      // 250 km away is a different place with the same name and is ignored.
      const geo = await geocode(dest.city, dest.country);
      let adminRegion: string | null = null;
      if (geo) {
        const driftKm = haversineKm(dest.lat, dest.lng, geo.lat, geo.lng);
        if (driftKm <= 250) {
          adminRegion = geo.admin_region;
        } else {
          console.warn(
            `  Geocoder returned a ${Math.round(driftKm)} km drift for ${dest.city}; keeping authored coordinates.`,
          );
        }
      }

      // latitude and longitude are generated from geom; never write them.
      const { data: destRow, error: destError } = await supabase
        .from("destinations")
        .insert({
          trip_id: tripId,
          user_id: userId,
          name: dest.city,
          country_code: dest.code,
          admin_region: adminRegion,
          arrival_date: dest.arrival,
          departure_date: dest.departure,
          order_index: i + 1,
          geom: `SRID=4326;POINT(${dest.lng} ${dest.lat})`,
          notes: dest.notes ?? null,
        })
        .select("id")
        .single();
      if (destError || !destRow) {
        console.error(`  Failed to insert ${dest.city}:`, destError);
        continue;
      }
      const destId = destRow.id as string;
      totals.destinations += 1;

      // Wikimedia cover photo for the destination, and the first one that
      // resolves also becomes the trip cover.
      const photo = await wikimedia(dest.photoQuery ?? dest.city);
      if (photo?.url) {
        const { data: photoRow, error: photoError } = await supabase
          .from("photos")
          .insert({
            user_id: userId,
            owner_type: "destination",
            owner_id: destId,
            source: "wikimedia",
            external_url: photo.url,
            attribution: formatAttribution(photo.attribution, photo.license),
            order_index: 0,
          })
          .select("id")
          .single();
        if (!photoError && photoRow) {
          await supabase
            .from("destinations")
            .update({ cover_photo_id: photoRow.id })
            .eq("id", destId);
          totals.photos += 1;
          if (!tripCoverPhotoId) tripCoverPhotoId = photoRow.id as string;
        } else {
          console.error(`  Failed to insert photo for ${dest.city}:`, photoError);
        }
      } else {
        console.warn(`  No Wikimedia photo found for ${dest.city}.`);
      }

      // Experiences. Planned ideas carry no rating and no visited date; done
      // ones are spread across the stay.
      const doneExperiences = dest.experiences.filter(
        (exp) => (exp.status ?? "done") === "done",
      );
      let doneIndex = 0;
      for (const exp of dest.experiences) {
        const status: ExperienceStatus = exp.status ?? "done";
        const categoryId = categoryMap.get(exp.slug) ?? null;
        if (!categoryId) {
          console.warn(
            `  No category for slug "${exp.slug}" (${exp.name}). Inserting without one.`,
          );
        }
        const visitedDate =
          status === "done"
            ? visitedDateFor(dest, doneIndex++, doneExperiences.length)
            : null;
        const { error: expError } = await supabase.from("experiences").insert({
          destination_id: destId,
          user_id: userId,
          name: exp.name,
          category_id: categoryId,
          rating: status === "done" ? (exp.rating ?? null) : null,
          visited_date: visitedDate,
          notes: exp.notes ?? null,
          status,
          planned_day: exp.day ?? null,
          geom:
            exp.lat !== undefined && exp.lng !== undefined
              ? `SRID=4326;POINT(${exp.lng} ${exp.lat})`
              : null,
        });
        if (expError) {
          console.error(`  Failed to insert experience "${exp.name}":`, expError);
          continue;
        }
        totals.experiences += 1;
      }

      console.log(
        `  ${i + 1}. ${dest.city} (${dest.experiences.length} experiences)`,
      );

      // Be a courteous client to the geocoding and Wikimedia providers.
      await sleep(400);
    }

    if (tripCoverPhotoId) {
      const { error: coverError } = await supabase
        .from("trips")
        .update({ cover_photo_id: tripCoverPhotoId })
        .eq("id", tripId);
      if (coverError) {
        console.error(`  Failed to set the trip cover:`, coverError);
      } else {
        totals.covers += 1;
      }
    }
  }

  return { totals, tripIds };
}

async function seedBucketList(
  supabase: SeedClient,
  userId: string,
  tripIds: Map<string, string>,
): Promise<{ total: number; fulfilled: number }> {
  let total = 0;
  let fulfilled = 0;

  for (const item of BUCKET_ITEMS) {
    const fulfilledTripId = item.fulfilled_by
      ? (tripIds.get(item.fulfilled_by) ?? null)
      : null;
    if (item.fulfilled_by && !fulfilledTripId) {
      console.warn(
        `  Bucket item "${item.place_name ?? item.country_code}" names a trip that was not seeded ("${item.fulfilled_by}"); leaving it unfulfilled.`,
      );
    }

    const { error } = await supabase.from("bucket_list").insert({
      user_id: userId,
      type: item.type,
      country_code: item.country_code,
      place_name: item.place_name ?? null,
      geom:
        item.lat !== undefined && item.lng !== undefined
          ? `SRID=4326;POINT(${item.lng} ${item.lat})`
          : null,
      priority: item.priority,
      target_date: item.target_date ?? null,
      notes: item.notes ?? null,
      fulfilled_trip_id: fulfilledTripId,
      fulfilled_at: fulfilledTripId
        ? `${item.fulfilled_at ?? item.target_date ?? "2024-01-01"}T12:00:00Z`
        : null,
    });
    if (error) {
      console.error(
        `  Failed to add bucket item "${item.place_name ?? item.country_code}":`,
        error,
      );
      continue;
    }
    total += 1;
    if (fulfilledTripId) fulfilled += 1;
  }

  return { total, fulfilled };
}

// --- Stats report ----------------------------------------------------------

async function reportStats(
  supabase: SeedClient,
  userId: string,
): Promise<void> {
  const [summary, categories, yearly, bucket, extremes, distance] =
    await Promise.all([
      supabase
        .from("v_user_travel_summary")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("v_experiences_by_category").select("*").eq("user_id", userId),
      supabase
        .from("v_yearly_breakdown")
        .select("*")
        .eq("user_id", userId)
        .order("year"),
      supabase
        .from("v_bucket_completion")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("v_travel_extremes")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.rpc("f_distance_traveled", { p_user_id: userId }),
    ]);

  console.log("\n--- Stats views ---");
  console.log("summary:", JSON.stringify(summary.data ?? summary.error));
  console.log("distance_km:", JSON.stringify(distance.data ?? distance.error));
  console.log("bucket:", JSON.stringify(bucket.data ?? bucket.error));
  console.log("extremes:", JSON.stringify(extremes.data ?? extremes.error));
  console.log("yearly:");
  for (const row of (yearly.data ?? []) as Record<string, unknown>[]) {
    console.log(
      `  ${row.year}: ${row.trips} trip(s), ${row.countries} country/ies, ${row.new_countries} new`,
    );
  }
  console.log("categories:");
  for (const row of (categories.data ?? []) as Record<string, unknown>[]) {
    console.log(
      `  ${row.label}: ${row.experience_count} experience(s), avg ${row.avg_rating_stars ?? "n/a"} stars`,
    );
  }
}

// --- Main ------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes("--reset")) {
    throw new Error(
      "Refusing to run without --reset. This script DELETES all demo travel data before reseeding it. Run: npm run seed-demo -- --reset",
    );
  }

  const env = loadEnvLocal();
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  const userId = resolveTargetUser(argv, env);
  const supabase = makeSupabase(supabaseUrl, serviceKey);
  await assertIsDemoAccount(supabase, userId);

  // Confirm the dev server is reachable before doing any work: without it
  // there is no geocoding and no Wikimedia imagery.
  try {
    const ping = await fetch(`${BASE_URL}/api/geocode/search?q=test`);
    if (!ping.ok) throw new Error(`status ${ping.status}`);
  } catch (error) {
    throw new Error(
      `Dev server is not reachable at ${BASE_URL}. Start it with "npm run dev" first. (${String(error)})`,
    );
  }

  const before = await countOtherUsers(supabase, userId);

  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id, slug");
  if (catError) throw catError;
  const categoryMap = new Map<string, string>(
    (categories ?? []).map((c: { id: string; slug: string }) => [c.slug, c.id]),
  );
  console.log(`Loaded ${categoryMap.size} categories.`);

  console.log("\n=== Reset ===");
  await resetDemoData(supabase, userId);

  const { totals, tripIds } = await seedTrips(supabase, userId, categoryMap);

  console.log("\n=== Bucket list ===");
  const bucket = await seedBucketList(supabase, userId, tripIds);
  console.log(`  ${bucket.total} item(s), ${bucket.fulfilled} fulfilled.`);

  console.log("\n=== Seeded ===");
  console.log(
    `  ${totals.trips} trips, ${totals.destinations} destinations, ${totals.experiences} experiences, ${totals.photos} photos, ${totals.covers} trip covers.`,
  );

  console.log("\n=== Blast radius check ===");
  const after = await countOtherUsers(supabase, userId);
  const clean = reportOtherUserDelta(before, after);
  if (!clean) {
    throw new Error(
      "Non-demo row counts changed. Investigate before trusting this run.",
    );
  }

  await reportStats(supabase, userId);

  console.log("\nDemo reset complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
