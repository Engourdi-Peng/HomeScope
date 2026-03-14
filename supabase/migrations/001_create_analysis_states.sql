-- Create table to store analysis states for polling
CREATE TABLE IF NOT EXISTS analysis_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT NOT NULL DEFAULT 'upload_received',
  message TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_analysis_states_created_at ON analysis_states(created_at DESC);

-- Enable Row Level Security
ALTER TABLE analysis_states ENABLE ROW LEVEL SECURITY;

-- Allow public read/write (since we're using anon key)
CREATE POLICY "Allow public access to analysis_states" ON analysis_states
  FOR ALL USING (true);
