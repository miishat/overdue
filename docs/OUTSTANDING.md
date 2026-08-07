# Outstanding work

**Last updated:** 2026-08-07, at the close of the M4 and audit-remediation
session. `main` is at the merge of audit Tier 3.

This file exists because the working record for that session lived in
`.superpowers/sdd/progress.md`, which is gitignored scratch and would not
survive a `git clean -fdx` or a fresh checkout. Everything below is the part
worth carrying forward. The scratch ledger has the blow-by-blow if it is
still on disk.

## State at close

| Check | Result |
|---|---|
| `pnpm test` | 925 passing |
| `pnpm typecheck` | 0 errors, gated in CI |
| `pnpm lint` | 0 errors, 0 warnings |
| `pnpm build` | green, `/offline` static |
| `pnpm test:e2e` | 27 passed, 1 pre-existing skip |
| `pnpm test:e2e:prod` | 6 passed |

Migrations through `0008` are applied to the live Neon database and verified
by querying `information_schema` and `pg_catalog` directly.

Every finding in `docs/audits/2026-07-30-full-audit.md` is closed except the
ones listed below. M4 shipped in full.

---

## 1. Verify the offline banner on a real device

**The only item here that no test in this repository can settle.**

Chromium reports `navigator.onLine` as `true` for a document created while
already offline, which is why `tests/e2e-prod/pwa.spec.ts` has to toggle
offline, online, offline to get a real signal out of it. The comment there
records the observation.

That is probably a CDP emulation artefact. If it is not, then on a real
phone reloading in airplane mode the app renders stale release dates with no
banner, which is the exact dishonesty the whole milestone exists to prevent.

**To check:** install the app on a phone, load the shelf, enable airplane
mode, reload. The banner should read "Offline. Showing what was last loaded
on this device."

Five minutes, and nothing else can answer it.

## 2. A newly discovered book produces no notification

The scheduled refresh now discovers new series entries, so the app finally
keeps the spec's promise that "the app owns discovering new entries, the
user never adds book five manually". But it tells nobody.

Confirmed by reading the code, not inferred: only `runRefresh` calls
`enqueue`, and only with `"date_change"` and `"digest"`, both derived from
diffing an already-known book. `src/lib/refresh/discovery-run.ts` persists
new rows and never enqueues.

**No decision needed.** Spec section 10 already settles it: new announcements
belong in the **daily digest**, not the instant alert, which is reserved for
date changes.

**The work:** an `enqueue` call in `discovery-run.ts`, and a case for the new
kind in `buildDigest` (`src/lib/notify/digest.ts`).

This is the smallest high-value item on the list. The discovery feature is
half mute until it lands.

## 3. `quarter` and `season` are unreachable from live data

Both are in the `date_precision` enum, stored in Postgres, handled by
`formatImprecise`, ranked in `PRECISION_RANK`, and tested. No adapter can
produce either. So "Fall 2027", the spec's own headline `ESTIMATED` example,
cannot come from real data.

Closing it means a date and precision field on the manual entry form. That is
a feature, not a fix, which is why it was not folded into the audit work.

## 4. `/api/search` has no rate limiting or caching

Audit finding E4. Every settled keystroke fans out to four providers.
Hardcover's documented limit is 60 requests per minute on a token the spec
notes is explicitly not for sharing. `provider_records` is the natural home
for a cache and is currently unused.

Behind the deployment gate this is a single-user concern. It is the first
thing that breaks if the gate ever comes off.

## 5. Query counts on the Library render

Audit findings F2 and F3. `lastSeriesReleaseAt` is re-derived up to three
times per Library render, and every data route is `force-dynamic` with no
caching. Correct for correctness; it means every navigation is a full round
trip. Now that the refresh runs on a schedule, `revalidateTag` on the refresh
job fits better than forcing dynamic everywhere.

## 6. Smaller things, noted so they are not rediscovered

- `SearchResult.tsx` hand-rolls a dashed cover placeholder. There is a real
  `Gap` component for exactly that. Consolidating them was left out of the
  G1 migration to keep it a pure styling change.
- `discovery-port.ts`'s `trackedSeries()` runs three sequential queries
  rather than one join. Matches the existing style in `port.ts`; flagged as a
  watch item rather than a defect.
- `authors.name` has no unique constraint, so `upsertAuthors` carries a
  check-then-insert race. Pre-existing and documented in the code. A unique
  constraint would close it, at the cost of a migration that has to cope with
  any existing duplicate rows.
- Reinstating row-level security is on the checklist for whenever
  `getCurrentUserId()` starts returning something real, alongside the
  object-scoping gap already documented in `src/lib/book-detail.ts` and
  `src/lib/series-detail.ts`. See `drizzle/0007_drop_rls.sql` for why it was
  removed rather than repaired.

---

## Before starting M5

M5 is Goodreads import, the two alternate themes, density and view options,
keyboard shortcuts, and polish.

**Audit finding G1 was closed deliberately ahead of M5** and it is worth
knowing why, because it constrains how the themes get built. The spec's
theming bet is that a theme is a `grid-template-areas` and token swap over
one shared DOM, and it states that if a theme ever needs different markup, it
is not a theme and the cost goes non-linear. Three components in the search
route hardcoded raw Tailwind colours and named typefaces directly, so they
would not have participated in that swap and would have needed fixing once
per theme. They are on the token layer now.

Keep them there. A raw colour utility or a `font-[family-name:...]` anywhere
in a component is the thing that breaks the swap.

The M2 decision record deferred the alternate themes to M5 specifically so
the Waiting Shelf rework would be paid for once. That is still the bet.
