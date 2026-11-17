import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils';
import * as Sentry from '@sentry/react-native';
import { doc, getDocFromServer, runTransaction } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { todayStr } from '@/lib/finance';
import {
  OUTBOX_KEY_BYTES, OUTBOX_PREFIX, canPersistMore, mergePatch, openEntry, outboxSecureKeyName, outboxStorageKey,
  parseStorageKey, parseStored, sealEntry, type StoredEntry,
} from '@/lib/outbox';

/**
 * توصيل الطابور المتشفّر بالتخزين: المدخلات في AsyncStorage (`nuqta-outbox:v1:<uid>:<txId>`) والمفتاح في SecureStore
 * (`nuqta_outbox_k_<sha256(uid)>`). كل عمليات نفس المدخلة ورا بعض (طابور وعود لكل id) — حفظ اتأخر ميرجعش بعد ما
 * الشيل خلص ويسيب مدخلة قديمة.
 *
 * **اللوج:** اسم الخطوة واسم نوع الخطأ بس — مفيش uid ولا مبلغ (قسم Sentry في CLAUDE.md).
 */

const rng = (n: number) => Crypto.getRandomBytes(n);

/** معرّف الجلسة: بيتعمل مرة لكل تشغيل للـJS. التطبيق اتقفل واتفتح ← جلسة جديدة ← مدخلات القديمة تتعاد */
let sessionId: string | null = null;
export function outboxSessionId(): string {
  // كسول: الاستيراد نفسه ميلمسش موديول أصلي (اختبارات من غير mock لـexpo-crypto بتستورد DataContext)
  if (!sessionId) sessionId = bytesToHex(rng(8));
  return sessionId;
}
/** للاختبارات بس: "التطبيق اتقفل واتفتح" */
export function __newOutboxSessionForTests(): string { sessionId = bytesToHex(rng(8)); return sessionId; }

const keyNames = new Map<string, string>();
async function keyName(uid: string): Promise<string> {
  const hit = keyNames.get(uid);
  if (hit) return hit;
  const h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, uid);
  const name = outboxSecureKeyName(h.toLowerCase());
  keyNames.set(uid, name);
  return name;
}

const errName = (e: unknown) => (e instanceof Error ? e.name : 'unknown');

/** `null` = مفيش مفتاح متخزّن. خطأ قراية بيترمي (مش `null`) — عشان منعملش مفتاح جديد فوق واحد موجود */
export async function readOutboxKey(uid: string): Promise<Uint8Array | null> {
  const raw = await SecureStore.getItemAsync(await keyName(uid));
  if (!raw) return null;
  try {
    const k = hexToBytes(raw);
    return k.length === OUTBOX_KEY_BYTES ? k : null;
  } catch {
    return null;
  }
}

/**
 * قفل لكل حساب: حفظين في نفس اللحظة على حساب مالوش مفتاح كانوا هيعملوا مفتاحين، والتاني يكتب فوق الأول — فالمدخلة
 * الأولى تبقى مش مقروءة.
 */
function keyForWrite(uid: string): Promise<Uint8Array> {
  return serial(`key:${uid}`, async () => {
    const existing = await readOutboxKey(uid);
    if (existing) return existing;
    const k = rng(OUTBOX_KEY_BYTES);
    await SecureStore.setItemAsync(await keyName(uid), bytesToHex(k));
    return k;
  });
}

const queues = new Map<string, Promise<unknown>>();
function serial<T>(id: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  queues.set(id, next);
  next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
  return next;
}

export async function outboxKeys(uid: string): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter(k => parseStorageKey(k)?.uid === uid);
}

/** `'skipped'` = الحد اتملى (الكتابة لفايربيز بتكمّل، بس من غير نسخة على الجهاز) */
export function putOutboxEntry(uid: string, txId: string, data: Record<string, unknown>): Promise<'saved' | 'skipped'> {
  return serial(outboxStorageKey(uid, txId), async () => {
    if (!canPersistMore((await outboxKeys(uid)).length)) return 'skipped';
    const key = await keyForWrite(uid);
    const stored = sealEntry({ uid, txId, data, sid: outboxSessionId(), savedAt: todayStr(), key, rng, t: Date.now() });
    await AsyncStorage.setItem(outboxStorageKey(uid, txId), JSON.stringify(stored));
    return 'saved';
  });
}

