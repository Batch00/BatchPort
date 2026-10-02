// Validation for EXIF-derived photo fields. Pure and client-safe: the EXIF
// parse runs it in the browser, and insertPhotoRecord runs it again on the
// server, because a value that reaches the insert unvalidated is what turned
// a missing date into a failed upload.
//
// The rule is that metadata is a bonus and never a blocker. Anything that is
// not clearly a real value becomes null, and the photo saves without it.
//
// Photos saved from an iCloud shared album are the case that forced this:
// GPS is stripped (sometimes leaving coordinates with no hemisphere refs) and
// DateTimeOriginal can be missing, zeroed ("0000:00:00 00:00:00"), blank
// ("    :  :     :  :  "), or truncated ("2024:05"). Postgres rejects the
// latter three outright (22007 / 22008), which failed the whole insert.

// Earliest year accepted as a capture date. Digital EXIF predates it only on
// scans and camera clocks reset to the epoch, both of which are noise here.
export const MIN_PHOTO_YEAR = 1990;

// Slack for a capture date "in the future": EXIF dates are camera local time
// with no zone, so a photo taken a few hours ago east of here can legitimately
// read as tomorrow.
const FUTURE_SLACK_MS = 36 * 60 * 60 * 1000;

const EXIF_DATE =
  /^\s*(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * A capture date as "YYYY-MM-DD HH:MM:SS", or null when the input is not a
 * real, plausible timestamp. Accepts the EXIF form ("YYYY:MM:DD HH:MM:SS"),
 * the ISO form, and a bare date. Rejects zeroed and partial dates, impossible
 * calendar values (Feb 30, hour 25), years before MIN_PHOTO_YEAR, and dates
 * in the future.
 */
export function sanitizeDateTaken(
  raw: unknown,
  now: Date = new Date(),
): string | null {
  if (typeof raw !== "string") return null;
  const match = EXIF_DATE.exec(raw);
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);

  if (hour > 23 || minute > 59 || second > 59) return null;
  // Round-trip through UTC: a zeroed month or Feb 30 normalizes to a
  // different date, which is how an impossible value shows itself.
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(ms);
  if (
    Number.isNaN(ms) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  if (year < MIN_PHOTO_YEAR) return null;
  if (ms > now.getTime() + FUTURE_SLACK_MS) return null;

  return `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/**
 * A coordinate pair, or nulls for both. Both halves must be finite and in
 * range; one valid half without the other is not a location. Hemisphere refs
 * are the EXIF parser's job (see extractExifFromBuffer): by the time a pair
 * gets here it is already signed.
 */
export function sanitizeGps(
  lat: unknown,
  lng: unknown,
): { gpsLat: number | null; gpsLng: number | null } {
  const none = { gpsLat: null, gpsLng: null };
  if (typeof lat !== "number" || typeof lng !== "number") return none;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return none;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return none;
  // Exactly 0,0 is what a zeroed GPS block reads as, not a photo taken in the
  // Gulf of Guinea.
  if (lat === 0 && lng === 0) return none;
  return { gpsLat: lat, gpsLng: lng };
}
