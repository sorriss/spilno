-- Монобанк, часть 1: подключение. Токен лежит только в Supabase Vault, клиент его не видит никогда:
-- у mono_connections клиенту открыты столбцы без secret_id, а токен читает только service_role (Edge Functions).
-- ponytail: импортируем только гривневые счета; валютные добавить вместе с курсом для amount_base.

alter table accounts add column external_id text; -- id счёта в mono
alter table accounts add unique (owner_member_id, external_id);

create table mono_connections (
  member_id uuid primary key,
  family_id uuid not null references families on delete cascade,
  client_name text not null,
  secret_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (family_id, member_id) references family_members (family_id, id)
);
alter table mono_connections enable row level security;
create policy own_read on mono_connections for select to authenticated
  using (member_id = private.member_id(family_id));
-- Supabase по умолчанию открывает новые таблицы всем ролям: закрываем и отдаём только безопасные столбцы.
revoke all on mono_connections from anon, authenticated;
grant select (member_id, family_id, client_name, created_at) on mono_connections to authenticated;

-- Вызывает Edge Function mono-connect после проверки токена в mono. Повторное подключение заменяет токен.
create function mono_save_connection(member uuid, token text, name text, mono_accounts jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  fam uuid;
  sid uuid;
begin
  select family_id into fam from public.family_members
    where id = member and left_at is null and role in ('owner', 'member');
  if not found then
    raise exception 'member cannot connect mono' using errcode = 'insufficient_privilege';
  end if;

  select secret_id into sid from public.mono_connections where member_id = member;
  if found then
    perform vault.update_secret(sid, token);
    update public.mono_connections set client_name = name where member_id = member;
  else
    insert into public.mono_connections (member_id, family_id, client_name, secret_id)
      values (member, fam, name, vault.create_secret(token));
  end if;

  -- Счета создаём один раз: потом пользователь может их переименовать или убрать в архив.
  insert into public.accounts (family_id, owner_member_id, name, kind, currency, external_id)
    select fam, member, a.name, 'mono', a.currency, a.external_id
    from jsonb_to_recordset(mono_accounts) as a (external_id text, name text, currency text)
  on conflict (owner_member_id, external_id) do nothing;
end $$;

-- Токен для запросов к mono из Edge Functions.
create function mono_token(member uuid) returns text
language sql security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s
    join public.mono_connections c on c.secret_id = s.id
  where c.member_id = member
$$;

-- Отключение: токен удаляется из Vault, счета и импортированные операции остаются в истории.
create function disconnect_mono(fam uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  delete from public.mono_connections where member_id = private.member_id(fam)
    returning secret_id into sid;
  delete from vault.secrets where id = sid;
end $$;

revoke all on function mono_save_connection(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function mono_token(uuid) from public, anon, authenticated;
grant execute on function mono_save_connection(uuid, text, text, jsonb) to service_role;
grant execute on function mono_token(uuid) to service_role;
revoke all on function disconnect_mono(uuid) from public, anon;
grant execute on function disconnect_mono(uuid) to authenticated;
