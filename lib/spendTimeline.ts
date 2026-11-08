import { addDays, endOfMonth, GROUPED_SLICE_ID, periodExpenseTotal, startOfMonth } from '@/lib/finance';
import { MONTH_NAMES } from '@/lib/recurringIncome';

/**
 * رسم الفترة في التقارير (طلب مؤمن 2026-11-08، بدل "آخر 6 شهور" الثابت): الأعمدة بتتبني من **الفترة المختارة نفسها**
 * ووحدتها بتتغير مع طولها، ومبتعدّيش `MAX_COLUMNS` عشان المبلغ يفضل مكتوب تحت كل عمود على عرض موبايل.
 *
 * `expenses` لازم تكون نفس صفوف "مصروفات الفترة" (`spendingExpenses` متفلترة على الفترة)، والمبالغ بتعدّي على
 * `periodExpenseTotal` — فمجموع الأعمدة = الرقم البطل بالظبط، حتى عملية بتاريخ قدام جوه الفترة (الاتجاه القديم كان
 * بيشيلها والرقمين كانوا بيختلفوا بيها).
 *
 * الترتيب من الأقدم للأحدث، و`share` = طول العمود نسبةً لأكبر عمود (زي `barRows`).
 */
export const MAX_COLUMNS = 8;

export type TimelineUnit = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'years';

export type TimelineSegment = { id: string; amount: number };

export type TimelineBucket = {
  key: string; // أول يوم في العمود 'YYYY-MM-DD'
  from: string;
  to: string;
  label: string;
  /** السطر التاني تحت العمود (التاريخ أو الشهر أو السنة) — فاضي لو الاسم كافي */
  sublabel: string;
  /** التاريخ كامل لقارئ الشاشة: السطرين المختصرين مش بيتقروا كويس */
  spoken: string;
  amount: number;
  share: number;
  /** فترته أقصر من الباقي أو لسه ما خلصتش — عموده مينفعش يتقري "صرفت أقل" */
  partial: boolean;
  /** لسه ما جاش */
  future: boolean;
  /** أجزاء العمود بالفئات، بترتيب `sliceIds` (الأكبر تحت) — فاضية من غير فلتر فئات */
  segments: TimelineSegment[];
};

export type Timeline = { unit: TimelineUnit; buckets: TimelineBucket[] };

type Row = { date: string; amount: number; categoryId?: string };
type Span = { from: string; to: string; label: string; sublabel: string; spoken: string; short: boolean };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** أيام الأسبوع زي ما بتتقال — `getUTCDay` بيبدأ بالحد. التواريخ كلها على UTC زي `lib/finance.ts` */
const WEEKDAYS = ['حد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];

const year = (d: string) => Number(d.slice(0, 4));
const month = (d: string) => Number(d.slice(5, 7)); // 1..12
const day = (d: string) => Number(d.slice(8, 10));
const utc = (d: string) => Date.UTC(year(d), month(d) - 1, day(d));
const dayCount = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86400000) + 1;
const monthIndex = (d: string) => year(d) * 12 + month(d) - 1;
const monthStart = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);
const dayMonth = (d: string) => `${day(d)}/${month(d)}`;
const monthName = (d: string) => MONTH_NAMES[month(d) - 1];

/** "1 نوفمبر 2026" */
export function spokenDate(d: string): string {
  return `${day(d)} ${monthName(d)} ${year(d)}`;
}

/** "من 1 نوفمبر 2026 لحد 30 نوفمبر 2026" — السطر اللي تحت عنوان الرسم، واليوم الواحد من غير "من/لحد" */
export function rangeText(from: string, to: string): string {
  return from === to ? spokenDate(from) : `من ${spokenDate(from)} لحد ${spokenDate(to)}`;
}

function dailySpans(from: string, days: number): Span[] {
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i);
    const weekday = WEEKDAYS[new Date(utc(d)).getUTCDay()];
    return { from: d, to: d, label: weekday, sublabel: dayMonth(d), spoken: spokenDate(d), short: false };
  });
}

/** أسابيع من أول الفترة، مش أسبوع التقويم: أول عمود كامل دايمًا والناقص بيبقى الأخير بس */
function weeklySpans(from: string, end: string): Span[] {
  const spans: Span[] = [];
  for (let start = from; start <= end; start = addDays(start, 7)) {
    const stop = earlier(addDays(start, 6), end);
    const sameMonth = start.slice(0, 7) === stop.slice(0, 7);
    spans.push({
      from: start,
      to: stop,
      label: sameMonth ? (start === stop ? String(day(start)) : `${day(start)}–${day(stop)}`) : dayMonth(start),
      sublabel: sameMonth ? monthName(start) : dayMonth(stop),
      spoken: rangeText(start, stop),
      short: dayCount(start, stop) < 7,
    });
  }
  return spans;
}

/** عمود لكل `step` شهور متقصوص على الفترة — الشهور والأرباع نفس الحساب */
function calendarSpans(from: string, end: string, step: 1 | 3, multiYear: boolean): Span[] {
  const spans: Span[] = [];
  const first = monthIndex(from) - (monthIndex(from) % step);
  for (let idx = first; idx <= monthIndex(end); idx += step) {
    const fullFrom = monthStart(idx);
    const fullTo = endOfMonth(monthStart(idx + step - 1));
    const a = later(fullFrom, from);
    const b = earlier(fullTo, end);
    spans.push({
      from: a,
      to: b,
      // "أكتوبر–ديسمبر" مبتتقراش في 36 نقطة، والتاريخ كامل بيتقال لقارئ الشاشة
      label: step === 1 ? monthName(fullFrom) : `ربع ${Math.floor(idx / 3) % 4 + 1}`,
      sublabel: multiYear || step === 3 ? String(year(fullFrom)) : '',
      spoken: rangeText(a, b),
      short: a !== fullFrom || b !== fullTo,
    });
  }
  return spans;
}

