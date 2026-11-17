-- the outbox is also the send queue. with CUSTOCK_TRANSPORT=live the worker sends unsent rows
-- through FCM and SMTP and marks them. in outbox mode (the default) rows only pile up for reading.
ALTER TABLE dev_outbox ADD COLUMN sent_at INTEGER;
ALTER TABLE dev_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dev_outbox ADD COLUMN last_error TEXT;
CREATE INDEX dev_outbox_unsent ON dev_outbox(sent_at, created_at);
