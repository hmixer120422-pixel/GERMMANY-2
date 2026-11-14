-- =====================================================================
-- Deutsch Meister — Update existing `german-learning` Storage Bucket
-- Adds full support for MP3, WAV, M4A, OGG, WEBM, AAC, and FLAC audio
-- without creating any duplicate bucket.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'german-learning',
  'german-learning',
  false,
  26214400, -- 25 MB max per file
  array[
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/x-m4a',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
    'audio/flac',
    'audio/x-flac',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = excluded.allowed_mime_types;
