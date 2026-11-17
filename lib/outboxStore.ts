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
async function keyForWrite(uid: string): Promise<Uint8Array> {
  const name = await keyName(uid);
  // نفس طابور المسح (`deleteKeyUnlessCurrent`) — بالاسم: مسح ومفتاح جديد لنفس الحساب ميتداخلوش
  return serial(keyQueueId(name), async () => {
    // في السجل قبل أي كتابة للمفتاح: مفتاح موجود من غير ما يتسجّل (اتعمل قبل السجل) بيتسجّل هنا كمان
    // فشل السجل مبيوقّفش الحفظ: أسوأ حاجة المفتاح يفضل يتيم (زي قبل السجل)
    try { await registerKeyName(name); } catch (e) { logOutboxFailure('key registry write failed', e); }
    const existing = await readOutboxKey(uid);
    if (existing) return existing;
    const k = rng(OUTBOX_KEY_BYTES);
    await SecureStore.setItemAsync(name, bytesToHex(k));
    return k;
  });
}

const keyQueueId = (name: string) => `key:${name}`;

/**
 * مسح مفتاح من SecureStore — في طابور المفتاح نفسه، و**الحساب الحالي بيتسأل وقت المسح** (مش وقت ما الكنس بدأ): تبديل
 * حساب في نص الكنس، أو إعادة مسح الخروج بعد ما نفس الحساب رجع دخل، كانوا هيمسحوا مفتاح الحساب اللي شغال دلوقتي فكل
 * مدخلاته تبقى مش مقروءة. `'kept'` = ده مفتاح الحساب الحالي فمتلمسش. المسح نجح ← الاسم بيتشال من السجل في نفس الطابور
 * (قبل أي `keyForWrite` جاي يسجّله تاني).
 */
function deleteKeyUnlessCurrent(name: string, currentUid: () => string | null | undefined): Promise<'deleted' | 'kept'> {
  return serial(keyQueueId(name), async () => {
    const cur = currentUid();
    if (cur && (await keyName(cur)) === name) return 'kept';
    await SecureStore.deleteItemAsync(name);
    try { await unregisterKeyNames([name]); } catch (e) { logOutboxFailure('key registry write failed', e); }
    return 'deleted';
  });
}

/*
 * ─── سجل أسامي المفاتيح (security-reviewer قبل الدمج) ───
 * SecureStore مالوش "هات كل المفاتيح"، فمفتاح حساب خرج غصب أو بـ«نسيت الكود؟» كان بيفضل يتيم للأبد (مدخلاته بتتكنس، هو
 * لأ). السجل في AsyncStorage فيه **أسامي** المفاتيح بس (`nuqta_outbox_k_<sha256(uid)>` — مفيش uid خام ولا مفتاح)، والكنس
 * بيمسح أي مفتاح في السجل مش بتاع الحساب الحالي. بره بادئة المدخلات والعلامات عشان `parseStorageKey`/`metaUid` ميشوفوهوش.
 */
export const OUTBOX_KEY_REGISTRY = 'nuqta-outbox-keys:v1';
/**
 * السجل في AsyncStorage (مش محمي) — فأي اسم مش بشكل مفتاح الطابور بالظبط بيتجاهل: من غير الفلتر ده الكنس كان ممكن يمسح
 * أي مفتاح SecureStore تاني اتكتب اسمه في السجل (قفل التطبيق مثلاً، security-reviewer)
 */
const KEY_NAME_RE = /^nuqta_outbox_k_[0-9a-f]{64}$/;
const registered = new Set<string>();
/** للاختبارات بس: `AsyncStorage.clear()` بين الاختبارات مبيفضّيش الكاش ده */
export function __resetOutboxKeyRegistryCacheForTests() { registered.clear(); }

/**
 * `null` = السجل موجود بس مش مقروء — **منكتبش فوقه** (كان هيمسح أسامي مفاتيح لسه في SecureStore فتفضل يتيمة للأبد)؛
 * بلاغ Sentry بالاسم بس، والحفظ بيكمّل من غير تسجيل
 */
async function readRegistry(): Promise<string[] | null> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY_REGISTRY);
  if (!raw) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch (e) { v = undefined; logOutboxFailure('key registry unreadable', e); }
  if (!Array.isArray(v)) {
    if (v !== undefined) console.warn('[outbox]', 'key registry unreadable', 'shape');
    reportOutboxEvent('key-registry-unreadable');
    return null;
  }
  return v.filter((x): x is string => typeof x === 'string' && KEY_NAME_RE.test(x));
}

function registerKeyName(name: string): Promise<void> {
  // الـ`has` جوه الطابور: برّه كان ممكن يسبق `unregisterKeyNames` لسه مستني ويرجع من غير ما يسجّل
  return serial('key-registry', async () => {
    if (registered.has(name)) return;
    const list = await readRegistry();
    if (!list) return; // مش مقروء ← منكتبش فوقه، والمرة الجاية بتحاول تاني
    if (!list.includes(name)) await AsyncStorage.setItem(OUTBOX_KEY_REGISTRY, JSON.stringify([...list, name]));
    registered.add(name);
  });
}

