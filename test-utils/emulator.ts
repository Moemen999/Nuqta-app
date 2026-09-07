/**
 * أدوات مساعدة لاختبارات المحاكي.
 * الاختبارات دي بتشتغل على محاكي Firestore محلي بس — أبدًا على قاعدة البيانات
 * الحقيقية. `npm run test:db` بيقوم المحاكي وبيحط FIRESTORE_EMULATOR_HOST
 * تلقائيًا، وfirebaseConfig بيوصّل عليه بناءً على المتغير ده.
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

/** معرّف مستخدم جديد لكل اختبار عشان الاختبارات ما تتلخبطش في بعض */
export function newUid(prefix = 'user') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** بيستنى شوية عشان نتأكد إن مفيش كتابات زيادة في السكة (للاختبارات اللي بتتأكد من عدم التكرار) */
export function settle(ms = 1500) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
