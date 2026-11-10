-- Лимит попыток ввода кода приглашения: 10 неудачных в час на пользователя.
-- Неверный код теперь возвращает null, а не исключение: исключение откатило бы запись о попытке.
-- ponytail: лимит на пользователя, а не на IP; новые аккаунты упираются в лимит отправки писем Supabase Auth.

create table private.invite_attempts (
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now()
);
create index on private.invite_attempts (user_id, at);
revoke all on private.invite_attempts from public, anon, authenticated;

create or replace function join_family(invite_code text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.family_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  delete from private.invite_attempts where user_id = auth.uid() and at < now() - interval '1 hour';
  if (select count(*) from private.invite_attempts where user_id = auth.uid()) >= 10 then
    raise exception 'too many invite attempts' using errcode = 'program_limit_exceeded';
  end if;

  update public.family_invites set used_at = now()
    where code = upper(trim(invite_code)) and used_at is null and expires_at > now()
    returning * into inv;
  if not found then
    insert into private.invite_attempts (user_id) values (auth.uid());
    return null; -- код не найден, использован или истёк
  end if;

  insert into public.family_members (family_id, user_id, display_name, role, color_index)
    select inv.family_id, auth.uid(), member_name, inv.role, count(*) % 5
    from public.family_members where family_id = inv.family_id
  on conflict (family_id, user_id) do update
    set left_at = null, role = excluded.role, display_name = excluded.display_name
    where public.family_members.left_at is not null; -- действующему участнику, в том числе владельцу, код роль не меняет
  return inv.family_id;
end $$;
