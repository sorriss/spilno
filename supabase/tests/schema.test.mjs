// Прогоняет миграцию на PGlite (Postgres в процессе, без Docker) и проверяет инварианты денег и RLS.
// Запуск: npm run test:db
import { readFileSync, readdirSync } from 'node:fs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const ANDRII = '00000000-0000-4000-8000-00000000000a';
const OLENA = '00000000-0000-4000-8000-00000000000b';
const SOFIA = '00000000-0000-4000-8000-00000000000c';
const STRANGER = '00000000-0000-4000-8000-00000000000d';

/** Выполняет sql от имени пользователя, как PostgREST: роль authenticated и sub в JWT. */
async function as(user, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

/** То же для нескольких выражений в одной транзакции БД. Возвращает ошибку наружу. */
async function txAs(user, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    await db.exec(`begin; ${sql}; commit;`);
  } catch (e) {
    await db.exec('rollback;');
    throw e;
  } finally {
    await db.exec('reset role;');
  }
}

let fam, andrii, olena, sofia;

async function memberId(user) {
  return (await db.query('select id from family_members where user_id = $1', [user])).rows[0].id;
}

function sharedExpense(id, { paidBy, total, shares }) {
  return `
    insert into transactions (id, family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, is_shared, split_mode)
      values ('${id}', '${fam}', 'expense', ${-total}, ${-total}, '${paidBy}', '${paidBy}', true, 'equal');
    insert into transaction_shares (family_id, transaction_id, member_id, amount) values
      ${shares.map(([m, a]) => `('${fam}', '${id}', '${m}', ${a})`).join(',')}`;
}

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon; create role authenticated;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${ANDRII}'), ('${OLENA}'), ('${SOFIA}'), ('${STRANGER}');
  `);
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }

  [{ fam }] = await as(ANDRII, `select create_family('Наша сім’я', 'Андрій') as fam`);
  const [{ code }] = await as(ANDRII, `select create_invite($1) as code`, [fam]);
  const [{ code: viewerCode }] = await as(ANDRII, `select create_invite($1, 'viewer') as code`, [fam]);
  await as(OLENA, `select join_family($1, 'Олена')`, [code]);
  await as(SOFIA, `select join_family($1, 'Софійка')`, [viewerCode.toLowerCase()]);
  andrii = await memberId(ANDRII);
  olena = await memberId(OLENA);
  sofia = await memberId(SOFIA);
});

test('create_family: владелец и 14 категорий', async () => {
  const [{ role }] = await as(ANDRII, 'select role from family_members where id = $1', [andrii]);
  assert.equal(role, 'owner');
  const cats = await as(ANDRII, 'select id from categories where family_id = $1', [fam]);
  assert.equal(cats.length, 14);
});

test('приглашение одноразовое и неверный код не проходит', async () => {
  const [{ code }] = await as(ANDRII, 'select create_invite($1) as code', [fam]);
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  await as(STRANGER, `select join_family($1, 'Гість')`, [code]);
  await assert.rejects(as(OLENA, `select join_family($1, 'Олена')`, [code]), /invalid invite code/);
  await db.exec(`delete from family_members where user_id = '${STRANGER}'`);
});

test('свой код не меняет роль действующего участника', async () => {
  const [{ code }] = await as(ANDRII, `select create_invite($1, 'viewer') as code`, [fam]);
  await as(ANDRII, `select join_family($1, 'Андрій')`, [code]);
  const [{ role }] = await as(ANDRII, 'select role from family_members where id = $1', [andrii]);
  assert.equal(role, 'owner');
});

test('приглашать может только владелец', async () => {
  await assert.rejects(as(OLENA, 'select create_invite($1)', [fam]), /only owner/);
});

test('сумма долей обязана равняться сумме операции', async () => {
  await assert.rejects(
    txAs(ANDRII, sharedExpense('10000000-0000-4000-8000-000000000001', {
      paidBy: andrii, total: 1000, shares: [[andrii, 500], [olena, 499]],
    })),
    /does not match/,
  );
  await assert.rejects(
    txAs(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, is_shared, split_mode)
      values ('${fam}', 'expense', -100, -100, '${andrii}', '${andrii}', true, 'equal')`),
    /does not match/,
  );
});

test('нельзя сослаться на участника чужой семьи', async () => {
  const [{ other }] = await as(STRANGER, `select create_family('Чужа', 'Гість') as other`);
  await assert.rejects(as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', -1, -1, $2, $2)`, [other, andrii]));
});

test('неверный знак суммы отклоняется', async () => {
  await assert.rejects(as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', 100, 100, $2, $2)`, [fam, andrii]));
});

test('баланс: общая трата, внутренний перевод не считается, частичный расчёт уменьшает долг', async () => {
  await txAs(ANDRII, sharedExpense('20000000-0000-4000-8000-000000000001', {
    paidBy: andrii, total: 124860, shares: [[andrii, 41620], [olena, 41620], [sofia, 41620]],
  }));
  await as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, to_member_id)
    values ($1, 'transfer', -84000, -84000, $2, $2, $3)`, [fam, andrii, olena]);

  const balances = async () => Object.fromEntries(
    (await as(ANDRII, 'select member_id, balance from member_balances where family_id = $1', [fam]))
      .map((r) => [r.member_id, Number(r.balance)]),
  );
  let b = await balances();
  assert.equal(b[andrii], 83240);
  assert.equal(b[olena], -41620);
  assert.equal(b[sofia], -41620);
  assert.equal(b[andrii] + b[olena] + b[sofia], 0);

  await as(ANDRII, `insert into settlements (family_id, from_member_id, to_member_id, amount) values ($1, $2, $3, 20000)`,
    [fam, olena, andrii]);
  b = await balances();
  assert.equal(b[andrii], 63240);
  assert.equal(b[olena], -21620);
});

test('подтвердить расчёт может только получатель', async () => {
  await assert.rejects(as(OLENA, `insert into settlements (family_id, from_member_id, to_member_id, amount) values ($1, $2, $3, 100)`,
    [fam, olena, andrii]), /row-level security/);
});

test('личную операцию видит только автор, даже владелец не видит чужую', async () => {
  const [{ id }] = await as(OLENA, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, comment)
    values ($1, 'expense', -38640, -38640, $2, $2, 'секрет') returning id`, [fam, olena]);

  assert.equal((await as(OLENA, 'select 1 from transactions where id = $1', [id])).length, 1);
  assert.equal((await as(ANDRII, 'select 1 from transactions where id = $1', [id])).length, 0);
  assert.equal((await as(SOFIA, 'select 1 from transactions where id = $1', [id])).length, 0);

  // Владелец не может и изменить или удалить невидимую ему строку.
  assert.equal((await as(ANDRII, `update transactions set comment = 'x' where id = $1 returning id`, [id])).length, 0);
  assert.equal((await as(ANDRII, 'delete from transactions where id = $1 returning id', [id])).length, 0);
  await as(OLENA, 'delete from transactions where id = $1', [id]);
});

