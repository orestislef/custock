-- who sees the business's posts (news, offers, events) on its shop page: the people who follow it
-- (the default), or everyone, like a catalog that is open to everyone (policy catalog.news)
ALTER TABLE organizations ADD COLUMN customer_news TEXT NOT NULL DEFAULT 'followers' CHECK (customer_news IN ('followers', 'everyone'));
