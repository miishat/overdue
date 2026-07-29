# Overdue: Design Spec

**Date:** 2026-07-28
**Status:** Approved, ready for planning
**Working name:** Overdue

---

## 1. Product thesis

A tracker for readers waiting on books. The user adds a series or a standalone author/book, and the app reports what is coming and when, including the honest and messy states: confirmed date, "Fall 2027", announced with no date, rumoured, nothing announced, series finished, author silent for six years.

The emotional job is ending the tab-hoarding ritual, where a reader manually checks Goodreads, an author's blog and a publisher catalogue to find out whether book four exists yet.

The name is deliberate. "Overdue" is affectionate about the actual experience: the book that should have arrived years ago. It also earns the `HIATUS` state rather than treating it as an edge case.

### Audience and scale

Single user in practice. Multi-tenant in the schema: real `user_id` foreign keys and row-level security from day one, so opening it to a trusted group or the public later is a deployment decision rather than a rewrite.

Consequences of this choice:
- No signup funnel. One account, magic-link auth.
- No moderation infrastructure. The manual layer is trusted input with an audit trail.
- Provider rate limits are not an engineering problem at this scale.
- Hardcover's API token is scoped to a personal account and is explicitly not for sharing. This is fine for single-user and is a hard blocker on public multi-tenancy. Noted as a tripwire, not a v1 problem.

---

## 2. Scope

### In scope for v1

- Search and add a book or series, with automatic recognition of series membership
- Track a whole series (all future entries) or a single standalone/author
- Release status tracking with honest confidence levels and per-field provenance
- Notifications: release day, ahead of release, new announcement, and date change
- Per-book read state, so "what is already out that I have not read" is answerable
- Installable on phone and desktop, browsable offline for already-tracked items
- Goodreads CSV import
- Three switchable visual themes

### Out of scope for v1

Not built, but not architected out of: social feed, reviews and ratings, reading progress and page tracking, recommendations, book club features, purchase links and affiliate integration.

### Explicitly dropped

**Natural-language "the one with the ice dragon" search.** No book API supports semantic search; they are keyword indexes. Rather than ship something that fails unpredictably, typeahead handles partial titles and authors, and a zero-result query routes to manual entry. Decided rather than discovered.

---

## 3. Decisions

| Decision | Resolution | Reasoning |
|---|---|---|
| Name | Overdue | Has a point of view about the actual emotional experience |
| Providers, M1 | Hardcover, Open Library, Google Books, Wikidata, plus manual layer | Wikidata pulled forward from M2 so the resolution layer is genuinely field-level from the start rather than a single-provider wrapper |
| Providers, deferred | Penguin Random House | Developer docs appear stale (nothing newer than roughly 2019 surfaced). Build the seam, not the adapter |
| Blog/RSS scraping | Not doing it | Fragile and high-maintenance. A manual entry with a pasted `source_url` gets the same honesty for none of the cost |
| Database | Neon Postgres | Supabase free pauses the entire project after 7 days of low activity (tightened Feb 2026) and requires a manual dashboard unpause. That is a silent outage of the core feature. Neon scales compute to zero and wakes in milliseconds without ever pausing the project |
| Auth | None in v1. A single seeded local user behind `getCurrentUserId()` | Revised 2026-07-28. Magic link meant running an email service to log one person in. Identity stays a single choke point so real auth is a one-file change, and `user_id` foreign keys remain intact so multi-user expansion is unaffected. Open risk: a public deployment with no auth leaves `/api/search` as an open proxy to the rate-limited Hardcover token, so Task 5 must gate the deployment |
| Email | Dropped entirely | Revised 2026-07-28. No Resend, no email notifications. Accepted risk stated below |
| Scheduling | GitHub Actions cron | Vercel Hobby caps cron at once per day, firing anywhere within the scheduled hour. GitHub Actions is free and finer-grained, which the instant date-change alert requires |
| Notifications | Daily digest, plus instant alert on date change | Digest respects the batch cadence honestly. Date change is the signature alert and earns its own delivery |
| Capacitor | No | User is on iOS, but add-to-home-screen plus web push on iOS 16.4+ covers it. Capacitor costs an Apple Developer account, signing, and a build pipeline. Tripwire for revisiting: opening the app to other users and measuring iOS push failure |
| Design direction | Imprint typography as chrome, departure-board column logic on the Waiting Shelf, stamp vernacular confined to provenance | Only direction that satisfies "chrome quiet enough to hold a 6x4 grid of clashing covers" while preserving four-second scanning |
| Themes | Three, switchable. Default ships M2, alternates ship M5 | Token architecture is needed for light/dark regardless. Deferring the alternates means Waiting Shelf rework is paid for once, not three times |