function unregisterKeyNames(names: string[]): Promise<void> {
  if (names.length === 0) return Promise.resolve();
  return serial('key-registry', async () => {
    names.forEach(n => registered.delete(n));
    const list = await readRegistry();
    if (!list) return;
    const next = list.filter(n => !names.includes(n));
    if (next.length !== list.length) await AsyncStorage.setItem(OUTBOX_KEY_REGISTRY, JSON.stringify(next));
  });
}

/** مسح مفتاح الحساب من SecureStore فشل — اسم بس؛ الاسم بيفضل في السجل والكنس الجاي بيحاول تاني */
export class OutboxKeyDeleteError extends Error {
  constructor() { super('outbox key delete failed'); this.name = 'OutboxKeyDeleteError'; }
}

/** مسح مدخلات الحساب نفسها (`getAllKeys`/`multiRemove`) فشل — المفتاح ما اتلمسش (المدخلات من غيره كانت هتبقى مش مقروءة) */
export class OutboxEntriesClearError extends Error {
  constructor() { super('outbox entries clear failed'); this.name = 'OutboxEntriesClearError'; }
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
export type OutboxEventReason =
  | 'persist-failed' | 'limit-reached' | 'signout-clear-failed' | 'meta-write-failed' | 'account-delete-key-failed'
  | 'account-delete-entries-failed' | 'key-registry-unreadable';
export function reportOutboxEvent(reason: OutboxEventReason) {
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

/**
 * الخروج ومسح الحساب: كل مدخلات الحساب **والمفتاح**. `currentUid` (الخروج بس): الحساب اللي داخل **دلوقتي** — لو نفس الحساب
 * رجع دخل قبل ما المسح (أو إعادته) يوصل، مفيش مسح: كان هيمسح مدخلات الجلسة الجديدة ومفتاحها. مسح الحساب مبيبعتهوش (الحساب
 * الحالي هو اللي بيتمسح).
 */
export async function clearOutboxForUid(uid: string, currentUid?: () => string | null | undefined): Promise<void> {
  // حفظ لسه شغال (خروج بعد الحفظ بلحظة) كان هيرجع يكتب مدخلة بعد المسح — نستنى الطابور يفضى الأول
  await Promise.allSettled([...queues.values()]);
  if (currentUid && currentUid() === uid) { console.warn('[outbox]', 'clear skipped: same account signed back in'); return; }
  try {
    const all = await AsyncStorage.getAllKeys();
    const keys = all.filter(k => parseStorageKey(k)?.uid === uid || metaUid(k) === uid);
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch (e) { logOutboxFailure('entries clear failed', e); throw new OutboxEntriesClearError(); }
  const name = await keyName(uid);
  let r: 'deleted' | 'kept';
  try { r = await deleteKeyUnlessCurrent(name, currentUid ?? (() => null)); }
  catch (e) { logOutboxFailure('key delete failed', e); throw new OutboxKeyDeleteError(); }
  if (r === 'kept') console.warn('[outbox]', 'key kept: same account signed back in');
}

/**
 * الدخول: أي مدخلات لحساب تاني (التطبيق اتقفل بين الخروج والمسح، أو المسح فشل) بتتمسح — عمرها ما بتتعاد على الحساب
 * ده (والـAAD كان هيرفضها أصلاً). مفاتيحها من السجل بتتمسح كمان. `currentUid`: الحساب الداخل **وقت كل مسح مفتاح**
 * (تبديل حساب في نص الكنس ميمسحش مفتاح الحساب الجديد) — الافتراضي `uid`.
 */
export async function sweepOtherOutboxes(uid: string, currentUid: () => string | null | undefined = () => uid): Promise<number> {
  const keys = await AsyncStorage.getAllKeys();
  const stale = keys.filter(k => { const p = parseStorageKey(k); return !!p && p.uid !== uid; });
  const staleMeta = keys.filter(k => { const m = metaUid(k); return !!m && m !== uid; });
  if (stale.length || staleMeta.length) await AsyncStorage.multiRemove([...stale, ...staleMeta]);
  await sweepOtherKeys(uid, currentUid);
  return stale.length;
}

/** مفاتيح SecureStore لحسابات تانية (من السجل، بشكل الاسم بس) — مدخلاتها اتكنست فوق. فشل واحد مبيوقّفش الباقي */
async function sweepOtherKeys(uid: string, currentUid: () => string | null | undefined): Promise<void> {
  const own = await keyName(uid);
  const list = await readRegistry();
  if (!list) return;
  for (const n of list.filter(x => x !== own)) {
    try { await deleteKeyUnlessCurrent(n, currentUid); }
    catch (e) { logOutboxFailure('stale key delete failed', e); }
  }
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
