// One-time (repeatable) seed of the full world country reference table.
//
// batchport.countries shipped with only a handful of European rows, which caps
// the bucket list country picker and breaks any non-European travel. This loads
// the complete ISO 3166-1 alpha-2 set with continent and region groupings.
//
// This is reference data, not application code. It talks to Supabase directly
// with the service-role key and does NOT need the dev server.
//
// Prerequisites:
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run seed-countries
//
// Idempotent: upserts on the code primary key, so existing rows are updated in
// place (their centroid/area, which this script does not set, are preserved) and
// missing rows are filled in. Safe to run repeatedly.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

interface CountryRow {
  code: string;
  name: string;
  continent: string;
  region: string;
}

// Continents grouped as: Africa, Asia, Europe, North America, South America,
// Oceania, Antarctica. Regions follow the UN geoscheme subregions. Names are
// kept ASCII to avoid any encoding surprises.
const COUNTRIES: CountryRow[] = [
  // --- Africa ---------------------------------------------------------------
  { code: "DZ", name: "Algeria", continent: "Africa", region: "Northern Africa" },
  { code: "EG", name: "Egypt", continent: "Africa", region: "Northern Africa" },
  { code: "LY", name: "Libya", continent: "Africa", region: "Northern Africa" },
  { code: "MA", name: "Morocco", continent: "Africa", region: "Northern Africa" },
  { code: "SD", name: "Sudan", continent: "Africa", region: "Northern Africa" },
  { code: "TN", name: "Tunisia", continent: "Africa", region: "Northern Africa" },
  { code: "EH", name: "Western Sahara", continent: "Africa", region: "Northern Africa" },
  { code: "BI", name: "Burundi", continent: "Africa", region: "Eastern Africa" },
  { code: "KM", name: "Comoros", continent: "Africa", region: "Eastern Africa" },
  { code: "DJ", name: "Djibouti", continent: "Africa", region: "Eastern Africa" },
  { code: "ER", name: "Eritrea", continent: "Africa", region: "Eastern Africa" },
  { code: "ET", name: "Ethiopia", continent: "Africa", region: "Eastern Africa" },
  { code: "KE", name: "Kenya", continent: "Africa", region: "Eastern Africa" },
  { code: "MG", name: "Madagascar", continent: "Africa", region: "Eastern Africa" },
  { code: "MW", name: "Malawi", continent: "Africa", region: "Eastern Africa" },
  { code: "MU", name: "Mauritius", continent: "Africa", region: "Eastern Africa" },
  { code: "YT", name: "Mayotte", continent: "Africa", region: "Eastern Africa" },
  { code: "MZ", name: "Mozambique", continent: "Africa", region: "Eastern Africa" },
  { code: "RE", name: "Reunion", continent: "Africa", region: "Eastern Africa" },
  { code: "RW", name: "Rwanda", continent: "Africa", region: "Eastern Africa" },
  { code: "SC", name: "Seychelles", continent: "Africa", region: "Eastern Africa" },
  { code: "SO", name: "Somalia", continent: "Africa", region: "Eastern Africa" },
  { code: "SS", name: "South Sudan", continent: "Africa", region: "Eastern Africa" },
  { code: "TZ", name: "Tanzania", continent: "Africa", region: "Eastern Africa" },
  { code: "UG", name: "Uganda", continent: "Africa", region: "Eastern Africa" },
  { code: "ZM", name: "Zambia", continent: "Africa", region: "Eastern Africa" },
  { code: "ZW", name: "Zimbabwe", continent: "Africa", region: "Eastern Africa" },
  { code: "AO", name: "Angola", continent: "Africa", region: "Middle Africa" },
  { code: "CM", name: "Cameroon", continent: "Africa", region: "Middle Africa" },
  { code: "CF", name: "Central African Republic", continent: "Africa", region: "Middle Africa" },
  { code: "TD", name: "Chad", continent: "Africa", region: "Middle Africa" },
  { code: "CG", name: "Republic of the Congo", continent: "Africa", region: "Middle Africa" },
  { code: "CD", name: "DR Congo", continent: "Africa", region: "Middle Africa" },
  { code: "GQ", name: "Equatorial Guinea", continent: "Africa", region: "Middle Africa" },
  { code: "GA", name: "Gabon", continent: "Africa", region: "Middle Africa" },
  { code: "ST", name: "Sao Tome and Principe", continent: "Africa", region: "Middle Africa" },
  { code: "BW", name: "Botswana", continent: "Africa", region: "Southern Africa" },
  { code: "SZ", name: "Eswatini", continent: "Africa", region: "Southern Africa" },
  { code: "LS", name: "Lesotho", continent: "Africa", region: "Southern Africa" },
  { code: "NA", name: "Namibia", continent: "Africa", region: "Southern Africa" },
  { code: "ZA", name: "South Africa", continent: "Africa", region: "Southern Africa" },
  { code: "BJ", name: "Benin", continent: "Africa", region: "Western Africa" },
  { code: "BF", name: "Burkina Faso", continent: "Africa", region: "Western Africa" },
  { code: "CV", name: "Cabo Verde", continent: "Africa", region: "Western Africa" },
  { code: "CI", name: "Cote d'Ivoire", continent: "Africa", region: "Western Africa" },
  { code: "GM", name: "Gambia", continent: "Africa", region: "Western Africa" },
  { code: "GH", name: "Ghana", continent: "Africa", region: "Western Africa" },
  { code: "GN", name: "Guinea", continent: "Africa", region: "Western Africa" },
  { code: "GW", name: "Guinea-Bissau", continent: "Africa", region: "Western Africa" },
  { code: "LR", name: "Liberia", continent: "Africa", region: "Western Africa" },
  { code: "ML", name: "Mali", continent: "Africa", region: "Western Africa" },
  { code: "MR", name: "Mauritania", continent: "Africa", region: "Western Africa" },
  { code: "NE", name: "Niger", continent: "Africa", region: "Western Africa" },
  { code: "NG", name: "Nigeria", continent: "Africa", region: "Western Africa" },
  { code: "SH", name: "Saint Helena", continent: "Africa", region: "Western Africa" },
  { code: "SN", name: "Senegal", continent: "Africa", region: "Western Africa" },
  { code: "SL", name: "Sierra Leone", continent: "Africa", region: "Western Africa" },
  { code: "TG", name: "Togo", continent: "Africa", region: "Western Africa" },

  // --- Asia -----------------------------------------------------------------
  { code: "KZ", name: "Kazakhstan", continent: "Asia", region: "Central Asia" },
  { code: "KG", name: "Kyrgyzstan", continent: "Asia", region: "Central Asia" },
  { code: "TJ", name: "Tajikistan", continent: "Asia", region: "Central Asia" },
  { code: "TM", name: "Turkmenistan", continent: "Asia", region: "Central Asia" },
  { code: "UZ", name: "Uzbekistan", continent: "Asia", region: "Central Asia" },
  { code: "CN", name: "China", continent: "Asia", region: "Eastern Asia" },
  { code: "HK", name: "Hong Kong", continent: "Asia", region: "Eastern Asia" },
  { code: "MO", name: "Macao", continent: "Asia", region: "Eastern Asia" },
  { code: "JP", name: "Japan", continent: "Asia", region: "Eastern Asia" },
  { code: "KP", name: "North Korea", continent: "Asia", region: "Eastern Asia" },
  { code: "KR", name: "South Korea", continent: "Asia", region: "Eastern Asia" },
  { code: "MN", name: "Mongolia", continent: "Asia", region: "Eastern Asia" },
  { code: "TW", name: "Taiwan", continent: "Asia", region: "Eastern Asia" },
  { code: "BN", name: "Brunei", continent: "Asia", region: "South-Eastern Asia" },
  { code: "KH", name: "Cambodia", continent: "Asia", region: "South-Eastern Asia" },
  { code: "ID", name: "Indonesia", continent: "Asia", region: "South-Eastern Asia" },
  { code: "LA", name: "Laos", continent: "Asia", region: "South-Eastern Asia" },
  { code: "MY", name: "Malaysia", continent: "Asia", region: "South-Eastern Asia" },
  { code: "MM", name: "Myanmar", continent: "Asia", region: "South-Eastern Asia" },
  { code: "PH", name: "Philippines", continent: "Asia", region: "South-Eastern Asia" },
  { code: "SG", name: "Singapore", continent: "Asia", region: "South-Eastern Asia" },
  { code: "TH", name: "Thailand", continent: "Asia", region: "South-Eastern Asia" },
  { code: "TL", name: "Timor-Leste", continent: "Asia", region: "South-Eastern Asia" },
  { code: "VN", name: "Vietnam", continent: "Asia", region: "South-Eastern Asia" },
  { code: "AF", name: "Afghanistan", continent: "Asia", region: "Southern Asia" },
  { code: "BD", name: "Bangladesh", continent: "Asia", region: "Southern Asia" },
  { code: "BT", name: "Bhutan", continent: "Asia", region: "Southern Asia" },
  { code: "IN", name: "India", continent: "Asia", region: "Southern Asia" },
  { code: "IR", name: "Iran", continent: "Asia", region: "Southern Asia" },
  { code: "MV", name: "Maldives", continent: "Asia", region: "Southern Asia" },
  { code: "NP", name: "Nepal", continent: "Asia", region: "Southern Asia" },
  { code: "PK", name: "Pakistan", continent: "Asia", region: "Southern Asia" },
  { code: "LK", name: "Sri Lanka", continent: "Asia", region: "Southern Asia" },
  { code: "IO", name: "British Indian Ocean Territory", continent: "Asia", region: "Southern Asia" },
  { code: "AM", name: "Armenia", continent: "Asia", region: "Western Asia" },
  { code: "AZ", name: "Azerbaijan", continent: "Asia", region: "Western Asia" },
  { code: "BH", name: "Bahrain", continent: "Asia", region: "Western Asia" },
  { code: "CY", name: "Cyprus", continent: "Asia", region: "Western Asia" },
  { code: "GE", name: "Georgia", continent: "Asia", region: "Western Asia" },
  { code: "IQ", name: "Iraq", continent: "Asia", region: "Western Asia" },
  { code: "IL", name: "Israel", continent: "Asia", region: "Western Asia" },
  { code: "JO", name: "Jordan", continent: "Asia", region: "Western Asia" },
  { code: "KW", name: "Kuwait", continent: "Asia", region: "Western Asia" },
  { code: "LB", name: "Lebanon", continent: "Asia", region: "Western Asia" },
  { code: "OM", name: "Oman", continent: "Asia", region: "Western Asia" },
  { code: "PS", name: "Palestine", continent: "Asia", region: "Western Asia" },
  { code: "QA", name: "Qatar", continent: "Asia", region: "Western Asia" },
  { code: "SA", name: "Saudi Arabia", continent: "Asia", region: "Western Asia" },
  { code: "SY", name: "Syria", continent: "Asia", region: "Western Asia" },
  { code: "TR", name: "Turkey", continent: "Asia", region: "Western Asia" },
  { code: "AE", name: "United Arab Emirates", continent: "Asia", region: "Western Asia" },
  { code: "YE", name: "Yemen", continent: "Asia", region: "Western Asia" },

  // --- Europe ---------------------------------------------------------------
  { code: "BY", name: "Belarus", continent: "Europe", region: "Eastern Europe" },
  { code: "BG", name: "Bulgaria", continent: "Europe", region: "Eastern Europe" },
  { code: "CZ", name: "Czechia", continent: "Europe", region: "Eastern Europe" },
  { code: "HU", name: "Hungary", continent: "Europe", region: "Eastern Europe" },
  { code: "MD", name: "Moldova", continent: "Europe", region: "Eastern Europe" },
  { code: "PL", name: "Poland", continent: "Europe", region: "Eastern Europe" },
  { code: "RO", name: "Romania", continent: "Europe", region: "Eastern Europe" },
  { code: "RU", name: "Russia", continent: "Europe", region: "Eastern Europe" },
  { code: "SK", name: "Slovakia", continent: "Europe", region: "Eastern Europe" },
  { code: "UA", name: "Ukraine", continent: "Europe", region: "Eastern Europe" },
  { code: "AX", name: "Aland Islands", continent: "Europe", region: "Northern Europe" },
  { code: "DK", name: "Denmark", continent: "Europe", region: "Northern Europe" },
  { code: "EE", name: "Estonia", continent: "Europe", region: "Northern Europe" },
  { code: "FO", name: "Faroe Islands", continent: "Europe", region: "Northern Europe" },
  { code: "FI", name: "Finland", continent: "Europe", region: "Northern Europe" },
  { code: "GG", name: "Guernsey", continent: "Europe", region: "Northern Europe" },
  { code: "IS", name: "Iceland", continent: "Europe", region: "Northern Europe" },
  { code: "IE", name: "Ireland", continent: "Europe", region: "Northern Europe" },
  { code: "IM", name: "Isle of Man", continent: "Europe", region: "Northern Europe" },
  { code: "JE", name: "Jersey", continent: "Europe", region: "Northern Europe" },
  { code: "LV", name: "Latvia", continent: "Europe", region: "Northern Europe" },
  { code: "LT", name: "Lithuania", continent: "Europe", region: "Northern Europe" },
  { code: "NO", name: "Norway", continent: "Europe", region: "Northern Europe" },
  { code: "SJ", name: "Svalbard and Jan Mayen", continent: "Europe", region: "Northern Europe" },
  { code: "SE", name: "Sweden", continent: "Europe", region: "Northern Europe" },
  { code: "GB", name: "United Kingdom", continent: "Europe", region: "Northern Europe" },
  { code: "AL", name: "Albania", continent: "Europe", region: "Southern Europe" },
  { code: "AD", name: "Andorra", continent: "Europe", region: "Southern Europe" },
  { code: "BA", name: "Bosnia and Herzegovina", continent: "Europe", region: "Southern Europe" },
  { code: "HR", name: "Croatia", continent: "Europe", region: "Southern Europe" },
  { code: "GI", name: "Gibraltar", continent: "Europe", region: "Southern Europe" },
  { code: "GR", name: "Greece", continent: "Europe", region: "Southern Europe" },
  { code: "IT", name: "Italy", continent: "Europe", region: "Southern Europe" },
  { code: "XK", name: "Kosovo", continent: "Europe", region: "Southern Europe" },
  { code: "MT", name: "Malta", continent: "Europe", region: "Southern Europe" },
  { code: "ME", name: "Montenegro", continent: "Europe", region: "Southern Europe" },
  { code: "MK", name: "North Macedonia", continent: "Europe", region: "Southern Europe" },
  { code: "PT", name: "Portugal", continent: "Europe", region: "Southern Europe" },
  { code: "SM", name: "San Marino", continent: "Europe", region: "Southern Europe" },
  { code: "RS", name: "Serbia", continent: "Europe", region: "Southern Europe" },
  { code: "SI", name: "Slovenia", continent: "Europe", region: "Southern Europe" },
  { code: "ES", name: "Spain", continent: "Europe", region: "Southern Europe" },
  { code: "VA", name: "Vatican City", continent: "Europe", region: "Southern Europe" },
  { code: "AT", name: "Austria", continent: "Europe", region: "Western Europe" },
  { code: "BE", name: "Belgium", continent: "Europe", region: "Western Europe" },
  { code: "FR", name: "France", continent: "Europe", region: "Western Europe" },
  { code: "DE", name: "Germany", continent: "Europe", region: "Western Europe" },
  { code: "LI", name: "Liechtenstein", continent: "Europe", region: "Western Europe" },
  { code: "LU", name: "Luxembourg", continent: "Europe", region: "Western Europe" },
  { code: "MC", name: "Monaco", continent: "Europe", region: "Western Europe" },
  { code: "NL", name: "Netherlands", continent: "Europe", region: "Western Europe" },
  { code: "CH", name: "Switzerland", continent: "Europe", region: "Western Europe" },

  // --- North America --------------------------------------------------------
  { code: "BM", name: "Bermuda", continent: "North America", region: "Northern America" },
  { code: "CA", name: "Canada", continent: "North America", region: "Northern America" },
  { code: "GL", name: "Greenland", continent: "North America", region: "Northern America" },
  { code: "PM", name: "Saint Pierre and Miquelon", continent: "North America", region: "Northern America" },
  { code: "US", name: "United States", continent: "North America", region: "Northern America" },
  { code: "BZ", name: "Belize", continent: "North America", region: "Central America" },
  { code: "CR", name: "Costa Rica", continent: "North America", region: "Central America" },
  { code: "SV", name: "El Salvador", continent: "North America", region: "Central America" },
  { code: "GT", name: "Guatemala", continent: "North America", region: "Central America" },
  { code: "HN", name: "Honduras", continent: "North America", region: "Central America" },
  { code: "MX", name: "Mexico", continent: "North America", region: "Central America" },
  { code: "NI", name: "Nicaragua", continent: "North America", region: "Central America" },
  { code: "PA", name: "Panama", continent: "North America", region: "Central America" },
  { code: "AI", name: "Anguilla", continent: "North America", region: "Caribbean" },
  { code: "AG", name: "Antigua and Barbuda", continent: "North America", region: "Caribbean" },
  { code: "AW", name: "Aruba", continent: "North America", region: "Caribbean" },
  { code: "BS", name: "Bahamas", continent: "North America", region: "Caribbean" },
  { code: "BB", name: "Barbados", continent: "North America", region: "Caribbean" },
  { code: "BQ", name: "Caribbean Netherlands", continent: "North America", region: "Caribbean" },
  { code: "VG", name: "British Virgin Islands", continent: "North America", region: "Caribbean" },
  { code: "KY", name: "Cayman Islands", continent: "North America", region: "Caribbean" },
  { code: "CU", name: "Cuba", continent: "North America", region: "Caribbean" },
  { code: "CW", name: "Curacao", continent: "North America", region: "Caribbean" },
  { code: "DM", name: "Dominica", continent: "North America", region: "Caribbean" },
  { code: "DO", name: "Dominican Republic", continent: "North America", region: "Caribbean" },
  { code: "GD", name: "Grenada", continent: "North America", region: "Caribbean" },
  { code: "GP", name: "Guadeloupe", continent: "North America", region: "Caribbean" },
  { code: "HT", name: "Haiti", continent: "North America", region: "Caribbean" },
  { code: "JM", name: "Jamaica", continent: "North America", region: "Caribbean" },
  { code: "MQ", name: "Martinique", continent: "North America", region: "Caribbean" },
  { code: "MS", name: "Montserrat", continent: "North America", region: "Caribbean" },
  { code: "PR", name: "Puerto Rico", continent: "North America", region: "Caribbean" },
  { code: "BL", name: "Saint Barthelemy", continent: "North America", region: "Caribbean" },
  { code: "KN", name: "Saint Kitts and Nevis", continent: "North America", region: "Caribbean" },
  { code: "LC", name: "Saint Lucia", continent: "North America", region: "Caribbean" },
  { code: "MF", name: "Saint Martin", continent: "North America", region: "Caribbean" },
  { code: "VC", name: "Saint Vincent and the Grenadines", continent: "North America", region: "Caribbean" },
  { code: "SX", name: "Sint Maarten", continent: "North America", region: "Caribbean" },
  { code: "TT", name: "Trinidad and Tobago", continent: "North America", region: "Caribbean" },
  { code: "TC", name: "Turks and Caicos Islands", continent: "North America", region: "Caribbean" },
  { code: "VI", name: "United States Virgin Islands", continent: "North America", region: "Caribbean" },

  // --- South America --------------------------------------------------------
  { code: "AR", name: "Argentina", continent: "South America", region: "South America" },
  { code: "BO", name: "Bolivia", continent: "South America", region: "South America" },
  { code: "BR", name: "Brazil", continent: "South America", region: "South America" },
  { code: "CL", name: "Chile", continent: "South America", region: "South America" },
  { code: "CO", name: "Colombia", continent: "South America", region: "South America" },
  { code: "EC", name: "Ecuador", continent: "South America", region: "South America" },
  { code: "FK", name: "Falkland Islands", continent: "South America", region: "South America" },
  { code: "GF", name: "French Guiana", continent: "South America", region: "South America" },
  { code: "GY", name: "Guyana", continent: "South America", region: "South America" },
  { code: "PY", name: "Paraguay", continent: "South America", region: "South America" },
  { code: "PE", name: "Peru", continent: "South America", region: "South America" },
  { code: "SR", name: "Suriname", continent: "South America", region: "South America" },
  { code: "UY", name: "Uruguay", continent: "South America", region: "South America" },
  { code: "VE", name: "Venezuela", continent: "South America", region: "South America" },

  // --- Oceania --------------------------------------------------------------
  { code: "AU", name: "Australia", continent: "Oceania", region: "Australia and New Zealand" },
  { code: "NZ", name: "New Zealand", continent: "Oceania", region: "Australia and New Zealand" },
  { code: "NF", name: "Norfolk Island", continent: "Oceania", region: "Australia and New Zealand" },
  { code: "CX", name: "Christmas Island", continent: "Oceania", region: "Australia and New Zealand" },
  { code: "CC", name: "Cocos (Keeling) Islands", continent: "Oceania", region: "Australia and New Zealand" },
  { code: "FJ", name: "Fiji", continent: "Oceania", region: "Melanesia" },
  { code: "NC", name: "New Caledonia", continent: "Oceania", region: "Melanesia" },
  { code: "PG", name: "Papua New Guinea", continent: "Oceania", region: "Melanesia" },
  { code: "SB", name: "Solomon Islands", continent: "Oceania", region: "Melanesia" },
  { code: "VU", name: "Vanuatu", continent: "Oceania", region: "Melanesia" },
  { code: "FM", name: "Micronesia", continent: "Oceania", region: "Micronesia" },
  { code: "GU", name: "Guam", continent: "Oceania", region: "Micronesia" },
  { code: "KI", name: "Kiribati", continent: "Oceania", region: "Micronesia" },
  { code: "MH", name: "Marshall Islands", continent: "Oceania", region: "Micronesia" },
  { code: "NR", name: "Nauru", continent: "Oceania", region: "Micronesia" },
  { code: "MP", name: "Northern Mariana Islands", continent: "Oceania", region: "Micronesia" },
  { code: "PW", name: "Palau", continent: "Oceania", region: "Micronesia" },
  { code: "UM", name: "United States Minor Outlying Islands", continent: "Oceania", region: "Micronesia" },
  { code: "AS", name: "American Samoa", continent: "Oceania", region: "Polynesia" },
  { code: "CK", name: "Cook Islands", continent: "Oceania", region: "Polynesia" },
  { code: "PF", name: "French Polynesia", continent: "Oceania", region: "Polynesia" },
  { code: "NU", name: "Niue", continent: "Oceania", region: "Polynesia" },
  { code: "PN", name: "Pitcairn", continent: "Oceania", region: "Polynesia" },
  { code: "WS", name: "Samoa", continent: "Oceania", region: "Polynesia" },
  { code: "TK", name: "Tokelau", continent: "Oceania", region: "Polynesia" },
  { code: "TO", name: "Tonga", continent: "Oceania", region: "Polynesia" },
  { code: "TV", name: "Tuvalu", continent: "Oceania", region: "Polynesia" },
  { code: "WF", name: "Wallis and Futuna", continent: "Oceania", region: "Polynesia" },

  // --- Antarctica -----------------------------------------------------------
  { code: "AQ", name: "Antarctica", continent: "Antarctica", region: "Antarctica" },
  { code: "BV", name: "Bouvet Island", continent: "Antarctica", region: "Antarctica" },
  { code: "TF", name: "French Southern Territories", continent: "Antarctica", region: "Antarctica" },
  { code: "HM", name: "Heard Island and McDonald Islands", continent: "Antarctica", region: "Antarctica" },
  { code: "GS", name: "South Georgia and the South Sandwich Islands", continent: "Antarctica", region: "Antarctica" },
];

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

async function main() {
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

  // Service-role client scoped to the batchport schema. Bypasses RLS.
  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Upserting ${COUNTRIES.length} countries...`);

  // Upsert on the code primary key: existing rows are updated in place (columns
  // this script does not set, like centroid, are left untouched), missing rows
  // are inserted. No duplicates.
  const { data, error } = await supabase
    .from("countries")
    .upsert(COUNTRIES, { onConflict: "code" })
    .select("code");
  if (error) throw error;

  console.log(`Upserted ${data?.length ?? 0} countries.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
