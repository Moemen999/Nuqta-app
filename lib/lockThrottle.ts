/**
 * حد محاولات كود القفل (الاختبار العنيف 2026-11-07، قرار مؤمن «موافق على الخمسة»).
 *
 * الرقم السري 4 أرقام = 10,000 احتمال بس. من غير حد، حد ماسك الموبايل يقدر يجرّبهم كلهم في ساعات. التأخير بيزيد
 * مع كل غلط بعد الأول كام مرة، **ومفيش قفل نهائي ولا مسح**: المخرج «نسيت الكود؟» (الخروج من الحساب) موجود دايمًا،
 * فصاحب الموبايل اللي نسي مش محبوس — والحماية الحقيقية لبياناته هي باسورد الحساب مش الكود ده.
 *
 * الوقت من ساعة الجهاز: اللي يرجّع الساعة لورا بيقصّر التأخير. ده مقبول — الهدف إبطاء التخمين مش منعه نهائيًا،
 * وتغيير الساعة لكل محاولة بطيء في حد ذاته.
 */

/** أول كام غلط من غير تأخير — حد بيغلط في الكتابة مش لازم يستنى */
export const FREE_ATTEMPTS = 3;

/** التأخير بعد الغلط رقم (FREE_ATTEMPTS + i)؛ بعد آخر واحد بيفضل ساعة */
const DELAYS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/** التأخير المطلوب بعد `failures` غلط ورا بعض (0 = مفيش) */
export function lockDelayMs(failures: number): number {
  if (!Number.isFinite(failures) || failures < FREE_ATTEMPTS) return 0;
  const i = Math.min(failures - FREE_ATTEMPTS, DELAYS_MS.length - 1);
  return DELAYS_MS[i];
}

export type LockFails = { count: number; until: number };
export const NO_FAILS: LockFails = { count: 0, until: 0 };

/** قراية العدّاد من التخزين — أي شكل بايظ = صفر (مبيقفلش صاحب الموبايل بسبب ملف بايظ) */
export function parseLockFails(raw: string | null): LockFails {
  if (!raw) return NO_FAILS;
  try {
    const v = JSON.parse(raw) as Partial<LockFails>;
    const count = typeof v.count === 'number' && Number.isFinite(v.count) && v.count >= 0 ? Math.floor(v.count) : 0;
    const until = typeof v.until === 'number' && Number.isFinite(v.until) && v.until >= 0 ? v.until : 0;
    return { count, until };
  } catch {
    return NO_FAILS;
  }
}

/** غلط جديد: العدّاد بيزيد، والانتظار من دلوقتي */
export function recordFailure(prev: LockFails, now: number): LockFails {
  const count = prev.count + 1;
  const delay = lockDelayMs(count);
  return { count, until: delay ? now + delay : 0 };
}

/**
 * فاضل قد إيه على المحاولة الجاية (0 = يقدر يجرّب دلوقتي). **محدود بتأخير العدّ نفسه** (security-reviewer +
 * silent-failure-hunter): ساعة الموبايل كانت قدّام وقت الغلط واتصلّحت ← `until` بعيد بأيام، وصاحب الموبايل محبوس
 * والرسالة بتقول «ساعة».
 */
export function remainingWaitMs(f: LockFails, now: number): number {
  return Math.max(0, capFails(f, now).until - now);
}

/**
 * الأكبر عدًّا — عدّاد الذاكرة أرضية لعدّاد التخزين (قراية أو كتابة فشلت مترجّعش العدّ لصفر). عند تساوي العدّ الأقرب
 * `until`: الفرق الوحيد بينهم ساعة اتصلّحت (`capFails` في الذاكرة والقديم البعيد في التخزين)، والأقرب هو الصح.
 */
export function maxFails(a: LockFails, b: LockFails): LockFails {
  if (a.count !== b.count) return a.count > b.count ? a : b;
  return a.until <= b.until ? a : b;
}

/** `until` مبيبعدش عن دلوقتي أكتر من تأخير العدّ (ساعة اتصلّحت). **بيتحفظ** — لو اتحسب كل مرة من جديد الانتظار مبيخلصش */
export function capFails(f: LockFails, now: number): LockFails {
  const max = now + lockDelayMs(f.count);
  return f.until > max ? { count: f.count, until: max } : f;
}

/** السبب — بيظهر فوق العدّ التنازلي عشان «استنى» لوحدها تتقري عطل (arabic-copy-reviewer) */
export const LOCK_WAIT_REASON = 'غلطت في الكود كذا مرة ورا بعض';

/** «جرّب تاني بعد 30 ثانية» — الرقم اللي بيتغيّر في الآخر، والعدد بصيغته الصح */
export function lockWaitMessage(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `جرّب تاني بعد ${secondsPhrase(s)}`;
  const m = Math.ceil(s / 60);
  if (m >= 60) return 'جرّب تاني بعد ساعة';
  return `جرّب تاني بعد ${minutesPhrase(m)}`;
}

function secondsPhrase(s: number): string {
  if (s === 1) return 'ثانية';
  if (s === 2) return 'ثانيتين';
  if (s <= 10) return `${s} ثواني`;
  return `${s} ثانية`;
}

function minutesPhrase(m: number): string {
  if (m === 1) return 'دقيقة';
  if (m === 2) return 'دقيقتين';
  if (m <= 10) return `${m} دقايق`;
  return `${m} دقيقة`;
}

/**
 * الهاش المتخزّن: `v2:<salt>:<sha256(salt + code)>` في **قيمة واحدة** — الملح والهاش بيتكتبوا مع بعض، فمفيش حالة
 * نص-نص (ملح جديد على هاش قديم = مقفول برّه). القيمة من غير `v2:` = هاش قديم من غير ملح (قبل 2026-11-07)، وبيتقبل
 * وبيترقّى أول ما الكود الصح يتكتب.
 */
export const HASH_V2 = 'v2';

export function parseStoredHash(stored: string): { salt: string | null; hash: string } {
  if (stored.startsWith(`${HASH_V2}:`)) {
    const rest = stored.slice(HASH_V2.length + 1);
    const i = rest.indexOf(':');
    if (i > 0) return { salt: rest.slice(0, i), hash: rest.slice(i + 1) };
  }
  return { salt: null, hash: stored };
}

export function formatStoredHash(salt: string, hash: string): string {
  return `${HASH_V2}:${salt}:${hash}`;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
