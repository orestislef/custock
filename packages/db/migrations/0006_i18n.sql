-- category names in the other languages, like product_translations. the org default language
-- stays in categories.name.
CREATE TABLE category_translations (
  category_id  TEXT NOT NULL REFERENCES categories(id),
  locale       TEXT NOT NULL CHECK (locale IN ('en','el','ru')),
  name         TEXT NOT NULL,
  PRIMARY KEY (category_id, locale)
);