---

## 4. Architecture

### Stack

- **Next.js (App Router) + TypeScript**, deployed on Vercel
- **Neon Postgres**, accessed via Drizzle ORM
- **No auth library.** Identity is `getCurrentUserId()` returning a fixed seeded user id
- **Tailwind**, no shadcn/ui. Default shadcn is recognisable on sight and would undercut the design direction; the component surface here is small enough that restyling it thoroughly costs more than writing it
- **Serwist** for the service worker
- **web-push** with VAPID keys. No email service
- **GitHub Actions** scheduled workflow hitting an authenticated refresh route

### The provider layer

The data is the product. Every source will be wrong, stale or missing something, so the architecture makes swapping or adding a source a contained change.

```
MetadataProvider (interface)
  searchBooks(query)        -> ProviderBook[]
  getBook(externalId)       -> ProviderBook
  getSeries(externalId)     -> ProviderSeries
  getSeriesEntries(id)      -> ProviderBook[]

Implementations: HardcoverProvider, OpenLibraryProvider,
                 GoogleBooksProvider, WikidataProvider, ManualProvider
```

Each adapter returns provider-shaped data with its own external IDs. Adapters never write to domain tables and never know about each other.

**Hardcover constraint:** GraphQL max query depth is 3 at 60 requests/minute. Series to books to editions cannot be one query. The adapter performs a multi-hop fetch and is written to expect this rather than working around it later.

### Resolution layer

Providers seed; Postgres owns. Our database is the source of truth. If Hardcover shuts down, the app still works.

Resolution merges at the **field** level, not the record level. Each field has its own trust ordering:

Manual is omitted from the table below because it outranks every provider on every field, permanently and without exception. Read each row as implicitly prefixed by `Manual >`.

| Field | Trust order (highest first) |
|---|---|
| Series membership | Hardcover > Wikidata > Open Library |
| Series ordinal | Hardcover > Wikidata (never Google) |
| Series status / planned length | Wikidata > Hardcover |
| Title, authors | Hardcover > Open Library > Wikidata > Google |
| Cover | Open Library > Hardcover > Google |
| ISBN | Open Library > Google > Hardcover |
| Description | Google > Hardcover > Open Library |
| Release date, already released | Open Library > Google > Hardcover |
| Release date, forthcoming | Wikidata > Hardcover > Google |
| Announced-but-undated existence | Wikidata > Hardcover |

Confidence for a resolved field is derived from three inputs: trust rank of the winning source, agreement across sources, and recency of `last_verified_at`. Disagreement lowers confidence rather than being hidden.

### Refresh and change detection

A scheduled job runs on GitHub Actions, hits an authenticated route, and for each tracked item:

1. Re-queries the relevant providers
2. Re-runs resolution
3. Diffs against current state
4. Writes every difference to `ChangeLog` (append-only)
5. Enqueues notifications

The job is **idempotent and sliceable**: it processes a bounded slice per run and can be re-run safely. This matters because scheduled runs on free tiers are best-effort and may be delayed or skipped.

---

## 5. Data model

Refined from the brief's sketch. Six changes, all listed with reasoning.

### Core entities

**`User`** id, email, timezone, region, format_preference, theme, created_at

**`Author`** id, name, sort_name, created_at

**`Series`** id, title, status (`ongoing` | `complete` | `hiatus`), planned_length (nullable), created_at