/** علامات المحاولات (`rj`، `fa`) — مش سرية (مفيهاش بيانات)، فبتتكتب بره التشفير. مدخلة مش موجودة ← مفيش حاجة */
export function updateOutboxMeta(uid: string, txId: string, patch: Pick<StoredEntry, 'rj' | 'fa'>): Promise<void> {
  const sk = outboxStorageKey(uid, txId);
  return serial(sk, async () => {
    const stored = parseStored(await AsyncStorage.getItem(sk));
    if (!stored) return;
    await AsyncStorage.setItem(sk, JSON.stringify({ ...stored, ...patch }));
  });
}

/**
 * تعديل عملية لسه في الطابور — كله جوه نفس طابور الـid (الدمج والبديل ورا بعض من غير ما شيل يدخل في النص):
 * - `merged`: اتدمج في المدخلة (الـsid والتاريخ زي ما هما).
 * - `absent`: مفيش مدخلة — **مبنعملش واحدة** (كانت اتأكدت واتشالت؛ إحياها كان هيرجّع عملية).
 * - مش مقروءة أو الدمج فشل ← `fallback()` (اللي بينادي بيرجّع العملية كاملة بعد التعديل، أو `null` لو اتشالت) بتتكتب
 *   مدخلة جديدة (`rewritten`)؛ مفيش بديل أو الكتابة فشلت ← `unprotected`.
 */
export function mergeOrRewriteOutboxEntry(
  uid: string, txId: string, patch: Record<string, unknown>, fallback: () => Record<string, unknown> | null,
): Promise<'merged' | 'absent' | 'rewritten' | 'unprotected'> {
  const sk = outboxStorageKey(uid, txId);
  return serial(sk, async () => {
    let stored: StoredEntry | null;
    try { stored = parseStored(await AsyncStorage.getItem(sk)); } catch (e) { logOutboxFailure('merge read failed', e); return 'unprotected'; }
    if (!stored) return 'absent';
    try {
      const key = await readOutboxKey(uid);
      const opened = openEntry(stored, uid, txId, key);
      if (opened.ok && key) {
        const next = sealEntry({ uid, txId, data: mergePatch(opened.data, patch), sid: stored.sid, savedAt: stored.savedAt, key, rng, t: stored.t });
        await AsyncStorage.setItem(sk, JSON.stringify(next));
        return 'merged';
      }
    } catch (e) { logOutboxFailure('merge failed', e); }
    const data = fallback();
    if (!data) return 'unprotected';
    try {
      const key = await keyForWrite(uid);
      const fresh = sealEntry({ uid, txId, data, sid: outboxSessionId(), savedAt: todayStr(), key, rng, t: Date.now() });
      await AsyncStorage.setItem(sk, JSON.stringify(fresh));
      return 'rewritten';
    } catch (e) {
      logOutboxFailure('rewrite failed', e);
      return 'unprotected';
    }
  });
}

export function removeOutboxEntry(uid: string, txId: string): Promise<void> {
  const sk = outboxStorageKey(uid, txId);
  return serial(sk, async () => {
    await AsyncStorage.removeItem(sk);
    await AsyncStorage.removeItem(tombstoneKey(uid, txId));
  });
}

/* ─── علامات على مستوى الحساب (بره بادئة المدخلات عشان `parseStorageKey` ميشوفهاش) ─── */
const META_PREFIX = 'nuqta-outbox-x:v1:';
const metaKey = (uid: string, name: string) => `${META_PREFIX}${uid}:${name}`;
const tombstoneKey = (uid: string, txId: string) => metaKey(uid, `del:${txId}`);
const metaUid = (k: string) => (k.startsWith(META_PREFIX) ? k.slice(META_PREFIX.length).split(':')[0] : null);

