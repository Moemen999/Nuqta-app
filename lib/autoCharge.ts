import { addDays, addMonths, fmt } from '@/lib/finance';
import { MONTH_NAMES } from '@/lib/recurringIncome';

/**
 * الخصم التلقائي للاشتراكات وأقساط الجمعية — نفس نموذج الدخل الثابت
 * (`lib/recurringIncome.ts`): كل فترة ليها مفتاح، والعملية المالية معرّفها
 * ثابت (`sub_{id}_{المفتاح}` / `gamiya_{id}_{الشهر}`)، والفترة بتتقفل في
 * نفس الذرة اللي بتكتب العملية. العملية بتتكتب **بس لو مش موجودة** — ممنوع
 * نكتب فوقها: لو المستخدم عدّل 100 لـ120، الكتابة فوقها كانت هتمسح تعديله.
 *
 * **الافتراضي "بيسألك الأول"** لأي حاجة بتخصم فلوس. "بيتسجل لوحده" أول ما التطبيق
 * يتفتح بعد المعاد — بس للفترات اللي معادها **من يوم ما التلقائي اتفعّل**
 * (`chargeAutoSince`): اشتراك متأخر من شهور مايتخصمش كله مرة واحدة لما حد
 * يحوّله تلقائي؛ الفترات القديمة دي بتسأل.
 *
 * **الفترة اللي عمليتها اتمسحت بترجع تسأل** (`reopened`) ومبتتسجلش لوحدها
 * تاني أبدًا — غير كده الاشتراك اللي اتلغى كان هيتخصم تاني مع كل فتحة.
 */

export type ChargeMode = 'auto' | 'confirm';

/** فترة اشتراك مقفولة، بمفتاح تاريخ المعاد */
export type ChargeClosed = {
  txId?: string;
  skipped?: boolean;
  /** اتسجلت لوحدها */
  auto?: boolean;
  /** عمليتها اتمسحت ← مفتوحة تاني، بس بتسأل (عمرها ما تتسجل لوحدها تاني) */
  reopened?: boolean;
  at: string;
};

/** أقصى فترات بتتلحق مرة واحدة لكل اشتراك/جمعية */
export const CHARGE_CATCHUP_MAX = 12;

/** حارس لأي لفة على التواريخ — مفيش اشتراك بيتأخر 1000 دورة */
const LOOP_GUARD = 1000;

export type SubscriptionLike = {
  id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'custom';
  customDays?: number;
  nextDueDate: string;
  active?: boolean;
  chargeMode?: ChargeMode;
  chargeAutoSince?: string;
  closed?: Record<string, ChargeClosed>;
};

export type GamiyaMonthLike = {
  id: string;
  monthIndex: number;
  dueDate: string;
  isPayoutMonth: boolean;
  amount: number;
  status: 'pending' | 'done';
  transactionId?: string;
  auto?: boolean;
  reopened?: boolean;
};

export type GamiyaLike = {
  id: string;
  name: string;
  months: GamiyaMonthLike[];
  chargeMode?: ChargeMode;
  chargeAutoSince?: string;
};

/** فترة مفتوحة: مفتاحها، ومبلغها المعتاد، ولو ينفع تتسجل لوحدها */
export type OpenCharge = { key: string; due: string; amount: number; autoOk: boolean };

export function subscriptionNextCycle(sub: Pick<SubscriptionLike, 'frequency' | 'customDays'>, date: string) {
  return sub.frequency === 'monthly' ? addMonths(date, 1)
    : sub.frequency === 'yearly' ? addMonths(date, 12)
    : addDays(date, sub.customDays || 30);
}

function autoAllowed(mode: ChargeMode | undefined, since: string | undefined, due: string) {
  return mode === 'auto' && !!since && due >= since;
}

/**
 * فترات الاشتراك اللي معادها جه ولسه مفتوحة، الأقدم الأول: الفترات من
 * `nextDueDate` لحد النهاردة اللي مش مقفولة، + أي فترة رجعت تسأل.
 */
export function subscriptionOpenCharges(sub: SubscriptionLike, today: string): OpenCharge[] {
  const closed = sub.closed || {};
  const out: OpenCharge[] = [];
  // الفترة اللي رجعت تسأل بتسأل حتى لو الاشتراك واقف — السؤال عن فلوس فاتت
  Object.entries(closed).forEach(([key, c]) => {
    if (c.reopened && key <= today) out.push({ key, due: key, amount: sub.amount, autoOk: false });
  });
  if (sub.active === false) return out.sort((a, b) => a.key.localeCompare(b.key)).slice(0, CHARGE_CATCHUP_MAX);
  let d = sub.nextDueDate;
  for (let i = 0; i < LOOP_GUARD && d && d <= today; i++) {
    if (!closed[d]) out.push({ key: d, due: d, amount: sub.amount, autoOk: autoAllowed(sub.chargeMode, sub.chargeAutoSince, d) });
    d = subscriptionNextCycle(sub, d);
  }
  return out.sort((a, b) => a.key.localeCompare(b.key)).slice(0, CHARGE_CATCHUP_MAX);
}

