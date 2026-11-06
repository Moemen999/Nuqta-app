/**
 * بند B (مراجعة المشروع 2026-11-05): مستندات فايرستور بتتصدّق من غير فحص (`as any`) — و"Firestore does not enforce a
 * schema" (توثيق فايربيز). الملف ده الجزء اللي **مالوش قرار**: شكل البيانات، مش رقم الفلوس.
 * - المعرّف **آخر حاجة**: حقل `id` متخزّن جوه المستند كان بيغطي معرّف المستند (`{ id, ...data }`) — وبعدها
 *   `doc(db, ..., x.id)` بيكتب على مستند تاني.
 * - مصفوفة متخزّنة `null` أو نوع تاني ← `[]`: الافتراضي بالـspread مكانش بيغطي `null` (الشاشات بتعمل `.forEach`).
 * - أرقام الميزانية والشخبطة والنسب: رقم محدود بس — `undefined`/نص/NaN كان بيدخل الحسبة.
 *
 * **مش هنا (مستني قرار مؤمن):** عملية أو محفظة رقمها مش محدود أو تاريخها ناقص — تتشال؟ تتعلّم؟
 */

type Data = Record<string, unknown>;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T>(v: unknown): Record<string, T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {});
export const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** `{ ...data, id }` — المعرّف من مسار المستند دايمًا */
export function withId<T>(id: string, data: Data): T {
  return { ...data, id } as T;
}

export function debtFromDoc<T>(id: string, data: Data): T {
  return { ...data, payments: arr(data.payments), increases: arr(data.increases), id } as T;
}

export function subscriptionFromDoc<T>(id: string, data: Data): T {
  return { ...data, history: arr(data.history), id } as T;
}

export function gamiyaFromDoc<T>(id: string, data: Data): T {
  return { ...data, months: arr(data.months), id } as T;
}

export function incomeFromDoc<T>(id: string, data: Data): T {
  return { ...data, closed: obj(data.closed), id } as T;
}

/** ميزانية/دخل شخبطة: رقم محدود بس — غير كده مفيش قيمة (زي ما يكون مش متسجل) */
export function numberField(data: Data, key: string): number | undefined {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
