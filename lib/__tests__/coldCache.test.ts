import { buildColdSnapshot, coldCacheKey, parseColdSnapshot, COLD_CACHE_MAX_AGE_MS, COLD_CACHE_RECENT } from '@/lib/coldCache';
import { walletBalance } from '@/lib/finance';
import type { Category, Transaction, Wallet } from '@/context/DataContext';

/**
 * كاش أول فتحة باردة (`reports/2026-11-02-cold-cache-design.md`). الحد الأدنى بقرار مؤمن:
 * أرصدة وآخر عمليات، **من غير ديون ولا أسامي ناس** — ونوتات الدين فيها اسم الشخص.
 */
const NOW = Date.parse('2026-11-02T20:00:00.000Z');
const W: Wallet[] = [
  { id: 'w1', name: 'الكاش', openingBalance: 1000, lowAlert: 100 },
  { id: 'w2', name: 'البنك', openingBalance: 5000, lowAlert: 0 },
  { id: 'w3', name: 'قديمة', openingBalance: 0, lowAlert: 0, archived: true },
];
const C: Category[] = [
  { id: 'c1', name: 'أكل', icon: '🍔', bucket: 'needs' },
  { id: 'c2', name: 'مواصلات' },
  { id: 'c3', name: 'مش مستعملة' },
];
const tx = (o: Partial<Transaction> & { id: string }): Transaction =>
  ({ type: 'expense', amount: 10, walletId: 'w1', date: '2026-11-01', createdAt: '2026-11-01T10:00:00Z', ...o });
const TXS: Transaction[] = [
  tx({ id: 't1', amount: 50, categoryId: 'c1', note: 'غدا مع محمد' }),
  tx({ id: 't2', amount: 300, note: 'قرض لـ أحمد علي', date: '2026-11-02' }),
  tx({ id: 't3', type: 'income', amount: 2000, walletId: 'w2', note: 'مرتب' }),
  tx({ id: 't4', type: 'withdraw', amount: 100, walletId: 'w2', toWalletId: 'w1', note: 'تحويل' }),
  tx({ id: 't5', amount: 99, subscriptionId: 's1', periodKey: '2026-11-01', note: 'اشتراك: نتفليكس' }),
  tx({ id: 't6', amount: 500, gamiyaId: 'g1', note: 'قسط جمعية: جمعية الشغل (شهر 2)' }),
  tx({ id: 't7', type: 'income', amount: 700, incomeId: 'i1', note: 'شغل حر — نوفمبر' }),
  tx({ id: 't8', amount: 5, walletId: 'w3', isSettlement: true, type: 'withdraw', toWalletId: 'w1' }),
];
const DEBT_TX = new Set(['t2']);
const build = (txs = TXS) => buildColdSnapshot({ uid: 'u1', wallets: W, categories: C, transactions: txs, debtTransactionIds: DEBT_TX, now: NOW });

