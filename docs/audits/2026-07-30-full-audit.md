# Overdue: full audit

**Date:** 2026-07-30
**Branch audited:** `feat/m2-waiting-shelf` at `eaa86b6`
**Scope:** every file under `src/`, `drizzle/`, `tests/`, plus the design spec and the M2 plan. Read in full, not sampled.
**Status:** findings only. No code was changed as part of this audit.

Two fixes landed from a parallel session while this was being written and are already excluded from the findings below: `ReadStateControl` gained try/catch/finally with a visible error, and `changes.ts` documented the `"release_date"` field-name contract.

---

## Baseline at time of audit

| Check | Command | Result |
|---|---|---|
| Unit tests | `vitest run` | 401 passing, 45 files, 5.0s |
| Typecheck | `tsc --noEmit` | **13 errors**, all in test files |
| Lint | `eslint .` | 0 errors, 3 `no-img-element` warnings |
| Build | `next build` | Clean, 10 routes |
| Coverage | `vitest --coverage --coverage.all` | 77.0% stmts / 72.1% branch / 79.0% lines |

The pure layer is genuinely strong and is where the correctness lives, as the M2 plan intended. Problems concentrate in three places the plan did not protect: the drizzle data sources (25 to 32 percent covered), the provider adapters' precision handling, and the boundary between provider data and the shelf's own semantics.

---

## A. Defects

### A1. Already-released books appear on the Waiting Shelf, in horizons that read as future. Critical.

`buildShelf` filters only `COMPLETE` (`src/lib/shelf.ts:98`). `groupByHorizon` skips only `COMPLETE` (`src/lib/horizons.ts:83`). Nothing removes `RELEASED`. Tracking a series persists every entry providers return, including the whole published backlist (`src/app/api/track/route.ts:53`).

Trace `horizonFor` (`src/lib/horizons.ts:44`) for a book published 2024-03-01 with `now` = 2026-07-29:

- `months = -28`, so not `This month`
- `months > 0` false, so not `Next 3 months`
- year 2024 != 2026, so not `Later this year`
- falls through to **`Dated further out`**

A book from two years ago lands in a bucket named for the future. A book from March of the current year computes `months = -4` and lands in **`Later this year`**. Track one five-book series and the shelf fills with four books already owned, under forward-looking headings.

Not caught by tests because the only `RELEASED` horizon test uses a date in the *current* month (`src/lib/horizons.test.ts:77`), the one past-date case that happens to land correctly. This is the failure mode the M2 plan warned about: a test sitting on the one date pair that hides the bug.

Two decisions are tangled. `horizonFor` needs a past-date branch. More importantly, the spec calls this screen "everything the user is waiting on," and you are not waiting on a 2024 book. A `RELEASED` filter in `buildShelf`, mirroring the existing `COMPLETE` filter, is the smaller and more honest change. Library already holds the full tracked set.

### A2. Every Hardcover date is asserted as day-precision. High.

`src/providers/hardcover.ts:145` and `:184`: `datePrecision: releaseDate ? "day" : undefined`.

Hardcover stores approximate future dates as January 1 of the target year. That flows through `deriveStatus` rule 3 (`src/resolution/status.ts:32`) to **`DATED`**, rendering a **solid** rule (`src/components/shelf/StatusRule.tsx:15`) and the string "1 Jan 2027". The app states a confirmed date nobody confirmed.

This is the dishonesty the product exists to prevent. `formatImprecise`'s own docstring says rendering a season as a day "would assert a confidence no source gave us, which is the dishonesty this whole app exists to avoid" (`src/lib/provenance.ts:131`). The adapter does exactly that one layer upstream. A heuristic (a bare `01-01` date far out is treated as `year` precision) is imperfect but strictly better than a blanket day claim.

### A3. Wikidata precision 8 and below silently becomes day-precision. High. Same family as A2.

`src/providers/wikidata.ts:15`. Only `"9"` maps to year and `"10"` to month; everything else, including 7 (century), 8 (decade), and any absent or malformed value, falls through to `"day"`. The default is biased toward maximum false confidence. It should default to `"year"` and require an explicit `11` for `"day"`.