const addTx = (user, { type = 'expense', amount = -1000, paidBy, to = null, mode = null, shares = [] }) =>
  as(user, 'select add_transaction($1, $2, $3, now(), null, null, $4, $5, $6, $7) as id',
    [fam, type, amount, paidBy, to, mode, JSON.stringify(shares)]);

test('add_transaction пишет общую операцию с долями и автором-вызывающим', async () => {
  const [{ id }] = await addTx(OLENA, {
    paidBy: andrii, mode: 'shares',
    shares: [{ member_id: andrii, amount: 667, weight: 2 }, { member_id: olena, amount: 333, weight: 1 }],
  });
  const [tx] = await as(ANDRII, 'select created_by_member_id, paid_by_member_id, is_shared, amount_base from transactions where id = $1', [id]);
  assert.equal(tx.created_by_member_id, olena);
  assert.equal(tx.paid_by_member_id, andrii);
  assert.equal(tx.is_shared, true);
  assert.equal(Number(tx.amount_base), -1000);
  assert.equal((await as(SOFIA, 'select 1 from transaction_shares where transaction_id = $1', [id])).length, 2);
  await as(OLENA, 'delete from transactions where id = $1', [id]);
});

test('add_transaction откатывает всё, если доли не сходятся с суммой', async () => {
  const count = async () => (await as(ANDRII, 'select count(*)::int as n from transactions'))[0].n;
  const before = await count();
  await assert.rejects(addTx(ANDRII, {
    paidBy: andrii, mode: 'equal', shares: [{ member_id: andrii, amount: 999, weight: null }],
  }), /does not match/);
  assert.equal(await count(), before);
});

test('add_transaction: личная операция, перевод и ограничения по ролям', async () => {
  const [{ id: personal }] = await addTx(OLENA, { paidBy: olena });
  assert.equal((await as(ANDRII, 'select 1 from transactions where id = $1', [personal])).length, 0);
  await as(OLENA, 'delete from transactions where id = $1', [personal]);

  const [{ id: transfer }] = await addTx(ANDRII, { type: 'transfer', paidBy: andrii, to: olena });
  assert.equal((await as(SOFIA, 'select is_internal_transfer from transactions where id = $1', [transfer]))[0].is_internal_transfer, true);
  await as(ANDRII, 'delete from transactions where id = $1', [transfer]);

  await assert.rejects(addTx(SOFIA, { paidBy: sofia }), /row-level security/);
  await assert.rejects(addTx(STRANGER, { paidBy: andrii }));
  await assert.rejects(addTx(ANDRII, { paidBy: olena }));
});

test('нельзя записать личную операцию на другого участника', async () => {
  await assert.rejects(as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', -100, -100, $2, $3)`, [fam, andrii, olena]));
});

test('чужой не видит ничего из семьи', async () => {
  for (const table of ['families', 'family_members', 'transactions', 'settlements', 'categories']) {
    const col = table === 'families' ? 'id' : 'family_id';
    assert.equal((await as(STRANGER, `select 1 from ${table} where ${col} = $1`, [fam])).length, 0, table);
  }
  assert.equal((await as(STRANGER, 'select 1 from member_balances where family_id = $1', [fam])).length, 0);
  assert.equal((await as(STRANGER, 'select 1 from transaction_shares where family_id = $1', [fam])).length, 0);
});

test('viewer только читает', async () => {
  assert.ok((await as(SOFIA, 'select 1 from transactions where family_id = $1', [fam])).length > 0);
  await assert.rejects(as(SOFIA, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', -100, -100, $2, $2)`, [fam, sofia]), /row-level security/);
});

test('участник не может повысить себе роль и сменить автора операции', async () => {
  assert.equal((await as(OLENA, `update family_members set role = 'owner' where id = $1 returning id`, [olena])).length, 0);
  await assert.rejects(as(ANDRII, 'update transactions set created_by_member_id = $1', [olena]), /permission denied/);
});

test('вышедший участник теряет доступ', async () => {
  await as(ANDRII, 'update family_members set left_at = now() where id = $1', [sofia]);
  assert.equal((await as(SOFIA, 'select 1 from transactions where family_id = $1', [fam])).length, 0);
  await as(ANDRII, 'update family_members set left_at = null where id = $1', [sofia]);
});
