// Раз в минуту (pg_cron, supabase/cron/mono-sync.sql) забирает выписку mono: по одному запросу на токен.
// Выкладка: Supabase Dashboard → Edge Functions → mono-sync, вставить этот файл целиком, Verify JWT выключить:
// функцию вызывает cron без пользователя. Ответ ничего не раскрывает, частоту держит БД (mono_claim_requests).
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Job {
  account_id: string;
  external_id: string;
  token: string;
  window_from: string;
  window_to: string;
}

interface StatementItem {
  id: string;
  time: number;
  description: string;
  mcc: number;
  amount: number;
  hold: boolean;
}

/** MCC → название категории из create_family. Переименованная категория просто не найдётся. */
function categoryFor(mcc: number): string | null {
  const exact: Record<string, number[]> = {
    'Продукти': [5297, 5298, 5300, 5311, 5331, 5399, 5411, 5412, 5422, 5441, 5451, 5462, 5499],
    'Кафе': [5811, 5812, 5813, 5814],
    'Транспорт': [4111, 4112, 4121, 4131, 4784, 4789, 7523],
    'Пальне': [5172, 5541, 5542, 5983],
    'Аптека': [5122, 5912, 8011, 8021, 8062, 8071, 8099],
    'Комуналка': [4814, 4816, 4899, 4900],
    'Дім': [5200, 5211, 5251, 5261, 5712, 5722],
    'Діти': [5641, 5945, 8211, 8351],
    'Одяг': [5611, 5621, 5631, 5651, 5661, 5691, 5699],
    'Розваги': [5815, 5816, 5817, 5818, 7832, 7841, 7922, 7991, 7996, 7999],
    'Подорожі': [4411, 4511, 4722, 7011],
    'Подарунки': [5947, 5992],
  };
  for (const [name, codes] of Object.entries(exact)) if (codes.includes(mcc)) return name;
  return mcc >= 3000 && mcc <= 3999 ? 'Подорожі' : null; // авиакомпании, аренда авто, отели
}

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: jobs, error } = await admin.rpc('mono_claim_requests');
  if (error) {
    console.error(error);
    return new Response('error', { status: 500 });
  }

  // Токены разные, поэтому запросы параллельно: лимит mono — на токен.
  await Promise.all(
    (jobs as Job[]).map(async (job) => {
      const url = `https://api.monobank.ua/personal/statement/${job.external_id}/${seconds(job.window_from)}/${seconds(job.window_to)}`;
      const res = await fetch(url, { headers: { 'X-Token': job.token } });
      if (!res.ok) {
        // 429 — повторим через минуту; 401/403 — токен отозван, пользователь переподключит.
        console.warn(job.account_id, res.status, await res.text());
        return;
      }
      const items: StatementItem[] = await res.json();
      // mono отдаёт не больше 500 операций за запрос, от новых к старым: остальное окно дочитываем позже.
      const nextPageTo =
        items.length >= 500 ? new Date(Math.min(...items.map((i) => i.time)) * 1000).toISOString() : null;
      const { error } = await admin.rpc('mono_import', {
        account: job.account_id,
        items: items.map((i) => ({
          external_id: i.id,
          occurred_at: new Date(i.time * 1000).toISOString(),
          amount: i.amount,
          hold: i.hold,
          comment: i.description,
          category: i.amount < 0 ? categoryFor(i.mcc) : null,
        })),
        window_to: job.window_to,
        next_page_to: nextPageTo,
      });
      if (error) console.error(job.account_id, error);
    }),
  );
  return new Response('ok');
});
