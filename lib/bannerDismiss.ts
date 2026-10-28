/**
 * قفل بانرات الرئيسية بالـ✕ ورجوعها (قرار مؤمن 2026-10-28).
 *
 * - **كل بانر ليه ✕**، حتى بانرات "رقم على الشاشة ممكن يكون غلط" (مفيش نت، الأرقام
 *   ممكن تكون قديمة، مقدرناش نجيب بياناتك). مؤمن قبل النتيجة: بعد الـ✕ الشاشة بتعرض
 *   أرقام من غير التحذير ده لحد ما يرجع.
 * - **البانر بيرجع بعد مدة**، والمدة إعداد من المستخدم لكل نوع بانر (الإعدادات ←
 *   الإشعارات). الـ✕ عمره ما بيخبّي الحالة للأبد، والبانر اللي حالته خلصت مبيظهرش
 *   أصلاً (الشاشة بتسأل هنا بس عن بانر حالته موجودة).
 * - **على الجهاز بس** (AsyncStorage) زي العين وإعدادات الإشعارات: "مفيش نت" حالة
 *   الجهاز ده، والحساب على جهاز تاني ليه تفضيلاته — ومزامنته كانت محتاجة مستند جديد
 *   في فايرستور وقاعدة ليه.
 *
 * الدوال هنا صافية (الوقت بيتبعت \`now\`) — التخزين والمؤقّت في \`useBannerDismiss\`.
 */

export type BannerType =
  | 'loadError' | 'offline' | 'stale'
  | 'pending' | 'verifyEmail' | 'noTxToday'
  | 'lowBalance' | 'budget' | 'subscriptionDue' | 'gamiyaDue';

/** بانرات "رقم على الشاشة ممكن يكون غلط" — مددها أقصر (مقفولة على ساعات مش أيام) */
export const WARNING_BANNERS: readonly BannerType[] = ['loadError', 'offline', 'stale'];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type IntervalOption = { id: string; ms: number; label: string };

export const WARNING_INTERVALS: readonly IntervalOption[] = [
  { id: '15m', ms: 15 * MIN, label: '¼ ساعة' },
  { id: '1h', ms: HOUR, label: 'ساعة' },
  { id: '3h', ms: 3 * HOUR, label: '3 ساعات' },
];
export const ROUTINE_INTERVALS: readonly IntervalOption[] = [
  { id: '1h', ms: HOUR, label: 'ساعة' },
  { id: '1d', ms: DAY, label: 'يوم' },
  { id: '3d', ms: 3 * DAY, label: '3 أيام' },
  { id: '7d', ms: 7 * DAY, label: 'أسبوع' },
];

/**
 * الافتراضي — **مش اختيار مؤمن**، اختيار Claude Code كأقل حاجة تفاجئ: التحذير يرجع بعد
 * ساعة (رقم ممكن يكون غلط مينفعش يغيب يوم)، والروتيني بعد يوم (يتقفل النهارده ويرجع بكره).
 */
export const DEFAULT_INTERVAL: Record<'warning' | 'routine', string> = { warning: '1h', routine: '1d' };

export const intervalOptions = (type: BannerType) =>
  WARNING_BANNERS.includes(type) ? WARNING_INTERVALS : ROUTINE_INTERVALS;

/** مدة النوع بالمللي ثانية — اختيار مش معروف (قديم، بايظ) ← الافتراضي */
export function intervalMs(type: BannerType, chosen: Record<string, string> | undefined): number {
  const opts = intervalOptions(type);
  const pick = opts.find(o => o.id === chosen?.[type])
    ?? opts.find(o => o.id === DEFAULT_INTERVAL[WARNING_BANNERS.includes(type) ? 'warning' : 'routine'])!;
  return pick.ms;
}

/** مفتاح البانر: النوع + الحالة بعينها (محفظة، فئة، اشتراك + معاده، شهر جمعية) */
export const bannerKey = (type: BannerType, instance = '') => (instance ? `${type}:${instance}` : type);
export const typeOfKey = (key: string) => key.split(':')[0] as BannerType;

/** وقت الـ✕ لكل مفتاح (ms) */
export type Dismissals = Record<string, number>;

