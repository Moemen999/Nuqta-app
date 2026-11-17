/**
 * مساعدات جهات الاتصال: تطبيع وفلترة.
 *
 * الفلترة متحطّة هنا بره الشاشة عشان تتختبر لوحدها من غير ما نركّب UI،
 * ولأنها بتشتغل على كل حرف بيتكتب في البحث فلازم تفضل رخيصة وواضحة.
 */

export type ContactEntry = {
  /** مفتاح القايمة — المعرّف الحقيقي لو موجود، وإلا مفتاح محلي **مبيتخزّنش** مع الدين */
  id: string;
  /**
   * معرّف جهة الاتصال على الموبايل — ده اللي بيتخزّن (`personContactId`). `undefined` لو النظام ما ادّاهاش
   * معرّف: معرّف عشوائي كان بيتخزّن ويخلّي اسم الشخص لينك بيفتح كارت مش موجود (بند 11)
   */
  contactId?: string;
  name: string;
  /** أول رقم محفوظ — ده اللي بيتعرض وبيتحفظ مع الدين */
  phone: string;
  /** الاسم مطبّع للبحث — بيتحسب مرة واحدة وقت التحميل مش كل حرف */
  searchName: string;
  /** كل أرقام الشخص مطبّعة للبحث — بيتحسبوا مرة واحدة وقت التحميل */
  searchPhones: string[];
};

/** تطبيع الاسم قبل المقارنة: شيل المسافات الزايدة ووحّد حالة الحروف */
function normalizeName(s: string) {
  return (s || '').trim().toLocaleLowerCase('ar');
}

/**
 * بتحوّل الأرقام العربية والفارسية (٠١٢ / ۰۱۲) لأرقام إنجليزي، لأن كيبورد
 * الموبايل العربي بتكتبها كده والأرقام المحفوظة في جهات الاتصال إنجليزي.
 */
function toAsciiDigits(s: string) {
  return s.replace(/[٠-٩۰-۹]/g, ch => {
    const code = ch.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * بترجّع الرقم أرقام بس، بصيغة محلية موحّدة.
 *
 * الأرقام محفوظة بأشكال مختلفة على نفس الموبايل:
 * `+20 100 123 4567` و`01001234567` و`0100-123-4567` كلهم نفس الرقم.
 * فبنشيل المسافات والشرط والأقواس، وبنحوّل كود مصر لصفر المحلي عشان
 * اللي يكتب الرقم عادي يلاقي الشخص بأي صيغة كان محفوظ بيها.
 */
export function normalizePhone(raw: string): string {
  let d = toAsciiDigits(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2); // 0020… → 20…
  if (d.startsWith('20')) d = '0' + d.slice(2); // كود مصر → الصفر المحلي
  return d;
}

/**
 * مقارنة رقمين مطبّعين. غير المطابقة المباشرة، بنجرّب كمان من غير الصفر
 * اللي في الأول — عشان اللي يكتب رقم محلي يلاقي رقم محفوظ بكود دولة تانية
 * (مثلاً رقم سعودي محفوظ +966 50… والمستخدم كاتب 050…).
 */
function phoneMatches(storedDigits: string, queryDigits: string): boolean {
  if (!storedDigits || !queryDigits) return false;
  if (storedDigits.includes(queryDigits)) return true;
  const bareQuery = queryDigits.replace(/^0+/, '');
  return !!bareQuery && storedDigits.replace(/^0+/, '').includes(bareQuery);
}

/** بتبني سطر جهة اتصال جاهز للبحث — التطبيع بيحصل هنا مرة واحدة */
export function makeContactEntry(contactId: string | undefined, name: string, phones: string[], fallbackKey?: string): ContactEntry {
  const clean = phones.filter(Boolean);
  return {
    id: contactId || fallbackKey || `${name}|${clean[0] || ''}`,
    ...(contactId ? { contactId } : {}),
    name,
    phone: clean[0] || '',
    searchName: normalizeName(name),
    searchPhones: clean.map(normalizePhone).filter(Boolean),
  };
}

/**
 * بترجّع جهات الاتصال اللي الاسم أو أي رقم من أرقامها فيه اللي المستخدم كتبه.
 * بحث فاضي = الليست كلها زي ما هي (نفس المصفوفة، من غير نسخة جديدة).
 */
export function filterContacts<T extends ContactEntry>(list: T[], query: string): T[] {
  const raw = (query || '').trim();
  if (!raw) return list;
  const name = normalizeName(raw);
  const digits = normalizePhone(raw);
  return list.filter(
    c => c.searchName.includes(name) || c.searchPhones.some(p => phoneMatches(p, digits))
  );
}

/**
 * بيحضّر الرقم للعرض جوه واجهة عربية.
 *
 * الواجهة كلها RTL، والرقم زي `+20 100 123 4567` فيه علامة + ومسافات —
 * فمن غير علامة اتجاه بيتقلب ويظهر `4567 123 100 20+`. علامة LTR في
 * الأول بتخلي الرقم يتعرض بترتيبه الصح.
 */
export function phoneForDisplay(phone: string): string {
  return phone ? `\u200E${phone}` : '';
}

/**
 * الاسم اللي بيتعرض لجهة اتصال (بند 11): الاسم الموحّد، وإلا الأول+الأوسط+الأخير (أسامي عربي كتير مالهاش
 * `name`)، وإلا الشركة، وإلا الرقم — بدل ما جهة الاتصال تختفي من القايمة. `''` لو مفيش أي حاجة خالص.
 */
export function contactDisplayName(c: {
  name?: string | null; firstName?: string | null; middleName?: string | null; lastName?: string | null;
  company?: string | null; phones?: string[];
}): string {
  const name = (c.name || '').trim();
  if (name) return name;
  const composed = [c.firstName, c.middleName, c.lastName].map(x => (x || '').trim()).filter(Boolean).join(' ');
  if (composed) return composed;
  const company = (c.company || '').trim();
  if (company) return company;
  return (c.phones || []).map(p => (p || '').trim()).find(Boolean) || '';
}
