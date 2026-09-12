/**
 * مساعدات جهات الاتصال: تطبيع وفلترة.
 *
 * الفلترة متحطّة هنا بره الشاشة عشان تتختبر لوحدها من غير ما نركّب UI،
 * ولأنها بتشتغل على كل حرف بيتكتب في البحث فلازم تفضل رخيصة وواضحة.
 */

export type ContactEntry = {
  id: string;
  name: string;
  /** أول رقم محفوظ — ده اللي بيتعرض وبيتحفظ مع الدين */
  phone: string;
};

/** تطبيع الاسم قبل المقارنة: شيل المسافات الزايدة ووحّد حالة الحروف */
function normalizeName(s: string) {
  return (s || '').trim().toLocaleLowerCase('ar');
}

/**
 * بترجّع جهات الاتصال اللي اسمها فيه اللي المستخدم كتبه.
 * بحث فاضي = الليست كلها زي ما هي (نفس المصفوفة، من غير نسخة جديدة).
 */
export function filterContacts<T extends ContactEntry>(list: T[], query: string): T[] {
  const q = normalizeName(query);
  if (!q) return list;
  return list.filter(c => normalizeName(c.name).includes(q));
}