/** الفترة اللي "سدّد" من شاشة الاشتراكات بيقفلها: الأقدم المفتوحة، ولو مفيش — اللي جاية (دفع بدري) */
export function subscriptionManualKey(sub: SubscriptionLike, today: string) {
  const open = subscriptionOpenCharges({ ...sub, active: true }, today);
  if (open.length) return open[0].key;
  let d = sub.nextDueDate;
  for (let i = 0; i < LOOP_GUARD && sub.closed?.[d] && !sub.closed[d].reopened; i++) d = subscriptionNextCycle(sub, d);
  return d;
}

/** الفترة دي لسه ينفع تتقفل؟ (مش مقفولة، ومن الجدول الحالي أو رجعت تسأل) */
export function subscriptionKeyOpen(sub: SubscriptionLike, key: string) {
  const c = sub.closed?.[key];
  if (c) return !!c.reopened;
  return key >= sub.nextDueDate;
}

/** بعد ما فترات اتقفلت: `nextDueDate` يعدّي أي فترة مقفولة وراه على طول */
export function subscriptionAdvance(sub: SubscriptionLike, closed: Record<string, ChargeClosed>) {
  let d = sub.nextDueDate;
  for (let i = 0; i < LOOP_GUARD && closed[d] && !closed[d].reopened; i++) d = subscriptionNextCycle(sub, d);
  return d;
}

/** شهور الجمعية المستحقة ولسه ما اتسددتش. شهر الاستلام **بيسأل دايمًا** — فلوس جاية من حد تاني ممكن تتأخر */
export function gamiyaOpenCharges(g: GamiyaLike, today: string): OpenCharge[] {
  return (g.months || [])
    .filter(m => m.status === 'pending' && m.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.monthIndex - b.monthIndex)
    .slice(0, CHARGE_CATCHUP_MAX)
    .map(m => ({
      key: m.id, due: m.dueDate, amount: m.amount,
      autoOk: !m.isPayoutMonth && !m.reopened && autoAllowed(g.chargeMode, g.chargeAutoSince, m.dueDate),
    }));
}

export function subscriptionTxId(subId: string, key: string) {
  return `sub_${subId}_${key}`;
}
export function gamiyaTxId(gamiyaId: string, monthId: string) {
  return `gamiya_${gamiyaId}_${monthId}`;
}

/** «25 سبتمبر» — والسنة لو مش السنة دي */
export function chargeDateLabel(date: string, today: string) {
  const [y, m, d] = date.split('-').map(Number);
  const base = `${d} ${MONTH_NAMES[m - 1]}`;
  return String(y) === today.slice(0, 4) ? base : `${base} ${y}`;
}

function joinAnd(items: string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;
}

/** جزء واحد من الرسالة: `اشتراك "نتفليكس" (25 أغسطس و25 سبتمبر)` */
export function chargeRecordedPart(kind: 'subscription' | 'gamiya', name: string, labels: string[]) {
  const what = kind === 'subscription' ? `اشتراك "${name}"` : `قسط جمعية "${name}"`;
  if (labels.length > 3) return `${what} (${labels.length} ${labels.length <= 10 ? 'مرات' : 'مرة'}، من ${labels[0]} لـ ${labels[labels.length - 1]})`;
  return `${what} (${joinAnd(labels)})`;
}

/** **رسالة واحدة** لكل اللي اتسجل في المرة دي، مهما كان عدد الفترات والاشتراكات */
export function chargeRecordedMessage(parts: string[]) {
  return `سجلنا لوحدنا: ${joinAnd(parts)}`;
}

/** نص الإشعار — من غير رقم لو المبالغ مخفية (بيظهر على شاشة القفل) */
export function chargeRecordedNotification(message: string, total: number, hideAmounts: boolean) {
  const amount = hideAmounts ? '' : ` — ${fmt(total)} ج.م`;
  return `${message}${amount}. لو الرقم مختلف عدّله من الأرشيف.`;
}

/**
 * **نفس الأسامي للدخل الثابت والاشتراكات والجمعية** (مصدر واحد — `IncomesView`
 * بيستوردها): نفس الفكرة بالظبط، فالمستخدم اللي اتعلّمها في مكان يلاقيها زي ما هي
 * في التاني. جملة بتوصف اللي هيحصل أوضح من "بتأكيد"/"تلقائي" (2026-09-28).
 */
export const CHARGE_MODE_LABEL: Record<ChargeMode, string> = {
  confirm: 'بيسألك الأول',
  auto: 'بيتسجل لوحده',
};

/** الحقول اللي بتتكتب لما الوضع يتغيّر — `chargeAutoSince` بيتحط مع "تلقائي" بس */
export function chargeModePatch(next: ChargeMode, current: { chargeMode?: ChargeMode; chargeAutoSince?: string } | undefined, today: string) {
  if (next === 'auto') {
    return { chargeMode: 'auto' as const, chargeAutoSince: current?.chargeMode === 'auto' && current.chargeAutoSince ? current.chargeAutoSince : today };
  }
  return { chargeMode: 'confirm' as const };
}