/**
 * لحد امتى البانر مقفول، أو \`null\` لو ظاهر. الساعة اترجعت لورا (وقت القفل في
 * المستقبل) ← ظاهر (silent-failure-hunter): الحساب من "دلوقتي" كان بيخلّيه دلوقتي +
 * المدة في كل مرة، فيفضل مقفول طول ما الساعة متأخرة ومبيتشالش من التخزين أبدًا.
 */
export function hiddenUntil(d: Dismissals, key: string, chosen: Record<string, string> | undefined, now: number): number | null {
  const at = d[key];
  if (typeof at !== 'number' || !Number.isFinite(at) || at > now) return null;
  const until = at + intervalMs(typeOfKey(key), chosen);
  return now < until ? until : null;
}

export const isHidden = (d: Dismissals, key: string, chosen: Record<string, string> | undefined, now: number) =>
  hiddenUntil(d, key, chosen, now) !== null;

/** أقرب وقت بانر مقفول هيرجع فيه — للمؤقّت اللي بيعيد الرسم */
export function nextReturnAt(d: Dismissals, chosen: Record<string, string> | undefined, now: number): number | null {
  let next: number | null = null;
  for (const key of Object.keys(d)) {
    const u = hiddenUntil(d, key, chosen, now);
    if (u !== null && (next === null || u < next)) next = u;
  }
  return next;
}

/** المفاتيح اللي مدتها خلصت بتتشال — مفاتيح محافظ ممسوحة ومعادات فاتت مبتتراكمش */
export function pruneExpired(d: Dismissals, chosen: Record<string, string> | undefined, now: number): Dismissals {
  return Object.fromEntries(Object.entries(d).filter(([k]) => isHidden(d, k, chosen, now)));
}

/** قراية آمنة من التخزين: أي حاجة بايظة ← فاضي (البانر يظهر — ده الأأمن) */
export function parseDismissals(raw: string | null): Dismissals {
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'number' && Number.isFinite(t))) as Dismissals;
  } catch { return {}; }
}
export function parseIntervals(raw: string | null): Record<string, string> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string')) as Record<string, string>;
  } catch { return {}; }
}

/** \`setTimeout\` بيقع فوق 2^31−1 ms (~24.8 يوم) — المؤقّت بيتقسّم */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** شرح الـ✕ لقارئ الشاشة — بيقول إنه مش للأبد */
export const DISMISS_HINT = 'بيخبّيه لحد المدة اللي اخترتها في الإعدادات، وبعدين بيرجع لو لسه فيه حاجة';

/** أسامي الأنواع في الإعدادات — بنفس كلام البانر نفسه عشان المستخدم يربطهم */
export const BANNER_LABELS: Record<BannerType, string> = {
  loadError: 'مقدرناش نجيب بياناتك',
  offline: 'مفيش نت',
  stale: 'الأرقام ممكن تكون قديمة',
  pending: 'مستنيين ردك',
  verifyEmail: 'تأكيد الإيميل',
  noTxToday: 'لسه ما سجلتش النهاردة',
  lowBalance: 'رصيد قرب يخلص',
  budget: 'الميزانية قربت تخلص',
  subscriptionDue: 'اشتراك جاي',
  gamiyaDue: 'قسط جمعية جاي',
};
export const BANNER_TYPES = Object.keys(BANNER_LABELS) as BannerType[];

/**
 * اسم الـ✕ لقارئ الشاشة — بيقول **أنهي** تنبيه (a11y-architect): ممكن يبقى فيه 5 ✕ على
 * الشاشة، و"اقفل التنبيه" للكل مبيفرّقش بينهم
 */
export const dismissLabel = (type: BannerType, name?: string) =>
  name ? `اقفل تنبيه ${BANNER_LABELS[type]}: ${name}` : `اقفل تنبيه ${BANNER_LABELS[type]}`;

/** بيتقال بعد الـ✕ — البانر بيختفي من الشجرة والتركيز بيضيع من غيرها */
export const DISMISSED_ANNOUNCEMENT = 'اتقفل التنبيه، وهيرجع بعد المدة اللي اخترتها لو المشكلة لسه موجودة';
