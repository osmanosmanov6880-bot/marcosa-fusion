-- MARCOSA R10: REVIEW-ONLY SQL PROPOSAL. NOT APPLIED TO ANY DATABASE.
-- Requires a freshly selected, isolated Supabase project and manual SQL review.
-- Do NOT paste into production or expose service_role credentials to public JS.
-- Based on Supabase RLS / Data API grant guidance, checked 2026-10-24.
--
-- Author privileges: their own private project titles, immutable story revisions,
-- and immutable review requests. NO author/moderator publishing API is created.
-- Decisions are private, exclusively managed by a trusted server-side service.
-- This is not a deployed moderation queue or a legal approval process.

begin;

create schema if not exists marcosa_private;
revoke all on schema marcosa_private from public, anon, authenticated;
grant usage on schema marcosa_private to service_role;

create table if not exists public.marcosa_cloud_projects_r10 (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default (select auth.uid()) references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 4 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.marcosa_cloud_revisions_r10 (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null default (select auth.uid()),
  revision_number integer not null check (revision_number between 1 and 10000),
  story jsonb not null check (
    jsonb_typeof(story)='object'
    and story->>'schema'='marcosa-original-story/v1'
    and story->>'status'='draft_only'
    and story->>'publication_state'='not_published'
    and story->>'rights_independently_verified'='false'
    and story->>'manual_approval'='false'
    and story->>'tracking'='false'
    and story->>'payments'='false'
    and jsonb_typeof(story->'opening')='object'
    and jsonb_typeof(story->'branches')='array'
    and jsonb_array_length(story->'branches')=2
    and jsonb_typeof(story->'endings')='array'
    and jsonb_array_length(story->'endings')=4
    and octet_length(story::text) <= 131072
  ),
  created_at timestamptz not null default now(),
  foreign key (project_id,owner_id)
    references public.marcosa_cloud_projects_r10 (id,owner_id) on delete restrict,
  unique (project_id,revision_number),
  unique (id,project_id,owner_id)
);

create table if not exists public.marcosa_review_submissions_r10 (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  revision_id uuid not null,
  owner_id uuid not null default (select auth.uid()),
  self_checklist jsonb not null check (
    self_checklist = '{"authorship":true,"sponsorship":true,"editorial":true,"privacy":true}'::jsonb
  ),
  submitted_at timestamptz not null default now(),
  foreign key (revision_id,project_id,owner_id)
    references public.marcosa_cloud_revisions_r10 (id,project_id,owner_id) on delete restrict
);

-- SECURITY BOUNDARY: independent review is not a browser-updatable column.
-- No public Data API grants, no SECURITY DEFINER function, no publish endpoint.
create table if not exists marcosa_private.marcosa_moderation_decisions_r10 (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.marcosa_review_submissions_r10(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','changes_requested','rejected')),
  rationale text not null check (char_length(trim(rationale)) between 10 and 4000),
  decided_at timestamptz not null default now()
);

-- Deny public access first, then apply least-privilege column grants.
revoke all on table public.marcosa_cloud_projects_r10 from public, anon, authenticated;
revoke all on table public.marcosa_cloud_revisions_r10 from public, anon, authenticated;
revoke all on table public.marcosa_review_submissions_r10 from public, anon, authenticated;
revoke all on table marcosa_private.marcosa_moderation_decisions_r10 from public, anon, authenticated;

grant select on public.marcosa_cloud_projects_r10 to authenticated;
grant insert (title) on public.marcosa_cloud_projects_r10 to authenticated;
grant update (title) on public.marcosa_cloud_projects_r10 to authenticated;

grant select on public.marcosa_cloud_revisions_r10 to authenticated;
grant insert (project_id,revision_number,story) on public.marcosa_cloud_revisions_r10 to authenticated;

grant select on public.marcosa_review_submissions_r10 to authenticated;
grant insert (project_id,revision_id,self_checklist)
  on public.marcosa_review_submissions_r10 to authenticated;

grant all on table marcosa_private.marcosa_moderation_decisions_r10 to service_role;

alter table public.marcosa_cloud_projects_r10 enable row level security;
alter table public.marcosa_cloud_revisions_r10 enable row level security;
alter table public.marcosa_review_submissions_r10 enable row level security;
alter table marcosa_private.marcosa_moderation_decisions_r10 enable row level security;

-- Important: anonymous Supabase Auth sessions may have Postgres role authenticated.
-- Reject those users explicitly in every owner policy.
create policy r10_owner_project_select
  on public.marcosa_cloud_projects_r10 for select to authenticated
  using (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  );
create policy r10_owner_project_insert
  on public.marcosa_cloud_projects_r10 for insert to authenticated
  with check (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  );
create policy r10_owner_project_update
  on public.marcosa_cloud_projects_r10 for update to authenticated
  using (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  )
  with check (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  );

create policy r10_owner_revision_select
  on public.marcosa_cloud_revisions_r10 for select to authenticated
  using (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  );
create policy r10_owner_revision_insert
  on public.marcosa_cloud_revisions_r10 for insert to authenticated
  with check (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  );

create policy r10_owner_submission_select
  on public.marcosa_review_submissions_r10 for select to authenticated
  using (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  );
create policy r10_owner_submission_insert
  on public.marcosa_review_submissions_r10 for insert to authenticated
  with check (
    owner_id=(select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
  );

-- No policies on the private moderation table means fail-closed for ordinary users.
-- service_role remains usable ONLY inside a trusted server-side deployment.
-- Before any live production application:
--  1) verify grants & RLS via two actual authenticated test accounts;
--  2) test cross-owner SELECT, INSERT, UPDATE, and anonymous sessions;
--  3) use a private moderation API for staff identity, logging and approvals;
--  4) implement independent publication gate (not provided in R10);
--  5) plan user deletion, backups, encryption, retention and incident response.

commit;
