-- Prevent a GSTIN from being registered by more than one ChanaX workspace.
-- The same workspace can keep the GSTIN in setup and in its own entity record,
-- but another workspace cannot register the same GST number.

begin;

create or replace function public.breezy_normalize_gstin(candidate_gstin text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(candidate_gstin, ''), '\s+', '', 'g'));
$$;

create or replace function public.breezy_assert_unique_gstin(
  target_workspace_id uuid,
  target_entity_id uuid,
  target_gstin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_gstin text := public.breezy_normalize_gstin(target_gstin);
begin
  if normalized_gstin = '' then
    return;
  end if;

  if exists (
    select 1
    from public.breezy_workspace_settings settings
    where settings.workspace_id <> target_workspace_id
      and public.breezy_normalize_gstin(settings.setup ->> 'gstin') = normalized_gstin
  ) then
    raise exception 'This GST number is already registered in ChanaX.' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.breezy_entities entities
    where public.breezy_normalize_gstin(entities.payload ->> 'gstin') = normalized_gstin
      and (
        entities.workspace_id <> target_workspace_id
        or (target_entity_id is not null and entities.id <> target_entity_id)
      )
  ) then
    raise exception 'This GST number is already registered in ChanaX.' using errcode = '23505';
  end if;
end;
$$;

create or replace function public.breezy_is_gstin_available(
  target_workspace_id uuid,
  target_gstin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if not public.breezy_has_permission(target_workspace_id, 'entities.manage') then
    raise exception 'You do not have permission to verify GSTINs in this workspace.' using errcode = '42501';
  end if;

  perform public.breezy_assert_unique_gstin(target_workspace_id, null, target_gstin);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

create or replace function public.breezy_workspace_settings_unique_gstin_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.breezy_assert_unique_gstin(new.workspace_id, null, new.setup ->> 'gstin');
  return new;
end;
$$;

create or replace function public.breezy_entities_unique_gstin_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.breezy_assert_unique_gstin(new.workspace_id, new.id, new.payload ->> 'gstin');
  return new;
end;
$$;

drop trigger if exists breezy_workspace_settings_unique_gstin on public.breezy_workspace_settings;
create trigger breezy_workspace_settings_unique_gstin
before insert or update of setup on public.breezy_workspace_settings
for each row execute function public.breezy_workspace_settings_unique_gstin_trigger();

drop trigger if exists breezy_entities_unique_gstin on public.breezy_entities;
create trigger breezy_entities_unique_gstin
before insert or update of payload on public.breezy_entities
for each row execute function public.breezy_entities_unique_gstin_trigger();

revoke all on function public.breezy_normalize_gstin(text) from public;
revoke all on function public.breezy_assert_unique_gstin(uuid, uuid, text) from public;
revoke all on function public.breezy_is_gstin_available(uuid, text) from public;
revoke all on function public.breezy_workspace_settings_unique_gstin_trigger() from public;
revoke all on function public.breezy_entities_unique_gstin_trigger() from public;

grant execute on function public.breezy_is_gstin_available(uuid, text) to authenticated;

commit;
