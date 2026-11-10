-- Web Push: подписки браузеров. Строка — одно устройство пользователя; читает и пишет только он сам,
-- отправляет Edge Function notify с service_role.
-- ponytail: при выходе из аккаунта подписка устройства остаётся до следующей подписки другим пользователем.
create table push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy own on push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on push_subscriptions from anon, authenticated;
grant select, insert, update, delete on push_subscriptions to authenticated;

-- Устройство перешло к другому пользователю: endpoint тот же, старую подписку RLS не даёт ни увидеть, ни заменить.
create function claim_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text) returns void
language sql security definer set search_path = '' as $$
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
    values (sub_endpoint, auth.uid(), sub_p256dh, sub_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth
$$;
revoke all on function claim_push_subscription(text, text, text) from public, anon;
grant execute on function claim_push_subscription(text, text, text) to authenticated;