describe('buildColdSnapshot — اللي بيتخزّن', () => {
  it('مفيش نوتات ولا أسامي ناس ولا أسامي اشتراكات/جمعيات/دخل في الناتج كله', () => {
    const json = JSON.stringify(build());
    for (const leaked of ['محمد', 'أحمد', 'نتفليكس', 'جمعية الشغل', 'شغل حر', 'مرتب', 'note', 'personName']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('المحافظ الشغالة بس، والرصيد = walletBalance على كل العمليات بالظبط', () => {
    const s = build();
    expect(s.wallets.map(w => w.id)).toEqual(['w1', 'w2']);
    for (const w of s.wallets) {
      const src = W.find(x => x.id === w.id)!;
      expect(w.balance).toBe(walletBalance(TXS, w.id, src.openingBalance));
    }
    expect(s.wallets[0]).toEqual({ id: 'w1', name: 'الكاش', balance: walletBalance(TXS, 'w1', 1000) });
  });

  it(`آخر ${COLD_CACHE_RECENT} عمليات بنفس ترتيب الرئيسية (التاريخ ثم createdAt)`, () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      tx({ id: `m${i}`, date: `2026-10-${String(10 + i).padStart(2, '0')}`, createdAt: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z` }));
    const s = build(many);
    expect(s.recent).toHaveLength(COLD_CACHE_RECENT);
    expect(s.recent[0].id).toBe('m14');
    expect(s.recent.at(-1)!.id).toBe('m5');
  });

  it('النوع بيتحفظ من غير الاسم: دين / اشتراك / جمعية / دخل ثابت / تسوية', () => {
    const kinds = Object.fromEntries(build().recent.map(r => [r.id, r.kind]));
    expect(kinds).toMatchObject({ t2: 'debt', t5: 'subscription', t6: 'gamiya', t7: 'income', t8: 'settlement' });
    expect(kinds.t1).toBeUndefined();
  });

  it('الفئات اللي العمليات المحفوظة محتاجاها بس (اسم + أيقونة)', () => {
    expect(build().categories).toEqual([{ id: 'c1', name: 'أكل', icon: '🍔' }]);
  });

  it('حقول العملية المحفوظة محددة بالاسم (مفيش حقل جديد بيتسرّب من غير ما حد يقرر)', () => {
    for (const r of build().recent) {
      for (const k of Object.keys(r)) expect(['id', 'type', 'amount', 'walletId', 'toWalletId', 'categoryId', 'date', 'createdAt', 'kind']).toContain(k);
    }
  });
});

describe('parseColdSnapshot — القراية بترفض أي حاجة مش متأكدة منها', () => {
  const raw = () => JSON.stringify(build());
  it('سليم ← نفس اللي اتكتب', () => expect(parseColdSnapshot(raw(), 'u1', NOW)).toEqual(build()));
  it('حساب تاني على نفس الموبايل ← null', () => expect(parseColdSnapshot(raw(), 'u2', NOW)).toBeNull());
  it(`أقدم من ${COLD_CACHE_MAX_AGE_MS / 86400000} يوم ← null`, () =>
    expect(parseColdSnapshot(raw(), 'u1', NOW + COLD_CACHE_MAX_AGE_MS + 1)).toBeNull());
  it('من المستقبل (ساعة الموبايل اتغيّرت) ← لسه مقبول؟ لأ — null', () =>
    expect(parseColdSnapshot(raw(), 'u1', NOW - 60 * 60 * 1000)).toBeNull());
  it.each([
    ['JSON بايظ', '{'],
    ['null', 'null'],
    ['نسخة تانية', JSON.stringify({ ...build(), v: 999 })],
    ['رصيد مش رقم', JSON.stringify({ ...build(), wallets: [{ id: 'w1', name: 'x', balance: 'NaN' }] })],
    ['رصيد Infinity', JSON.stringify({ ...build(), wallets: [{ id: 'w1', name: 'x', balance: 1e999 }] })],
    ['عملية مبلغها سالب', JSON.stringify({ ...build(), recent: [{ id: 'a', type: 'expense', amount: -5, walletId: 'w1', date: '2026-11-01' }] })],
    ['نوع مش معروف', JSON.stringify({ ...build(), recent: [{ id: 'a', type: 'gift', amount: 5, walletId: 'w1', date: '2026-11-01' }] })],
    ['kind مش معروف', JSON.stringify({ ...build(), recent: [{ id: 'a', type: 'expense', amount: 5, walletId: 'w1', date: '2026-11-01', kind: 'loan' }] })],
    ['createdAt مش نص', JSON.stringify({ ...build(), recent: [{ id: 'a', type: 'expense', amount: 5, walletId: 'w1', date: '2026-11-01', createdAt: 5 }] })],
  ])('%s ← null', (_, r) => expect(parseColdSnapshot(r, 'u1', NOW)).toBeNull());
  it('مفيش حاجة متخزّنة ← null', () => expect(parseColdSnapshot(null, 'u1', NOW)).toBeNull());
});

it('المفتاح متربط بالحساب', () => {
  expect(coldCacheKey('u1')).not.toBe(coldCacheKey('u2'));
  expect(coldCacheKey('u1')).toContain('u1');
});

it('الباك أب مقفول للتطبيق كله (قرار مؤمن 2026-11-03 — الكاش على الجهاز من غير تشفير)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const resolved = require('../../app.config.js')({ config: require('../../app.json').expo });
  expect(resolved.android.allowBackup).toBe(false);
});
