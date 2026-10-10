-- Unrelated settings/entity edits must not revalidate legacy GST registrations.
-- New registrations, changed GST numbers and ownership moves still validate.
begin;

create or replace function public.breezy_workspace_settings_unique_gstin_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id is not distinct from old.workspace_id
      and public.breezy_normalize_gstin(new.setup ->> 'gstin')
        = public.breezy_normalize_gstin(old.setup ->> 'gstin') then
      return new;
    end if;
  end if;
  perform public.breezy_assert_unique_gstin(new.workspace_id, null, new.setup ->> 'gstin');
  return new;
end;
$$;

create or replace function public.breezy_entities_unique_gstin_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.transferred_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.workspace_id is not distinct from old.workspace_id
      and new.id is not distinct from old.id
      and old.transferred_at is null
      and public.breezy_normalize_gstin(new.payload ->> 'gstin')
        = public.breezy_normalize_gstin(old.payload ->> 'gstin') then
      return new;
    end if;
  end if;
  perform public.breezy_assert_unique_gstin(new.workspace_id, new.id, new.payload ->> 'gstin');
  return new;
end;
$$;

-- Include ownership/reactivation changes so unchanged payload cannot bypass checks.
drop trigger if exists breezy_workspace_settings_unique_gstin on public.breezy_workspace_settings;
create trigger breezy_workspace_settings_unique_gstin
before insert or update of setup, workspace_id on public.breezy_workspace_settings
for each row execute function public.breezy_workspace_settings_unique_gstin_trigger();

drop trigger if exists breezy_entities_unique_gstin on public.breezy_entities;
drop trigger if exists breezy_z_entities_unique_gstin on public.breezy_entities;
-- PostgreSQL orders triggers by name: keep the transfer/read-only guard first.
create trigger breezy_z_entities_unique_gstin
before insert or update of payload, workspace_id, id, transferred_at on public.breezy_entities
for each row execute function public.breezy_entities_unique_gstin_trigger();

revoke all on function public.breezy_workspace_settings_unique_gstin_trigger() from public;
revoke all on function public.breezy_entities_unique_gstin_trigger() from public;
notify pgrst, 'reload schema';
commit;