**`Book`** id, title, series_id (nullable), series_position (decimal, so novellas are 2.5), cover_url, description, created_at

**`BookAuthor`** book_id, author_id, position
> **Change 1.** Junction table rather than an `authors` column on `Book`. Co-authorship is common enough that a column will hurt.

**`ExternalId`** entity_type, entity_id, provider, external_id, created_at
> **Change 2, the most important addition.** The same book is simultaneously `hardcover:12345`, `openlibrary:OL123W`, `wikidata:Q456` and `google:abc`. Without an identity table you cannot merge four providers or re-fetch anything. Every part of the provider architecture depends on this existing.

**`Release`** id, book_id, region, format, date (nullable), date_precision, status, confidence, created_at, updated_at
> **Change 3.** `date_precision` is an enum: `day` | `month` | `quarter` | `season` | `year`. "Fall 2027" stores as `2027-09-01` with precision `season`. This is what lets `ESTIMATED` items sort into the same timeline as `DATED` ones. Without it the Waiting Shelf cannot order its own contents.

Region and format are modelled from day one (US/UK dates routinely differ by months; paperback typically lags hardcover by around a year). v1 **writes** only the pair matching the user's `region` setting and a `format` of `hardcover`, treating that as the canonical release. It **displays** any additional region/format rows that providers happen to return, but does not seek them out. The shape exists so no migration is needed later.

**`ReleaseSource`** id, release_id, provider, source_url, value_seen, last_verified_at, trust_rank
> **Change 4.** `Release` is what we believe; `ReleaseSource` is each provider's individual claim. Four providers will disagree, and collapsing to one source per release throws away the disagreement, which is exactly the information that makes the app honest.

**`Track`** id, user_id, series_id (nullable), book_id (nullable), created_at
> **Change 5.** Nullable pair with a `CHECK` constraint enforcing exactly one of the two, rather than a polymorphic type-string pair. Keeps real foreign keys and referential integrity.

**`ReadState`** user_id, book_id, state (`want` | `reading` | `read` | `skipped`), changed_at
> Renamed from `rated_at`, since ratings are out of scope.

**`NotificationPref`** user_id, track_id (nullable, for per-track overrides), channel, lead_days, enabled

**`ChangeLog`** id, entity_type, entity_id, field, old_value, new_value, provider, observed_at
> Append-only, never updated. Powers date-change notifications and the per-book history view. Cheap now, impossible to reconstruct later.

**`ProviderRecord`** provider, external_id, payload (jsonb), fetched_at
> Caches raw provider responses so resolution can be re-run and debugged without re-fetching.

### Change 6: `EXPECTED` entries are generated at read time

"Book 5 of an ongoing series" is not a book yet. Writing placeholder rows into `Book` would poison search, Goodreads import, and read state. The Waiting Shelf synthesises these entries when rendering, from series status and the highest known ordinal.

---

## 6. The status system

Release status is an enum, not a date field. This is the most important modelling decision in the app.

| Status | Meaning |
|---|---|
| `RELEASED` | Out now |
| `DATED` | Confirmed specific future date |
| `ESTIMATED` | Window only, "Fall 2027", "Q3" |
| `ANNOUNCED` | Confirmed to exist, no date at all |
| `RUMORED` | Author or publisher referenced it, nothing official |
| `EXPECTED` | Series ongoing, nothing announced, not finished |
| `HIATUS` | Long gap, no news, stated plainly |
| `COMPLETE` | Series has ended, stop waiting |

### Derivation rules

Status is computed, never stored by hand. Evaluated in order:

1. `Series.status = complete` and no further entries: **`COMPLETE`**
2. Resolved date exists and is in the past: **`RELEASED`**
3. Future date, `date_precision = day`: **`DATED`**
4. Future date, precision `month` | `quarter` | `season` | `year`: **`ESTIMATED`**
5. Book record exists, no date from any source, best source is official (publisher, Hardcover, Wikidata): **`ANNOUNCED`**
6. Book record exists, no date, only unofficial sourcing (author interview, manual entry flagged unofficial): **`RUMORED`**
7. No book record, series ongoing, last release under the hiatus threshold: **`EXPECTED`**
8. No book record, series ongoing, last release over the hiatus threshold: **`HIATUS`**

