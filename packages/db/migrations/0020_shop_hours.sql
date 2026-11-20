-- opening hours per shop (packages/core/src/hours.ts) live in the opening_hours column that
-- 0001 made and nothing used: {"week":{"mon":[{"from":"15:00","to":"20:00"}],...},"note":null}.
-- values in an earlier draft shape are cleared, so every stored value reads with the new one
UPDATE shops SET opening_hours = NULL WHERE opening_hours IS NOT NULL AND json_valid(opening_hours) AND json_type(opening_hours, '$.week') IS NOT 'object';
UPDATE shops SET opening_hours = NULL WHERE opening_hours IS NOT NULL AND NOT json_valid(opening_hours);
