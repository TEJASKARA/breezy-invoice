-- Shareable PDF links for invoices, quotations and employee letters.
-- Run after 202611110003_grant_credits_single_balance.sql.
--
-- The backend uploads the PDF to a private bucket and records an unguessable
-- token. Anyone with the link (chanax.in/d/<token>) can view and download that
-- one PDF; the backend hands out short-lived signed URLs. Sharing the same
-- document again refreshes its PDF and keeps the same link. Deleting the
-- document stops the link from working.

begin;

create table if not exists public.breezy_document_links (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{24,64}$'),
  workspace_id uuid not null references public.breezy_workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('invoice', 'quotation', 'employee_letter')),
  document_id uuid not null,
  document_number text not null default '',
  sender_company_name text not null default '',
  filename text not null,
  storage_path text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, document_type, document_id)
);

-- Only the backend (service role) reads or writes links.
alter table public.breezy_document_links enable row level security;
revoke all on public.breezy_document_links from anon, authenticated;
grant select, insert, update, delete on public.breezy_document_links to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('document-links', 'document-links', false, 15728640, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.breezy_schema_versions(version)
values ('2026-11-19-document-share-links')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
