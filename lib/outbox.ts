import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils';
import { transactionsPhrase } from '@/lib/archiving';
import { dateText } from '@/lib/dateText';
import { fmt } from '@/lib/finance';

/**
 * الطابور المحلي المتشفّر — الجزء الصافي (مفيش تخزين ولا شبكة هنا؛ التوصيل في `lib/outboxStore.ts`).
 * التصميم والقرارات: reports/2026-11-16-outbox-design.md.
 *
 * **ليه:** فايربيز في الموبايل طابورها في الذاكرة بس (مفيش IndexedDB في RN — شوف CLAUDE.md). عملية اتسجلت من غير نت
 * والتطبيق اتقفل قبل ما ترفع ← كانت بتضيع ساكت. المودال بيحفظ نسخة متشفّرة على الجهاز الأول، والفتحة الجاية بترفعها
 * لو لسه ما وصلتش.
 *
 * **التشفير:** XChaCha20-Poly1305 (`@noble/ciphers` 1.3.0 بالظبط)، nonce 24 بايت عشوائي لكل مرة، مفتاح 32 بايت لكل
 * حساب في SecureStore، والـAAD = `v1|uid|txId` — المدخلة مربوطة بالحساب والمستند، فنقلها لحساب تاني أو مستند تاني
 * بيفشل الفك. **مفيش مبلغ ولا ملاحظة مقروءة** في المخزّن: `{v, alg, sid, savedAt, n, c}` بس.
 */

export const OUTBOX_VERSION = 1 as const;
/** حقل للترحيل بعدين (AES-GCM لو بقى متاح أصلي) — المدخلة القديمة بتتعرف بيه */
export const OUTBOX_ALG = 'xchacha20poly1305' as const;
/** أقصى عدد مدخلات للحساب — فوقه الحفظ المحلي بيتخطّى (الكتابة لفايربيز بتكمّل عادي) */
export const OUTBOX_MAX = 500;
export const OUTBOX_PREFIX = 'nuqta-outbox:v1:';
export const OUTBOX_KEY_BYTES = 32;
export const OUTBOX_NONCE_BYTES = 24;
/** إعادة فشلت بسبب غير الرفض في التلات جلسات دول ← بنقول للمستخدم يسجّلها تاني بدل ما تفضل مستنية للأبد */
export const OUTBOX_MAX_FAILED_SESSIONS = 3;
/** قراية المفتاح فشلت في الجلستين دول ← المدخلات بتتعامل "مش مقروءة" */
export const OUTBOX_KEY_FAIL_SESSIONS = 2;

export type StoredEntry = {
  v: typeof OUTBOX_VERSION;
  alg: typeof OUTBOX_ALG;
  /** الجلسة اللي حفظتها — الإعادة بتتخطّى مدخلات الجلسة الحالية (فايربيز لسه شايلاها في طابورها) */
  sid: string;
  /** اليوم المحلي (YYYY-MM-DD) — لرسالة "بصّ على مصاريفك من يوم ..." */
  savedAt: string;
  /** nonce بالـhex */
  n: string;
  /** النص المشفّر + الـtag بالـhex */
  c: string;
  /** وقت الحفظ (ms) — لعلامة "اتمسح قبل كده" لو مسح الخروج فشل (`clearedBefore`). المدخلات القديمة مالهاش */
  t?: number;
  /** جلسة أول رفض `permission-denied` — الرفض بيتحسب نهائي بس لو اتكرر في جلسة تانية (التوكن ممكن يكون لسه ما اتربطش) */
  rj?: string;
  /** جلسات فشلت فيها الإعادة بسبب تاني (النت، السقف…) — بعد `OUTBOX_MAX_FAILED_SESSIONS` بنقول للمستخدم */
  fa?: string[];
};

export type Rng = (n: number) => Uint8Array;
export type OpenResult = { ok: true; data: Record<string, unknown> } | { ok: false; reason: 'unreadable' };

export function outboxStorageKey(uid: string, txId: string): string {
  return `${OUTBOX_PREFIX}${uid}:${txId}`;
}

export function parseStorageKey(key: string): { uid: string; txId: string } | null {
  if (!key.startsWith(OUTBOX_PREFIX)) return null;
  const rest = key.slice(OUTBOX_PREFIX.length);
  const i = rest.indexOf(':');
  if (i <= 0 || i === rest.length - 1) return null;
  return { uid: rest.slice(0, i), txId: rest.slice(i + 1) };
}

