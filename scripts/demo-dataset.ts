// The demo showcase dataset: the single source of truth for what the public
// demo account contains.
//
// Two consumers read this fixture:
//   - scripts/seed-demo.ts writes it into Supabase for the demo account.
//   - scripts/generate-mock-globe.ts derives src/lib/mock-travel-data.ts from
//     it, the static fallback the landing hero renders when the live read is
//     unavailable.
//
// It lives in its own module so those two can never drift apart. Coordinates
// here are the authored source of truth; the seeder sanity-checks them against
// the geocoder rather than replacing them.

// --- Types -----------------------------------------------------------------

export type TripStatus = "completed" | "ongoing" | "planned";
export type ExperienceStatus = "planned" | "done";

export interface SeedExperience {
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

export interface SeedDestination {
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

export interface SeedTrip {
  name: string;
  start: string;
  end: string;
  status: TripStatus;
  notes?: string;
  destinations: SeedDestination[];
}

export interface SeedBucketItem {
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

// --- Showcase dataset ------------------------------------------------------

// A fictional travel history. Eight completed trips across six continents from
// 2019 to early 2026 (2020 is empty and 2021 holds one short trip, which is
// what the years actually looked like), one ongoing trip straddling today, and
// two planned trips ahead of it.

export const TRIPS: SeedTrip[] = [
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

export const BUCKET_ITEMS: SeedBucketItem[] = [
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
