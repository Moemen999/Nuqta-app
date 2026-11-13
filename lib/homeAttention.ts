import type { Category, Gamiya, Subscription, Transaction, Wallet } from '@/context/DataContext';
import { budgetLevel } from '@/lib/budgetForecast';
import type { BannerType } from '@/lib/bannerDismiss';
import { daysUntil, monthSpend } from '@/lib/finance';
import { speakable, type AmountFormatter } from '@/lib/money';

/**
 * «حاجات محتاجة انتباهك» في الرئيسية (2026-11-13): الحالات اللي كانت بانرات روتينية
 * (إيميل مش مأكّد، لسه ما سجلتش، رصيد قرب يخلص، ميزانية فئة، اشتراك وقسط جمعية جايين)
 * بقت عناصر في قايمة واحدة بتتعرض في سطر + شيت (`components/AttentionSheet.tsx`).
 *
 * **الشروط اللي بتقرر امتى كل عنصر يظهر اتنقلت زي ما هي** من `app/(tabs)/index.tsx` (نفس
 * الحدود، نفس `budgetLevel`، نفس نافذة الأيام، نفس ساعة التذكير) — دالة صافية، مفيش حسبة فلوس
 * جديدة. **النص والـlabel والمفتاح** (`type` + `instance`) نفس اللي البانر كان بيستخدمه، فأي ✕
 * قديم لسه بيسري ومفيش حاجة اتقفلت قبل كده بترجع.
 *
 * **اللي مش هنا عن قصد:** بانرات «الأرقام ممكن تكون غلط» (class A) و«ما سجلناش» وسطر
 * «مستنيين ردك» — دول بيفضلوا في الرئيسية نفسها ومبيتعدّوش.
 */

export type AttentionKind = 'budget' | 'low' | 'subscription' | 'gamiya' | 'verifyEmail' | 'noTxToday';

export type AttentionRoute = '/(tabs)/planning' | '/settings-screens/wallets' | '/(tabs)/debts';

export type AttentionItem = {
  /** معرّف فريد (للـtestID والمفتاح): `low_w1`، `budget_c1`، `sub_s1`، `gamiya_m2`، `verify_email`، `no_tx_today` */
  id: string;
  kind: AttentionKind;
  /** نوع الـ✕ ومفتاحه — **نفس** اللي البانر كان بيعدّيه لـ`dismiss(type, instance)` */
  type: BannerType;
  instance?: string;
  /** النص المعروض (المبالغ فيه عدّت على `money` يعني مخفية لو العين مقفولة) */
  text: string;
  /** اللي قارئ الشاشة بيقراه — `speakable(...)` زي البانر. للإيميل و«لسه ما سجلتش»: النص نفسه */
  label: string;
  /** الاسم اللي في `dismissLabel(type, name)` — الإيميل و«لسه ما سجلتش» من غير اسم */
  dismissName?: string;
  tone: 'danger' | 'warn' | 'plain';
  /** وجهة الدوسة: الاشتراك والجمعية ← الديون (وجهتهم القديمة)، والرصيد ← المحافظ والميزانية ← التخطيط (جديدتين بقرار مؤمن 2026-11-13، البانرات القديمة ماكانتش بتتداس). من غيرها (الإيميل، لسه ما سجلتش) الصف مبيفتحش حاجة */
  route?: AttentionRoute;
  /** مرتّب في القايمة — الأقل الأول */
  rank: number;
  /** جوه الرتبة: أقرب يوم الأول، أو خلصت قبل قربت */
  sort: number;
};

export type AttentionInput = {
  activeWallets: Wallet[];
  /** رصيد كل محفظة نشطة (`walletBalance`) — بيتحسب في الرئيسية زي ما كان */
  balances: Map<string, number>;
  activeCategories: Category[];
  transactions: Transaction[];
  budgets: Record<string, number>;
  /** السلفة وقسط الجمعية مش مصروف (`transferTransactionIds`) */
  transfers: Set<string>;
  /** بند 11: وهي بتحمّل السلفة بتتعدّ مصروف — بانر الميزانية مبيولّعش (`transfersStatus !== 'loading'`) */
  spendKnown: boolean;
  nowMonth: string;
  subscriptions: Subscription[];
  gamiyas: Gamiya[];
  hasTodayTx: boolean;
  /** حالات الرئيسية اللي بتمنع «لسه ما سجلتش» (مفيش نت وفاضي، مفيش محفظة، كاش بارد) */
  offlineEmpty: boolean;
  noWallets: boolean;
  cold: boolean;
  /** ساعة التذكير اليومي (`useDailyReminderHour`) — null = التذكير مقفول */
  dailyHour: number | null;
  nowHour: number;
  /** إيميل وباسورد ولسه مش مأكّد ← الإيميل، غير كده null */
  unverifiedEmail: string | null;
  money: AmountFormatter;
};

/** `budget` و`low` وجهتين **جديدتين** (قرار مؤمن 2026-11-13)؛ `debts` هي الوجهة القديمة للاشتراك والجمعية */
export const ATTENTION_ROUTE = {
  budget: '/(tabs)/planning',
  low: '/settings-screens/wallets',
  debts: '/(tabs)/debts',
} as const;

const RANK = { budget: 0, low: 1, due: 2, verifyEmail: 3, noTxToday: 4 } as const;

/** مفتاح الـ✕ للميزانية: «قربت» ← near، أي حاجة غيرها (خلصت/عدّت) ← over — زي ما كان */
export const budgetDismissKey = (catId: string, level: string) => `${catId}:${level === 'near' ? 'near' : 'over'}`;

