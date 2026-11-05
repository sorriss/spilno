-- Spilno: схема MVP. Этап 2 (mono_connections, очередь «Розібрати», push_tokens) — отдельными миграциями.
-- Деньги: целые копейки в bigint, расход < 0, доход > 0.
-- Составные FK (family_id, ...) не дают сослаться на строку чужой семьи на уровне БД.

-- Схема private не публикуется в API.
create schema private;

create type member_role as enum ('owner', 'member', 'viewer');
create type account_kind as enum ('cash', 'card', 'mono');
create type category_kind as enum ('expense', 'income');
create type transaction_type as enum ('expense', 'income', 'transfer');
create type transaction_source as enum ('manual', 'mono');
create type split_mode as enum ('equal', 'shares', 'amounts');
create type settlement_kind as enum ('paid', 'forgiven');

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  base_currency char(3) not null default 'UAH',
  created_at timestamptz not null default now()
);

create table family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  role member_role not null default 'member',
  color_index smallint not null default 0 check (color_index between 0 and 4),
  joined_at timestamptz not null default now(),
  left_at timestamptz, -- мягкое удаление: доли и расчёты ушедшего остаются в истории
  unique (family_id, user_id),
  unique (family_id, id)
);
create index on family_members (user_id);

create table family_invites (
  code text primary key,
  family_id uuid not null references families on delete cascade,
  role member_role not null default 'member' check (role <> 'owner'),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  owner_member_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  kind account_kind not null default 'cash',
  currency char(3) not null default 'UAH',
  is_visible_to_family boolean not null default false,
  is_shared_by_default boolean not null default false,
  archived_at timestamptz,
  unique (family_id, id),
  foreign key (family_id, owner_member_id) references family_members (family_id, id)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind category_kind not null default 'expense',
  icon text not null default 'pricetag-outline',
  color_index smallint not null default 0 check (color_index between 0 and 4),
  archived_at timestamptz,
  unique (family_id, id)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  type transaction_type not null,
  amount bigint not null,      -- в валюте операции; у перевода < 0 (списание у отправителя), показывается без знака
  currency char(3) not null default 'UAH',
  amount_base bigint not null, -- в базовой валюте семьи; по нему считаются доли и балансы
  occurred_at timestamptz not null default now(),
  comment text,
  created_by_member_id uuid not null, -- автор: только он видит личную операцию
  paid_by_member_id uuid not null,
  to_member_id uuid,           -- получатель внутрисемейного перевода
  account_id uuid,
  category_id uuid,
  is_shared boolean not null default false,
  split_mode split_mode,
  is_internal_transfer boolean generated always as (type = 'transfer' and to_member_id is not null) stored,
  is_hold boolean not null default false,
  source transaction_source not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  unique (family_id, id),
  unique (family_id, source, external_id),
  foreign key (family_id, created_by_member_id) references family_members (family_id, id),
  foreign key (family_id, paid_by_member_id) references family_members (family_id, id),
  foreign key (family_id, to_member_id) references family_members (family_id, id),
  foreign key (family_id, account_id) references accounts (family_id, id),
  foreign key (family_id, category_id) references categories (family_id, id),
  check ((type = 'income' and amount > 0) or (type in ('expense', 'transfer') and amount < 0)),
  check (sign(amount) = sign(amount_base)),
  -- Внутренний перевод и общая трата — взаимоисключающие: перевод не расход и не задваивается.
  check (not is_shared or type = 'expense'),
  check (is_shared = (split_mode is not null)),
  check (to_member_id is null or (type = 'transfer' and to_member_id <> paid_by_member_id)),
  -- Личную операцию нельзя записать на другого: она была бы не видна тому, кто платил.
  check (is_shared or type = 'transfer' or paid_by_member_id = created_by_member_id)
);
create index on transactions (family_id, occurred_at desc);

create table transaction_shares (
  family_id uuid not null,
  transaction_id uuid not null,
  member_id uuid not null,
  amount bigint not null check (amount > 0), -- копейки доли в базовой валюте
  weight integer check (weight > 0),         -- только для split_mode = 'shares'
  primary key (transaction_id, member_id),
  foreign key (family_id, transaction_id) references transactions (family_id, id) on delete cascade,
  foreign key (family_id, member_id) references family_members (family_id, id)
);
create index on transaction_shares (member_id);

-- Строка появляется, когда получатель нажимает «Отримав» или «Пробачити». Частичное погашение — просто меньшая сумма.
create table settlements (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  from_member_id uuid not null,
  to_member_id uuid not null,
  amount bigint not null check (amount > 0),
  kind settlement_kind not null default 'paid',
  created_at timestamptz not null default now(),
  check (from_member_id <> to_member_id),
  foreign key (family_id, from_member_id) references family_members (family_id, id),
  foreign key (family_id, to_member_id) references family_members (family_id, id)
);
create index on settlements (family_id, created_at desc);

-- Инвариант: сумма долей общей операции равна её сумме, у личной долей нет.
-- Проверка в конце транзакции БД, поэтому операция и доли пишутся одной транзакцией (RPC).
create function private.check_shares() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tx_id uuid;
  tx public.transactions;
  share_sum bigint;
  share_count bigint;
