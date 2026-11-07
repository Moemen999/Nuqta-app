import { clearFirestore, signInTestUser, writeRawDoc } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { walletBalance } from '@/lib/finance';
import { spendingExpenses, transferTransactionIds } from '@/lib/spending';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * اختبار "عنيف" (طلب مؤمن 2026-11-07): القواعد بتقبل قيم بايظة جوه حساب الواحد نفسه (Infinity، سالب، أسامي فاضية،
 * نص 900KB، تاريخ بايظ، أنواع غلط — اتقاس في attackProbe). هنا بنكتبهم كلهم مرة واحدة في الحساب ونشغّل الـDataProvider
 * الحقيقي: لازم مفيش كراش، والأرصدة اللي بتتحسب أرقام محدودة (مش NaN/Infinity).
 */
let harness: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});
afterEach(async () => { await harness.unmount(); });

it('حساب مليان بيانات بايظة ← مفيش كراش، والأرصدة والمصروف أرقام محدودة', async () => {
  const A = getMockUid();
  await harness.waitForData(a => a.wallets.length > 0);
  const w = harness.api().wallets[0].id;
  const big = 'x'.repeat(900000);
  const tx = { type: 'expense', amount: 10, walletId: w, date: '2026-01-01' };
  const writes: [string[], object][] = [
    [['transactions', 't1'], { ...tx, amount: Infinity }],
    [['transactions', 't13'], { ...tx, note: big }],
    [['transactions', 't14'], { ...tx, date: 'not-a-date' }],
    [['transactions', 't15'], { ...tx, createdAt: 12345, note: { a: { b: [1] } }, toWalletId: 5 }],
    [['debts', 'd1'], { personName: 'x', totalAmount: Infinity, direction: 'i_owe' }],
    [['debts', 'd16'], { personName: '', totalAmount: 1, direction: 'i_owe', payments: [{ amount: -1e9 }], increases: 'x' }],
    [['subscriptions', 's1'], { name: '', amount: Infinity }],
    [['wallets', 'w1'], { name: 'x', openingBalance: NaN, lowAlert: Infinity }],
    [['wallets', 'w2'], { name: 'y', openingBalance: -1e300, lowAlert: 0 }],
    [['gamiyas', 'g1'], { name: '', monthlyAmount: -5 }],
    [['shakhbata_settings', 'percents'], { needs: NaN, wants: -50, future: 1e308 }],
    [['budgets', 'c1'], { limit: Infinity }],
    [['shakhbata_income', '2026-01'], { income: Infinity }],
  ];
  // من غير القواعد: القواعد المشدودة (2026-11-07) بترفض الكتابات دي من الكلاينت — بس البيانات القديمة لسه ممكن تكون كده
  for (const [p, data] of writes) await writeRawDoc(['users', A, ...p].join('/'), data as Record<string, unknown>);
  await harness.waitForData(a => a.wallets.length >= 3 && a.brokenTransactions.length >= 1, 20000);
  const api = harness.api();
  // الأرصدة: كل محفظة رقم محدود (البايظ برّه الحساب)
  for (const wl of api.wallets) expect(Number.isFinite(walletBalance(api.transactions, wl.id, wl.openingBalance))).toBe(true);
  // المصروف: محدود
  const exp = spendingExpenses(api.transactions, transferTransactionIds(api.debts, api.gamiyas));
  expect(Number.isFinite(exp.reduce((s: number, t: { amount: number }) => s + t.amount, 0))).toBe(true);
  // الملاحظة اللي مش نص ما كسرتش حاجة، والعملية بالـ900KB موجودة
  expect(api.transactions.some(t => t.id === 't13')).toBe(true);
});
