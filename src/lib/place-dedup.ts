// ONE VENUE IS ONE PIN, in one definition.
//
// Pure and client-safe, and deliberately a decision over rows rather than a
// query: the server action reaches it through requireUser()'s client and
// scripts/seed-places.ts reaches it through the service-role client, and those
// two cannot share a query but must share a RULE. A seed that logs several
// venues in one city is the most likely thing to hit this, so a second
// implementation living in the seed is exactly the duplicate problem again.
//
// Why it exists at all: logging a catalog venue that is already logged must add
// a visit to it, not clone it. Two rows for one building double-count a
// catalog's denominator, put two pins on one spot, and split a visit history
// that only makes sense whole. American Family Field was logged twice before
// this existed.

/** The columns a candidate row must carry to be judged. */
export interface DuplicateCandidate {
  id: string;
  name: string;
  locality_name: string | null;
  catalog_item_id: string | null;
}

/** The shape of what is about to be logged. */
export interface DuplicateInput {
  name: string;
  locality_name: string | null;
  catalog_item_id: string | null;
}

function norm(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The id of the place this input would duplicate, or null.
 *
 * Two rules, in order:
 *
 *   1. A CATALOG ITEM IS AN IDENTITY. Same catalog_item_id is the same
 *      building, whatever either row happens to be named: a venue renamed by a
 *      sponsor is still the venue you have been to.
 *
 *   2. Otherwise, SAME NAME IN THE SAME LOCALITY. That is the best available
 *      answer for a geocoded pick, where there is no stable id: "Green Bay"
 *      logged twice in Green Bay is one place. Compared case and
 *      whitespace-insensitively, because a geocoder is not consistent about
 *      either.
 *
 * A place with NO LOCALITY never matches under rule 2. "No locality" is not a
 * locality two things can share, and two unlocated places called "Home" are not
 * evidence of anything. A catalog row is also never matched by rule 2, so a
 * hand-typed "Fenway Park" does not silently absorb into the tracked venue: the
 * catalog link is a claim the user made by picking it.
 */
export function findDuplicate(
  candidates: readonly DuplicateCandidate[],
  input: DuplicateInput,
): string | null {
  // TWO NULLS ARE NOT A MATCH, and that is stated rather than implied. The
  // first version guarded this branch with a truthy check, which excluded null
  // correctly but by accident: an auditor looking for the null-comparison bug
  // had to reason out that the guard was doing double duty. The equivalent
  // mistake in SQL is real and was made in this feature's own verification
  // query, where `partition by catalog_item_id` grouped every non-catalog place
  // together (PARTITION BY treats NULLs as equal, unlike `=`), so eleven
  // unrelated places each reported ten others "sharing their venue".
  //
  // If two places both have no catalog item, that is not evidence they are the
  // same building. It means neither is a tracked venue, and the name and
  // locality rule below is what decides.
  const catalogId = input.catalog_item_id ?? null;
  if (catalogId !== null) {
    const hit = candidates.find((c) => (c.catalog_item_id ?? null) === catalogId);
    return hit?.id ?? null;
  }

  const locality = norm(input.locality_name);
  if (!locality) return null;

  const name = norm(input.name);
  const hit = candidates.find(
    (c) =>
      (c.catalog_item_id ?? null) === null &&
      norm(c.name) === name &&
      norm(c.locality_name) === locality,
  );
  return hit?.id ?? null;
}