**Hiatus threshold: 4 years** since the last release in the series with no dated or announced next entry. Configurable per user.

Status derivation is a pure function over resolved data. It gets an exhaustive table test covering all eight states.

---

## 7. Design system

### Palette

Six values plus one reserved alert. Dark is the default; readers use this at night.

| Token | Dark | Light | Role |
|---|---|---|---|
| `ink` | `#0D0E10` | `#F2F3F1` | Page ground |
| `leaf` | `#16181B` | `#FFFFFF` | Raised surface |
| `rule` | `#2B2E33` | `#DCDEDA` | Hairlines, dividers |
| `body` | `#E6E4DF` | `#16181B` | Primary text |
| `quiet` | `#8A8D93` | `#6B6F73` | Secondary text, metadata |
| `verdigris` | `#5F8C7D` | `#3F6357` | Provenance stamps, focus rings only |
| `oxide` | `#D99A2B` | `#8A5A12` | Reserved: a date that moved later |

Light mode's `#F2F3F1` carries a green-cool bias, not a yellow-warm one. Set beside the `#F4F1EA` the brief warns against, it reads as archival paper under daylight rather than a coffee-stained paperback.

`oxide` is used for exactly one thing, so it always means something. A date moving **earlier** is good news and renders in `verdigris`, same mechanism, opposite feeling.

### Typefaces

- **Display: Newsreader.** Variable with a true optical-size axis, so a 26px title and a 13px one are different drawings rather than one scaled. Low-contrast and sturdy, deliberately not the high-contrast Playfair silhouette that marks the default book-app aesthetic. Acknowledged as the least adventurous choice on the board, justified as referential (real book titles are set in serif) rather than decorative.
- **Body and UI: Instrument Sans.** Holds up at 11 to 14px across 300 rows. Chosen over Inter specifically because Inter is the default that would undercut the direction.
- **Utility: IBM Plex Mono.** Tabular figures so the date column aligns to the pixel down a long list. Reads as catalogue rather than terminal.

Three families, latin subsets, self-hosted via `next/font`. Roughly 120KB total.

### The status visual language

Eight states solved with a system, not eight badge colours. **Two axes:**

**Certainty, carried by the left rule:**
- Solid: `RELEASED`, `DATED`
- Dashed: `ESTIMATED`
- Dotted: `ANNOUNCED`, `RUMORED` (rumoured is additionally dimmed)
- Absent: `EXPECTED`, `HIATUS`, `COMPLETE`

**Time, carried by the right column:** holds a date, a window, or is honestly empty. `RELEASED` and `DATED` are separated by past versus future.

Rules carry `body` at stepped opacity, not colour. Colour only ever reinforces what the line and the column already state, so the system is colourblind-safe by construction and survives greyscale.

Two disambiguation rules that were weak in the first pass and are now explicit:
- **`HIATUS` always renders elapsed time** in the date column ("14 yrs"). `EXPECTED` never does. This is what separates two states that otherwise share "no rule, blank date".
- **`COMPLETE` never appears on the Waiting Shelf at all.** It lives in Library and Series detail only.

### Signature elements

**The gap.** An unreleased entry renders as a cover-shaped void at correct 2:3 proportions with a hairline dashed edge, not a grey placeholder box. In a series view the user sees the literal shape of what is not there yet. Minimum width 44px; below that density it becomes a solid `leaf` block with a hairline top rule, because a small dashed outline reads as a rendering failure rather than a designed absence.

**The provenance stamp.** A monospace mark beside every date: `PUB · CHK 2d`, `WIKIDATA · CHK 6d`, `AUTHOR · CHK 9d`, `MOVED +6W`. Which source said so, and how long ago we checked. Nothing else in this category shows its working, and this is what makes the app honest where competitors are vague.

### Themes

