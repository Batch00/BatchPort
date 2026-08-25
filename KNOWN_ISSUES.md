# Known issues

Defects found and not fixed at the time, with enough detail to be picked up
cold. Each entry states what a user sees, what causes it, and why it was left.

Fixed entries stay here rather than being deleted, marked **Fixed** with the
date. The diagnosis is usually worth more than the patch, and a wrong first
diagnosis is worth keeping visible: two of the entries below were understood
incorrectly before they were understood correctly, and in both cases the
mistake is more instructive than the fix.

---

## The expense entry row is four rows tall on a phone

**Found** 2026-08-23, during the expenses visual pass.
**Status** open, deliberately deferred. A layout design pass, not a bug fix.

### What happens

`/trips/[id]/expenses` at 375px and 390px wraps the entry row onto roughly four
lines. Nothing is broken or unreachable, and every control still works; it is
simply much taller than it should be. The inline editor in
`expense-workspace.tsx` (`EditRow`) has the identical shape and the identical
problem.

### Why it matters more here than it would elsewhere

The stated design target for this surface is a day's spending logged from a
phone in a hostel, and the fast-entry loop (amount, Enter, repeat) is the
reason the page is shaped the way it is. A four-row form pushes the ledger
below the fold on every commit, so the row you just added is not visible
without scrolling, which is exactly the feedback the loop depends on.

### Cause

The controls carry minimum widths that cannot coexist at phone width:

| control | class | min width |
|---|---|---|
| amount | `w-24` | 96px |
| vendor | `min-w-40 flex-1` | 160px |
| category | `min-w-40 flex-1` | 160px |
| date | `w-36` | 144px |
| alcohol toggle | `size-9` | 36px |
| Add button | auto | ~80px |

