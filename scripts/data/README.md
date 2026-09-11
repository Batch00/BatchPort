# Places catalog data

Reference data for the places feature (in development, unshipped). Everything
here is a pull artifact plus one hand-maintained correction layer. Nothing in
this directory is loaded by the app yet.

## Files

| File | What |
|---|---|
| `national_parks.csv`, `mlb.csv`, `nfl.csv`, `nba.csv`, `nhl.csv`, `ncaa_fbs_football.csv`, `ncaa_basketball_arenas.csv` | One row per venue per catalog |
| `missing-coords.csv` | Venues the pull could not give a coordinate for, for manual fill |
| `catalog-overrides.csv` | Hand-maintained corrections applied after the pull |
| `us-admin1.geojson` | US Census `cb_2023_us_state_500k`, 50 states + DC, for point-in-polygon state coverage |

Catalog columns: `wikidata_qid, catalog_slug, name, lat, lng, city, state,
country_code, tenants, leagues`. `tenants` and `leagues` are pipe delimited.
`missing-coords.csv` has the same columns plus a trailing `reason`, with `lat`
and `lng` blank.

`country_code` is ISO 3166-1 alpha-2, sourced from Wikidata `P17` -> `P297`
(664 US, 8 CA). It is NOT NULL in `place_catalog_items` and the loader refuses a
blank one, because it is the last segment of the generated
`places.locality_key`: a venue with no country keys as `green bay|wisconsin|`
and will not group with the same city picked from Photon, which always returns
one. Exactly one item has no `P17` and is filled through
`catalog-overrides.csv`.

`wikidata_qid` is the identity key. A venue that belongs to more than one
catalog appears in each file with the same QID and identical values in every
other column, so cross-catalog dedup is a QID match and never a coordinate
match. Two different buildings can share a name (Convocation Center appears
three times, at three schools), so name is not an identity.

Every `lat` / `lng` in a catalog file came from a Wikidata `P625` SPARQL result.
A venue that returned without one is in `missing-coords.csv` rather than
carrying a guess. Coordinates introduced by `catalog-overrides.csv` follow the
same rule and name their source item in the `reason` column.

## catalog-overrides.csv

Columns: `wikidata_qid, catalog_slug, field, value, reason`.

The pull is reproducible and destructive: re-running it rewrites the catalog
CSVs from scratch. This file is the layer that survives that, so a correction
is made here and never by editing a catalog CSV.

One row corrects **one field of one row**, keyed on the `wikidata_qid` **as the
pull produced it**. `field` is a catalog column name. `catalog_slug` says which
file's row is being patched.

Two conventions:

- **A QID not present in the pull means "add this row".** Intuit Dome is the
  case: no team's `P115` points at it (the Clippers' statement was never closed
  out), so the pull cannot see it at all. Fields the group does not set are
  left empty.
- **A venue in more than one catalog needs one row per catalog.** Crypto.com
  Arena is in both `nba.csv` and `nhl.csv`, so dropping the Clippers from its
  tenants takes two rows. Patching one file only would break the rule that a
  shared venue is identical everywhere.

### Apply semantics

**Group every override row by its original `wikidata_qid`. Apply the whole
group as one atomic patch. Re-key the row only after the entire group has been
applied.**

```
for each group (keyed on the original wikidata_qid):
    patch = {}
    for each row in group:
        patch[row.catalog_slug][row.field] = row.value   # collect only
    for each catalog named in patch:
        target = catalog row whose wikidata_qid == the group key
        apply every field in patch[catalog] to target     # then, and only then
    if patch set wikidata_qid:
        re-key target to the new value
```

**Never apply row-by-row with a re-match between rows.** A group that retargets
a venue contains a `wikidata_qid` row, and re-matching after it would change
the key mid-group: every later row in that group then matches nothing, or
matches whatever venue happens to hold the new QID. The Texas Rangers group is
the live example. Its four rows are

```
Q1634492,mlb,wikidata_qid,Q24284037
Q1634492,mlb,name,Globe Life Field
Q1634492,mlb,lat,32.74736111
Q1634492,mlb,lng,-97.08416667
```

Applied atomically this retargets one row from Choctaw Stadium to Globe Life
Field. Applied with re-matching, the first row moves the key to `Q24284037` and
the remaining three look up `Q1634492`, which no longer exists: the row keeps
Choctaw Stadium's name and coordinates under Globe Life Field's QID. That is a
silent wrong answer, not an error, which is why the ordering is written down
rather than left to the implementation.

Row order within a group is therefore irrelevant, and must stay irrelevant.

## Provenance

- Venue coordinates and pro-league tenancy: Wikidata (`P625`, `P115`, `P118`,
  `P131`), via the Wikidata Query Service.
- Membership lists: the Wikipedia list articles for national parks, FBS
  football stadiums, and D1 basketball arenas, resolved to QIDs through
  `pageprops.wikibase_item`.
- State boundaries: US Census Bureau cartographic boundary file
  `cb_2023_us_state_500k` (1:500,000), converted from shapefile with geometry
  unsimplified. Source CRS is NAD83; treated as WGS84, a sub-metre difference.
  This replaced Natural Earth 10m, which put five riverfront venues in the
  wrong state and left four coastal points outside every polygon.