Three, sharing a single DOM. Each Waiting Shelf row has the same four slots (cover, identity, status, date); each theme's CSS decides whether status gets its own column, a border treatment, or is absorbed into the date. This is a `grid-template-areas` swap, not a component fork. **If any theme ever needs different markup, it is not a theme and the cost goes non-linear.**

| Theme | Schemes | Ships |
|---|---|---|
| Imprint + Signal (default) | Full light and dark | M2 |
| Signal Board | Dark-native, plus a lifted variant | M5 |
| Card Catalog | Light-native, plus a dimmed variant | M5 |

Four real combinations rather than six. Each theme is honest about its nature instead of being forced into a scheme that fights it. This also caps the permanent contrast-check tax on every future component.

### Accessibility

WCAG AA contrast in every theme and scheme, verified per component. Visible keyboard focus using `verdigris` focus rings. `prefers-reduced-motion` respected. Status never communicated by colour alone. Empty states are an invitation to act, not an apology.

---

## 8. Screens

- **Waiting Shelf (home).** Everything the user is waiting on, soonest-known-date first, undated and unknown grouped below. Horizon groups: This month / Next 3 months / Later this year / Dated further out / No date yet / Not announced. A user should open the app, spend four seconds, and know whether anything changed. This is the screen that matters; everything else is support.
- **Library.** Everything tracked. Grid and list views, sort and filter, density toggle. Designed for 300 items, not 12. Virtualised.
- **Series detail.** The full run in order, each entry showing read state and release state, with gaps visible. The shape of the series legible at a glance: what is read, what is out and unread, what is coming.
- **Book detail.** Cover, metadata, all known release records with provenance, change history from `ChangeLog`, notes.
- **Search / Add.** The recognition flow, below.
- **Settings.** Notifications, region, format preference, theme, import/export.

### The recognition flow

1. User types anything: partial title, author.
2. Debounced typeahead. Results show cover, title, author, and **series badge with position** ("Book 2 of 5"). The series context is the differentiator and is not buried.
3. On select, if the book belongs to a series, immediately offer the higher-intent action: "This is part of [Series]. Track the whole series?" with a secondary option to track just this book. **Defaults to tracking the series.**
4. If tracking a series, the app owns discovering new entries. The user never adds book five manually.
5. Failure handling: ambiguous match gives a disambiguation list; no match lets them create a manual entry with title, author, notes and an optional `source_url`. The app is never a dead end.

---

## 9. Responsive

Mobile and desktop are first-class layouts sharing components, not one layout with breakpoints bolted on. Container queries are preferred over viewport media queries for components appearing in multiple contexts.

- **Mobile.** Bottom tab bar, maximum four destinations (Shelf, Library, Search, Settings). Primary actions in thumb reach. Detail views as sheets. Swipe gestures for mark-read and dismiss. Tested one-handed.
- **Tablet.** Two-column, treated as its own case rather than an afterthought.
- **Desktop.** Persistent sidebar, master-detail so the user can move through a series without losing context. Hover states. Keyboard shortcuts: `/` to search, `j`/`k` to move, `Esc` to close. Explicitly not a phone layout centred in a 1400px window.

---

## 10. PWA and notifications

Proper PWA: web app manifest, maskable icons, service worker with an offline shell, cached covers and tracked-library data readable offline.

### iOS constraints, designed around rather than discovered

- Web push works on iOS only for PWAs added to the home screen, and only on iOS 16.4+.
- There is no `beforeinstallprompt` on iOS, so the install prompt is a hand-built instructional sheet.
- Notification permission must be requested from a real tap **inside** the installed app, not on the website.
- iOS drops push subscriptions if the user deletes and re-adds the home screen icon.
- The install prompt appears only after the user has tracked something. Never on first load.

### Delivery

All release-data refreshing happens server-side on a schedule, never in a client background task.

- **Daily digest** (push): releases today, upcoming within lead time, new announcements. One batched notification rather than several landing at once.
- **Instant alert on date change** (push): the signature alert, delivered on its own. This is why scheduling runs on GitHub Actions rather than Vercel Hobby cron, which is capped at once per day.

