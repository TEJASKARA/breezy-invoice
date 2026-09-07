-- Customer feedback, bug reports and feature requests submitted in ChanaX.

begin;

create table if not exists public.breezy_product_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  workspace_id uuid references public.breezy_workspaces(id) on delete set null,
  workspace_name text,
  feedback_type text not null check (feedback_type in ('general', 'bug', 'feature')),
  rating integer check (rating between 1 and 5),
  message text not null check (char_length(trim(message)) between 5 and 4000),
  page_path text,
  browser_details text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'planned', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breezy_product_feedback_created_idx
on public.breezy_product_feedback (created_at desc);

create index if not exists breezy_product_feedback_workspace_idx
on public.breezy_product_feedback (workspace_id, created_at desc);

alter table public.breezy_product_feedback enable row level security;

drop policy if exists "Users submit their own product feedback" on public.breezy_product_feedback;
create policy "Users submit their own product feedback"
on public.breezy_product_feedback
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users read their own product feedback" on public.breezy_product_feedback;
create policy "Users read their own product feedback"
on public.breezy_product_feedback
for select to authenticated
using (user_id = auth.uid());

revoke all on table public.breezy_product_feedback from anon;
grant select, insert on table public.breezy_product_feedback to authenticated;

insert into public.breezy_schema_versions(version)
values ('2026-09-07-product-feedback')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
