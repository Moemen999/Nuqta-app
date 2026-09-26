/**
 * بيانات حساب الاختبار — ثابتة، وأساميها وهمية بشكل واضح ("تجربة 1"، "فئة أ"،
 * "صاحبي أ") عشان عمرها ما تتلخبط مع بيانات حقيقية.
 *
 * الملف ده **بيانات بس** من غير كتابة: الكتابة في `app/dev-seed.tsx` عن طريق
 * دوال `DataContext` نفسها، فالعمليات المرتبطة (الدين وعمليته الأولى، شهور
 * الجمعية) بتطلع بالظبط زي ما التطبيق بيعملها. والمسح هنا بيحدد **إيه** اللي
 * يتمسح، والشاشة بتمسحه.
 *
 * التواريخ نسبية لليوم (العمليات جوه الشهر ده، والدخل الثابت معاده النهارده
 * عشان كارت "نزل؟" يظهر). اللي ثابت: الأسامي والمبالغ وعدد كل حاجة.
 *
 * طريقة التشغيل والمسح: CLAUDE.md، قسم "حساب الاختبار".
 */
import type { Transaction } from '@/context/DataContext';

export const SEED_WALLETS = [
  { name: 'تجربة 1', openingBalance: 5000, lowAlert: 500 },
  { name: 'تجربة 2', openingBalance: 2000, lowAlert: 200 },
  { name: 'تجربة 3', openingBalance: 1000, lowAlert: 0 },
] as const;

export const SEED_CATEGORIES = ['فئة أ', 'فئة ب', 'فئة ج', 'فئة د', 'فئة هـ'] as const;

export const SEED_DEBT_PEOPLE = ['صاحبي أ', 'صاحبي ب'] as const;
export const SEED_SUBSCRIPTION = 'اشتراك تجربة';
export const SEED_GAMIYA = 'جمعية تجربة';
export const SEED_INCOME = 'دخل ثابت تجربة';

/** الاسم ← المعرّف، بعد ما المحافظ والفئات يوصلوا من الـlistener */
export type SeedIds = { wallets: Record<string, string>; categories: Record<string, string> };

