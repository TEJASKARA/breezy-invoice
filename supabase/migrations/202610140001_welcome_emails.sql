-- One-time welcome delivery. Only the backend service role can claim/send/finish.
begin;
create table public.chanax_welcome_emails (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','skipped')),
  recipient_email text,
  recipient_name text,
  account_type text,
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  welcome_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.chanax_welcome_emails enable row level security;
revoke all on public.chanax_welcome_emails from public, anon, authenticated;
grant select, insert, update, delete on public.chanax_welcome_emails to service_role;
-- Do not send a surprise welcome campaign to existing accounts after deployment.
insert into public.chanax_welcome_emails(user_id,status)
select id,'skipped' from auth.users;

create function public.chanax_claim_welcome_email(target_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  delivery public.chanax_welcome_emails;
  recipient text;
  display_name text;
  kind text;
begin
  select u.email, left(coalesce(p.full_name, u.raw_user_meta_data->>'full_name', ''),160),
    coalesce(p.account_type,'unselected')
  into recipient,display_name,kind
  from auth.users u left join public.profiles p on p.id=u.id
  where u.id=target_user_id and u.email_confirmed_at is not null
    and u.deleted_at is null and nullif(trim(u.email),'') is not null;
  if recipient is null then return null; end if;
  insert into public.chanax_welcome_emails(user_id) values(target_user_id)
    on conflict(user_id) do nothing;
  select * into delivery from public.chanax_welcome_emails
    where user_id=target_user_id for update;
  if delivery.status in ('sent','skipped')
    or delivery.lease_expires_at > now()
    or delivery.next_attempt_at > now() then return null; end if;
  -- Resend keeps idempotency keys for 24 hours. Never retry an ambiguous send
  -- outside that window; a crash after provider acceptance must not duplicate it.
  if delivery.attempts >= 3 or delivery.first_attempt_at < now()-interval '23 hours' then
    update public.chanax_welcome_emails set status='skipped',lease_token=null,
      lease_expires_at=null where user_id=target_user_id;
    return null;
  end if;
  update public.chanax_welcome_emails set status='sending',attempts=attempts+1,
    recipient_email=coalesce(recipient_email,recipient),
    recipient_name=coalesce(recipient_name,display_name),
    account_type=coalesce(account_type,kind),
    first_attempt_at=coalesce(first_attempt_at,now()),next_attempt_at=null,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes'
  where user_id=target_user_id returning * into delivery;
  return jsonb_build_object('user_id',delivery.user_id,'email',delivery.recipient_email,
    'name',delivery.recipient_name,'account_type',delivery.account_type,
    'lease_token',delivery.lease_token);
end;
$$;

create function public.chanax_finish_welcome_email(
  target_user_id uuid, target_lease_token uuid, delivered boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update public.chanax_welcome_emails set
    status=case when delivered then 'sent' else 'pending' end,
    welcome_email_sent_at=case when delivered then now() else welcome_email_sent_at end,
    next_attempt_at=case when delivered then null else now()+interval '10 minutes' end,
    lease_token=null,lease_expires_at=null
  where user_id=target_user_id and status='sending' and lease_token=target_lease_token;
  get diagnostics affected=row_count;
  return affected=1;
end;
$$;
revoke all on function public.chanax_claim_welcome_email(uuid) from public,anon,authenticated;
revoke all on function public.chanax_finish_welcome_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.chanax_claim_welcome_email(uuid) to service_role;
grant execute on function public.chanax_finish_welcome_email(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