Related: `quarter` and `season` are in the enum, stored in Postgres, handled by `formatImprecise`, ranked in `PRECISION_RANK`, and tested. **No adapter can produce them.** Google parses day/month/year only (`src/providers/google-books.ts:20`), Open Library emits `year`, Hardcover `day`, Wikidata day/month/year. "Fall 2027," the spec's headline `ESTIMATED` example, is unreachable from live data, and the manual form has no date field.

### A4. Open Library reports `first_publish_year` as the release date. Medium-high.

`src/providers/open-library.ts:31`. That field is a property of the *work*, not of any edition or forthcoming release. For a reissue it asserts a release date decades in the past.

Mostly masked because Open Library ranks third for `releaseDate` (`src/resolution/trust.ts:26`), so it only wins when Wikidata and Hardcover are silent. But it still enters `computeConfidence` as a *distinct* date and triggers the `-15` disagreement penalty (`src/resolution/resolve.ts:57`), so it systematically suppresses confidence for books whose real date is correct.

### A5. Duplicate Wikidata bindings make the winning date order-dependent. Medium-high.

`entriesQuery` (`src/providers/wikidata.ts:50`) selects `?pubDate` from P577, which is routinely multi-valued (one statement per edition, country, printing). SPARQL returns one row per statement, so `getSeriesEntries` returns N `ProviderBook` records for the same QID with different dates.

`groupByIdentity` merges them (same title, empty author, no ISBN), then `pick` takes `records.find(...)`, which is **first in array order** (`src/resolution/resolve.ts:39`). Which date wins is whatever order WDQS returned. No `ORDER BY` on the date, no tie-break in `pick`.

Same class of defect as one recorded in M1's review history in the M2 plan: "a `Map.set` collision that made behaviour depend on provider response order." It has recurred in a different file. Fix with `MIN(?pubDate)` plus `GROUP BY` in SPARQL, or a deterministic tie-break in `pick`.

### A6. Wikidata never returns authors, and the code implies otherwise. Medium.

`toProviderBook` reads `bindingValue(binding, "authorLabel")` (`src/providers/wikidata.ts:139`) but **no query selects `?authorLabel`**. `toProviderBookFromCandidate` hardcodes `authors: []`. Every Wikidata result has an empty author array, permanently.

