/**
 * أدوات مساعدة لاختبارات المحاكي.
 * الاختبارات دي بتشتغل على محاكي Firestore ومحاكي Auth محليين بس — أبدًا على
 * قاعدة البيانات الحقيقية. `npm run test:db` بيقوم المحاكيين وبيحط
 * FIRESTORE_EMULATOR_HOST وFIREBASE_AUTH_EMULATOR_HOST تلقائيًا، وfirebaseConfig
 * بيوصّل عليهم بناءً على المتغيرين دول.
 */
const PROJECT_ID = 'nuqta-711f2';

export function emulatorHost() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) {
    throw new Error(
      'محاكي Firestore مش شغال. شغّل الاختبارات دي بـ `npm run test:db` مش بـ jest مباشرةً.'
    );
  }
  return host;
}

/** بيمسح كل بيانات المشروع من المحاكي عشان كل اختبار يبدأ من صفحة بيضا */
export async function clearFirestore() {
  const res = await fetch(
    `http://${emulatorHost()}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`مقدرتش أمسح بيانات المحاكي: ${res.status}`);
}

/**
 * بتسجل دخول مستخدم جديد فعلي على محاكي Auth وبترجع الـ uid الحقيقي بتاعه.
 * قواعد الإنتاج بتتحقق من request.auth.uid فعليًا (مش بس من مسار المستند)،
 * فاختبارات الكتابة لازم تستخدم مستخدم حقيقي مسجّل دخول مش uid مختلق —
 * وإلا كل كتابة هترجع permission-denied حتى لو المنطق صح.
 */
export async function signInTestUser(): Promise<string> {
  const { auth } = require('@/firebaseConfig');
  const { signInAnonymously, signOut } = require('firebase/auth');
  try {
    await signOut(auth);
  } catch {
    // مفيش مستخدم مسجل دخول أصلاً — عادي
  }
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

/**
 * بيكتب مستند **من غير ما يعدّي على القواعد** (`Bearer owner` — المحاكي بس).
 * لتمثيل بيانات قديمة اتكتبت قبل ما القاعدة تتشد: مثلاً دين فيه
 * `installmentCount: -2` من بناء قبل `ad4a339` (15–17 سبتمبر) مكانش بيتحقق منه.
 * الأرقام الصحيحة بتتكتب `integerValue` والكسور `doubleValue` زي الـSDK بالظبط.
 */
export async function writeLegacyDoc(path: string, data: Record<string, string | number>) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k,
    typeof v === 'string' ? { stringValue: v }
      : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v },
  ]));
  const res = await fetch(
    `http://${emulatorHost()}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
  );
  if (!res.ok) throw new Error(`مقدرتش أكتب المستند القديم: ${res.status} ${await res.text()}`);
}

/** المستند موجود؟ **من غير القواعد** (`Bearer owner`) — لمستند المستخدم الحالي ممنوع يقراه (رأي حد تاني مثلاً) */
export async function legacyDocExists(path: string): Promise<boolean> {
  const res = await fetch(
    `http://${emulatorHost()}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: 'Bearer owner' } }
  );
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`مقدرتش أقرا المستند: ${res.status}`);
  return true;
}

/** بيستنى شوية عشان نتأكد إن مفيش كتابات زيادة في السكة (للاختبارات اللي بتتأكد من عدم التكرار) */
export function settle(ms = 1500) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** قيمة JS ← قيمة REST بتاعة Firestore (أي شكل: Infinity/NaN كنص زي proto3 JSON، null، مصفوفة، كائن متداخل) */
function toRestValue(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { doubleValue: 'NaN' };
    if (!Number.isFinite(v)) return { doubleValue: v > 0 ? 'Infinity' : '-Infinity' };
    return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toRestValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toRestValue(x)])) } };
}

/**
 * زي `writeLegacyDoc` بس لأي شكل بيانات — **من غير القواعد** (`Bearer owner`). لتمثيل بيانات بايظة اتكتبت قبل تشديد
 * القواعد (2026-11-07) أو من كلاينت معدّل: الكلاينت الحقيقي مبقاش يقدر يكتبها، بس اللي اتكتب قبل كده لسه موجود والتطبيق لازم يستحمله.
 */
export async function writeRawDoc(path: string, data: Record<string, unknown>) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toRestValue(v)]));
  const res = await fetch(
    `http://${emulatorHost()}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
  );
  if (!res.ok) throw new Error(`مقدرتش أكتب المستند البايظ: ${res.status} ${await res.text()}`);
}
