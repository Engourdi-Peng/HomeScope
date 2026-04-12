-- Migration: 008_add_report_mode
-- Description: Add report_mode column to support both rental and sale analysis modes
-- Date: 2026-04-08

-- Add report_mode column to analyses table
ALTER TABLE analyses ADD COLUMN report_mode TEXT NOT NULL DEFAULT 'rent'
  CHECK (report_mode IN ('rent', 'sale'));

-- Add report_mode column to analysis_states table
ALTER TABLE analysis_states ADD COLUMN report_mode TEXT NOT NULL DEFAULT 'rent';

-- Index for filtering by report mode
CREATE INDEX idx_analyses_report_mode ON analyses(report_mode);
CREATE INDEX idx_analysis_states_report_mode ON analysis_states(report_mode);

-- Backfill existing records with 'rent' as default (they are all rental analyses)
UPDATE analyses SET report_mode = 'rent' WHERE report_mode IS NULL;
UPDATE analysis_states SET report_mode = 'rent' WHERE report_mode IS NULL;