A series entry discovered only through Wikidata (a forthcoming book Hardcover has not indexed, exactly this app's case) reaches the shelf with no author line. It also weakens `groupByIdentity`, whose title-author key degrades to title-only for every Wikidata record (`src/resolution/identity.ts:23`), making cross-provider merging least reliable where it matters most.

### A7. SPARQL injection from a client-controlled field. Medium (low impact today, real path).

`src/providers/wikidata.ts:51` interpolates `externalId` straight into SPARQL (`BIND(wd:${seriesQid} AS ?series)`), likewise in `getBook` and `getSeries`.

The path is untrusted end to end: `POST /api/track` accepts `body.book` unvalidated and maps `body.book.sources` to `{provider, externalId}` (`src/app/api/track/route.ts:49`), handed to `discoverSeriesEntries` then `getSeriesEntriesFromAll`. A crafted `externalId` closes the `BIND` and appends arbitrary SPARQL, including a `SERVICE` clause pointing at an attacker-chosen endpoint, executed from our IP against public WDQS.

Impact is bounded (read-only, third-party endpoint, no access to our data), hence Medium. But the Hardcover adapter does `Number(externalId)` (`src/providers/hardcover.ts:216`), neutralising the identical attack by accident of numeric ids. A `/^Q\d+$/` guard costs one line.

### A8. `db.transaction` is never used; `persistResolvedBook` has a destructive window. Medium-high.

`src/lib/persist.ts:250-341` issues ~12 sequential statements with no transaction, plus 3 per author in a loop (`:78`). The dangerous pair: `delete(releaseSources)` followed later by `insert(releaseSources)`.

A failure between them leaves the release with zero source rows. Both `drizzleShelfSource` and `drizzleSeriesDetailSource` derive `sourceOfficial` **solely** from `release_sources` (`src/lib/shelf.ts:236`, `src/lib/series-detail.ts:246`), so the book silently downgrades `ANNOUNCED` to `RUMORED`: dotted rule, dimmed to 25 percent, different horizon bucket. Nothing repairs it, since nothing re-persists until M3.

The read/write officiality divergence is already documented at `src/lib/shelf.ts:230`. What that comment does not say is that a partial write turns a documented edge case into a routine one. `neon-http` supports non-interactive batched transactions; the delete/insert pair at minimum belongs in one.

### A9. Migration snapshots are missing for 0001 through 0004. Medium, and it will bite on the next schema change.

`drizzle/meta/` has `_journal.json` (correctly listing all five) and **only `0000_snapshot.json`**. Migrations 0001 to 0004 were hand-written without regenerating snapshots.

`drizzle-kit generate` diffs against the latest snapshot, which is 0000. The next `pnpm db:generate` will re-emit `series_title_unique` and `release_book_region_format_unique` as a new migration, which then fails on apply with "constraint already exists." Regenerate snapshots now, while the drift is four constraints and not forty.

### A10. RLS is enabled and enforces nothing.

`drizzle/0001_rls.sql` enables RLS on `tracks`, `read_states`, `notification_prefs` with policies on `current_setting('app.user_id', true)::uuid`. Nothing anywhere sets `app.user_id`. And `neon-http` is stateless per statement, so a `SET` would not survive to the next query. The app works only because the connection role owns the tables and bypasses RLS.

Three problems: no `WITH CHECK`, so writes would be unconstrained even if active; `USING` without `FOR` covers SELECT/UPDATE/DELETE but not INSERT; and the spec's claim of "row-level security from day one" (section 1) is not currently true. Either wire `app.user_id` through a pooled per-request connection, or remove the migration and rely on the explicit `eq(userId)` filters every query already gets right. The present middle state reads as protected in review and is not.

---

## B. Divergences from the approved spec

**B1. The two-order release-date trust matrix collapsed to one.** Spec section 4 defines "already released: Open Library > Google > Hardcover" and "forthcoming: Wikidata > Hardcover > Google". `src/resolution/trust.ts:26` implements a single order. The forthcoming order is honoured; already-released is not. Given A4, the current single order may be the safer choice, and `ResolvableField` has no notion of value-dependent trust, so implementing the spec as written is structural. Worth a decision record rather than silent drift.

**B2. Confidence uses neither of two of its three specified inputs.** Spec section 4 names trust rank of the winning source, agreement, and recency of `last_verified_at`. `computeConfidence` (`src/resolution/resolve.ts:50`) uses agreement, a record-count "breadth" term, and a hardcoded official check. It never reads trust rank, and cannot read recency (it runs before persistence). Confidence is also per-book, not per-field as the spec frames it. `breadth` counts *records* not *distinct providers*, so A5's duplicate bindings inflate it: four Wikidata printings score the same breadth as four independent providers. The official check hardcodes `manual | hardcover | wikidata` inline, duplicating `OFFICIAL_PROVIDERS`, which `src/providers/registry.ts:22` exists specifically to prevent.

**B3. The light scheme is built, contrast-tested, and unreachable.** `data-scheme="dark"` is hardcoded on `<html>` (`src/app/layout.tsx:16`). No toggle, no `prefers-color-scheme` fallback, no persistence. The full light palette exists in `tokens.ts`, mirrors into `globals.css`, and has six passing AA assertions. Spec section 7 ships "Full light and dark" in M2.

**B4. `provider_records` is never written.** Defined (`src/db/schema/identity.ts:29`) and migrated. Spec section 5 justifies it as caching raw responses so resolution can be re-run without re-fetching. Consequence for M3: the refresh job cannot diff against the previous *raw* payload, only against resolved state, so it cannot distinguish "the provider changed its answer" from "our resolution changed its mind." That distinction is what makes a `ChangeLog` entry attributable to a provider. Worth writing before the refresh job is designed around its absence.

**B5. Dead schema from a dropped decision.** `accounts`, `sessions`, `verification_tokens` (`src/db/schema/users.ts:26-71`) are NextAuth tables, migrated in 0000, unreachable since auth was dropped. Also unwired: `notification_prefs` (M3), and `users.theme` / `region` / `format_preference` / `hiatus_threshold_years`. The last is notable: a per-user column shadowed by the hardcoded `DEFAULT_HIATUS_THRESHOLD_YEARS` (`src/lib/shelf.ts:14`), and `loadShelf` never passes the override its own signature accepts.

**B6. `COMPLETE` is unreachable for any real book.** `deriveStatus` returns it only when `seriesStatus === "complete" && !hasBookRecord` (`src/resolution/status.ts:23`), every book row passes `hasBookRecord: true`, and `synthesiseSeriesEntry` returns null for a complete series. Consistent and documented in three places, with Library working around it via `completeSeriesIds`. Flagged only because `LABELS`, `ruleStyleFor`, the `groupByHorizon` skip, and the `buildShelf` filter all carry `COMPLETE` branches that are dead by construction and will read as live code.

---

## C. M2 is not done by its own definition

The M2 plan's Definition of Done has two unmet items, both testing:

- **Task 18, e2e coverage of all eight states.** `tests/e2e/waiting-shelf.spec.ts` and `tests/e2e/fixtures/seed-states.ts` do not exist. The plan specifies them in detail, down to the seeding strategy (fixed UUIDs, exact cleanup, never truncate). The spec requires it too (section 11). The plan calls this "the one test that proves the visual language works end to end rather than per component."
- **Task 19, navigation e2e.** Not written at time of audit. (A parallel session appears to be working on this.)

The four existing e2e tests all target `/search` and all stub `/api/search`. **No e2e test visits `/`, `/library`, `/books/[id]`, or `/series/[id]`.** The entire M2 deliverable has zero end-to-end coverage. Despite its name, `add-and-track.spec.ts` never tracks anything.

Correctly out of scope per the plan, and therefore **not** findings: cover proxying (M4), virtualisation (measure first), theme switcher (M5), settings screen, responsive shell, `ChangeLog` writes (M3).

---

## D. Testing

77.0% statements with `--coverage.all`. Distribution matters more than the number:

| Area | Lines | Reading |
|---|---|---|
| `src/resolution/**` | ~100% | Exhaustive, table-driven. Best code in the repo. |
| `src/components/shelf/**` | 100% | Every component, including branch cases. |
| `persist.ts` | 98.6% | 837 lines of test for 341 of source. |
| `read-state.ts` | 45.5% | Store impl untested. |
| `series-detail.ts` | 31.8% | Lines 121-259: the entire drizzle source. |
| `shelf.ts` | 25.0% | Lines 153-369: the entire drizzle source. |
| `tracks.ts` | **0%** | `insertTrack` never executed by a test. |
| `book-detail.ts` | **0%** | No test file exists. |

**D1. The newest feature shipped with no test file.** Commit `eaa86b6` added `src/lib/book-detail.ts`, 164 lines, with no `book-detail.test.ts`, in a TDD project, on the commit immediately after one titled "test: pin the series-detail synthetic-suppression rule."

**D2. The drizzle sources are the least-tested and highest-risk code.** The pure halves are near-100%; the query layers that feed them are near-0%. Those queries contain real decisions that could be pinned without a database: the direct-plus-series book id union, the region/format join pinning, the `max(date) <= current_date` aggregate, the first-author-by-position reduction, the officiality set. `mergeTrackedBookIds` was extracted to be testable (`src/lib/shelf.ts:110`) and is the only piece that got that treatment.

**D3. Thirteen type errors, invisible to CI.** `tsc --noEmit` fails; `next build` passes because it only typechecks the app's import graph, so test files escape. `.github/workflows/ci.yml` runs lint, test, build, e2e, and no typecheck. Errors in `persist.test.ts` (6), `discover.test.ts` (4), `registry.test.ts` (1), `proxy.test.ts` (1). Not all cosmetic: `discover.test.ts` passes arrays into a parameter inferred as `never`, meaning the mock's shape and the real signature have diverged.

**D4. A test named for the left rule does not test the left rule.** `src/lib/contrast.test.ts:60` makes two assertions; the first is a verbatim duplicate of the previous test and says nothing about `rule`. Only the 1.2 floor touches it, and that one's comment is honest about being a regression pin rather than an AA claim.

**D5. No coverage threshold.** `@vitest/coverage-v8` is installed; there is no `coverage` script and no `thresholds` block, so coverage is never enforced or reported in CI. A threshold on `src/lib/**` would have caught D1 mechanically.

**D6. Playwright's `reuseExistingServer: true` is a documented footgun** (`playwright.config.ts:15`): if a gated `pnpm dev` is already on port 3000, Playwright attaches and every spec 401s. Since `SITE_GATE_SECRET: ""` is already injected, `reuseExistingServer: !process.env.CI` plus a distinct port removes the manual step.

---

## E. Security

**E1. `/api/track` and `/api/manual` write catalog data with no validation.** `as Partial<TrackRequest>` (`src/app/api/track/route.ts:15`) is a cast, not a check. `body.book` goes straight to `persistResolvedBook`, writing title, coverUrl, description, seriesName, confidence, releaseDate, datePrecision, and arbitrary `(provider, externalId)` pairs into shared tables. No length bounds, no enum validation on `provider` (an invalid value hits a Postgres enum and throws a 500 rather than a 400), no URL scheme check on `coverUrl` despite it rendering as `<img src>` on four screens. `/api/track` also lacks the malformed-JSON try/catch `/api/read-state` has.

The right pattern already exists in the codebase: `/api/read-state` uses `isReadStateValue` as a narrowing guard with a comment explaining why (`src/lib/read-state.ts:15`). Two routes do not use it.

**E2. The gate is the only control, and it defaults to off.** `evaluateGate` returns `allow` when `SITE_GATE_SECRET` is unset or blank (`src/lib/gate.ts:22`). Reasonable for local dev; it means a deploy that forgets the env var is fully open with no warning. Spec section 13 names this the tripwire before the Vercel URL goes live. A fail-closed default in production, or a loud boot-time log, would match the stated posture. The gate logic itself is well built: `timingSafeEqual` with length pre-check, `httpOnly`, `sameSite: "lax"`, `secure` in production, and an explicitly unreachable deny branch that denies rather than admits.

**E3. Detail routes are unscoped by object id.** `drizzleBookDetailSource` and `drizzleSeriesDetailSource` render any valid uuid without checking the user tracks it. Both carry an excellent comment saying exactly this and what must change when auth lands (`src/lib/book-detail.ts:47`, `src/lib/series-detail.ts:104`). Correctly handled. Noted so it stays on the auth checklist: it is an IDOR the moment `getCurrentUserId` returns something real.

**E4. `/api/search` has no rate limiting or caching.** Every settled keystroke fans out to four providers. Hardcover's documented limit is 60/min on a personal token the spec notes is explicitly not for sharing. No cache layer (`provider_records` is the natural home, see B4), no per-IP limit. Behind the gate this is a single-user concern; it is the first thing that breaks if the gate is lifted.

---

## F. Performance and the data layer

**F1. Query counts.** `persistResolvedBook` is ~12 statements plus 3 per author. `discoverSeriesEntries` calls it once per entry, sequentially, **inside the POST the user is waiting on** (`src/app/api/track/route.ts:55`). A 15-book series is roughly 200 round trips plus provider latency, with the button disabled and no progress indication. The `try/catch` correctly prevents provider failure from killing the track, but nothing retries or resumes, so a blip leaves the series permanently half-discovered until M3. `after()` from `next/server` moves this off the response path.

**F2. `lastSeriesReleaseAt` is re-derived up to three times per Library render.** `trackedBooks` and `trackedSeries` each run their own `max(releases.date)` aggregate over the same series set (`src/lib/shelf.ts:120`), and `/library` calls `loadShelf` **and** `trackedSeries` again (`src/app/library/page.tsx:23`). The comment justifying extra round trips is fair for one user; the design target is 300 items and this scales with tracked series on every page view.

**F3. No caching or revalidation.** All four data routes are `force-dynamic`, each with a well-reasoned comment citing the Next docs. Correct for correctness, and it means every navigation is a full DB round trip. Once M3 makes data change on a schedule, `revalidateTag` on the refresh job fits better than forcing dynamic everywhere.

**F4. Missing index on `books.series_id`.** Queried with `inArray` in four places, joined in three, no index (`catalog.ts` indexes only `releases`, `change_log`, `external_ids`). On the hot path of every shelf and library render.

---

## G. Design system, accessibility, UX

**G1. The search route is off-system.** `SearchBox`, `SearchResult`, `TrackPrompt` predate the token layer and were never migrated. Raw Tailwind throughout, most visibly **`text-red-600`** (`src/components/SearchBox.tsx:206`), a colour outside the seven-token palette, violating the spec's constraint that colour only reinforces what the rule and column already state. `SearchResult` also names typefaces directly (`font-[family-name:var(--font-newsreader)]`), the exact coupling `--font-display` was created to prevent (`src/app/globals.css:35`). Every M2 component gets this right; the three M1 components do not. A lint rule banning raw colour utilities would pin it.

**G2. `aria-live="polite"` on the results list is too loud.** `src/components/SearchBox.tsx:141` puts it on the `<ul>` of every result, so a screen reader re-announces the whole list on each settled keystroke. Conventional pattern is a visually-hidden status region announcing a count. There is already a separate live region for "Searching..." two lines above, so a user currently gets both.

**G3. Library's metadata renders outside the row it describes.** `LibraryGrid` places "Series complete" and read-state labels as siblings *after* `<ShelfRow>`, not inside it (`src/components/library/LibraryGrid.tsx:56-66`). They inherit no grid placement and appear as loose text below each row. A consequence of the four-slot contract being genuinely closed, which is the right call; the answer is a fifth slot or a wrapper, not orphaned spans.

**G4. The manual form is unannounced and its success is silent.** When a search settles empty, `SearchBox` mounts a five-field form (`src/components/SearchBox.tsx:85`) with focus left in the search input and nothing announcing it. On success the form unmounts and the query clears, with no confirmation and no navigation, so the user cannot tell whether it worked.

**G5. No `loading.tsx` or `error.tsx` anywhere.** Four `force-dynamic` routes awaiting Postgres; a Neon cold start or failed query yields Next's default error page. The shelf especially, since it is the four-second-scan screen.

**G6. Genuinely good, worth not regressing.** `:focus-visible` rings using `verdigris` at 2px with offset, plus a full `prefers-reduced-motion` block (`src/app/globals.css:66-88`). `StatusRule` carries a text label for all eight states via `aria-label` + `role="img"`, and its exhaustive switch makes a ninth state a compile error. `Gap` is `aria-hidden` with a documented reason. The `OPACITY` / `RUMORED_OPACITY` split has a real explanation (two equal-specificity Tailwind utilities resolve by stylesheet order, not class order) that most codebases get wrong.

---

## H. Repo and tooling

- **README.md is 2 bytes.** No setup steps, no env var list, no "run migrations first."
- **No `typecheck` script**, and none in CI. See D3.
- `tsconfig.tsbuildinfo` (385 KB) and `test-results/` are on disk; confirm both are gitignored.
- `target: "ES2017"` against Node 22 and Next 16 downlevels async/await for no reason.
- CI has no concurrency group, so pushing twice to a PR runs two full pipelines including a Playwright browser install.

---

## I. Recommended sequence

**Tier 1, correctness the user will see.** A1 first: the one bug guaranteed to appear on first real use, fixed with a filter, a horizon branch, and the two tests that should have caught it. Then A2 and A3 together: the same defect in two adapters, undermining the product's central honesty claim, contained to two mapping functions.

**Tier 2, stop the bleeding in tooling.** Add `tsc --noEmit` to CI and clear the 13 errors (D3). Regenerate drizzle snapshots before anyone touches the schema (A9). Add a coverage threshold on `src/lib/**` (D5). Roughly an hour, and it prevents recurrence of D1 and A9 mechanically rather than by vigilance.

**Tier 3, one focused pass on `persistResolvedBook`.** A8 (transaction around delete/insert), F1 (discovery off the request path), and the batched author upsert all touch the same function. Together it is one restructure; separately it is three. Also the natural moment to add the `change_log` write M3 needs, since it requires the same read-before-write shape.

**Tier 4, before the gate ever comes off.** E1 (validate the two write routes, using `isReadStateValue` as the model), A7 (one regex on the QID), E2 (fail closed in production), and a decision on A10 (wire RLS properly, or delete the migration and say why).

**Tier 5, finish M2 honestly.** Tasks 18 and 19. The plan already specifies the seeding strategy in full, so this is execution rather than design, and it is the only thing between the current state and M2 meeting its own Definition of Done.
