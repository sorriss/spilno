-- Push на языке получателя: язык хранится у подписки, то есть у устройства, потому что язык выбирают на устройстве.
alter table push_subscriptions add column lang text not null default 'uk' check (lang in ('uk', 'en', 'pl'));

drop function claim_push_subscription(text, text, text);
create function claim_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text, sub_lang text) returns void
language sql security definer set search_path = '' as $$
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, lang)
    values (sub_endpoint, auth.uid(), sub_p256dh, sub_auth, sub_lang)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang
$$;
revoke all on function claim_push_subscription(text, text, text, text) from public, anon;
grant execute on function claim_push_subscription(text, text, text, text) to authenticated;
