-- =====================================================================
-- Deutsch Meister — Supabase Database Schema, Private Storage & RLS SQL
-- Run this entire script in: Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================

-- 1. Saved German Texts & Uploaded Document References
create table if not exists public.saved_texts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null,
  author_info text not null default '',
  level text not null default 'A2',
  german_text text not null,
  sentences jsonb not null default '[]'::jsonb,
  arabic_summary text not null default '',
  key_vocabulary jsonb not null default '[]'::jsonb,
  word_count integer not null default 0,
  style text not null default 'Custom Text',
  topic text not null default '',
  is_favorite boolean not null default false,
  last_read_sentence_index integer not null default 0,
  storage_path text,
  file_name text,
  file_size integer,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists idx_saved_texts_user_created
  on public.saved_texts (user_id, created_at desc);

alter table public.saved_texts enable row level security;

drop policy if exists "Users can view their own saved_texts" on public.saved_texts;
create policy "Users can view their own saved_texts"
  on public.saved_texts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own saved_texts" on public.saved_texts;
create policy "Users can insert their own saved_texts"
  on public.saved_texts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own saved_texts" on public.saved_texts;
create policy "Users can update their own saved_texts"
  on public.saved_texts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own saved_texts" on public.saved_texts;
create policy "Users can delete their own saved_texts"
  on public.saved_texts
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 2. Saved Vocabulary & Flashcards
create table if not exists public.saved_vocabulary (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  german_word text not null,
  article text,
  plural text,
  arabic_meaning text not null,
  ipa text,
  arabic_pronunciation text,
  part_of_speech text,
  example_german text,
  example_arabic text,
  level text not null default 'A2',
  date_saved timestamptz not null default now(),
  source_title text,
  mastery text not null default 'learning',
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists idx_saved_vocabulary_user_date
  on public.saved_vocabulary (user_id, date_saved desc);

alter table public.saved_vocabulary enable row level security;

drop policy if exists "Users can view their own saved_vocabulary" on public.saved_vocabulary;
create policy "Users can view their own saved_vocabulary"
  on public.saved_vocabulary
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own saved_vocabulary" on public.saved_vocabulary;
create policy "Users can insert their own saved_vocabulary"
  on public.saved_vocabulary
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own saved_vocabulary" on public.saved_vocabulary;
create policy "Users can update their own saved_vocabulary"
  on public.saved_vocabulary
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own saved_vocabulary" on public.saved_vocabulary;
create policy "Users can delete their own saved_vocabulary"
  on public.saved_vocabulary
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3. Reading History (Per-text sentence progress across devices)
create table if not exists public.reading_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  text_id text not null,
  title text not null,
  level text not null default 'A2',
  last_sentence_index integer not null default 0,
  total_sentences integer not null default 0,
  last_read_at timestamptz not null default now(),
  primary key (user_id, text_id)
);

create index if not exists idx_reading_history_user_last_read
  on public.reading_history (user_id, last_read_at desc);

alter table public.reading_history enable row level security;

drop policy if exists "Users can view their own reading_history" on public.reading_history;
create policy "Users can view their own reading_history"
  on public.reading_history
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own reading_history" on public.reading_history;
create policy "Users can insert their own reading_history"
  on public.reading_history
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own reading_history" on public.reading_history;
create policy "Users can update their own reading_history"
  on public.reading_history
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own reading_history" on public.reading_history;
create policy "Users can delete their own reading_history"
  on public.reading_history
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. User Settings, Active Text & Listening Stats
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{"totalMinutesListened":0,"sentencesRead":0,"wordsLookedUp":0,"textsCompleted":0}'::jsonb,
  active_text_id text,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users can view their own user_settings" on public.user_settings;
create policy "Users can view their own user_settings"
  on public.user_settings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own user_settings" on public.user_settings;
create policy "Users can insert their own user_settings"
  on public.user_settings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own user_settings" on public.user_settings;
create policy "Users can update their own user_settings"
  on public.user_settings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own user_settings" on public.user_settings;
create policy "Users can delete their own user_settings"
  on public.user_settings
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5. Private Storage Bucket `german-learning` & User-Scoped Storage RLS Policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'german-learning',
  'german-learning',
  false,
  26214400, -- 25 MB max per document
  array[
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400;

drop policy if exists "Authenticated users can list/read own files in german-learning" on storage.objects;
create policy "Authenticated users can list/read own files in german-learning"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'german-learning'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Authenticated users can upload own files to german-learning" on storage.objects;
create policy "Authenticated users can upload own files to german-learning"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'german-learning'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Authenticated users can update own files in german-learning" on storage.objects;
create policy "Authenticated users can update own files in german-learning"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'german-learning'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'german-learning'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Authenticated users can delete own files from german-learning" on storage.objects;
create policy "Authenticated users can delete own files from german-learning"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'german-learning'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
