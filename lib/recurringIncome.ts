import { addDays, endOfMonth, fmt } from '@/lib/finance';

/**
 * الدخل الثابت (مرتب، إيجار بيدخلك، مصروف شهري). كل حاجة هنا دوال صافية على
 * نصوص تواريخ 'YYYY-MM-DD' — نفس طريقة `lib/finance.ts` (حساب على UTC)، فمفيش
 * توقيت صيفي ولا انزياح يوم.
 *
 * **ممنوع يتسجل مرتين.** كل فترة ليها مفتاح (`2026-09` للشهري، تاريخ المعاد
 * للأسبوعي)، والعملية المالية معرّفها `income_{id}_{المفتاح}` — ثابت. ومعاه
 * `closed` جوه مستند الدخل: الفترة اللي اتسجلت أو اتشالت بتتقفل هناك في نفس
 * الذرة، فمسح العملية بعدين مبيخليش التسجيل التلقائي يرجع يسجلها.
 */

export type IncomeFrequency = 'monthly' | 'weekly';
export type IncomeMode = 'auto' | 'confirm';
export type IncomeStatus = 'active' | 'paused' | 'stopped';
export type IncomeClosed = { txId?: string; skipped?: boolean; at: string };

export type RecurringIncome = {
  id: string;
  name: string;
  amount: number;
  walletId: string;
  frequency: IncomeFrequency;
  /** 1..31 — لو الشهر أقصر بياخد آخر يوم */
  dayOfMonth?: number;
  /** 0 = الأحد .. 6 = السبت */
  weekday?: number;
  /** `confirm` افتراضيًا: بيسأل قبل ما يسجل */
  mode: IncomeMode;
  status: IncomeStatus;
  /**
   * أول يوم بنعدّ منه الفترات: يوم الإنشاء، أو يوم الرجوع من الإيقاف — الفترات
   * اللي وقعت وهو واقف مش بتتسجل (الإيقاف معناه "مفيش دخل").
   */
  startDate: string;
  closed?: Record<string, IncomeClosed>;
  createdAt: string;
};

/** أقصى فترات بتتلحق مرة واحدة — اللي غاب سنين مايلاقيش 150 عملية مرة واحدة */
export const INCOME_CATCHUP_MAX = 12;

export const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
export const WEEKDAY_NAMES = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

const pad2 = (n: number) => String(n).padStart(2, '0');

function weekdayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function nextMonthKey(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

/** معاد الفترة. الأسبوعي مفتاحه هو تاريخه */
export function incomeDueDate(inc: RecurringIncome, key: string) {
  if (inc.frequency === 'weekly') return key;
  const last = Number(endOfMonth(`${key}-01`).slice(8));
  return `${key}-${pad2(Math.min(inc.dayOfMonth ?? 1, last))}`;
}

/** كل مفاتيح الفترات من `startDate` لحد `until` (شامل) بالترتيب */
function periodsThrough(inc: RecurringIncome, until: string): string[] {
  const out: string[] = [];
  if (inc.frequency === 'weekly') {
    const w = inc.weekday ?? 0;
    let d = addDays(inc.startDate, (w - weekdayOf(inc.startDate) + 7) % 7);
    while (d <= until) { out.push(d); d = addDays(d, 7); }
    return out;
  }
  let ym = inc.startDate.slice(0, 7);
  while (`${ym}-01` <= until) {
    const due = incomeDueDate(inc, ym);
    if (due >= inc.startDate && due <= until) out.push(ym);
    ym = nextMonthKey(ym);
  }
  return out;
}

/** فترات معادها جه ولسه ما اتقفلتش — الأقدم الأول، والأحدث `INCOME_CATCHUP_MAX` بس */
export function incomeOpenPeriods(inc: RecurringIncome, today: string): string[] {
  if (inc.status !== 'active') return [];
  const open = periodsThrough(inc, today).filter(k => !inc.closed?.[k]);
  return open.slice(-INCOME_CATCHUP_MAX);
}

/** أول فترة معادها لسه ما جاش ولسه مفتوحة — "نزل" قبل المعاد بيقفلها */
export function incomeUpcomingPeriod(inc: RecurringIncome, today: string): string | null {
  if (inc.status !== 'active') return null;
  // سنة قدام كفاية: أي فترة فيها لازم تكون مفتوحة (محدش بيقفل سنة بدري)
  const horizon = addDays(today, 400);
  return periodsThrough(inc, horizon).find(k => incomeDueDate(inc, k) > today && !inc.closed?.[k]) ?? null;
}

/** الجدول اتغيّر لدرجة إن مفاتيح الفترات اتغيّرت (شهري↔أسبوعي، أو يوم الأسبوع) */
export function incomeScheduleKeysChange(
  inc: Pick<RecurringIncome, 'frequency' | 'weekday'>,
  next: { frequency?: IncomeFrequency; weekday?: number },
) {
  const freq = next.frequency ?? inc.frequency;
  if (freq !== inc.frequency) return true;
  return freq === 'weekly' && next.weekday !== undefined && next.weekday !== inc.weekday;
}

/**
 * لما مفاتيح الفترات تتغيّر، الفترات اللي اتقفلت بالجدول القديم مالهاش مفاتيح
 * في الجديد — فالأسابيع/الشهور اللي اتسجلت فعلاً كانت هتبان "مفتوحة" تاني
 * وتتسجل مرتين (والتلقائي كان هيسجلها من غير ما يسأل). فالجدول الجديد بيبدأ
 * بعد آخر دورة اتقفلت (أسبوع بعد آخر معاد أسبوعي، أو أول الشهر اللي بعد آخر
 * شهر)، ومش قبل النهاردة.
 */
export function incomeRescheduleStart(inc: RecurringIncome, today: string) {
  const ownKeys = Object.keys(inc.closed || {})
    .filter(k => (inc.frequency === 'weekly' ? k.length === 10 : k.length === 7))
    .sort();
  const last = ownKeys[ownKeys.length - 1];
  if (!last) return today;
  const after = inc.frequency === 'weekly' ? addDays(last, 7) : `${nextMonthKey(last)}-01`;
  return after > today ? after : today;
}

export function incomeTxId(incomeId: string, key: string) {
  return `income_${incomeId}_${key}`;
}

/** متأخر = يوم المعاد (الفلوس نزلت ساعتها). "نزل" بدري = النهاردة */
export function incomeTxDate(inc: RecurringIncome, key: string, today: string) {
  const due = incomeDueDate(inc, key);
  return due < today ? due : today;
}

export function incomePeriodLabel(inc: RecurringIncome, key: string, today: string) {
  if (inc.frequency === 'weekly') {
    const [, m, d] = key.split('-').map(Number);
    return `أسبوع ${d} ${MONTH_NAMES[m - 1]}`;
  }
  const [y, m] = key.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  return String(y) === today.slice(0, 4) ? name : `${name} ${y}`;
}

function joinAnd(items: string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(' و')} و${items[items.length - 1]}`;
}

/** رسالة واحدة للكذا فترة: «سجلنا «المرتب» عن سبتمبر وأكتوبر» */
export function incomeRecordedMessage(name: string, labels: string[]) {
  if (labels.length > 3) {
    return `سجلنا «${name}» عن ${labels.length} ${labels.length <= 10 ? 'فترات' : 'فترة'}، من ${labels[0]} لـ ${labels[labels.length - 1]}`;
  }
  return `سجلنا «${name}» عن ${joinAnd(labels)}`;
}

/** «وفيه فترة تانية» / «فترتين» / «3 فترات» / «11 فترة» — العدد بالعربي مش "2 فترات" */
export function morePeriodsPhrase(n: number) {
  if (n === 1) return 'وفيه فترة تانية';
  if (n === 2) return 'وفيه فترتين تانيين';
  return `وفيه ${n} ${n <= 10 ? 'فترات' : 'فترة'} تانية`;
}

export function incomeScheduleLabel(inc: Pick<RecurringIncome, 'frequency' | 'dayOfMonth' | 'weekday'>) {
  if (inc.frequency === 'weekly') return `كل أسبوع يوم ${WEEKDAY_NAMES[inc.weekday ?? 0]}`;
  const d = inc.dayOfMonth ?? 1;
  return d >= 29 ? `كل شهر يوم ${d} (أو آخر الشهر)` : `كل شهر يوم ${d}`;
}

/** «أقل من المعتاد بـ 800» — `money` من الشاشة عشان يتخبّى مع المبالغ */
export function incomeDiffNote(entered: number, base: number, money: (n: number) => string) {
  const diff = Math.round((entered - base) * 100) / 100;
  if (Math.abs(diff) < 0.01) return null;
  return `${diff < 0 ? 'أقل' : 'أكتر'} من المعتاد بـ ${money(Math.abs(diff))} ج.م`;
}

/**
 * نص إشعار "اتسجل لوحده". الإشعار بيظهر على شاشة القفل، فلو المبالغ مخفية
 * مفيش رقم خالص (زي باقي الإشعارات) — مش قناع.
 */
export function incomeRecordedNotification(message: string, total: number, hideAmounts: boolean) {
  const amount = hideAmounts ? '' : ` — ${fmt(total)} ج.م`;
  return `${message}${amount}. لو الرقم مختلف عدّله من الأرشيف.`;
}

export type IncomeDraft = {
  name: string; amount: number; walletId: string; frequency: IncomeFrequency; dayOfMonth?: number; weekday?: number;
};

/**
 * القواعد بتتحقق من الشكل بس (قاعدة 6)، فالتحقق من القيم هنا. بترجّع أول
 * مشكلة بالكلام، أو null.
 */
export function validateIncomeDraft(d: IncomeDraft): string | null {
  if (!d.name.trim()) return 'اكتب اسم للدخل ده (زي "المرتب").';
  if (!(d.amount > 0) || !Number.isFinite(d.amount)) return 'المبلغ لازم يكون أكبر من صفر.';
  if (!d.walletId) return 'اختار المحفظة اللي الفلوس بتنزل فيها.';
  if (d.frequency === 'monthly') {
    if (!Number.isInteger(d.dayOfMonth) || d.dayOfMonth! < 1 || d.dayOfMonth! > 31) return 'اليوم لازم يكون من 1 لـ 31.';
  } else if (!Number.isInteger(d.weekday) || d.weekday! < 0 || d.weekday! > 6) {
    return 'اختار يوم من الأسبوع.';
  }
  return null;
}