/** SecureStore بيقبل `[A-Za-z0-9._-]` بس — فالـuid بيتعدّى sha256 hex مش زي ما هو */
export function outboxSecureKeyName(uidSha256Hex: string): string {
  return `nuqta_outbox_k_${uidSha256Hex}`;
}

function aad(uid: string, txId: string): Uint8Array {
  return utf8ToBytes(`v${OUTBOX_VERSION}|${uid}|${txId}`);
}

export function sealEntry(p: {
  uid: string; txId: string; data: Record<string, unknown>; sid: string; savedAt: string; key: Uint8Array; rng: Rng; t?: number;
}): StoredEntry {
  const nonce = p.rng(OUTBOX_NONCE_BYTES);
  if (nonce.length !== OUTBOX_NONCE_BYTES) throw new Error('outbox: bad nonce length');
  const cipher = xchacha20poly1305(p.key, nonce, aad(p.uid, p.txId));
  const c = cipher.encrypt(utf8ToBytes(JSON.stringify(p.data)));
  const out: StoredEntry = { v: OUTBOX_VERSION, alg: OUTBOX_ALG, sid: p.sid, savedAt: p.savedAt, n: bytesToHex(nonce), c: bytesToHex(c) };
  if (p.t !== undefined) out.t = p.t;
  return out;
}

