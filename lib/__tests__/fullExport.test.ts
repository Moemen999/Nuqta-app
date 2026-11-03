import { buildFullExportSheets, type FullExportInput } from '@/lib/fullExport';

/**
 * التصدير الكامل: **كل** اللي متخزّن بيطلع (كل نوع ورقة، وكل عنصر صف — حتى المؤرشف)، والأوراق بتتربط
 * بالمعرّفات، والأرقام خام. ده نص "associated data" اللي بلاي بتطلبه قبل المسح.
 */
const input: FullExportInput = {
  wallets: [
    { id: 'w1', name: 'الكاش', openingBalance: 1000, lowAlert: 100 },
    { id: 'w2', name: 'قديمة', openingBalance: 0, lowAlert: 0, archived: true, archivedAt: '2026-10-01' },
  ],
  categories: [{ id: 'c1', name: 'أكل', icon: '🍔', bucket: 'needs' }],
  transactions: [
    { id: 't2', type: 'expense', amount: 50.25, walletId: 'w1', categoryId: 'c1', date: '2026-11-02', note: 'غدا' },
    { id: 't1', type: 'withdraw', amount: 100, walletId: 'w1', toWalletId: 'w2', date: '2026-11-01' },
  ],
  debts: [{
    id: 'd1', direction: 'owed_to_me', personName: 'أحمد', totalAmount: 500, date: '2026-10-01', isInstallment: true,
    installmentCount: 5, installmentAmount: 100, createdAt: '2026-10-01T00:00:00Z',
    payments: [{ id: 'p1', date: '2026-10-15', amount: 100, walletId: 'w1', transactionId: 'tp1' }],
    increases: [{ id: 'i1', date: '2026-10-20', amount: 50 }],
  }],
  subscriptions: [{
    id: 's1', name: 'نتفليكس', amount: 150, walletId: 'w1', frequency: 'custom', customDays: 45, nextDueDate: '2026-12-01',
    reminderDaysBefore: 2, active: false, createdAt: '2026-01-01', history: [{ id: 'h1', date: '2026-10-01', amount: 150 }],
  }],
  gamiyas: [{
    id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000, walletId: 'w1',
    startDate: '2026-10-01', reminderDaysBefore: 1, createdAt: '2026-10-01',
    months: [
      { id: 'm2', monthIndex: 2, dueDate: '2026-11-01', isPayoutMonth: true, amount: 2000, status: 'pending' },
      { id: 'm1', monthIndex: 1, dueDate: '2026-10-01', isPayoutMonth: false, amount: 1000, status: 'done', transactionId: 'tg1' },
    ],
  }],
  incomes: [{ id: 'n1', name: 'المرتب', amount: 8000, walletId: 'w1', frequency: 'monthly', dayOfMonth: 25, mode: 'confirm', status: 'active', startDate: '2026-01-01', createdAt: '2026-01-01' }],
  budgets: { c1: 2000 },
  shakhbataIncome: { '2026-11': 9000, '2026-10': 8500 },
  shakhbataPercents: { needs: 50, wants: 30, future: 20 },
};
const sheets = buildFullExportSheets(input);
const sheet = (name: string) => sheets.find(x => x.name === name)!.rows;

it('ورقة لكل نوع متخزّن', () => {
  expect(sheets.map(x => x.name)).toEqual([
    'Wallets', 'Categories', 'Transactions', 'Debts', 'DebtPayments', 'DebtIncreases', 'Subscriptions',
    'SubscriptionPayments', 'Gamiyas', 'GamiyaMonths', 'FixedIncomes', 'Budgets', 'Shakhbata', 'ShakhbataPercents',
  ]);
});

it('كل عنصر صف — المؤرشف والواقف جوّه', () => {
  expect(sheet('Wallets')).toHaveLength(2);
  expect(sheet('Wallets')[1]).toMatchObject({ Id: 'w2', Archived: true, ArchivedAt: '2026-10-01' });
  expect(sheet('Subscriptions')[0]).toMatchObject({ Id: 's1', Active: false, Frequency: 'custom', CustomDays: 45, ChargeMode: 'confirm' });
  expect(sheet('GamiyaMonths').map(r => r.Id)).toEqual(['m1', 'm2']);
  expect(sheet('Shakhbata').map(r => r.Month)).toEqual(['2026-10', '2026-11']);
});

it('الأوراق بتتربط بالمعرّفات، والأسامي جنبها', () => {
  expect(sheet('Transactions')[0]).toMatchObject({ Id: 't1', ToWalletId: 'w2', ToWallet: 'قديمة', Wallet: 'الكاش' });
  expect(sheet('DebtPayments')[0]).toMatchObject({ DebtId: 'd1', Person: 'أحمد', TransactionId: 'tp1', Amount: 100 });
  expect(sheet('DebtIncreases')[0]).toMatchObject({ DebtId: 'd1', WalletId: '', Amount: 50 });
  expect(sheet('Budgets')[0]).toEqual({ CategoryId: 'c1', Category: 'أكل', MonthlyLimit: 2000 });
});

it('الأرقام خام (مش متقرّبة ولا مخفية) والعمليات بالتاريخ', () => {
  expect(sheet('Transactions').map(r => r.Amount)).toEqual([100, 50.25]);
});

it('مفيش خلية undefined/NaN/object (الإكسيل بيكتبها غلط أو بيقع)', () => {
  for (const sh of sheets) for (const row of sh.rows) for (const v of Object.values(row)) {
    expect(['string', 'number', 'boolean']).toContain(typeof v);
    if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
  }
});

it('حساب فاضي ← نفس الأوراق من غير صفوف (مبيقعش)', () => {
  const empty = buildFullExportSheets({ ...input, wallets: [], categories: [], transactions: [], debts: [], subscriptions: [], gamiyas: [], incomes: [], budgets: {}, shakhbataIncome: {} });
  expect(empty).toHaveLength(14);
  expect(empty.find(x => x.name === 'Transactions')!.rows).toEqual([]);
});
