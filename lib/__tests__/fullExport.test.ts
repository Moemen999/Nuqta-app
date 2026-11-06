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
    { id: 't2', type: 'expense', amount: 50.25, walletId: 'w1', categoryId: 'c1', date: '2026-11-02', note: 'غدا', createdAt: '2026-11-02T12:00:00Z', subscriptionId: 's1', gamiyaId: 'g1', incomeId: 'n1', periodKey: '2026-11', isSettlement: true, archivedWalletId: 'w2', autoRecorded: true },
    { id: 't1', type: 'withdraw', amount: 100, walletId: 'w1', toWalletId: 'w2', date: '2026-11-01' },
  ],
  debts: [{
    id: 'd1', direction: 'owed_to_me', personName: 'أحمد', totalAmount: 500, date: '2026-10-01', isInstallment: true,
    installmentCount: 5, installmentAmount: 100, createdAt: '2026-10-01T00:00:00Z', personPhone: '0100', personContactId: 'ct9',
    installmentResidue: { amount: 0.37, forInstallment: 100.01, over: 13, increasesTotal: 55.5, lastAbsorbs: true }, dueDate: '2026-12-01', reminderDaysBefore: 3, note: 'سلفة', initialWalletId: 'w1', initialTransactionId: 'td0',
    payments: [{ id: 'p1', date: '2026-10-15', amount: 100, walletId: 'w1', transactionId: 'tp1', categoryId: 'c1' }],
    increases: [{ id: 'i1', date: '2026-10-20', amount: 50, walletId: 'w1', transactionId: 'ti1' }],
  }],
  subscriptions: [{
    id: 's1', name: 'نتفليكس', amount: 150, walletId: 'w1', frequency: 'custom', customDays: 45, nextDueDate: '2026-12-01',
    reminderDaysBefore: 2, active: false, createdAt: '2026-01-01', history: [{ id: 'h1', date: '2026-10-01', amount: 150, periodKey: '2026-10-01', transactionId: 'ts1', auto: true }],
    categoryId: 'c1', chargeMode: 'auto', chargeAutoSince: '2026-09-01', closed: { '2026-10-01': { txId: 'ts1', at: '2026-10-01T09:00:00Z' }, '2026-11-15': { skipped: true, reopened: true, auto: true, at: '2026-11-15T09:00:00Z' } },
  }],
  gamiyas: [{
    id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000, walletId: 'w1',
    startDate: '2026-10-01', reminderDaysBefore: 1, createdAt: '2026-10-01', chargeMode: 'auto', chargeAutoSince: '2026-10-02',
    months: [
      { id: 'm2', monthIndex: 2, dueDate: '2026-11-01', isPayoutMonth: true, amount: 2000, status: 'pending' },
      { id: 'm1', monthIndex: 1, dueDate: '2026-10-01', isPayoutMonth: false, amount: 1000, status: 'done', transactionId: 'tg1', auto: true, reopened: true },
    ],
  }],
  incomes: [
    { id: 'n1', name: 'المرتب', amount: 8000, walletId: 'w1', frequency: 'monthly', dayOfMonth: 25, mode: 'confirm', status: 'active', startDate: '2026-01-01', createdAt: '2026-01-01',
      closed: { '2026-10': { txId: 'tn1', at: '2026-10-25T10:00:00Z' }, '2026-11': { skipped: true, at: '2026-11-25T10:00:00Z' } } },
    { id: 'n2', name: 'شغل حر', amount: 500, walletId: 'w1', frequency: 'weekly', weekday: 4, mode: 'auto', status: 'paused', startDate: '2026-02-01', createdAt: '2026-02-01' },
  ],
  budgets: { c1: 2000 },
  shakhbataIncome: { '2026-11': 9000, '2026-10': 8500 },
  shakhbataPercents: { needs: 50, wants: 30, future: 20 },
  feedback: [
    { id: 'f2', type: 'idea', text: 'زرار أسرع', createdAt: '2026-11-03T10:00:00.000Z', appVersion: '1.0.0', buildNumber: '9', fullVersion: '1.0.0.004', platform: 'android', deviceModel: 'Xiaomi 11', osVersion: '13' },
    { id: 'f1', type: 'bug', text: 'الرصيد مش ظاهر', createdAt: '2026-11-01T08:00:00.000Z', appVersion: '1.0.0', buildNumber: '8', fullVersion: '1.0.0.003', platform: 'android', deviceModel: 'Galaxy A56', osVersion: '15' },
  ],
};
const sheets = buildFullExportSheets(input);
const sheet = (name: string) => sheets.find(x => x.name === name)!.rows;

it('ورقة لكل نوع متخزّن', () => {
  expect(sheets.map(x => x.name)).toEqual([
    'Wallets', 'Categories', 'Transactions', 'Debts', 'DebtPayments', 'DebtIncreases', 'Subscriptions',
    'SubscriptionPayments', 'SubscriptionPeriods', 'Gamiyas', 'GamiyaMonths', 'FixedIncomes', 'IncomePeriods', 'Budgets', 'Shakhbata', 'ShakhbataPercents', 'Feedback',
  ]);
});