/** أي فشل (مفتاح ناقص/غلط، uid أو id تاني، تلاعب، JSON بايظ) ← `unreadable` — مفيش تفاصيل تانية تخرج */
export function openEntry(stored: StoredEntry, uid: string, txId: string, key: Uint8Array | null): OpenResult {
  if (!key || key.length !== OUTBOX_KEY_BYTES) return { ok: false, reason: 'unreadable' };
  try {
    const cipher = xchacha20poly1305(key, hexToBytes(stored.n), aad(uid, txId));
    const data = JSON.parse(bytesToUtf8(cipher.decrypt(hexToBytes(stored.c))));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'unreadable' };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

const HEX = /^(?:[0-9a-f]{2})+$/;

export function parseStored(raw: string | null | undefined): StoredEntry | null {
  if (typeof raw !== 'string') return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const e = o as Record<string, unknown>;
  if (e.v !== OUTBOX_VERSION || e.alg !== OUTBOX_ALG) return null;
  if (typeof e.sid !== 'string' || !e.sid || typeof e.savedAt !== 'string' || !e.savedAt) return null;
  if (typeof e.n !== 'string' || e.n.length !== OUTBOX_NONCE_BYTES * 2 || !HEX.test(e.n)) return null;
  // أقل نص مشفّر = الـtag (16 بايت)
  if (typeof e.c !== 'string' || e.c.length < 32 || !HEX.test(e.c)) return null;
  const out: StoredEntry = { v: OUTBOX_VERSION, alg: OUTBOX_ALG, sid: e.sid, savedAt: e.savedAt, n: e.n, c: e.c };
  // الحقول الاختيارية: شكل غلط ← بتتشال (مش المدخلة كلها)
  if (typeof e.t === 'number' && Number.isFinite(e.t)) out.t = e.t;
  if (typeof e.rj === 'string' && e.rj) out.rj = e.rj;
  if (Array.isArray(e.fa) && e.fa.every(x => typeof x === 'string')) out.fa = e.fa as string[];
  return out;
}

/** مدخلات جلسات سابقة بس (الحالية لسه في طابور فايربيز)، بحد `OUTBOX_MAX` */
export function planReplay<T extends { stored: StoredEntry }>(entries: T[], currentSid: string): T[] {
  return entries.filter(e => e.stored.sid !== currentSid).slice(0, OUTBOX_MAX);
}

/**
 * `setDoc` اترفض: المدخلة بتتشال بس لو الرفض نهائي (القواعد أو شكل البيانات). أي كود تاني (طابور اتلغى مع خروج غصب،
 * سيرفر مش متاح…) ← المدخلة تفضل والإعادة في الفتحة الجاية تحاول تاني.
 */
export function isFinalWriteRejection(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'permission-denied' || code === 'invalid-argument';
}

export function canPersistMore(count: number): boolean {
  return count < OUTBOX_MAX;
}

/** تعديل عملية لسه في الطابور بيتدمج فيها (قرار مؤمن 4) — `undefined` مبيمسحش حقل */
export function mergePatch(data: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * حقول الربط على العملية نفسها. العملية المربوطة بتتكتب من مسارات تانية (ذرية أو مع سجلها)، فإعادتها لوحدها كانت
 * هتعمل عملية من غير سجلها. الدين بيخزّن `transactionId` جوّه الدين مش على العملية — و`addDebt` مبيطلبش `durable` أصلاً.
 */
export const LINKED_TX_FIELDS = ['incomeId', 'subscriptionId', 'gamiyaId', 'periodKey', 'isSettlement', 'archivedWalletId', 'autoRecorded'] as const;

export function hasLinkFields(tx: Record<string, unknown>): boolean {
  return LINKED_TX_FIELDS.some(f => tx[f] !== undefined && tx[f] !== null && tx[f] !== false);
}

/* ─────────────  النصوص  ───────────── */

export const OUTBOX_UNREADABLE_TITLE = 'ما قدرناش نرجّع عملياتك';

/** «عملية 150 يوم 12 نوفمبر» — المبلغ أو التاريخ مش سليم ← بيتشال من الجملة بدل NaN */
function txLabel(amount: unknown, date: unknown, today: string): string {
  const parts = ['عملية'];
  if (typeof amount === 'number' && Number.isFinite(amount)) parts.push(`${fmt(amount)}`); // قالب عن قصد عشان جرد الإخفاء (amountsPrivacy) يعدّه
  if (typeof date === 'string' && date) parts.push(`يوم ${dateText(date, today)}`);
  return parts.join(' ');
}

/** الإعادة اترفضت من السيرفر (القواعد) أو فشلت كذا جلسة — العنوان `WRITE_ERROR_TITLE` */
export function rejectedReplayBody(amount: unknown, date: unknown, today: string): string {
  return `${txLabel(amount, date, today)} كانت مستنية النت واترفضت لما حاولنا نرفعها. سجّلها تاني من "+".`;
}

/** الإعادة فشلت كذا جلسة (مش رفض) والعملية **اتأكد** إنها مش على السيرفر — العنوان `WRITE_ERROR_TITLE` */
export function repeatedFailReplayBody(amount: unknown, date: unknown, today: string): string {
  return `${txLabel(amount, date, today)} حاولنا نرفعها كذا مرة وما نفعش، ومفيش منها حاجة اتسجلت. سجّلها تاني من "+".`;
}

/** تعديل عملية لسه مستنية النت ومقدرناش نحميه على الموبايل (التخزين فشل) */
export const OUTBOX_EDIT_UNPROTECTED_TITLE = 'خلّي بالك';
export const OUTBOX_EDIT_UNPROTECTED_BODY = 'التعديل اتحفظ، بس لو قفلت التطبيق قبل ما النت يرجع ممكن العملية دي ما تترفعش.';

/** المحفظة اتأرشفت أو اتمسحت قبل ما العملية ترفع — مبنكتبهاش على محفظة مقفولة */
export function walletGoneReplayBody(amount: unknown, date: unknown, today: string): string {
  return `${txLabel(amount, date, today)} ما اترفعتش لأن المحفظة اتأرشفت أو اتمسحت. سجّلها تاني على محفظة تانية لو لسه محتاجها.`;
}

export function unreadableReplayBody(n: number, savedAt: string, today: string): string {
  const head = n === 2
    ? `كان فيه ${transactionsPhrase(n)} متسجلين على الموبايل وما اترفعوش، ومقدرناش نقراهم تاني.`
    : `كان فيه ${transactionsPhrase(n)} متسجلة على الموبايل وما اترفعتش، ومقدرناش نقراها تاني.`;
  return `${head} بصّ على مصاريفك من يوم ${dateText(savedAt, today)} وسجّل اللي ناقص.`;
}

/** «لسه فيه عمليتين ما اترفعتش» */
export function outboxLogoutTitle(n: number): string {
  return `لسه فيه ${transactionsPhrase(n)} ما اترفعتش`;
}

/** رسالة الخروج (قرار مؤمن 1): الخروج بيمسح الطابور، فالعدد بيتقال صريح إنه هيضيع */
export function outboxLogoutSentence(n: number): string {
  if (n === 2) return `فيه ${transactionsPhrase(n)} متسجلين على الموبايل ولسه ما اترفعوش — لو خرجت دلوقتي هيضيعوا.`;
  return `فيه ${transactionsPhrase(n)} متسجلة على الموبايل ولسه ما اترفعتش — لو خرجت دلوقتي هتضيع.`;
}
