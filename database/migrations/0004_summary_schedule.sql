-- Preserve existing automatic summaries. Retain this additive column on rollback;
-- older Workers ignore this toggle, so pause Cron before rolling back the Worker.
ALTER TABLE sites ADD COLUMN auto_summary_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (auto_summary_enabled IN (0, 1));