/** اليوم ناقص n يوم، من غير ما يطلع برّه الشهر ده (عشان التقارير والميزانية) */
function daysAgo(today: string, n: number) {
  const [y, m, d] = today.split('-').map(Number);
  const day = Math.max(1, d - n);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthStart(today: string) {
  return `${today.slice(0, 7)}-01`;
}

/** عشر عمليات: دخل واحد، تمن مصاريف على الفئات الخمسة، وتحويل واحد */
export function seedTransactions(ids: SeedIds, today: string): Omit<Transaction, 'id'>[] {
  const w = (i: 1 | 2 | 3) => ids.wallets[`تجربة ${i}`];
  const c = (name: (typeof SEED_CATEGORIES)[number]) => ids.categories[name];
  return [
    { type: 'income', amount: 3000, walletId: w(1), note: 'دخل تجربة', date: daysAgo(today, 10) },
    { type: 'expense', amount: 150, walletId: w(1), categoryId: c('فئة أ'), date: daysAgo(today, 9) },
    { type: 'expense', amount: 80, walletId: w(2), categoryId: c('فئة ب'), date: daysAgo(today, 8) },
    { type: 'expense', amount: 200, walletId: w(1), categoryId: c('فئة ج'), date: daysAgo(today, 7) },
    { type: 'expense', amount: 50, walletId: w(3), categoryId: c('فئة د'), date: daysAgo(today, 6) },
    { type: 'expense', amount: 120, walletId: w(1), categoryId: c('فئة هـ'), date: daysAgo(today, 5) },
    { type: 'expense', amount: 300, walletId: w(2), categoryId: c('فئة أ'), date: daysAgo(today, 4) },
    { type: 'expense', amount: 40, walletId: w(3), categoryId: c('فئة ب'), date: daysAgo(today, 3) },
    { type: 'expense', amount: 60, walletId: w(1), categoryId: c('فئة ج'), date: daysAgo(today, 2) },
    { type: 'withdraw', amount: 500, walletId: w(1), toWalletId: w(3), date: daysAgo(today, 1) },
  ];
}

export function seedDebts(ids: SeedIds, today: string) {
  return [
    // سلّفت صاحبي أ 1000 من تجربة 1 — بيولّد عملية خروج فلوس زي الشاشة بالظبط
    {
      direction: 'owed_to_me' as const, personName: 'صاحبي أ', totalAmount: 1000,
      isInstallment: false, walletId: ids.wallets['تجربة 1'], date: daysAgo(today, 6),
    },
    // عليّا لصاحبي ب 600 على 3 أقساط، من غير محفظة (دين قديم)
    {
      direction: 'i_owe' as const, personName: 'صاحبي ب', totalAmount: 600,
      isInstallment: true, installmentCount: 3, date: daysAgo(today, 5),
    },
  ];
}

export function seedSubscription(ids: SeedIds, today: string) {
  const [y, m, d] = today.split('-').map(Number);
  const due = new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
  return {
    name: SEED_SUBSCRIPTION, amount: 100, walletId: ids.wallets['تجربة 1'], categoryId: ids.categories['فئة هـ'],
    frequency: 'monthly' as const, nextDueDate: due, reminderDaysBefore: 1,
  };
}

export function seedGamiya(ids: SeedIds, today: string) {
  return {
    name: SEED_GAMIYA, monthlyAmount: 500, totalMonths: 4, payoutMonthIndex: 2, payoutAmount: 2000,
    walletId: ids.wallets['تجربة 2'], startDate: monthStart(today), reminderDaysBefore: 2,
  };
}

/** معاده النهارده و"بيسألك الأول" — فكارت "نزل؟" بيظهر في الرئيسية على طول */
export function seedIncome(ids: SeedIds, today: string) {
  return {
    name: SEED_INCOME, amount: 4000, walletId: ids.wallets['تجربة 1'],
    frequency: 'monthly' as const, dayOfMonth: Number(today.slice(8, 10)), mode: 'confirm' as const,
  };
}

type Named = { id: string; name: string };
type Linked = { transactionId?: string };
export type SeedScanInput = {
  wallets: (Named & { openingBalance?: number; lowAlert?: number })[];
  categories: Named[];
  debts: { id: string; personName: string; initialTransactionId?: string; payments?: Linked[]; increases?: Linked[] }[];
  subscriptions: (Named & { history?: Linked[] })[];
  gamiyas: (Named & { months?: Linked[] })[];
  incomes: Named[];
  transactions: { id: string; type?: string; amount?: number; walletId: string; toWalletId?: string; incomeId?: string }[];
  budgets: Record<string, unknown>;
};
export type SeedDocRef = { collection: string; id: string };

const WALLET_NAMES = new Set<string>(SEED_WALLETS.map(w => w.name));
const CATEGORY_NAMES = new Set<string>(SEED_CATEGORIES);
const PEOPLE = new Set<string>(SEED_DEBT_PEOPLE);

function seedEntities(d: SeedScanInput) {
  return {
    wallets: d.wallets.filter(w => WALLET_NAMES.has(w.name)),
    categories: d.categories.filter(c => CATEGORY_NAMES.has(c.name)),
    debts: d.debts.filter(x => PEOPLE.has(x.personName)),
    subscriptions: d.subscriptions.filter(x => x.name === SEED_SUBSCRIPTION),
    gamiyas: d.gamiyas.filter(x => x.name === SEED_GAMIYA),
    incomes: d.incomes.filter(i => i.name === SEED_INCOME),
  };
}

/**
 * كل مستند التعبئة عملته — بالاسم من القايمة الثابتة بس، ومفيش wildcard.
 *
 * العمليات بتتمسك بطريقتين:
 * - أي عملية على محفظة تجربة (من، أو لـ)، أو تبع دخل التجربة.
 * - أي عملية معرّفها متخزّن جوه كيان تجربة (أول عملية الدين، دفعاته
 *   وزياداته، مدفوعات الاشتراك، شهور الجمعية). ده ضروري: دفعة الدين بتتعمل
 *   من **أي** محفظة يختارها اللي بيجرّب — ولو اختار محفظة مش تجربة (زي
 *   الافتراضية بتاعة الحساب الجديد) كانت هتفضل بعد المسح (money-reviewer).
 *
 * الميزانيات بتاعة فئات التجربة بتتمسح معاها لو موجودة، زي `deleteCategory`.
 * الشخبطة مش هنا: التعبئة مبتلمسهاش، والمسح مش إعادة ضبط كاملة للحساب.
 */
export function seedDocs(d: SeedScanInput): SeedDocRef[] {
  const e = seedEntities(d);
  const walletIds = new Set(e.wallets.map(w => w.id));
  const incomeIds = new Set(e.incomes.map(i => i.id));
  const linked = new Set<string>([
    ...e.debts.flatMap(x => [x.initialTransactionId, ...(x.payments ?? []).map(p => p.transactionId), ...(x.increases ?? []).map(p => p.transactionId)]),
    ...e.subscriptions.flatMap(x => (x.history ?? []).map(p => p.transactionId)),
    ...e.gamiyas.flatMap(x => (x.months ?? []).map(m => m.transactionId)),
  ].filter((id): id is string => !!id));
  const txs = d.transactions.filter(t =>
    linked.has(t.id) || walletIds.has(t.walletId) || (!!t.toWalletId && walletIds.has(t.toWalletId)) || (!!t.incomeId && incomeIds.has(t.incomeId)));
  return [
    ...txs.map(t => ({ collection: 'transactions', id: t.id })),
    ...e.debts.map(x => ({ collection: 'debts', id: x.id })),
    ...e.subscriptions.map(x => ({ collection: 'subscriptions', id: x.id })),
    ...e.gamiyas.map(x => ({ collection: 'gamiyas', id: x.id })),
    ...e.incomes.map(x => ({ collection: 'incomes', id: x.id })),
    ...e.categories.filter(c => d.budgets[c.id] != null).map(c => ({ collection: 'budgets', id: c.id })),
    ...e.categories.map(c => ({ collection: 'categories', id: c.id })),
    ...e.wallets.map(w => ({ collection: 'wallets', id: w.id })),
  ];
}

/**
 * إيه اللي ناقص عشان التعبئة تبقى كاملة — فاضية = كاملة.
 *
 * ده **مصدر الحقيقة** للشاشة، مش تنبيه الكتابة العام: `reportWriteError`
 * بيعرض تنبيه واحد كل 10 ثواني، وكل العمليات اسمها "العملية"، فلو 4 من
 * العشرة فشلوا كان هيبان تنبيه واحد والشاشة تقول "خلصت" (silent-failure-hunter).
 * العمليات العشرة بتتعد بالبصمة (النوع + المبلغ + المحفظة + المحفظة التانية).
 *
 * **قيد لازم يفضل:** مبالغ التعبئة على نفس المحفظة لازم تفضل مختلفة عن بعض في
 * كل الكيانات (العشرة، أول عملية الدين 1000، الاشتراك 100، الجمعية 500/2000،
 * الدخل 4000). لو اتنين اتساووا، عملية منهم ممكن تتعد مكان التانية و"كاملة"
 * تطلع وهي ناقصة.
 */
export function seedMissing(d: SeedScanInput): string[] {
  const e = seedEntities(d);
  const missing: string[] = [];
  const walletByName = new Map(e.wallets.map(w => [w.name, w]));
  for (const w of SEED_WALLETS) {
    const got = walletByName.get(w.name);
    if (!got) missing.push(`محفظة "${w.name}"`);
    else if (got.openingBalance !== w.openingBalance || got.lowAlert !== w.lowAlert) missing.push(`رصيد "${w.name}" الافتتاحي`);
  }
  const catNames = new Set(e.categories.map(c => c.name));
  SEED_CATEGORIES.filter(c => !catNames.has(c)).forEach(c => missing.push(`فئة "${c}"`));

  const ids: SeedIds = {
    wallets: Object.fromEntries(e.wallets.map(w => [w.name, w.id])),
    categories: Object.fromEntries(e.categories.map(c => [c.name, c.id])),
  };
  const pool = [...d.transactions];
  let found = 0;
  for (const t of seedTransactions(ids, '2000-01-01')) {
    const i = pool.findIndex(p => !!t.walletId && p.type === t.type && p.amount === t.amount
      && p.walletId === t.walletId && (p.toWalletId ?? undefined) === (t.toWalletId ?? undefined));
    if (i >= 0) { found++; pool.splice(i, 1); }
  }
  if (found < 10) missing.push(`عمليات (${found} من 10)`);

  const txIds = new Set(d.transactions.map(t => t.id));
  for (const p of SEED_DEBT_PEOPLE) {
    const debt = e.debts.find(x => x.personName === p);
    if (!debt) missing.push(`دين "${p}"`);
    else if (debt.initialTransactionId && !txIds.has(debt.initialTransactionId)) missing.push(`أول عملية لدين "${p}"`);
  }
  if (!e.subscriptions.length) missing.push(`"${SEED_SUBSCRIPTION}"`);
  if (!e.gamiyas.length) missing.push(`"${SEED_GAMIYA}"`);
  if (!e.incomes.length) missing.push(`"${SEED_INCOME}"`);
  return missing;
}

/** نفس صيغة `countPhrase` في `lib/archiving.ts` — صفر من غير رقم، والمثنى والجمع */
export function documentsPhrase(n: number) {
  if (n <= 0) return 'مفيش مستندات';
  if (n === 1) return 'مستند واحد';
  if (n === 2) return 'مستندين';
  if (n <= 10) return `${n} مستندات`;
  return `${n} مستند`;
}
