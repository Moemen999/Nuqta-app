import type { Debt, Transaction, Wallet } from '@/context/DataContext';

export function walletBalance(tx: Transaction[], walletId: string, opening: number) {
  return tx.reduce((s, t) => {
    if (t.type === 'income') return t.walletId === walletId ? s + t.amount : s;
    if (t.type === 'withdraw') {
      let r = s;
      if (t.walletId === walletId) r -= t.amount;
      if (t.toWalletId === walletId) r += t.amount;
      return r;
    }
    return t.walletId === walletId ? s - t.amount : s;
  }, opening || 0);
}

export function monthSpend(tx: Transaction[], categoryId: string, month: string) {
  return tx
    .filter(t => t.type === 'expense' && t.categoryId === categoryId && t.date.slice(0, 7) === month)
    .reduce((s, t) => s + t.amount, 0);
}

export function fmt(n: number) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * التاريخ اللي المستخدم بيشوفه بيتاخد من ساعة جهازه المحلية، لأن ده اليوم اللي
 * هو عايشه فعلاً. قبل كده كان بياخده من toISOString (UTC)، فاللي بيسجل عملية
 * الساعة 1 بالليل بالقاهرة كانت بتتحفظ بتاريخ امبارح، وبانر "لسه ما سجلتش
 * مصاريف النهاردة" كان بيفضل ظاهر.
 */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * أي حساب على نص تاريخ ('YYYY-MM-DD') بيتعمل على UTC بالكامل — قراية وكتابة.
 * الخلط اللي كان موجود (تاريخ متقري كـ UTC + getDate/setDate بالتوقيت المحلي)
 * هو اللي كان بيخلي endOfMonth يرجع اليوم اللي قبل آخر يوم في الشهر، وaddDays
 * يضيع يوم عند بداية التوقيت الصيفي — والاتنين مكانوش بيظهروا في UTC خالص.
 * الحساب على UTC مفيهوش توقيت صيفي ولا انزياح، فنفس المدخل بيدي نفس المخرج في
 * أي مكان في الدنيا.
 */
function parseDateStr(dateStr: string) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}