/** العملية اتمسحت وشيل مدخلتها فشل أو اتأخر — الإعادة بتشوف العلامة دي ومبتكتبش */
export function writeOutboxTombstone(uid: string, txId: string): Promise<void> {
  return AsyncStorage.setItem(tombstoneKey(uid, txId), '1');
}
export async function hasOutboxTombstone(uid: string, txId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(tombstoneKey(uid, txId))) === '1';
}

/**
 * مسح الخروج فشل ← المدخلات اللي كانت موجودة وقت الخروج (بالمعرّف، مش بالساعة — ساعة الموبايل ممكن ترجع لورا)
 * متتعادش: المستخدم اختار إنها تضيع
 */
export function setOutboxClearedIds(uid: string, ids: string[]): Promise<void> {
  return AsyncStorage.setItem(metaKey(uid, 'cleared'), JSON.stringify(ids));
}
export async function getOutboxClearedIds(uid: string): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(metaKey(uid, 'cleared'));
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch (e) {
    logOutboxFailure('cleared marker unreadable', e);
    return new Set();
  }
}

/** معرّفات مدخلات الحساب دلوقتي — بعد ما أي حفظ لسه شغال يخلص */
export async function outboxIdsAfterPendingSaves(uid: string): Promise<string[]> {
  await Promise.allSettled([...queues.values()]);
  return (await outboxKeys(uid)).map(k => parseStorageKey(k)!.txId);
}

/** قراية المفتاح فشلت في الجلسة دي — بيرجّع عدد الجلسات المختلفة اللي فشلت فيها */
export async function noteOutboxKeyReadFailure(uid: string): Promise<number> {
  const k = metaKey(uid, 'keyfail');
  let list: string[] = [];
  try { const v = JSON.parse((await AsyncStorage.getItem(k)) ?? '[]'); if (Array.isArray(v)) list = v.filter(x => typeof x === 'string'); }
  catch (e) { logOutboxFailure('keyfail marker unreadable', e); }
  const sid = outboxSessionId();
  if (!list.includes(sid)) list.push(sid);
  await AsyncStorage.setItem(k, JSON.stringify(list.slice(-5)));
  return list.length;
}
export function clearOutboxKeyReadFailures(uid: string): Promise<void> {
  return AsyncStorage.removeItem(metaKey(uid, 'keyfail'));
}

/**
 * الخروج اللي المستخدم طلبه (`logOut`) بيعلّم هنا قبل ما فايربيز يخرّجه — `DataContext` بيمسح الطابور بس لو العلامة موجودة.
 * خروج غصب (التوكن اتلغى…) ← المدخلات بتفضل (الـAAD والكنس بيعزلوا الحسابات).
 */
let userSignOut: string | null = null;
export function markUserSignOut(uid: string | null | undefined) { userSignOut = uid ?? null; }
export function consumeUserSignOut(uid: string): boolean {
  const hit = userSignOut === uid;
  if (hit) userSignOut = null;
  return hit;
}

/** حدث Sentry معدود (اسم بس، مفيش بيانات) — مرة لكل سبب في الجلسة */
const reported = new Set<string>();
export function reportOutboxEvent(reason: 'persist-failed' | 'limit-reached' | 'signout-clear-failed' | 'meta-write-failed') {
  if (reported.has(reason)) return;
  reported.add(reason);
  Sentry.captureMessage(`outbox: ${reason}`, { level: 'warning', tags: { outbox_reason: reason }, fingerprint: ['outbox', reason] });
}

export type ListedEntry = { txId: string; stored: StoredEntry | null };

/** `stored: null` = المدخلة نفسها بايظة (مش JSON، نسخة تانية) — بتتعامل زي "مش مقروءة" */
export async function listOutboxEntries(uid: string): Promise<ListedEntry[]> {
  const keys = await outboxKeys(uid);
  if (keys.length === 0) return [];
  const pairs = await AsyncStorage.multiGet(keys);
  return pairs.map(([k, raw]) => ({ txId: parseStorageKey(k)!.txId, stored: parseStored(raw) }));
}

