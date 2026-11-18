-- "show prices in offers": with prices hidden on the shop page, an offer still shows its own price
-- and the lowest price of the last 30 days only when the business allows it (on by default, as before)
ALTER TABLE organizations ADD COLUMN customer_offer_prices INTEGER NOT NULL DEFAULT 1;