### Email is dropped, and what that costs

**Revised 2026-07-28.** The original design made email a first-class fallback. The user chose push-only, so there is no Resend and no email path anywhere in the system.

The accepted risk, stated plainly because it is the failure this app exists to prevent: **when iOS drops the push subscription, it does so silently.** A release date can move and no notification arrives, with no signal that anything is wrong. There is no second channel to catch it.

Two mitigations that cost nothing and should be built in M3 rather than treated as optional:
- The scheduled job records the last successful push per subscription. Settings surfaces subscription health, so a dead subscription is visible rather than invisible.
- The Waiting Shelf marks changed items since last view regardless of whether a notification was delivered, so opening the app always reveals what moved.

This makes the app's own UI the fallback channel instead of email.

Covers are proxied through our own route rather than hot-linked, which avoids CORS issues, keeps provider URLs out of the client, and lets the service worker cache them for offline browsing.

---

## 11. Testing strategy

Test-driven throughout, per `superpowers:test-driven-development`.

- **Provider adapters:** contract tests against recorded fixtures via MSW. CI never hits live APIs. Each adapter has a fixture set including malformed and partial responses, because every source will be wrong or missing something.
- **Resolution layer:** pure functions, heavily unit tested with fixture sets that deliberately disagree. This is where the product's correctness lives.
- **Status derivation:** pure function, exhaustive table test over all eight states plus boundary cases (hiatus threshold, precision transitions, past/future edges).
- **ChangeLog diffing:** unit tested, including no-op runs producing no entries.
- **Notification fan-out:** unit tested with a fake transport. No real sends in tests.
- **E2E (Playwright):** the Waiting Shelf rendering all eight states, and the full add-a-series recognition flow.
- **Accessibility:** automated contrast and focus checks per theme and scheme in CI.

---

## 12. Build order

- **M0.** Scaffolding, auth, data model, deploy pipeline
- **M1.** Search, recognition, series detection, tracking. Four providers plus manual layer. No notifications
- **M2.** The Waiting Shelf and the full status system, plus token architecture and the default theme. This is where the product becomes real; spend time here
- **M3.** Scheduled refresh, change detection, push notifications, plus subscription health surfacing and changed-since-last-view marking as the in-app fallback
- **M4.** PWA install, offline shell, install prompts
- **M5.** Goodreads import, the two alternate themes, density and view options, keyboard shortcuts, polish

Each milestone gets its own implementation plan. M0 and M1 are planned first.

---

## 13. Known risks and tripwires

| Risk | Tripwire | Response |
|---|---|---|
| Hardcover shuts down or restricts the API | Adapter failures in the refresh job | Postgres already owns the data; promote Wikidata in the trust matrix. Contained change by design |
| Hardcover token cannot support multi-user | Opening the app beyond a trusted group | Requires a different primary provider or per-user tokens. Blocker for public launch, not for v1 |
| Free-tier scheduled runs delayed or skipped | Gaps in `ChangeLog` observation timestamps | Job is idempotent and sliceable, so a skipped run self-heals on the next one |
| iOS push subscription silently lost | Gaps between `ChangeLog` entries and delivered notifications | No second channel, since email was dropped. Settings surfaces subscription health and the Shelf marks changed-since-last-view, so the app's own UI is the fallback |
| Public deployment has no authentication | Task 5, before the Vercel URL goes live | `/api/search` is an open proxy to the rate-limited Hardcover token. Gate with Vercel Deployment Protection or a shared-secret cookie before making the deployment public |
| Series data wrong or missing for a niche series | User hits a series the providers do not know | Manual layer, which outranks every provider |
| Waiting Shelf needs structural rework after real use | Living with it post-M2 | Alternate themes deferred to M5 specifically so this is paid for once |

---

## 14. Open items

None blocking. Deferred by decision:

- Penguin Random House adapter (seam exists, adapter unbuilt)
- Regional and format date population beyond the primary pair (shape exists, populated later)
- Capacitor native shell (tripwire documented above)
