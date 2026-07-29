ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE read_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tracks_owner ON tracks
  USING (user_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY read_states_owner ON read_states
  USING (user_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY notification_prefs_owner ON notification_prefs
  USING (user_id = current_setting('app.user_id', true)::uuid);
