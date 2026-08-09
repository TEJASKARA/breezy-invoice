-- Custom expense register and private bill attachments.
-- Run after 202607290002_workspace_data.sql.

create table if not exists public.breezy_expenses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.breezy_entities(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breezy_expenses_user_entity_idx
on public.breezy_expenses(user_id, entity_id);

drop trigger if exists breezy_expenses_set_updated_at on public.breezy_expenses;
create trigger breezy_expenses_set_updated_at before update on public.breezy_expenses
for each row execute function public.set_updated_at();

alter table public.breezy_expenses enable row level security;

drop policy if exists "Users manage their Breezy expenses" on public.breezy_expenses;
create policy "Users manage their Breezy expenses" on public.breezy_expenses
for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.breezy_entities
    where breezy_entities.id = breezy_expenses.entity_id
      and breezy_entities.user_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-bills',
  'expense-bills',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload their own expense bills" on storage.objects;
create policy "Users upload their own expense bills" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'expense-bills'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read their own expense bills" on storage.objects;
create policy "Users read their own expense bills" on storage.objects
for select to authenticated
using (
  bucket_id = 'expense-bills'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete their own expense bills" on storage.objects;
create policy "Users delete their own expense bills" on storage.objects
for delete to authenticated
using (
  bucket_id = 'expense-bills'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