function yearSpans(from: string, end: string, step: number): Span[] {
  const spans: Span[] = [];
  for (let y = year(from); y <= year(end); y += step) {
    const fullFrom = `${y}-01-01`;
    const fullTo = `${y + step - 1}-12-31`;
    const a = later(fullFrom, from);
    const b = earlier(fullTo, end);
    spans.push({
      from: a,
      to: b,
      label: step === 1 ? String(y) : `${y}–${year(b)}`,
      sublabel: '',
      spoken: rangeText(a, b),
      short: a !== fullFrom || b !== fullTo,
    });
  }
  return spans;
}

function spansFor(from: string, to: string): { unit: TimelineUnit; spans: Span[] } {
  const days = dayCount(from, to);
  if (days <= MAX_COLUMNS) return { unit: 'day', spans: dailySpans(from, days) };
  if (days <= MAX_COLUMNS * 7) return { unit: 'week', spans: weeklySpans(from, to) };
  const multiYear = year(from) !== year(to);
  if (monthIndex(to) - monthIndex(from) + 1 <= MAX_COLUMNS) return { unit: 'month', spans: calendarSpans(from, to, 1, multiYear) };
  const quarter = (d: string) => Math.floor(monthIndex(d) / 3);
  if (quarter(to) - quarter(from) + 1 <= MAX_COLUMNS) return { unit: 'quarter', spans: calendarSpans(from, to, 3, multiYear) };
  const years = year(to) - year(from) + 1;
  if (years <= MAX_COLUMNS) return { unit: 'year', spans: yearSpans(from, to, 1) };
  return { unit: 'years', spans: yearSpans(from, to, Math.ceil(years / MAX_COLUMNS)) };
}

export function spendTimeline(
  expenses: Row[],
  range: { from: string; to: string },
  today: string,
  visibleIds?: string[],
  /** ترتيب الشرايح وتجميعها زي `buildPieSlices`، عشان نفس اللون يمثل نفس الفلوس في الرسمين */
  sliceIds?: string[],
): Timeline {
  const { from, to } = range;
  // تاريخ بشكل غلط ← مفيش رسم، مش أعمدة باسم "NaN"
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || !DATE_RE.test(today) || from > to) return { unit: 'day', buckets: [] };

  const { unit, spans } = spansFor(from, to);
  const rows: Row[][] = spans.map(() => []);
  let skipped = 0;
  for (const r of expenses) {
    // صف بتاريخ مش نص أو مبلغ مش رقم محدود مبيبوّظش كل الأعمدة — بيتشال وبيتعدّ
    if (typeof r.date !== 'string' || !Number.isFinite(r.amount)) { skipped++; continue; }
    const i = spans.findIndex(s => r.date >= s.from && r.date <= s.to);
    if (i >= 0) rows[i].push(r); else skipped++; // الصفوف داخلة متفلترة على الفترة، فاللي برّه الأعمدة تاريخه بايظ
  }
  // العدد بس — مفيش مبالغ ولا أسامي (قاعدة Sentry)
  if (skipped > 0) console.warn(`[spendTimeline] ${skipped} صف اتشال من الرسم (تاريخ أو مبلغ بايظ)`);

  const amounts = rows.map(bucket => periodExpenseTotal(bucket, visibleIds));
  const max = amounts.reduce((a, b) => Math.max(a, b), 0);
  const allowed = visibleIds ? new Set(visibleIds) : null;
  const known = new Set(sliceIds ?? []);

  const buckets = spans.map((s, i): TimelineBucket => {
    const future = s.from > today;
    const totals = new Map<string, number>();
    if (allowed && sliceIds) {
      for (const r of rows[i]) {
        if (!r.categoryId || !allowed.has(r.categoryId)) continue;
        const id = known.has(r.categoryId) ? r.categoryId : GROUPED_SLICE_ID;
        totals.set(id, (totals.get(id) || 0) + r.amount);
      }
    }
    return {
      key: s.from,
      from: s.from,
      to: s.to,
      label: s.label,
      sublabel: s.sublabel,
      spoken: s.spoken,
      amount: amounts[i],
      // سالب (لو حصل) ← صفر، مش ارتفاع سالب
      share: max > 0 ? Math.max(0, amounts[i] / max) : 0,
      partial: !future && (s.short || (s.from <= today && today < s.to)),
      future,
      segments: (sliceIds ?? [])
        .filter(id => (totals.get(id) || 0) > 0)
        .map(id => ({ id, amount: totals.get(id)! })),
    };
  });
  return { unit, buckets };
}

/** عنوان الرسم بيقول الأعمدة بتتقسم إزاي — بيتغير مع الفترة */
export const TIMELINE_TITLE: Record<TimelineUnit, string> = {
  day: 'مصروفك يوم بيوم',
  week: 'مصروفك أسبوع بأسبوع',
  month: 'مصروفك شهر بشهر',
  quarter: 'مصروفك كل 3 شهور',
  year: 'مصروفك سنة بسنة',
  years: 'مصروفك على مدار السنين',
};

/** أول يوم في الفترة بتاعة "آخر 6 شهور": بداية الشهر قبل 5 شهور */
export function sixMonthsStart(today: string): string {
  return monthStart(monthIndex(startOfMonth(today)) - 5);
}
