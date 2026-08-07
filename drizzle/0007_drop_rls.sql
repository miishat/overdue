-- Removes the row-level security added by 0001_rls.sql, which enforced
-- nothing and read as protection that was not there.
--
-- Why it never worked. The policies keyed on
-- current_setting('app.user_id', true)::uuid, and nothing in the application
-- has ever set app.user_id. Even if something did, the app talks to Postgres
-- over neon-http, which is stateless per statement: a SET would not survive
-- to the next query. On top of that the policies had no WITH CHECK, so writes
-- would have been unconstrained even had they been active, and USING without
-- FOR covers SELECT, UPDATE and DELETE but not INSERT. The app worked only
-- because the connection role owns these tables and bypasses RLS entirely.
--
-- Why remove rather than repair. Making RLS real means moving off neon-http
-- to a pooled per-request connection so app.user_id can be set and held for
-- the life of a transaction. neon-http was chosen deliberately, and there is
-- no auth in v1: identity is a single seeded user behind getCurrentUserId().
-- The access control that actually runs today is the explicit eq(userId)
-- filter every query already carries, and that is honest about what it is.
--
-- What this costs, stated plainly. There is now no database-level backstop
-- if one of those eq(userId) filters is ever dropped. That is the trade, and
-- it is the right one only while there is one user. Reinstating RLS is on the
-- checklist for whenever getCurrentUserId starts returning something real,
-- alongside the object-scoping gap already documented in
-- src/lib/book-detail.ts and src/lib/series-detail.ts.
--
-- Audit finding A10, docs/audits/2026-07-30-full-audit.md.

DROP POLICY IF EXISTS tracks_owner ON tracks;
DROP POLICY IF EXISTS read_states_owner ON read_states;
DROP POLICY IF EXISTS notification_prefs_owner ON notification_prefs;

ALTER TABLE tracks DISABLE ROW LEVEL SECURITY;
ALTER TABLE read_states DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs DISABLE ROW LEVEL SECURITY;