/** الخروج ومسح الحساب: كل مدخلات الحساب **والمفتاح** */
export async function clearOutboxForUid(uid: string): Promise<void> {
  // حفظ لسه شغال (خروج بعد الحفظ بلحظة) كان هيرجع يكتب مدخلة بعد المسح — نستنى الطابور يفضى الأول
  await Promise.allSettled([...queues.values()]);
  const all = await AsyncStorage.getAllKeys();
  const keys = all.filter(k => parseStorageKey(k)?.uid === uid || metaUid(k) === uid);
  if (keys.length) await AsyncStorage.multiRemove(keys);
  await SecureStore.deleteItemAsync(await keyName(uid));
}

/**
 * الدخول: أي مدخلات لحساب تاني (التطبيق اتقفل بين الخروج والمسح، أو المسح فشل) بتتمسح — عمرها ما بتتعاد على الحساب
 * ده (والـAAD كان هيرفضها أصلاً). مفتاحها في SecureStore مبيتلاقاش من غير الـuid، ومن غير مدخلات ملوش لازمة.
 */
export async function sweepOtherOutboxes(uid: string): Promise<number> {
  const keys = await AsyncStorage.getAllKeys();
  const stale = keys.filter(k => { const p = parseStorageKey(k); return !!p && p.uid !== uid; });
  const staleMeta = keys.filter(k => { const m = metaUid(k); return !!m && m !== uid; });
  if (stale.length || staleMeta.length) await AsyncStorage.multiRemove([...stale, ...staleMeta]);
  return stale.length;
}

/**
 * إعادة مدخلة واحدة في ذرة: المستند موجود على السيرفر ← **مفيش كتابة** (`'exists'` — لو اتعدّل 100 ← 120 من جهاز تاني
 * يفضل 120)؛ مش موجود ← `set` بنفس المعرّف (`'written'`). الانتظار (`waitForPendingWrites`) والسقف عند اللي بينادي.
 */
export async function replayOutboxDoc(uid: string, txId: string, data: Record<string, unknown>): Promise<'written' | 'exists' | 'wallet-gone'> {
  let result: 'written' | 'exists' | 'wallet-gone' = 'exists';
  const ref = doc(db, 'users', uid, 'transactions', txId);
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    if (snap.exists()) { result = 'exists'; return; }
    // المحفظة (والوجهة في التحويل) لازم تكون موجودة ومش مؤرشفة — عملية على محفظة اتقفلت كانت هتغيّر رصيد صفّرناه
    const walletIds = [data.walletId, data.type === 'withdraw' ? data.toWalletId : undefined].filter((w): w is string => typeof w === 'string' && !!w);
    if (walletIds.length === 0) { result = 'wallet-gone'; return; }
    for (const w of walletIds) {
      const ws = await t.get(doc(db, 'users', uid, 'wallets', w));
      if (!ws.exists() || ws.data()?.archived === true) { result = 'wallet-gone'; return; }
    }
    t.set(ref, data);
    result = 'written';
  });
  return result;
}

/**
 * قبل أي "سجّلها تاني": العملية دي على السيرفر ولا لأ؟ محاولة قديمة عدّت السقف ممكن تكون وصلت — `present` اترفعت (تتشال من
 * غير رسالة)، `missing` اتأكد إنها مش هناك، `unknown` القراية فشلت (تفضل للمرة الجاية بدل رسالة ممكن تعمل نسخة تانية).
 */
export async function serverTxStatus(uid: string, txId: string, timeoutMs: number): Promise<'present' | 'missing' | 'unknown'> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const snap = await Promise.race([
      getDocFromServer(doc(db, 'users', uid, 'transactions', txId)),
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), timeoutMs); }),
    ]);
    return snap.exists() ? 'present' : 'missing';
  } catch (e) {
    logOutboxFailure('give-up check failed', e);
    return 'unknown';
  } finally { if (t) clearTimeout(t); }
}

export function logOutboxFailure(step: string, e: unknown) {
  console.warn('[outbox]', step, errName(e), (e as { code?: string })?.code ?? '');
}

export { OUTBOX_PREFIX };
