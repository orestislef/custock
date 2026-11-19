-- one browser, one session: the web app keeps a random device id and sends it when it signs in.
-- a new sign in from the same browser ends the session it had before, so a lost token does not
-- leave an old session counted as another device for a month
ALTER TABLE sessions ADD COLUMN device_id TEXT;
CREATE INDEX sessions_user_device ON sessions (user_id, device_id);
