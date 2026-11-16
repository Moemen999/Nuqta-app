import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils';
import { runTransaction, type DocumentReference } from 'firebase/firestore';
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

async function keyForWrite(uid: string): Promise<Uint8Array> {
  const existing = await readOutboxKey(uid);
  if (existing) return existing;
  const k = rng(OUTBOX_KEY_BYTES);
  await SecureStore.setItemAsync(await keyName(uid), bytesToHex(k));
  return k;
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
    const stored = sealEntry({ uid, txId, data, sid: outboxSessionId(), savedAt: todayStr(), key, rng });
    await AsyncStorage.setItem(outboxStorageKey(uid, txId), JSON.stringify(stored));
    return 'saved';
  });
}

/** تعديل عملية لسه في الطابور — الـsid والتاريخ بيفضلوا زي ما هما. مفيش مدخلة أو مش مقروءة ← مبنعملش حاجة */
export function mergeOutboxEntry(uid: string, txId: string, patch: Record<string, unknown>): Promise<'merged' | 'absent' | 'unreadable'> {
  const sk = outboxStorageKey(uid, txId);
  return serial(sk, async () => {
    const stored = parseStored(await AsyncStorage.getItem(sk));
    if (!stored) return 'absent';
    const key = await readOutboxKey(uid);
    const opened = openEntry(stored, uid, txId, key);
    if (!opened.ok || !key) return 'unreadable';
    const next = sealEntry({ uid, txId, data: mergePatch(opened.data, patch), sid: stored.sid, savedAt: stored.savedAt, key, rng });
    await AsyncStorage.setItem(sk, JSON.stringify(next));
    return 'merged';
  });
}

export function removeOutboxEntry(uid: string, txId: string): Promise<void> {
  const sk = outboxStorageKey(uid, txId);
  return serial(sk, () => AsyncStorage.removeItem(sk));
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
  const keys = await outboxKeys(uid);
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
  if (stale.length) await AsyncStorage.multiRemove(stale);
  return stale.length;
}

/**
 * إعادة مدخلة واحدة في ذرة: المستند موجود على السيرفر ← **مفيش كتابة** (`'exists'` — لو اتعدّل 100 ← 120 من جهاز تاني
 * يفضل 120)؛ مش موجود ← `set` بنفس المعرّف (`'written'`). الانتظار (`waitForPendingWrites`) والسقف عند اللي بينادي.
 */
export async function replayOutboxDoc(ref: DocumentReference, data: Record<string, unknown>): Promise<'written' | 'exists'> {
  let result: 'written' | 'exists' = 'exists';
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    if (snap.exists()) { result = 'exists'; return; }
    t.set(ref, data);
    result = 'written';
  });
  return result;
}

export function logOutboxFailure(step: string, e: unknown) {
  console.warn('[outbox]', step, errName(e), (e as { code?: string })?.code ?? '');
}

export { OUTBOX_PREFIX };