it('كل عنصر صف — المؤرشف والواقف جوّه', () => {
  expect(sheet('Wallets')).toHaveLength(2);
  expect(sheet('Wallets')[1]).toMatchObject({ Id: 'w2', Archived: true, ArchivedAt: '2026-10-01' });
  expect(sheet('Subscriptions')[0]).toMatchObject({ Id: 's1', Active: false, Frequency: 'custom', CustomDays: 45, ChargeMode: 'auto', ChargeAutoSince: '2026-09-01' });
  expect(sheet('GamiyaMonths').map(r => r.Id)).toEqual(['m1', 'm2']);
  expect(sheet('Shakhbata').map(r => r.Month)).toEqual(['2026-10', '2026-11']);
});

it('الأوراق بتتربط بالمعرّفات، والأسامي جنبها', () => {
  expect(sheet('Transactions')[0]).toMatchObject({ Id: 't1', ToWalletId: 'w2', ToWallet: 'قديمة', Wallet: 'الكاش' });
  expect(sheet('DebtPayments')[0]).toMatchObject({ DebtId: 'd1', Person: 'أحمد', TransactionId: 'tp1', Amount: 100 });
  expect(sheet('DebtIncreases')[0]).toMatchObject({ DebtId: 'd1', WalletId: 'w1', Amount: 50, TransactionId: 'ti1' });
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
  const empty = buildFullExportSheets({ ...input, wallets: [], categories: [], transactions: [], debts: [], subscriptions: [], gamiyas: [], incomes: [], budgets: {}, shakhbataIncome: {}, feedback: [] });
  expect(empty).toHaveLength(17);
  expect(empty.find(x => x.name === 'Transactions')!.rows).toEqual([]);
});

/**
 * الجرد (silent-failure-hunter): **كل** قيمة متخزّنة في المدخل — في أي عمق (`installmentResidue.over`،
 * `closed['2026-11'].skipped`…) — لازم تطلع في خلية في الملف. حقل جديد يتضاف للنوع ويتملى في المدخل هنا ومش في
 * الملف ← الاختبار ده يقع. (`true` بس من المنطقيات — `false` هو الافتراضي في الملف.)
 */
it('كل قيمة متخزّنة في المدخل طالعة في الملف (مفيش حقل بيضيع)', () => {
  const cells = new Set<string>();
  for (const sh of sheets) for (const row of sh.rows) for (const v of Object.values(row)) cells.add(String(v));
  const missing: string[] = [];
  const walk = (x: unknown, path: string) => {
    if (x === null || x === undefined || x === false) return;
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, `${path}[${i}]`)); return; }
    if (typeof x === 'object') {
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        // مفاتيح السجلات (الفترات، الميزانية، شهور الشخبطة) بيانات برضه، بتطلع كقيمة في عمود
        if (/^\d{4}-\d{2}(-\d{2})?$/.test(k) || /^c\d$/.test(k)) { if (!cells.has(k)) missing.push(`${path} key ${k}`); }
        walk(v, `${path}.${k}`);
      }
      return;
    }
    if (!cells.has(String(x))) missing.push(`${path} = ${String(x)}`);
  };
  walk(input, 'input');
  expect(missing).toEqual([]);
});

it('الرأي اللي بعته بالترتيب، والنوع خام', () => {
  expect(sheet('Feedback').map(r => r.Id)).toEqual(['f1', 'f2']);
  expect(sheet('Feedback')[0]).toMatchObject({ Type: 'bug', Text: 'الرصيد مش ظاهر', SentAt: '2026-11-01T08:00:00.000Z', FullVersion: '1.0.0.003' });
});

it('نسب الشخبطة مش متخزّنة ← الافتراضي بعلامة IsDefault، مش كأن المستخدم اختارها', () => {
  const rows = buildFullExportSheets({ ...input, shakhbataPercents: null }).find(x => x.name === 'ShakhbataPercents')!.rows;
  expect(rows).toEqual([{ Needs: 50, Wants: 30, Future: 20, IsDefault: true }]);
  expect(sheet('ShakhbataPercents')[0].IsDefault).toBe(false);
});


