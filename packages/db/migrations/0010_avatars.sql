-- a profile photo per person, staff and customers alike. the file lives in the bucket under
-- users/<user>/avatar/<uuid>.webp, the row in files has no business (org_id null).
ALTER TABLE users ADD COLUMN avatar_file_id TEXT REFERENCES files(id);