That is roughly 676px of minimum content in a 327px content box (375px less
the page's `p-6`), so `flex-wrap` does what it is told.

### Fix sketch (not applied)

This wants a deliberate two-row phone layout rather than tightening widths one
at a time. Roughly: amount and vendor on the first row, category and date on
the second, alcohol and Add sharing the end of it, with the whole thing
collapsing back to one row at `sm`. Whatever shape it takes, the ledger's first
row should still be visible under the form after a commit at 375px, which is
the test that actually matters.

`EditRow` should get the same treatment in the same pass, since it duplicates
the entry row's field list by design (one mental model for both), and fixing
one without the other would break that.

---

## The share feature has never worked for a signed-in visitor

**Found** 2026-08-23, while verifying the expenses privacy gate.
**Fixed** 2026-08-24. Seven policies widened, verified end to end.

### What happened

**This is not a settings-table problem. It is schema-wide, and it means the
public share feature has been broken for every signed-in visitor since it
shipped.** Not merely the slug lookup: the profile, the trips, the stats, the
photos and the bucket list were all invisible to anyone with a session who was
not the profile's owner. Signed out it worked perfectly, which is why it was
never noticed: the owner only ever checks their own share page while signed in
as themselves (works, it is their own row) or in a private window (works, that
is anon). The audience the feature was built for, other signed-in Batch Apps
users, could not see any of it.

The visible symptom was "Profile not found. This profile is not shared or does
not exist." on `/share/batch00`, and on `/demo` the quieter version: page
shell, empty globe, "No travel data yet."

### The actual cause: policy ROLES, not a missing policy

The first version of this entry said `user_settings` had a single owner-scoped
policy and needed a second one added for share resolution. **That was wrong.**
Both policies already existed and had all along:

```
user_settings_owner    ALL     {authenticated}   (user_id = auth.uid())
user_settings_public   SELECT  {anon}            (public_share_enabled OR is_demo)
```

The share policy was correct in every respect except **who it applied to**. It
was granted to `anon` only, so a signed-in visitor never reached it: they were
evaluated against `user_settings_owner`, which restricts to their own row, and
another account's settings were invisible. Anon matched the public policy and
worked; authenticated fell through and got nothing.

### The fix

```sql
alter policy user_settings_public on batchport.user_settings
  to anon, authenticated;
```

One line. No new policy, no widening of what is exposed, no change to either
`USING` clause. The same rows, to one more role.

### The lesson worth keeping

**`pg_policies` without the `roles` column looks like a complete picture and is
not.** Both of us read that catalog while diagnosing this and both of us read
policy names and `USING` clauses, saw a public-share policy that said exactly
what it should, and concluded the logic was right and something else was wrong.
The column that held the bug was the one neither of us selected.

When a policy exists and behaves as though it does not, check `roles` before
anything else:

```sql
select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'batchport' and tablename = '<table>';
```

A policy scoped to `{anon}` on an app where most readers are `authenticated` is
a policy that is off for almost everyone, and it fails silently: RLS returns no
rows rather than an error, so it reads as "no data" rather than "no access".
That is the same silence documented in `scripts/sql/2026-08-19-expenses.sql`
for RLS-with-no-policy, arriving by a different route.

### What it means for the expense gate

The fix **widens who can resolve a slug**, so `/share/[slug]` now has a caller
class it never had: an authenticated non-owner. RLS permits that caller to read
the demo account's expenses (`is_demo_account`), exactly as it permits anon, so
the surface flag in `src/app/share/[slug]/page.tsx` is the only thing holding
the line for them too.

`scripts/check-share-gate.ts` fetched anonymously, which is precisely why this
bug survived a gate written to catch leaks on that route. It now carries a
signed-in half, which runs as a throwaway non-owner account.

### The rest of it: six more policies, and two nobody could have found

Fixing `user_settings` fixed slug RESOLUTION only. A signed-in non-owner now
reaches the page instead of "Profile not found", and then gets an empty shell:
"No travel data yet" and "No trips to show yet". Measured by reading each table
twice, once as anon and once as an authenticated non-owner, for the demo
account:

| table | anon | authenticated non-owner |
|---|---|---|
| trips | 11 | **0** |
| destinations | 48 | **0** |
| experiences | 238 | **0** |
| photos | 48 | **0** |
| bucket_list | 10 | **0** |
| v_user_travel_summary | 1 | **0** |
| v_yearly_breakdown | 7 | **0** |
| transport_legs | 48 | 48 |
| expenses | 75 | 75 |

Five tables, five policies. The two views carry no policies of their own: they
are `security_invoker`, their `SELECT` grants to `authenticated` are already in
place (they return zero rows rather than `42501`), and the reference tables they
join (`countries`, `cities`) are already readable by both roles. They start
working the moment the base tables are widened, with nothing further to do.

Generate the statements rather than typing the names, which also catches any
anon-only policy nobody probed:

```sql
select format(
  'alter policy %I on batchport.%I to anon, authenticated;',
  policyname, tablename
)
from pg_policies
where schemaname = 'batchport' and roles = '{anon}'
order by tablename;
```

**Why two tables were already right is the useful part.** `transport_legs` and
`expenses` work for both roles because their policies were created with no `TO`
clause at all, which defaults to `PUBLIC`, meaning every role. The broken ones
were explicitly scoped `TO anon`, which reads like a deliberate tightening and
is in fact a silent narrowing to a role that most readers are not. Writing no
`TO` clause turned out safer than writing a specific one.

### Verified

All seven policies widened. Every object carrying a shared-read policy now
reads identically for anon and for an authenticated non-owner:

```
match: 13   mismatch: 0   untestable: 3
```

The three untestable are `journal_entries`, `lists` and `list_items`, which
hold no rows at all, so there is nothing to read either way.

`npm run check-share-gate` passes 12 checks, including the one that was
impossible before: **the expense gate against a fully populated profile.** A
signed-in non-owner can now reach `/share/batch00` with its trips, stats and
photos rendered, in a database holding 226 of the owner's expense rows, and the
page shows none of them. Every earlier "no spend" pass on that route was
against an empty shell and proved nothing.

The RLS layer holds underneath it: that same caller reads 75 expense rows (the
demo's, which `is_demo_account()` permits) out of 301 in the table, so the
owner's 226 are refused by the database and the demo's are refused by the
surface. Two independent layers, each doing the half the other cannot.

**The generator found seven policies, not five, and the two extra ones could
not have been found any other way.** `lists_shared_read` and
`list_items_shared_read` were `{anon}`-only like the rest. No probe caught them
and no page exercised them, because the custom lists UI does not exist yet:
they would have shipped broken for every signed-in visitor on the day that
feature landed, and the bug would have looked like a brand-new lists bug rather
than a four-year-old policy bug.

That is the argument for asking the catalog "which policies have this shape"
instead of asking the app "which pages are broken". A symptom-driven sweep can
only ever reach the surfaces that already exist. `journal_entries` did not
appear in the generated list, which is also worth recording: its policy was
already correct, so the earlier probe reading 0 for both roles really was the
demo having no journal entries rather than evidence of anything.

`journal_entries` reads 0 for both roles, but the demo account has no journal
entries, so that is not evidence either way and wants rechecking against an
account that does.
