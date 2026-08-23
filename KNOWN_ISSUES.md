# Known issues

Defects found and deliberately not fixed at the time, with enough detail to be
picked up cold. Each entry states what a user sees, what causes it, and why it
was left.

---

## A signed-in user cannot view anyone else's shared profile

**Found** 2026-08-23, while verifying the expenses privacy gate.
**Status** open, not fixed. Unrelated to expenses; predates that work.

### What happens

Any signed-in BatchPort user who visits `/share/batch00` gets:

> **Profile not found**
> This profile is not shared or does not exist.

The same account viewed **signed out** renders correctly. `/demo` has the same
problem in a quieter form: signed in it renders the page shell with an empty
globe and "No travel data yet. Add a trip to see your stats."; signed out it
renders the full demo profile.

### Why it is easy to miss

`/share/[slug]` is a surface built for **other people** to look at, and the
only two ways its owner ever checks it are signed in as themselves (broken, but
looks like a slug problem) or in a private window (works). Neither reveals that
the audience it was built for, other signed-in Batch Apps users, cannot see it
at all. It was found only because an anonymous `fetch` and a browser tab
disagreed about the same URL.

### Cause

`getUserBySlug` in `src/lib/share-data.ts` resolves a slug by reading
`batchport.user_settings`:

```ts
const { data } = await supabase
  .from("user_settings")
  .select("user_id")
  .eq("public_slug", slug)
  .or("public_share_enabled.eq.true,is_demo.eq.true")
  .maybeSingle();
```

RLS on `user_settings` is `auth.uid() = user_id`. So:

- **Anon**: the anon role is not `auth.uid() = user_id` for anybody, and
  whatever policy grants anon its read is the one that makes the public share
  surface work. It resolves.
- **Signed in as someone else**: `auth.uid()` is the *visitor*, not the profile
  owner, so the row is invisible, `getUserBySlug` returns null, and the page
  renders "Profile not found".

The same root cause explains the empty `/demo`: `getDemoUserId()` reads the
same table and falls back to the `DEMO_USER_ID` constant, but the subsequent
reads go through `is_shared(user_id)`, which itself reads `user_settings` and
is therefore also blind under another user's session.

### Fix sketch (not applied)

The share-resolution read needs to be legible to any authenticated user, not
only to the row's owner. Options, roughly in order of preference:

1. Add a SELECT policy on `user_settings` exposing **only the share columns**
   (`user_id`, `public_slug`, `public_share_enabled`, `is_demo`) to
   `authenticated`, via a view rather than widening the table's own policy. The
   table also holds home location and other private settings, so widening it
   directly would leak more than the slug.
2. Make `is_shared()` `security definer` so it can answer regardless of who is
   asking, which is what it is already doing implicitly for anon.

Either way this wants its own migration and its own verification, including the
case that is currently untested: **a signed-in user viewing another account's
share page.** `scripts/check-share-gate.ts` fetches anonymously and so would
not have caught this and still would not.

### Why it was left

It was found mid-way through the expenses feature, it is not caused by that
work, and fixing it means touching `user_settings` RLS, which is the same class
of change that produced the taxonomy bug documented in
`scripts/sql/2026-08-19-expenses.sql`. Bundling it into a phase-2 UI change
would have been exactly the kind of unrelated-change-in-a-diff this project has
been careful to avoid.
