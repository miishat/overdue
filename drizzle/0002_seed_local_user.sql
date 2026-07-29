-- v1 is single-user with no login. One row, fixed id, so tracks.user_id
-- and read_states.user_id have a real referent. ON CONFLICT makes this
-- migration safe to re-run.
INSERT INTO users (id, email, timezone, region)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'local@overdue.invalid',
  'UTC',
  'US'
)
ON CONFLICT (id) DO NOTHING;