describe('localizeSheets — الأسامي بالعربي والقيم زي ما هي', () => {
  const { localizeSheets, SHEET_NAMES_AR, COLUMN_NAMES_AR } = require('@/lib/fullExport');
  const ar = localizeSheets(sheets);
  it('كل ورقة وكل عمود ليهم اسم عربي (مفيش اسم إنجليزي فاضل)', () => {
    for (const sh of sheets) {
      expect(SHEET_NAMES_AR[sh.name]).toBeTruthy();
      // كل الصفوف مش أول صف بس — حقل في صف تاني من غير ترجمة كان هيعدّي بالإنجليزي (code-reviewer)
      for (const r of sh.rows) for (const k of Object.keys(r)) expect({ sheet: sh.name, key: k, ar: COLUMN_NAMES_AR[k] }).toMatchObject({ ar: expect.any(String) });
    }
    // والناتج نفسه: مفيش ولا مفتاح من غير حرف عربي (الـ`?? k` في localizeSheets بيرجّع الإنجليزي ساكت)
    for (const sh of ar) for (const r of sh.rows) for (const k of Object.keys(r)) expect({ sheet: sh.name, key: k }).toMatchObject({ key: expect.stringMatching(/[؀-ۿ]/) });
  });
  it('عمود واحد = معنى واحد: "الدخل الثابت" اسم و"الدخل الشهري" مبلغ (كانوا الاتنين "الدخل")', () => {
    expect(Object.keys(ar.find((s: { name: string }) => s.name === 'توزيع الدخل').rows[0])).toEqual(['الشهر', 'الدخل الشهري']);
    expect(Object.keys(ar.find((s: { name: string }) => s.name === 'فترات الدخل الثابت').rows[0])).toContain('الدخل الثابت');
  });
  it('أسامي الأوراق تنفع في Excel: ≤ 31 حرف، من غير / \ ? * : [ ]، ومفيش تكرار', () => {
    const names = ar.map((s: { name: string }) => s.name);
    for (const n of names) { expect(n.length).toBeLessThanOrEqual(31); expect(n).not.toMatch(/[/\\?*:[\]]/); }
    expect(new Set(names).size).toBe(names.length);
  });
  it('أسامي الأعمدة مش متكررة جوه نفس الورقة (كانت هتمسح عمود)', () => {
    for (const sh of ar) for (const r of sh.rows) { const ks = Object.keys(r); expect(new Set(ks).size).toBe(ks.length); }
  });
  it('كل قيمة في كل ورقة وكل صف زي ما هي وبنفس الترتيب (تواريخ وأرقام وصح/غلط)', () => {
    expect(ar.length).toBe(sheets.length);
    sheets.forEach((sh, i) => {
      expect(ar[i].rows.length).toBe(sh.rows.length);
      sh.rows.forEach((r, j) => expect(Object.values(ar[i].rows[j])).toEqual(Object.values(r)));
    });
  });
  it('القيم نفسها مااتغيّرتش (المعرّفات والأنواع الخام)', () => {
    const tx = ar.find((s: { name: string }) => s.name === 'العمليات').rows[0];
    expect(tx['المعرّف']).toBe('t1');
    expect(tx['النوع']).toBe('withdraw');
    expect(tx['المبلغ']).toBe(100);
  });
});

describe('feedbackFromDoc — مفيش قيمة متخزّنة بتتبلع (silent-failure-hunter جولة 1)', () => {
  const { feedbackFromDoc } = require('@/lib/fullExport');
  it('Timestamp ← نص ISO', () => {
    const r = feedbackFromDoc('f1', { type: 'bug', text: 'x', createdAt: { toDate: () => new Date('2026-11-01T08:00:00Z') } });
    expect(r.createdAt).toBe('2026-11-01T08:00:00.000Z');
  });
  it('حقل نوعه غلط بيطلع نصّه، مش خلية فاضية', () => {
    const r = feedbackFromDoc('f1', { type: 7, text: 123, buildNumber: 9, createdAt: '2026-11-01' });
    expect(r).toMatchObject({ type: '7', text: '123', buildNumber: '9', createdAt: '2026-11-01' });
    // object (مستند متعدّل من الكونسول) بقيمته مش [object Object] — جولة 2 NIT
    expect(feedbackFromDoc('f1', { text: { a: 1 } }).text).toBe('{"a":1}');
  });
  it('createdAt مش Timestamp ومش نص ← بيطلع زي ما هو (مش فاضي)', () => {
    expect(feedbackFromDoc('f1', { createdAt: { seconds: 5 } }).createdAt).toBe('{"seconds":5}');
    expect(feedbackFromDoc('f1', { createdAt: 1700000000 }).createdAt).toBe('1700000000');
  });
  it('الحقل مش متخزّن ← فاضي (ده المعنى الوحيد للخلية الفاضية)', () => {
    expect(feedbackFromDoc('f1', { type: 'idea', text: 'x' })).toMatchObject({ createdAt: '', fullVersion: '', osVersion: '' });
  });
  it('رأي من غير تاريخ في آخر الورقة، والتعادل بالمعرّف', () => {
    const base = { type: 'idea', text: 't', appVersion: '', buildNumber: '', fullVersion: '', platform: '', deviceModel: '', osVersion: '' };
    const rows = buildFullExportSheets({ ...input, feedback: [
      { ...base, id: 'z', createdAt: '' }, { ...base, id: 'b', createdAt: '2026-11-02T00:00:00.000Z' }, { ...base, id: 'a', createdAt: '2026-11-02T00:00:00.000Z' },
    ] }).find(x => x.name === 'Feedback')!.rows;
    expect(rows.map(r => r.Id)).toEqual(['a', 'b', 'z']);
  });
});