begin
  if tg_table_name = 'transactions' then
    tx_id := new.id;
  elsif tg_op = 'DELETE' then
    tx_id := old.transaction_id;
  else
    tx_id := new.transaction_id;
  end if;

  select * into tx from public.transactions where id = tx_id;
  if not found then return null; end if; -- операция удалена вместе с долями

  select coalesce(sum(amount), 0), count(*) into share_sum, share_count
  from public.transaction_shares where transaction_id = tx_id;

  if tx.is_shared and (share_count = 0 or share_sum <> abs(tx.amount_base)) then
    raise exception 'shares sum % does not match transaction amount %', share_sum, abs(tx.amount_base)
      using errcode = 'check_violation';
  end if;
  if not tx.is_shared and share_count > 0 then
    raise exception 'personal transaction cannot have shares' using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger transactions_shares_sum after insert or update on transactions
  deferrable initially deferred for each row execute function private.check_shares();
create constraint trigger shares_sum after insert or update or delete on transaction_shares
  deferrable initially deferred for each row execute function private.check_shares();

-- Баланс: + тебе должны, − должен ты. Это накопительный счёт за всю историю, а не с даты расчёта:
-- так частичное погашение оставляет остаток долга само собой. Холды не считаем: сумма ещё не окончательная.
create view member_balances with (security_invoker = true) as
select m.family_id, m.id as member_id, coalesce(sum(l.delta), 0)::bigint as balance
from family_members m
left join (
  select paid_by_member_id as member_id, -amount_base as delta
    from transactions where is_shared and not is_hold
  union all
  select s.member_id, -s.amount
    from transaction_shares s join transactions t on t.id = s.transaction_id where not t.is_hold
  union all
  select from_member_id, amount from settlements
  union all
  select to_member_id, -amount from settlements
) l on l.member_id = m.id
group by m.family_id, m.id;