function toDateStr(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function currentMonth() {
  return todayStr().slice(0, 7);
}

export function daysUntil(dateStr: string) {
  const today = parseDateStr(todayStr());
  const target = parseDateStr(dateStr);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function addDays(dateStr: string, days: number) {
  const d = parseDateStr(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

/**
 * الشهور اللي مالهاش نفس اليوم بتتقصّ على آخر يوم في الشهر: 31 يناير + شهر =
 * 28 فبراير (29 في السنة الكبيسة). لو سبناها لجافاسكريبت كانت هتدي 3 مارس، يعني
 * اشتراك مستحق يوم 31 كان هيفوّت فبراير بالكامل.
 * ملحوظة: التقصّ مش قابل للعكس بطبيعته — 31 يناير + شهر − شهر = 28 يناير، لأن
 * اليوم الأصلي مش متخزّن في أي مكان.
 */
export function addMonths(dateStr: string, n: number) {
  const d = parseDateStr(dateStr);
  const day = d.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(day, lastDayOfTarget));
  return toDateStr(firstOfTarget);
}

export function startOfMonth(dateStr: string) {
  return dateStr.slice(0, 7) + '-01';
}

export function endOfMonth(dateStr: string) {
  const d = parseDateStr(dateStr);
  // اليوم رقم 0 من الشهر اللي بعده = آخر يوم في الشهر ده
  return toDateStr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

function hashIndex(str: string, length: number) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % length;
}

/**
 * لون ثابت لكل عنصر (فئة أو محفظة) بضمان عدم التكرار طالما العدد ≤ حجم
 * الباليتة — عكس هاش بسيط بيحسب كل اسم لوحده وممكن يصادف نفس الخانة لاسم
 * تاني (اتنين فئة بلون واحد في نفس الرسم البياني).
 *
 * الحل: كل عنصر بياخد خانة الهاش بتاعته لو فاضية، ولو مشغولة بيدوّر للخانة
 * اللي بعدها (probing خطي بيلف على الباليتة). عشان النتيجة تفضل ثابتة مهما
 * كان ترتيب العرض في الشاشة (فلتر تقرير مختلف، ترتيب مختلف من فايربيز)،
 * الحل بيرتب العناصر بمعرّفها (`id`) قبل ما يوزّع الألوان — الـid مش بيتغيّر
 * زي الاسم (المستخدم بيقدر يغيّر اسم الفئة/المحفظة) ولا زي ترتيب العرض.
 *
 * لو العناصر أكتر من حجم الباليتة، التكرار بقى حتمي رياضيًا (pigeonhole) —
 * مفيش خوارزمية توزيع تقدر تمنعه من غير ما تكبّر الباليتة نفسها، فالعناصر
 * الزيادة بتاخد خانة الهاش المباشرة من غير probing.
 */
export function assignChartColors<T extends { id: string; name: string }>(
  items: T[],
  palette: string[],
): Map<string, string> {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const used = new Set<number>();
  const result = new Map<string, string>();

  for (const item of sorted) {
    let idx = hashIndex(item.name, palette.length);
    if (used.size < palette.length) {
      let attempts = 0;
      while (used.has(idx) && attempts < palette.length) {
        idx = (idx + 1) % palette.length;
        attempts++;
      }
    }
    used.add(idx);
    result.set(item.id, palette[idx]);
  }
  return result;
}

export type PieSlice = { id: string; name: string; amount: number; color: string };

/** معرّف شريحة الفئات الممسوحة — ثابت زي شريحة التجميع */
export const DELETED_SLICE_ID = '__deleted__';
export const DELETED_SLICE_NAME = 'فئات ممسوحة';

type SpendRow = { categoryId?: string; amount: number };

/**
 * مصروف كل فئة في الفترة.
 *
 * الحتة المهمة: المصروف اللي فئته اتمسحت **مبيتشالش**. قبل كده الرسم كان
 * بيلف على الفئات الموجودة بس، فالفلوس اللي فئتها اتمسحت كانت بتختفي من
 * الرسم ومن "مصروفات الفترة" — يعني المستخدم يشوف رقم أقل من اللي صرفه
 * فعلاً، من غير أي سطر يقول ليه. دلوقتي بتتلمّ في شريحة "فئات ممسوحة"
 * واحدة، فمجموع الشرايح = مصروفات الفترة = إجمالي الشهر.
 *
 * `visibleIds` بتيجي من فلتر الفئات في الشاشة. لما يبقى فيه فلتر، المستخدم
 * اختار فئات بعينها فالشريحة الممسوحة مالهاش لازمة (مفيش شريحة ليها أصلاً
 * يختارها) — والرقم اللي جنبها بيتحسب بنفس القيد، فالاتنين بيفضلوا متطابقين.
 */
export function buildCategorySpend(
  expenses: SpendRow[],
  categories: { id: string; name: string; icon?: string; archived?: boolean }[],
  opts: { colorFor: (id: string) => string; deletedColor: string; visibleIds?: string[] },
): PieSlice[] {
  const { colorFor, deletedColor, visibleIds } = opts;
  const allowed = visibleIds ? new Set(visibleIds) : null;

  const known = new Map(categories.map(c => [c.id, c]));
  const totals = new Map<string, number>();
  let deleted = 0;

  for (const row of expenses) {
    const id = row.categoryId;
    if (id && known.has(id)) {
      if (allowed && !allowed.has(id)) continue;
      totals.set(id, (totals.get(id) || 0) + row.amount);
      continue;
    }
    // فئة ممسوحة (أو عملية من غير فئة خالص) — بتتلمّ مع بعض
    if (!allowed) deleted += row.amount;
  }

  const slices: PieSlice[] = [];
  for (const c of categories) {
    const amount = totals.get(c.id) || 0;
    if (amount > 0) slices.push({ id: c.id, name: categoryLabel(c), amount, color: colorFor(c.id) });
  }
  if (deleted > 0) {
    slices.push({ id: DELETED_SLICE_ID, name: DELETED_SLICE_NAME, amount: deleted, color: deletedColor });
  }
  return slices;
}

/**
 * إجمالي المصروف في فترة، بنفس قيد الفلتر بتاع `buildCategorySpend`.
 *
 * موجودة عشان المقارنة بالفترة السابقة تتحسب بنفس القاعدة بالظبط. قبل كده
 * كانت بتفلتر على `categories.map(c => c.id)` حتى وإحنا مش فالتين حاجة،
 * فكانت بتشيل المصروف اللي فئته اتمسحت من الفترة السابقة بس — ومقارنة بين
 * فترتين محسوبين بقاعدتين مختلفتين بتدي نسبة غلط.
 */
export function periodExpenseTotal(expenses: SpendRow[], visibleIds?: string[]): number {
  if (!visibleIds) return expenses.reduce((s, r) => s + r.amount, 0);
  const allowed = new Set(visibleIds);
  return expenses.reduce((s, r) => (r.categoryId && allowed.has(r.categoryId) ? s + r.amount : s), 0);
}

/**
 * الرسم بياني معقول لغاية 7 شرايح — أكتر من كده والدائرة بتتقطّع لشرايح صغيرة
 * مالهاش لون واضح يتفرّق عن جاره.
 */
export const PIE_TOP_N = 7;

/** معرّف الشريحة المجمّعة — ثابت عشان الرسم واللستة يستخدموه كـkey */
export const GROUPED_SLICE_ID = '__other__';

const GROUPED_SLICE_BASE = 'فئات تانية';

/**
 * اسم الشريحة اللي بتلمّ الفئات الصغيرة.
 *
 * كانت اسمها "أخرى"، وده اسم فئة **حقيقية** بيتزرع لكل مستخدم جديد
 * (`DEFAULT_CATEGORIES` في DataContext) — يعني شريحتين بنفس الاسم في نفس
 * الرسم، واحدة فئة المستخدم والتانية مجموعة فئات تانية خالص. اللون المحايد
 * لوحده مش كفاية: الليجيندة بتتقري بالاسم.
 *
 * العدد مش زينة — هو اللي بيقول للمستخدم إن دي مجموعة مش فئة، وبيفرّقها عن
 * أي اسم مكتوب بالإيد. ولو حصل والاسم بالعدد نفسه اتكرر مع فئة حقيقية،
 * بنزوّد علامة لحد ما يبقى فريد: شريحتين بنفس الاسم بالظبط معناهم حاجتين
 * مختلفتين، وده أسوأ من اسم شكله غريب شوية.
 *
 * أسماء فئات المستخدم نفسها مبنلمسهاش خالص.
 */
export function groupedSliceName(count: number, takenNames: Iterable<string> = []): string {
  const taken = new Set(takenNames);
  const base = `${GROUPED_SLICE_BASE} (${count})`;
  if (!taken.has(base)) return base;
  let marks = 1;
  while (taken.has(`${base} ${'*'.repeat(marks)}`)) marks++;
  return `${base} ${'*'.repeat(marks)}`;
}

/**
 * بترتب الفئات بالمصروف وبتلمّ اللي بعد أول `topN` في شريحة واحدة بلون محايد
 * برّه باليتة الفئات. الليجيندة في الشاشة بتتبني من نفس المصفوفة دي، فالاسم
 * والعدد بيتطابقوا في الاتنين بالضرورة.
 */
export function buildPieSlices(
  byCategory: PieSlice[],
  groupedColor: string,
  topN: number = PIE_TOP_N,
): PieSlice[] {
  // شريحة "فئات ممسوحة" بتفضل لوحدها دايمًا ومبتدخلش في التجميع. لو اتلمّت
  // جوه "فئات تانية (N)" كان المستخدم هيبص على رقم مالوش تفسير خالص: لا هو
  // فئة يعرفها، ولا هو مكتوب إن فيه فلوس فئتها اتمسحت. وبتتحط آخر حاجة عشان
  // تفضل في نفس المكان مهما اتغيّرت المصاريف.
  const deleted = byCategory.filter(c => c.id === DELETED_SLICE_ID);
  const sorted = byCategory.filter(c => c.id !== DELETED_SLICE_ID).sort((a, b) => b.amount - a.amount);
  if (sorted.length <= topN) return [...sorted, ...deleted];

  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const taken = [...top, ...deleted].map(c => c.name);
  return [...top, {
    id: GROUPED_SLICE_ID,
    name: groupedSliceName(rest.length, taken),
    amount: rest.reduce((s, c) => s + c.amount, 0),
    color: groupedColor,
  }, ...deleted];
}

export const TYPE_LABELS: Record<string, { label: string; color: string; sign: string }> = {
  expense: { label: 'مصروف', color: '#D97878', sign: '-' },
  income: { label: 'إيراد', color: '#7FA98F', sign: '+' },
  withdraw: { label: 'سحب', color: '#C9A961', sign: '-' },
};

export function debtGrandTotal(d: Debt) {
  return d.totalAmount + (d.increases || []).reduce((s, e) => s + e.amount, 0);
}

export function debtPaid(d: Debt) {
  return (d.payments || []).reduce((s, p) => s + p.amount, 0);
}

/**
 * فرق صغير جدًا بنتجاهله في مقارنات الفلوس.
 *
 * ده **مش** سماحية للزيادة: ده بس عشان جمع أرقام بكسور عشرية في JS ممكن
 * يطلع 549.9999999999999 بدل 550، فمنحذّرش المستخدم من زيادة مش موجودة.
 * أي زيادة حقيقية (ولو قرش) بتعدّي الرقم ده بكتير.
 */
const MONEY_EPS = 1e-9;

/**
 * أصغر فرق فلوس **بيهم المستخدم**: نص قرش.
 *
 * `MONEY_EPS` بتاعة فواصل الآلة (1e-9)، وهي غلط تستخدم في مقارنة مبالغ:
 * قسط 1083.333... واللي المستخدم دفعه فعلاً 1083.33 بيختلفوا بـ0.0033 —
 * أكبر من 1e-9 بكتير، فالكود كان بيعتبرهم مبلغين مختلفين ويقول "دفعت
 * 1,083.33 بدل 1,083.33" (نفس الرقمين حرفيًا لأن العرض بيقرّب). الفرق ده
 * مش موجود عند المستخدم، فمش المفروض يبقى موجود عندنا.
 */
export const PIASTRE_EPS = 0.005;

/** تقريب مبلغ لأقرب قرش — الرقم اللي بيتخزّن هو الرقم اللي بيتعرض */
export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** المتبقي على الدين. بيطلع بالسالب لو اتدفع أكتر من الإجمالي. */
export function debtRemaining(d: Debt) {
  return debtGrandTotal(d) - debtPaid(d);
}

/** الزيادة اللي اتدفعت فوق إجمالي الدين — صفر لو مفيش زيادة. */
export function debtExcess(d: Debt) {
  const over = debtPaid(d) - debtGrandTotal(d);
  return over > MONEY_EPS ? over : 0;
}

export type OverpayCheck = 'none' | 'exceeds' | 'settled';

/**
 * هل تسجيل دفعة بالمبلغ ده محتاج تأكيد من المستخدم؟
 *
 * روبو (اختبار Firebase Test Lab) سجّل دفعة 35,630 على دين 550، والرصيد اتحرك
 * بالمبلغ كله والدين بان "اتسدد بالكامل" — رقم غلط بشكل واثق. التحقق الوحيد
 * اللي كان موجود وقتها إن المبلغ أكبر من صفر.
 *
 * القرار: **تحذير مش منع**. دفع أكتر شوية شرعي (تقريب لفوق، "خلي الباقي")،
 * فالمنع هيقف في وش استخدام عادي. ومفيش نسبة سماح كمان: النسبة بتكبر مع حجم
 * الدين، يعني بتسيب أكبر فجوة بالظبط وقت ما الغلطة تكون أغلى.
 *
 * الدالة دي منفصلة عن الواجهة عشان تتختبر من غير ما نشغّل ديالوج.
 */
export function overpayCheck(amount: number, remaining: number): OverpayCheck {
  if (remaining <= MONEY_EPS) return 'settled';
  if (amount > remaining + MONEY_EPS) return 'exceeds';
  return 'none';
}

/**
 * سطر "اتسدد كذا من كذا".
 *
 * لو فيه زيادة، الكسر بيبقى كلام فارغ ("اتسدد 35,630 من 550")، فبنقول
 * الحقيقة بدله: اتسدد بالكامل وفيه زيادة قدّها كذا.
 */
/**
 * بيقرا سقف ميزانية من اللي المستخدم كتبه. `null` معناها "مترفض، متكتبش".
 *
 * السقف بالسالب مالوش معنى، وتحويله لصفر في السكوت كدبة صغيرة: المستخدم كتب
 * -500 والتطبيق يوافق وبعدين يعرض 0. فبنرفضه، والخانة بترجع لآخر قيمة محفوظة.
 *
 * الفاضي لسه بيرجّع صفر عن قصد — ده الطريقة الطبيعية لمسح سقف فئة.
 */
export type BalanceProjection = { walletId: string; name: string; before: number; after: number };

/**
 * الرصيد قبل وبعد العملية اللي المستخدم بيكتبها دلوقتي.
 *
 * الفكرة مش إن التطبيق يحكم على المبلغ — هو مش عارف المستخدم بيصرف قد إيه.
 * الفكرة إن الرقم يبقى **مقروء** قبل ما يتحفظ: حد كتب 50000 وهو قاصد 500
 * هيشوف الرصيد بيتحوّل لرقم واضح إنه غلط، ويصلّح بنفسه.
 *
 * بترجّع لستة فاضية لو مفيش محفظة أو المبلغ مش رقم موجب — مفيش حاجة صح
 * نقولها، فمبنقولش حاجة (مش صفر ومش شرطة).
 *
 * `excludeTransactionId` مهمة في التعديل: الرصيد الحالي فيه المبلغ القديم
 * أصلاً، فمن غيرها تعديل مصروف من 500 لـ 600 هيتحسب كإن 1,100 خرجت من
 * المحفظة — رقم شكله معقول وغلط، وده بالظبط اللي الميزة دي موجودة تمنعه.
 */
export function projectBalances(opts: {
  transactions: Transaction[];
  wallets: Wallet[];
  type: 'expense' | 'income' | 'withdraw';
  amount: number;
  walletId?: string;
  toWalletId?: string;
  excludeTransactionId?: string;
}): BalanceProjection[] {
  const { transactions, wallets, type, amount, walletId, toWalletId, excludeTransactionId } = opts;
  if (!isFinite(amount) || amount <= 0) return [];

  const src = wallets.find(w => w.id === walletId);
  if (!src) return [];

  const txs = excludeTransactionId ? transactions.filter(t => t.id !== excludeTransactionId) : transactions;
  const srcBefore = walletBalance(txs, src.id, src.openingBalance);
  const out: BalanceProjection[] = [{
    walletId: src.id,
    name: src.name,
    before: srcBefore,
    after: type === 'income' ? srcBefore + amount : srcBefore - amount,
  }];

  // التحويل بيلمس محفظتين. عرض الطرف الواحد بس بيقرا إن فلوس خرجت، وإجمالي
  // الفلوس مااتغيرش أصلاً — نص الحقيقة، ونفس نوع الكلام اللي شيلناه من
  // سطر "اتسدد كذا من كذا".
  if (type === 'withdraw') {
    const dst = wallets.find(w => w.id === toWalletId);
    if (dst && dst.id !== src.id) {
      const dstBefore = walletBalance(txs, dst.id, dst.openingBalance);
      out.push({ walletId: dst.id, name: dst.name, before: dstBefore, after: dstBefore + amount });
    }
  }
  return out;
}

export function parseBudgetInput(raw: string): number | null {
  const num = Number(raw);
  if (!isFinite(num) || num < 0) return null;
  return num;
}

/**
 * بيقرا رقم فلوس من خانة محفظة (الرصيد الابتدائي أو حد التنبيه).
 * `null` معناها "الكلام ده مش رقم — متكتبش، ورجّع المحفوظ".
 *
 * الفرق عن `parseBudgetInput`: **السالب مسموح**. محفظة كارت ائتمان رصيدها
 * سالب فعلاً، ورفضه كان هيمنع استخدام حقيقي.
 *
 * الفاضي بيرجّع صفر عن قصد — ده الطريقة الطبيعية لمسح الخانة، وده كمان
 * قاعدة المنتج (خانة فاضية = صفر).
 *
 * الأهم إن `null` هنا **مش** صفر. الكود القديم كان `Number(x) || 0`، وده
 * كان بيحوّل "أي حاجة مش رقم" لصفر: "abc" تبقى صفر، و`undefined` (يعني
 * المستخدم مادخلش الخانة أصلاً) تبقى صفر كمان — فمجرد ما يلمس الخانة
 * ويطلع منها كان رصيد المحفظة كله بيروح. التفريق ده هو كل الحكاية.
 */
export function parseWalletAmountInput(raw: string): number | null {
  const num = Number(String(raw ?? '').trim());
  if (!isFinite(num)) return null;
  return num;
}

export type WalletAmountPlan =
  /** مفيش حاجة تتعمل: مفيش مسوّدة أصلاً، أو الرقم زي المحفوظ بالظبط */
  | { action: 'none' }
  /** كلام مش رقم — الخانة ترجع لآخر قيمة محفوظة ومفيش كتابة */
  | { action: 'reject' }
  /** اكتب على طول */
  | { action: 'write'; value: number }
  /** اسأل المستخدم الأول — **ومفيش أي كتابة قبل ما يرد** */
  | { action: 'confirm'; value: number };

/**
 * بيقرر الخانة تعمل إيه لما المستخدم يخرج منها.
 *
 * منفصلة عن الواجهة عشان تتختبر من غير ما نشغّل ديالوج ولا نعمل render.
 *
 * `draft === undefined` معناها المستخدم مادخلش الخانة ولا كتب فيها حاجة —
 * ودي لازم تبقى "متعملش حاجة" مش "اكتب صفر". دي كانت باگ فلوس حقيقي:
 * تدوس على خانة الرصيد وتطلع منها من غير ما تكتب، والرصيد يتصفّر.
 *
 * والتأكيد بيطلع **بس** لما الرقم يعدّي من موجب (أو صفر) لسالب. من سالب
 * لسالب مفيش سؤال: المستخدم عارف أصلاً إن المحفظة دي بالسالب، والسؤال في
 * كل تعديل بيبقى إزعاج مش حماية.
 */
function planWith(
  draft: string | undefined,
  stored: number,
  parse: (raw: string) => number | null,
): WalletAmountPlan {
  if (draft === undefined) return { action: 'none' };

  const value = parse(draft);
  if (value === null) return { action: 'reject' };

  const current = isFinite(stored) ? stored : 0;
  if (value === current) return { action: 'none' };
  return { action: 'write', value };
}

export function planWalletAmountCommit(draft: string | undefined, stored: number): WalletAmountPlan {
  const base = planWith(draft, stored, parseWalletAmountInput);
  if (base.action !== 'write') return base;

  const current = isFinite(stored) ? stored : 0;
  if (base.value < 0 && current >= 0) return { action: 'confirm', value: base.value };
  return base;
}

/**
 * سقف الميزانية: نفس القواعد التلاتة، بس من غير خطوة التأكيد — السالب هنا
 * مرفوض من الأساس (`parseBudgetInput`)، مش بيتسأل عنه. ميزانية بالسالب
 * مالهاش معنى، على عكس رصيد محفظة كارت ائتمان.
 */
export function planBudgetCommit(draft: string | undefined, stored: number): WalletAmountPlan {
  return planWith(draft, stored, parseBudgetInput);
}

/** دخل الشهر في شخبطة — نفس قاعدة الميزانية بالظبط: موجب أو صفر، والسالب مرفوض */
export function planIncomeCommit(draft: string | undefined, stored: number): WalletAmountPlan {
  return planWith(draft, stored, parseBudgetInput);
}

export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;

/**
 * نسبة من نسب شخبطة.
 *
 * القاعدة: كل خانة لوحدها لازم تكون رقم بين 0 و100 (الطرفين داخلين). أي
 * حاجة برّه ده — كلام، سالب، أكبر من 100 — مرفوضة، والخانة بترجع لآخر قيمة
 * محفوظة زي أي خانة تانية.
 *
 * **ومجموع التلاتة مش مفروض يبقى 100.** ده عن قصد: وانت بتعدّل لازم تعدّي
 * على مجاميع غلط (تمسح 50 عشان تكتب 60، المجموع يبقى 50 لحظتها) — فلو
 * رفضنا على أساس المجموع، الكتابة نفسها تبقى مستحيلة. المجموع فضل تحذير
 * ناعم زي ما كان.
 */
export function parsePercentInput(raw: string): number | null {
  const num = Number(String(raw ?? '').trim());
  if (!isFinite(num)) return null;
  if (num < PERCENT_MIN || num > PERCENT_MAX) return null;
  return num;
}


export function percentInvalidTitle(count: number) {
  return count === 1 ? 'نسبة مش مظبوطة' : 'نسب مش مظبوطة';
}

/** "احتياجات ورفاهيات لازم تكون رقم من 0 لـ100" — بالأسماء اللي المستخدم شايفها */
export function percentInvalidBody(labels: string[]) {
  const which = labels.length <= 1
    ? (labels[0] || '')
    : `${labels.slice(0, -1).join('، ')} و${labels[labels.length - 1]}`;
  const verb = labels.length === 1 ? 'تكون' : 'يكونوا';
  return `${which} لازم ${verb} رقم من ${PERCENT_MIN} لـ${PERCENT_MAX}. صلّح وحاول تاني.`;
}

/* ─────────────────────  الأقساط  ───────────────────── */

/**
 * قيمة القسط الواحد.
 *
 * **ليه متخزّنة مش محسوبة كل مرة:** الحسبة الطبيعية `الإجمالي ÷ العدد`
 * بتتغيّر مع كل تعديل للعدد، فالقسط نفسه كان هيرقص. والمستخدم مستنّي
 * العكس بالظبط: القسط يفضل 1000 والعدد هو اللي يتغيّر — ده نص القرار
 * ("دفعت 700 بدل 1000، الأقساط بقت 7").
 *
 * فالقيمة بتتحسب مرة عند الإنشاء (`totalAmount ÷ installmentCount`)
 * وبتتخزّن، ومبتتغيّرش غير لما المستخدم يعدّل العدد بإيده.
 *
 * والرجوع للحسبة القديمة لو الحقل مش موجود: الديون اللي اتعملت قبل
 * الميزة دي مالهاش `installmentAmount`، ولازم تفضل شغالة.
 */
export function installmentValue(d: Debt): number | null {
  if (!d.isInstallment) return null;
  if (typeof d.installmentAmount === 'number' && d.installmentAmount > MONEY_EPS) {
    return d.installmentAmount;
  }
  const count = d.installmentCount;
  if (!count || count <= 0) return null;
  // `totalAmount` مش `debtGrandTotal`: القيمة المتخزّنة بتتحسب من الأصلي،
  // فالرجوع لازم يدّي **نفس** الرقم. لو استخدمنا الإجمالي مع الزيادات، دين
  // قديم فيه زيادة كان هياخد قسط مختلف عن دين جديد مطابق له بالظبط.
  const value = roundMoney(d.totalAmount / count);
  return value > PIASTRE_EPS ? value : null;
}

export type InstallmentProgress = { current: number; total: number };

/**
 * "القسط 3 من 6".
 *
 * `current` هو رقم القسط **الجاي** (اللي المستخدم بيدفعه دلوقتي)، يعني
 * عدد الدفعات اللي اتسجلت + 1. لو الدين اتسدد خلاص بترجّع `null` —
 * مفيش قسط جاي يتقال عليه حاجة.
 */
export function installmentProgress(d: Debt): InstallmentProgress | null {
  if (!d.isInstallment) return null;
  const total = d.installmentCount;
  if (!total || total <= 0) return null;
  if (debtRemaining(d) <= PIASTRE_EPS) return null;
  const paidCount = (d.payments || []).length;
  return { current: Math.min(paidCount + 1, total), total };
}

export function installmentProgressLabel(d: Debt): string | null {
  const p = installmentProgress(d);
  return p ? `القسط ${p.current} من ${p.total}` : null;
}

/**
 * عدد الأقساط بعد دفعة بمبلغ معيّن.
 *
 * القاعدة: **الدفعات اللي اتسجلت + عدد الأقساط الباقية**، والباقي =
 * المتبقي ÷ قيمة القسط مجبور لفوق. يعني القسط ثابت والعدد هو اللي
 * بيتحرّك — اللي دفع نص قسط بياخد قسط زيادة، واللي دفع قسطين بيخلّص بدري.
 *
 * بترجّع `null` لو مفيش حاجة تتحسب (مش قسط، أو الدين خلص).
 */
/**
 * العدد اللي يوصف الدين **بحالته الحالية**: الدفعات اللي حصلت + الأقساط
 * الباقية. بتتنادى بعد الحذف كمان مش بعد الدفع بس — العدد لازم يوصف
 * الواقع في الاتجاهين.
 */
export function installmentCountFor(d: Debt): number | null {
  if (!d.isInstallment) return null;
  const value = installmentValue(d);
  if (!value || value <= PIASTRE_EPS) return null;

  const remaining = debtRemaining(d);
  const paidCount = (d.payments || []).length;
  if (remaining <= PIASTRE_EPS) return Math.max(paidCount, 1);

  return paidCount + Math.ceil(remaining / value - PIASTRE_EPS);
}

export function installmentCountAfterPayment(d: Debt, paidAmount: number): number | null {
  if (!d.isInstallment) return null;
  const value = installmentValue(d);
  if (!value || value <= MONEY_EPS) return null;

  const remaining = debtRemaining(d) - paidAmount;
  const paidCount = (d.payments || []).length + 1;

  // اتسدد بالكامل (أو زيادة): العدد بيقف عند الدفعات اللي حصلت فعلاً
  if (remaining <= PIASTRE_EPS) return paidCount;

  return paidCount + Math.ceil(remaining / value - PIASTRE_EPS);
}

/**
 * الرسالة اللي بتتقال للمستخدم لما العدد يتغيّر.
 *
 * بترجّع `null` في تلات حالات مقصودة: العدد ما اتغيرش، أو الدفعة كانت
 * بقيمة القسط بالظبط (مفيش حاجة تتقال)، أو الدفعة خلّصت الدين — وقتها
 * "اتسدد بالكامل" هي الرسالة، ومفيش لازمة لكلام عن أقساط خلصت.
 */
export function installmentChangeMessage(
  paidAmount: number,
  expectedValue: number,
  beforeCount: number,
  afterCount: number,
  settled: boolean,
): string | null {
  if (settled) return null;
  if (beforeCount === afterCount) return null;
  // بالقرش مش بفاصلة الآلة: اللي دفع الرقم المقترح بالظبط مايتقالوش إنه غيّر حاجة
  if (Math.abs(paidAmount - expectedValue) <= PIASTRE_EPS) return null;
  return `دفعت ${fmt(paidAmount)} بدل ${fmt(expectedValue)}، الأقساط بقت ${afterCount}.`;
}

/**
 * لما المستخدم يعدّل عدد الأقساط بإيده.
 *
 * العدد اللي بيكتبه هو **الإجمالي** (زي ما هو معروض في "القسط 3 من 6")،
 * فلازم يكون أكبر من عدد الدفعات اللي حصلت خلاص. والقسط بيتعاد حسابه من
 * المتبقي على الأقساط الباقية — ده معنى "قسّمهالي على N".
 *
 * `null` معناها العدد مش مقبول.
 */
export function planInstallmentCountEdit(d: Debt, nextTotal: number): { count: number; value: number } | null {
  if (!Number.isInteger(nextTotal) || nextTotal <= 0) return null;
  const paidCount = (d.payments || []).length;
  if (nextTotal <= paidCount) return null;

  const remaining = debtRemaining(d);
  if (remaining <= PIASTRE_EPS) return null;

  return { count: nextTotal, value: roundMoney(remaining / (nextTotal - paidCount)) };
}

export function installmentCountTooLowMessage(paidCount: number) {
  return `اتسجل ${paidCount === 1 ? 'قسط واحد' : paidCount === 2 ? 'قسطين' : `${paidCount} أقساط`} خلاص، فالعدد لازم يكون أكبر من كده.`;
}

export function debtPaidLabel(d: Debt) {
  const excess = debtExcess(d);
  if (excess > 0) return `اتسدد بالكامل · زيادة ${fmt(excess)} ج.م`;
  return `اتسدد ${fmt(debtPaid(d))} من ${fmt(debtGrandTotal(d))} ج.م`;
}

/** تطبيع اسم الشخص قبل المقارنة: شيل المسافات الزايدة ووحّد المسافات الجوّا */
function normalizePersonName(name: string) {
  return (name || '').trim().replace(/\s+/g, ' ');
}

export type PersonGroup = {
  /** مفتاح ثابت للشخص — بيتبعت في الراوت لكشف الحساب */
  key: string;
  /** الاسم اللي بيتعرض — بناخده من دين مربوط بجهة اتصال لو فيه */
  displayName: string;
  personContactId?: string;
  debts: Debt[];
};

/**
 * بتجمّع الديون على الشخص.
 *
 * كان التجميع بـ `d.personName === name` بالحرف، وده كان بيقسّم حساب الشخص
 * الواحد في حالات حقيقية:
 * - "أحمد" و"أحمد " (مسافة زايدة) بيبانوا شخصين، وحسابه بينقسم نصين
 * - نفس جهة الاتصال بس الاسم اتعدّل في دين منهم → بيبانوا اتنين
 * - دين مكتوب بالإيد "أحمد" ودين مختار من جهات الاتصال بنفس الاسم → اتنين
 *
 * فالتجميع بقى على رقم جهة الاتصال أول ما يكون موجود، وعلى الاسم المطبّع لما
 * ميكونش. وبنعمل لفة أولى بنعرف منها اسم كل جهة اتصال، عشان الدين المكتوب
 * بالإيد بنفس الاسم يلتحق بجهة الاتصال بدل ما يعمل مجموعة لوحده.
 *
 * اللي لسه مش بيتجمّع لوحده: اسمين مختلفين فعلاً لنفس الشخص ("أحمد" و
 * "أحمد محمد") — ده محتاج المستخدم يعدّل الاسم بنفسه، ومفيش طريقة نحزره.
 */
export function groupDebtsByPerson(debts: Debt[]): PersonGroup[] {
  const nameToContact = new Map<string, string>();
  debts.forEach(d => {
    if (!d.personContactId) return;
    const n = normalizePersonName(d.personName);
    if (n && !nameToContact.has(n)) nameToContact.set(n, d.personContactId);
  });

  const groups = new Map<string, PersonGroup>();
  debts.forEach(d => {
    const norm = normalizePersonName(d.personName);
    const contactId = d.personContactId || nameToContact.get(norm);
    const key = contactId ? `contact:${contactId}` : `name:${norm}`;
    const existing = groups.get(key);
    if (existing) {
      existing.debts.push(d);
      // الاسم المربوط بجهة اتصال أوثق من اسم مكتوب بالإيد
      if (d.personContactId && !existing.personContactId) existing.displayName = norm;
      if (d.personContactId) existing.personContactId = d.personContactId;
      return;
    }
    groups.set(key, { key, displayName: norm, personContactId: d.personContactId, debts: [d] });
  });
  return Array.from(groups.values());
}

export type DebtPrefill = {
  personName: string;
  personPhone?: string;
  personContactId?: string;
  /** لو من غير اتجاه محدد (زي كشف الحساب)، AddDebtModal بتسيبها للمستخدم يختار */
  direction?: Debt['direction'];
};

/**
 * بيبني قيم دين جديد بالاتجاه العكسي لنفس الشخص، بحيث الدين الجديد يقع في
 * نفس مجموعة `groupDebtsByPerson` بتاعة الدين الأصلي.
 *
 * لازم `personContactId` تتنسخ زي ما هي (لو موجودة) — هي مفتاح التجميع
 * الأقوى، وبتشتغل حتى لو المستخدم غيّر نص الاسم. من غيرها، التجميع بيرجع
 * للاسم المطبّع (`normalizePersonName`)، فلازم نفس نص الاسم يتنسخ زي ما هو
 * برضه من غير ما حد يعيد كتابته يدوي ويغيّر فيه بالغلط.
 */
export function reverseDebtPrefill(d: Debt): DebtPrefill {
  return {
    personName: d.personName,
    personPhone: d.personPhone,
    personContactId: d.personContactId,
    direction: d.direction === 'owed_to_me' ? 'i_owe' : 'owed_to_me',
  };
}

/** بتلاقي مجموعة شخص بمفتاحه — بترجّع undefined لو خلصت ديونه واتمسحت */
export function findPersonGroup(debts: Debt[], key: string): PersonGroup | undefined {
  return groupDebtsByPerson(debts).find(g => g.key === key);
}

/**
 * هنا التوقيت المحلي مقصود: createdAt لحظة حقيقية، والمستخدم لازم يشوفها بساعته.
 */
export function formatTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const period = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const mm = String(minutes).padStart(2, '0');
  return `${hours}:${mm} ${period}`;
}

export const DELETED_WALLET_LABEL = 'محفظة ممسوحة';
export const DELETED_CATEGORY_LABEL = 'فئة ممسوحة';
export const ARCHIVED_SUFFIX = 'مؤرشفة';

export type NamedRecord = { id: string; name: string; archived?: boolean };

/**
 * اسم محفظة من معرّفها — للتاريخ، مش للاختيار.
 *
 * كل الشاشات كانت بتعمل `wallets.find(...)?.name || ''`، يعني المحفظة اللي
 * اتمسحت بتسيب **خانة فاضية** في مكان الاسم. المستخدم بيبص على عملية بـ800
 * جنيه من غير أي محفظة ومش عارف دي إيه — والأسوأ في السحب: "من  إلى "
 * بالحرف. اسم صريح أحسن من فراغ: على الأقل بيقول إيه اللي حصل.
 *
 * والمؤرشفة اسمها بيفضل زي ما هو مع "(مؤرشفة)" — هي مش ممسوحة، بس المستخدم
 * لازم يعرف ليه مش لاقيها في قايمة الاختيار.
 */
export function historyName(items: NamedRecord[], id: string | undefined, deletedLabel: string): string {
  const found = items.find(w => w.id === id);
  if (!found) return deletedLabel;
  return found.archived ? `${found.name} (${ARCHIVED_SUFFIX})` : found.name;
}

export function walletHistoryName(wallets: NamedRecord[], id?: string) {
  return historyName(wallets, id, DELETED_WALLET_LABEL);
}

export function categoryHistoryName(categories: NamedRecord[], id?: string) {
  return historyName(categories, id, DELETED_CATEGORY_LABEL);
}

/**
 * وصف المحفظة (أو المحفظتين) بتاع العملية. عمليات السحب كانت بتتكتب بسهم بين
 * الاسمين، والسهم مع اتجاه النص العربي كان بيظهر بالعكس فمحدش يعرف الفلوس راحت
 * منين لفين. الصيغة الصريحة "من X إلى Y" مفيهاش لبس مهما كان اتجاه العرض.
 */
export function transactionWalletLabel(
  t: { type: string; walletId: string; toWalletId?: string },
  wallets: NamedRecord[],
) {
  const from = walletHistoryName(wallets, t.walletId);
  if (t.type !== 'withdraw') return from;
  return `من ${from} إلى ${walletHistoryName(wallets, t.toWalletId)}`;
}

/**
 * أيقونة الفئة اللي لسه المستخدم ماختارش ليها واحدة.
 *
 * محايدة عن قصد: الفئات اللي اتعملت قبل الميزة دي (وكل الفئات الافتراضية)
 * مالهاش `icon`، ولو سبناها من غير أيقونة كانت القوايم هتطلع نص صفوفها
 * مزّحزح عن التاني. الأيقونة الافتراضية بتخلي الشكل واحد لحد ما المستخدم
 * يختار.
 */
export const DEFAULT_CATEGORY_ICON = '🏷️';

export type CategoryLabelOptions = {
  /** `false` بتدّي الاسم من غير أيقونة — للتصدير، عشان عمود الإكسيل يفضل قابل للفرز */
  icon?: boolean;
};

export function categoryLabel(
  c?: { name: string; icon?: string; archived?: boolean },
  opts: CategoryLabelOptions = {},
) {
  if (!c) return '';
  const name = c.archived ? `${c.name} (${ARCHIVED_SUFFIX})` : c.name;
  if (opts.icon === false) return name;
  return `${c.icon || DEFAULT_CATEGORY_ICON} ${name}`;
}

/**
 * زي `categoryLabel` بس بتبدأ من المعرّف، فبتغطي حالة الفئة الممسوحة كمان.
 * بترجّع `''` لو مفيش معرّف أصلاً (عملية من غير فئة مش نفس العملية اللي
 * فئتها اتمسحت — الأولى عادية والتانية ناقصة معلومة).
 */
export function categoryLabelById(
  categories: { id: string; name: string; icon?: string; archived?: boolean }[],
  id?: string,
  opts: CategoryLabelOptions = {},
) {
  if (!id) return '';
  const found = categories.find(c => c.id === id);
  return found ? categoryLabel(found, opts) : DELETED_CATEGORY_LABEL;
}

/** الأيقونة لوحدها — للأماكن اللي بتعرضها جنب اسم قابل للتعديل */
export function categoryIcon(c?: { icon?: string }) {
  return c?.icon || DEFAULT_CATEGORY_ICON;
}

/** أطول أيقونة مقبولة. الإيموجي المركّب (زي ✈️ أو 👨‍👩‍👧) بياخد أكتر من حرف */
export const CATEGORY_ICON_MAX = 8;

export function categoryIconValid(icon: string) {
  return CATEGORY_ICONS.includes(icon) || (icon.length > 0 && icon.length <= CATEGORY_ICON_MAX);
}

export const CATEGORY_ICONS = [
  '🚗', '🍳', '🛒', '🍔', '💡', '🏠', '👕', '💊',
  '🎓', '🎮', '✈️', '🎁', '💰', '📱', '☕', '💼',
  '🐾', '🧾', '⚡', '❓',
];
