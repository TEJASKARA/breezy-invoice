-- Run after the existing CA portal, owner-plus-two seats and usage migrations.
begin;
create table if not exists public.chanax_ca_client_invitations (
  id uuid primary key default gen_random_uuid(),
  ca_user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null,
  client_email text,
  client_phone text,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  registered_user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.breezy_workspaces(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  check (client_email is not null or client_phone is not null)
);
create index if not exists chanax_ca_invites_owner on public.chanax_ca_client_invitations(ca_user_id, created_at desc);
alter table public.chanax_ca_client_invitations enable row level security;
revoke all on public.chanax_ca_client_invitations from public, anon, authenticated;
grant select on public.chanax_ca_client_invitations to service_role;

create or replace function public.chanax_create_ca_client_invitation(
  target_client_name text, target_email text default null, target_phone text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  name text := nullif(trim(target_client_name),'');
  email text := nullif(lower(trim(target_email)),'');
  phone text := nullif(regexp_replace(coalesce(target_phone,''),'[\s()+-]','','g'),'');
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  invitation_id uuid;
  firm text;
begin
  select p.ca_firm_name into firm from public.profiles p where p.id=actor and p.account_type='ca';
  if not found then raise exception 'Only CA partner accounts can invite clients.' using errcode='42501'; end if;
  if name is null or length(name)>160 then raise exception 'Enter a client name of 160 characters or fewer.' using errcode='P0001'; end if;
  if email is null and phone is null then raise exception 'Enter the client email or international phone number.' using errcode='P0001'; end if;
  if email is not null and (length(email)>320 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Enter a valid client email address.' using errcode='P0001';
  end if;
  if phone is not null and phone !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'Enter the phone number with its country code.' using errcode='P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ca-invite:' || actor::text,0));
  if (select count(*) from public.chanax_ca_client_invitations where ca_user_id=actor and created_at>now()-interval '1 day')>=50 then
    raise exception 'The daily client invitation limit has been reached. Try again tomorrow.' using errcode='P0001';
  end if;
  if exists(select 1 from public.chanax_ca_client_invitations i where i.ca_user_id=actor and i.status='pending' and i.expires_at>now()
    and ((email is not null and i.client_email=email) or (phone is not null and i.client_phone=phone))) then
    raise exception 'A pending invitation already exists for this client. Cancel it before sending a replacement.' using errcode='P0001';
  end if;
  insert into public.chanax_ca_client_invitations(ca_user_id,client_name,client_email,client_phone,token_hash)
  values(actor,name,email,phone,encode(sha256(convert_to(token,'UTF8')),'hex')) returning id into invitation_id;
  return jsonb_build_object('id',invitation_id,'token',token,'firm_name',firm,'email',email,'phone',phone);
end;
$$;

-- Only a high-entropy bearer link reveals these minimal invitation details.
create or replace function public.chanax_preview_ca_client_invitation(invitation_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.chanax_ca_client_invitations; firm text;
begin
  if invitation_token is null or invitation_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into i from public.chanax_ca_client_invitations
  where token_hash=encode(sha256(convert_to(invitation_token,'UTF8')),'hex') and status='pending' and expires_at>now();
  if not found then return null; end if;
  select ca_firm_name into firm from public.profiles where id=i.ca_user_id and account_type='ca';
  if not found then return null; end if;
  return jsonb_build_object('client_name',i.client_name,'firm_name',firm,'email',i.client_email,'expires_at',i.expires_at);
end;
$$;

create or replace function public.chanax_register_ca_client_invitation(invitation_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); email text;
begin
  select lower(u.email) into email from auth.users u where u.id=actor and u.email_confirmed_at is not null;
  if email is null then return; end if;
  update public.chanax_ca_client_invitations set registered_user_id=actor
  where token_hash=encode(sha256(convert_to(invitation_token,'UTF8')),'hex') and status='pending' and expires_at>now()
    and ca_user_id<>actor and (client_email is null or client_email=email)
    and (registered_user_id is null or registered_user_id=actor);
end;
$$;

create or replace function public.chanax_accept_ca_client_invitation(
  invitation_token text, target_workspace_id uuid, target_permissions text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); email text; i public.chanax_ca_client_invitations;
  additional_limit integer; already_member boolean;
begin
  select lower(u.email) into email from auth.users u where u.id=actor and u.email_confirmed_at is not null;
  if email is null then raise exception 'Confirm your email and sign in before approving this invitation.' using errcode='P0001'; end if;
  select * into i from public.chanax_ca_client_invitations
    where token_hash=encode(sha256(convert_to(invitation_token,'UTF8')),'hex') for update;
  if i.id is null or i.status='revoked' or (i.status='pending' and i.expires_at<=now()) then
    raise exception 'This invitation is invalid, expired or cancelled. Ask your CA for a new invitation.' using errcode='P0001';
  end if;
  if i.ca_user_id=actor or (i.client_email is not null and i.client_email<>email) then
    raise exception 'Sign in with the client email this invitation was sent to.' using errcode='P0001';
  end if;
  if not exists(select 1 from public.profiles where id=i.ca_user_id and account_type='ca') then
    raise exception 'This CA partner account is no longer available.' using errcode='P0001';
  end if;
  if not exists(select 1 from public.breezy_workspaces where id=target_workspace_id and owner_user_id=actor and status='active') then
    raise exception 'Only the company owner can approve access to an active workspace.' using errcode='42501';
  end if;
  if i.status='accepted' then
    if i.registered_user_id=actor and i.workspace_id=target_workspace_id then return jsonb_build_object('workspace_id',target_workspace_id); end if;
    raise exception 'This invitation has already been accepted.' using errcode='P0001';
  end if;
  if target_permissions is null or not public.breezy_validate_permissions(target_permissions) then
    raise exception 'Select valid page permissions for your CA.' using errcode='P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text,0));
  select exists(select 1 from public.breezy_workspace_members where workspace_id=target_workspace_id and user_id=i.ca_user_id and status in ('active','invited')) into already_member;
  select greatest(included_seats-1,2)+extra_seats into additional_limit from public.breezy_subscriptions where workspace_id=target_workspace_id;
  if not already_member and public.breezy_additional_seats_reserved(target_workspace_id)>=coalesce(additional_limit,2) then
    raise exception 'Both included additional-user seats are reserved. Free a seat before approving your CA.' using errcode='P0001';
  end if;
  insert into public.breezy_workspace_members(workspace_id,user_id,role,permissions,status,invited_by,joined_at)
  values(target_workspace_id,i.ca_user_id,'accountant',target_permissions,'active',actor,now())
  on conflict(workspace_id,user_id) do update set role='accountant',permissions=excluded.permissions,status='active',invited_by=actor,joined_at=coalesce(public.breezy_workspace_members.joined_at,now()),updated_at=now();
  update public.chanax_ca_client_invitations set status='accepted',registered_user_id=actor,workspace_id=target_workspace_id,accepted_at=now() where id=i.id;
  update public.profiles set account_type='founder',updated_at=now() where id=actor and account_type='unselected';
  insert into public.breezy_workspace_audit_log(workspace_id,actor_user_id,actor_email,actor_account_type,action,resource_type,resource_id,details)
  values(target_workspace_id,actor,email,'founder','approved','ca_client_invitation',i.id::text,jsonb_build_object('ca_user_id',i.ca_user_id,'permissions',target_permissions));
  return jsonb_build_object('workspace_id',target_workspace_id);
end;
$$;

create or replace function public.chanax_revoke_ca_client_invitation(target_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.chanax_ca_client_invitations set status='revoked'
  where id=target_invitation_id and ca_user_id=auth.uid() and status='pending';
  if not found then raise exception 'This invitation is no longer pending.' using errcode='P0001'; end if;
end;
$$;

-- Disconnection never deletes the company's operational records or subscription.
create or replace function public.chanax_disconnect_ca_client(target_workspace_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and account_type='ca') then
    raise exception 'Only CA partner accounts can disconnect clients.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text,0));
  update public.breezy_workspace_members set status='disabled',updated_at=now()
  where workspace_id=target_workspace_id and user_id=auth.uid() and role<>'owner'
    and not exists(select 1 from public.breezy_workspaces where id=target_workspace_id and owner_user_id=auth.uid());
  if not found then raise exception 'This client relationship could not be disconnected.' using errcode='P0001'; end if;
  insert into public.breezy_workspace_audit_log(workspace_id,actor_user_id,actor_email,actor_account_type,action,resource_type,resource_id)
  select target_workspace_id,p.id,p.email,'ca','disconnected','ca_client',auth.uid()::text from public.profiles p where p.id=auth.uid();
end;
$$;

-- Returns only the actor's invitation pipeline and authorised, minimal client summaries.
create or replace function public.chanax_ca_partner_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid:=auth.uid(); invitations jsonb; clients jsonb:='[]'::jsonb;
  r record; setup jsonb; details_ok boolean; entity_ok boolean; workflow_ok boolean;
  missing text[]; last_activity timestamptz; stage text; can_see_entities boolean;
  can_see_invoices boolean; can_see_payroll boolean; can_see_expenses boolean;
begin
  if not exists(select 1 from public.profiles where id=actor and account_type='ca') then
    raise exception 'Only CA partner accounts can open the partner dashboard.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'client_name',i.client_name,'email',i.client_email,'phone',i.client_phone,
    'status',case when i.status='pending' and i.expires_at<=now() then 'expired' when i.status='pending' and i.registered_user_id is not null then 'registered' else i.status end,
    'workspace_id',i.workspace_id,'created_at',i.created_at,'expires_at',i.expires_at) order by i.created_at desc),'[]'::jsonb)
  into invitations from public.chanax_ca_client_invitations i where i.ca_user_id=actor;
  for r in select w.*,coalesce(m.status,'disabled') as member_status
    from public.breezy_workspaces w join (
      select workspace_id from public.breezy_workspace_members where user_id=actor and role<>'owner'
      union select workspace_id from public.chanax_ca_client_invitations where ca_user_id=actor and status='accepted'
    ) relationships on relationships.workspace_id=w.id
    left join public.breezy_workspace_members m on m.workspace_id=w.id and m.user_id=actor
    where w.owner_user_id<>actor order by w.name
  loop
    if r.member_status<>'active' or r.status<>'active' then
      clients:=clients||jsonb_build_array(jsonb_build_object('workspace_id',r.id,'name',r.name,'status','inactive','missing','[]'::jsonb,'last_activity',null,'can_open',false));
      continue;
    end if;
    select s.setup into setup from public.breezy_workspace_settings s where s.workspace_id=r.id;
    details_ok:=coalesce(length(trim(setup->>'firmName'))>0 and length(trim(setup->>'mailingAddress'))>0,false);
    can_see_entities:=public.breezy_has_permission(r.id,'entities.read');
    can_see_invoices:=public.breezy_has_permission(r.id,'invoices.read');
    can_see_payroll:=public.breezy_has_permission(r.id,'payslips.read');
    can_see_expenses:=public.breezy_has_permission(r.id,'expenses.read');
    entity_ok:=can_see_entities and exists(select 1 from public.breezy_entities e where e.workspace_id=r.id and e.transferred_at is null);
    workflow_ok:=(can_see_invoices and (exists(select 1 from public.breezy_invoices v where v.workspace_id=r.id and lower(coalesce(v.payload->>'status',''))='generated')
      or exists(select 1 from public.breezy_proformas v where v.workspace_id=r.id and lower(coalesce(v.payload->>'status',''))='generated')))
      or (can_see_payroll and exists(select 1 from public.breezy_payslips v where v.workspace_id=r.id and lower(coalesce(v.payload->>'status',''))='generated'))
      or (can_see_expenses and exists(select 1 from public.breezy_expenses e where e.workspace_id=r.id));
    missing:='{}';
    if not details_ok then missing:=array_append(missing,'Complete company details and billing address'); end if;
    if can_see_entities and not entity_ok then missing:=array_append(missing,'Add the first business entity'); end if;
    if (can_see_invoices or can_see_payroll or can_see_expenses) and not workflow_ok then missing:=array_append(missing,'Add the first workflow record in the pages shared with your CA'); end if;
    -- Only client-side activity, not a CA opening the portal, resets this indicator.
    select max(e.occurred_at) into last_activity from public.breezy_usage_events e
      join public.profiles p on p.id=e.user_id
      where e.workspace_id=r.id and p.account_type<>'ca';
    stage:=case when not can_see_entities or not (can_see_invoices or can_see_payroll or can_see_expenses) then 'limited_visibility'
      when cardinality(missing)>0 then 'onboarding_incomplete'
      when coalesce(last_activity,r.created_at)<now()-interval '30 days' then 'inactive' else 'ready' end;
    clients:=clients||jsonb_build_array(jsonb_build_object('workspace_id',r.id,'name',r.name,'status',stage,'missing',to_jsonb(missing),
      'last_activity',last_activity,'can_open',true,'company_details_complete',details_ok,'has_entity',case when can_see_entities then entity_ok else null end,
      'has_workflow',case when can_see_invoices or can_see_payroll or can_see_expenses then workflow_ok else null end));
  end loop;
  return jsonb_build_object('invitations',invitations,'clients',clients);
end;
$$;
revoke all on function public.chanax_create_ca_client_invitation(text,text,text) from public,anon;
revoke all on function public.chanax_preview_ca_client_invitation(text) from public;
revoke all on function public.chanax_register_ca_client_invitation(text) from public,anon;
revoke all on function public.chanax_accept_ca_client_invitation(text,uuid,text[]) from public,anon;
revoke all on function public.chanax_revoke_ca_client_invitation(uuid) from public,anon;
revoke all on function public.chanax_disconnect_ca_client(uuid) from public,anon;
revoke all on function public.chanax_ca_partner_dashboard() from public,anon;
grant execute on function public.chanax_preview_ca_client_invitation(text) to anon,authenticated;
grant execute on function public.chanax_create_ca_client_invitation(text,text,text),
  public.chanax_register_ca_client_invitation(text), public.chanax_accept_ca_client_invitation(text,uuid,text[]),
  public.chanax_revoke_ca_client_invitation(uuid), public.chanax_disconnect_ca_client(uuid),
  public.chanax_ca_partner_dashboard() to authenticated;
notify pgrst,'reload schema';
commit;