/**
 * كل العناصر اللي **حالتها موجودة دلوقتي** (قبل أي ✕)، مرتّبة: ميزانيات الفئات (خلصت قبل قربت)
 * ← محافظ قرب تخلص ← اشتراكات وأقساط جمعية (الأقرب يوم الأول) ← تأكيد الإيميل ← «لسه ما سجلتش».
 * اللي اتقفل بـ✕ بيتشال بعدها بـ`visibleAttention`.
 */
export function buildAttentionItems(i: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  // ميزانيات الفئات — نفس الفلتر والحسبة اللي كانت في الرئيسية
  i.activeCategories
    .filter(c => i.spendKnown && i.budgets[c.id] > 0)
    .map(c => ({ cat: c, spend: monthSpend(i.transactions, c.id, i.nowMonth, i.transfers), limit: i.budgets[c.id] }))
    .map(b => ({ ...b, level: budgetLevel(b.spend, b.limit) }))
    .filter(b => b.level !== 'under')
    .forEach(b => {
      const word = b.level === 'near' ? 'قربت تخلص' : 'خلصت';
      items.push({
        id: `budget_${b.cat.id}`, kind: 'budget', type: 'budget', instance: budgetDismissKey(b.cat.id, b.level),
        text: `ميزانية ${b.cat.name} ${word} (${i.money(b.spend)}/${i.money(b.limit)})`,
        label: speakable(`ميزانية ${b.cat.name} ${word} (${i.money(b.spend)} من ${i.money(b.limit)})`),
        dismissName: b.cat.name, tone: 'warn', route: ATTENTION_ROUTE.budget,
        rank: RANK.budget, sort: b.level === 'near' ? 1 : 0,
      });
    });

  // محافظ تحت حد التنبيه
  i.activeWallets
    .filter(w => (i.balances.get(w.id) || 0) < (w.lowAlert || 0))
    .forEach(w => {
      const bal = i.money(i.balances.get(w.id) || 0);
      items.push({
        id: `low_${w.id}`, kind: 'low', type: 'lowBalance', instance: w.id,
        text: `رصيد ${w.name} قرب يخلص (${bal} ج.م)`,
        label: speakable(`رصيد ${w.name} قرب يخلص (${bal} ج.م)`),
        dismissName: w.name, tone: 'danger', route: ATTENTION_ROUTE.low, rank: RANK.low, sort: 0,
      });
    });

  // اشتراكات جاية: للي **لسه جاي** بس — اللي معاده جه (النهارده أو فات) ليه كارت «اتخصم؟» في شيت «مستنيين ردك»
  i.subscriptions
    .filter(s => s.active !== false && daysUntil(s.nextDueDate) > 0 && daysUntil(s.nextDueDate) <= s.reminderDaysBefore)
    .forEach(s => {
      const d = daysUntil(s.nextDueDate);
      const text = `اشتراك ${s.name} بعد ${d} يوم (${i.money(s.amount)} ج.م)`;
      items.push({
        id: `sub_${s.id}`, kind: 'subscription', type: 'subscriptionDue', instance: `${s.id}@${s.nextDueDate}`,
        text, label: speakable(text), dismissName: s.name, tone: 'warn', route: ATTENTION_ROUTE.debts,
        rank: RANK.due, sort: d,
      });
    });

  i.gamiyas.flatMap(g =>
    g.months
      .filter(m => m.status === 'pending' && daysUntil(m.dueDate) > 0 && daysUntil(m.dueDate) <= g.reminderDaysBefore)
      .map(m => ({ gamiya: g, month: m })),
  ).forEach(({ gamiya, month }) => {
    const d = daysUntil(month.dueDate);
    const text = `جمعية ${gamiya.name} — ${month.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} بعد ${d} يوم (${i.money(month.amount)} ج.م)`;
    items.push({
      id: `gamiya_${month.id}`, kind: 'gamiya', type: 'gamiyaDue', instance: month.id,
      text, label: speakable(text), dismissName: gamiya.name, tone: 'warn', route: ATTENTION_ROUTE.debts,
      rank: RANK.due, sort: d,
    });
  });

  if (i.unverifiedEmail !== null) {
    const text = `إيميلك (${i.unverifiedEmail}) لسه مش مأكّد — أكّده عشان تأمّن حسابك`;
    items.push({
      id: 'verify_email', kind: 'verifyEmail', type: 'verifyEmail', text, label: text,
      tone: 'warn', rank: RANK.verifyEmail, sort: 0,
    });
  }

  // بعد الساعة اللي اختارها المستخدم بس (نفس ساعة التذكير اليومي)
  if (!i.hasTodayTx && !i.offlineEmpty && !i.noWallets && !i.cold && i.dailyHour !== null && i.nowHour >= i.dailyHour) {
    const text = 'لسه ما سجلتش مصاريف النهاردة';
    items.push({
      id: 'no_tx_today', kind: 'noTxToday', type: 'noTxToday', text, label: text, tone: 'plain',
      rank: RANK.noTxToday, sort: 0,
    });
  }

  // ترتيب ثابت: الرتبة ← الفرز جواها؛ المتساوي بيفضل بترتيبه الأصلي (Array.sort ثابت)
  return items.sort((a, b) => a.rank - b.rank || a.sort - b.sort);
}

/** اللي لسه مش مقفول — نفس `hidden(type, instance)` اللي كانت البانرات بتسأله */
export function visibleAttention(items: AttentionItem[], hidden: (type: BannerType, instance?: string) => boolean): AttentionItem[] {
  return items.filter(it => !hidden(it.type, it.instance));
}