-- Хелперы RLS: security definer обходит рекурсию политик family_members.
create function private.member_id(fam uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.family_members
  where family_id = fam and user_id = auth.uid() and left_at is null
$$;

create function private.has_role(fam uuid, variadic roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members
    where family_id = fam and user_id = auth.uid() and left_at is null and role = any (roles)
  )
$$;

alter table families enable row level security;
alter table family_members enable row level security;
alter table family_invites enable row level security;
alter table accounts enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;
alter table transaction_shares enable row level security;
alter table settlements enable row level security;

create policy read on families for select to authenticated using (private.member_id(id) is not null);
create policy owner_update on families for update to authenticated
  using (private.has_role(id, 'owner')) with check (private.has_role(id, 'owner'));

create policy read on family_members for select to authenticated using (private.member_id(family_id) is not null);
create policy owner_update on family_members for update to authenticated
  using (private.has_role(family_id, 'owner')) with check (private.has_role(family_id, 'owner'));

-- Коды видит только владелец; вступление идёт через join_family.
create policy owner_read on family_invites for select to authenticated using (private.has_role(family_id, 'owner'));
create policy owner_delete on family_invites for delete to authenticated using (private.has_role(family_id, 'owner'));

create policy read on accounts for select to authenticated using (
  is_visible_to_family and private.member_id(family_id) is not null
  or owner_member_id = private.member_id(family_id)
);
create policy owner_write on accounts for all to authenticated
  using (owner_member_id = private.member_id(family_id) and private.has_role(family_id, 'owner', 'member'))
  with check (owner_member_id = private.member_id(family_id) and private.has_role(family_id, 'owner', 'member'));

create policy read on categories for select to authenticated using (private.member_id(family_id) is not null);
create policy write on categories for all to authenticated
  using (private.has_role(family_id, 'owner', 'member'))
  with check (private.has_role(family_id, 'owner', 'member'));

-- Личные операции видит только автор, общие и внутренние переводы — вся семья.
create policy read on transactions for select to authenticated using (
  private.member_id(family_id) is not null
  and (is_shared or is_internal_transfer or created_by_member_id = private.member_id(family_id))
);
create policy insert_own on transactions for insert to authenticated with check (
  private.has_role(family_id, 'owner', 'member') and created_by_member_id = private.member_id(family_id)
);
create policy author_or_owner_update on transactions for update to authenticated
  using (
    private.has_role(family_id, 'owner')
    or (private.has_role(family_id, 'member') and created_by_member_id = private.member_id(family_id))
  );
create policy author_or_owner_delete on transactions for delete to authenticated
  using (
    private.has_role(family_id, 'owner')
    or (private.has_role(family_id, 'member') and created_by_member_id = private.member_id(family_id))
  );

-- Подзапрос к transactions сам проходит через её RLS: доли личной операции чужой не увидит.
create policy read on transaction_shares for select to authenticated using (
  exists (select 1 from public.transactions t where t.id = transaction_id)
);
create policy author_or_owner_write on transaction_shares for all to authenticated
  using (exists (
    select 1 from public.transactions t where t.id = transaction_id and (
      private.has_role(t.family_id, 'owner')
      or (private.has_role(t.family_id, 'member') and t.created_by_member_id = private.member_id(t.family_id))
    )
  ))
  with check (exists (
    select 1 from public.transactions t where t.id = transaction_id and (
      private.has_role(t.family_id, 'owner')
      or (private.has_role(t.family_id, 'member') and t.created_by_member_id = private.member_id(t.family_id))
    )
  ));

create policy read on settlements for select to authenticated using (private.member_id(family_id) is not null);
-- Закрыть долг может только получатель, это его деньги; поэтому и viewer тоже.
create policy receiver_insert on settlements for insert to authenticated
  with check (to_member_id = private.member_id(family_id));
create policy receiver_undo on settlements for delete to authenticated
  using (to_member_id = private.member_id(family_id));

create function create_family(family_name text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  fam uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into public.families (name) values (family_name) returning id into fam;
  insert into public.family_members (family_id, user_id, display_name, role)
    values (fam, auth.uid(), member_name, 'owner');
  insert into public.categories (family_id, name, kind, icon, color_index)
  select fam, c.name, c.kind::public.category_kind, c.icon, c.color_index from (values
    ('Продукти', 'expense', 'cart-outline', 0),
    ('Кафе', 'expense', 'cafe-outline', 4),
    ('Комуналка', 'expense', 'home-outline', 1),
    ('Транспорт', 'expense', 'bus-outline', 0),
    ('Пальне', 'expense', 'car-outline', 3),
    ('Аптека', 'expense', 'medkit-outline', 2),
    ('Дім', 'expense', 'bed-outline', 1),
    ('Діти', 'expense', 'happy-outline', 4),
    ('Одяг', 'expense', 'shirt-outline', 3),
    ('Розваги', 'expense', 'film-outline', 3),
    ('Подорожі', 'expense', 'airplane-outline', 0),
    ('Подарунки', 'expense', 'gift-outline', 1),
    ('Інше', 'expense', 'pricetag-outline', 4),
    ('Зарплата', 'income', 'card-outline', 2)
  ) as c (name, kind, icon, color_index);
  return fam;
end $$;

-- Код: 8 символов из алфавита без I и O, 32^8 ≈ 10^12 вариантов. Одноразовый, живёт 7 дней.
create function create_invite(fam uuid, invite_role public.member_role default 'member') returns text
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  new_code text;
  pos int;
begin
  if not private.has_role(fam, 'owner') then
    raise exception 'only owner can invite' using errcode = 'insufficient_privilege';
  end if;
  loop
    bytes := uuid_send(gen_random_uuid());
    new_code := '';
    foreach pos in array array[0, 1, 2, 3, 4, 5, 10, 11] loop -- байты UUID v4 без служебных битов
      new_code := new_code || substr(alphabet, get_byte(bytes, pos) % 32 + 1, 1);
    end loop;
    begin
      insert into public.family_invites (code, family_id, role) values (new_code, fam, invite_role);
      return new_code;
    exception when unique_violation then
      null; -- совпадение: пробуем другой код
    end;
  end loop;
end $$;

create function join_family(invite_code text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.family_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  update public.family_invites set used_at = now()
    where code = upper(trim(invite_code)) and used_at is null and expires_at > now()
    returning * into inv;
  if not found then
    raise exception 'invalid invite code' using errcode = 'no_data_found';
  end if;

  insert into public.family_members (family_id, user_id, display_name, role, color_index)
    select inv.family_id, auth.uid(), member_name, inv.role, count(*) % 5
    from public.family_members where family_id = inv.family_id
  on conflict (family_id, user_id) do update
    set left_at = null, role = excluded.role, display_name = excluded.display_name
    where public.family_members.left_at is not null; -- действующему участнику, в том числе владельцу, код роль не меняет
  return inv.family_id;
end $$;

-- Права по столбцам: автор и id семьи неизменяемы, роль меняется только через политику владельца.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (name, base_currency) on families to authenticated;
grant update (display_name, role, color_index, left_at) on family_members to authenticated;
grant delete on family_invites to authenticated;
grant insert, delete on accounts to authenticated;
grant update (name, kind, currency, is_visible_to_family, is_shared_by_default, archived_at) on accounts to authenticated;
grant insert, delete on categories to authenticated;
grant update (name, kind, icon, color_index, archived_at) on categories to authenticated;
grant insert, delete on transactions to authenticated;
grant update (type, amount, currency, amount_base, occurred_at, comment, paid_by_member_id, to_member_id,
  account_id, category_id, is_shared, split_mode, is_hold) on transactions to authenticated;
grant insert, delete on transaction_shares to authenticated;
grant update (amount, weight) on transaction_shares to authenticated;
grant insert, delete on settlements to authenticated;

revoke all on function create_family(text, text) from public, anon;
revoke all on function create_invite(uuid, public.member_role) from public, anon;
revoke all on function join_family(text, text) from public, anon;
grant execute on function create_family(text, text) to authenticated;
grant execute on function create_invite(uuid, public.member_role) to authenticated;
grant execute on function join_family(text, text) to authenticated;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
