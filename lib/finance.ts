import type { Debt, Transaction } from '@/context/DataContext';

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
 * ملحوظة على الشهور اللي مالهاش نفس اليوم: 31 يناير + شهر بيدي 3 مارس (ده سلوك
 * جافاسكريبت الطبيعي في تجاوز عدد أيام الشهر). ده سلوك مقصود سايبينه زي ما هو
 * دلوقتي عشان الإصلاح ده يكون عن التوقيت بس، بس محتاج قرار منتج لوحده.
 */
export function addMonths(dateStr: string, n: number) {
  const d = parseDateStr(dateStr);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toDateStr(d);
}

export function startOfMonth(dateStr: string) {
  return dateStr.slice(0, 7) + '-01';
}

export function endOfMonth(dateStr: string) {
  const d = parseDateStr(dateStr);
  // اليوم رقم 0 من الشهر اللي بعده = آخر يوم في الشهر ده
  return toDateStr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export const PALETTE = ['#7FA98F', '#C9A961', '#7C93C9', '#C97C9B', '#9B7CC9', '#C98F5A', '#6FB3B8', '#B08FC9'];

export function hashColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
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

/**
 * وصف المحفظة (أو المحفظتين) بتاع العملية. عمليات السحب كانت بتتكتب بسهم بين
 * الاسمين، والسهم مع اتجاه النص العربي كان بيظهر بالعكس فمحدش يعرف الفلوس راحت
 * منين لفين. الصيغة الصريحة "من X إلى Y" مفيهاش لبس مهما كان اتجاه العرض.
 */
export function transactionWalletLabel(
  t: { type: string; walletId: string; toWalletId?: string },
  wallets: { id: string; name: string }[],
) {
  const from = wallets.find(w => w.id === t.walletId)?.name || '';
  if (t.type !== 'withdraw') return from;
  const to = wallets.find(w => w.id === t.toWalletId)?.name || '';
  return `من ${from} إلى ${to}`;
}

export function categoryLabel(c?: { name: string; icon?: string }) {
  if (!c) return '';
  return c.icon ? `${c.icon} ${c.name}` : c.name;
}

export const CATEGORY_ICONS = [
  '🚗', '🍳', '🛒', '🍔', '💡', '🏠', '👕', '💊',
  '🎓', '🎮', '✈️', '🎁', '💰', '📱', '☕', '💼',
  '🐾', '🧾', '⚡', '❓',
];
