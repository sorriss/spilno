-- «Ні» на подсказке «Схоже на повернення» на Огляді: доход больше не предлагается как возврат. Пишет автор дохода (RLS).
alter table transactions add column refund_dismissed boolean not null default false;
grant update (refund_dismissed) on transactions to authenticated;
