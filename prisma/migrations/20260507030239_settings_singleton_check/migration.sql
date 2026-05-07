-- Defensive: ensure the Settings table never holds more than one row.
-- The application code already uses upsert with id='singleton'; this CHECK
-- backs that up at the DB level so a stray INSERT with a different id fails.
ALTER TABLE "Settings"
ADD CONSTRAINT "settings_singleton_check" CHECK (id = 'singleton');
