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

/** بيستنى شوية عشان نتأكد إن مفيش كتابات زيادة في السكة (للاختبارات اللي بتتأكد من عدم التكرار) */
export function settle(ms = 1500) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
