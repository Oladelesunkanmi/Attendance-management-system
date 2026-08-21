-- Add minimum attendance percentage threshold to courses
-- Run this in the Supabase SQL Editor or via supabase db push

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS min_attendance_pct integer NOT NULL DEFAULT 75
  CHECK (min_attendance_pct BETWEEN 1 AND 100);

COMMENT ON COLUMN courses.min_attendance_pct IS
  'Minimum attendance percentage (1-100) required for a student to pass this course.';
