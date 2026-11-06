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

import * as Sentry from '@sentry/react-native';

type Data = Record<string, unknown>;

/**
 * التطبيع نفسه ساكت (silent-failure-hunter جولة 1): دين `payments` بتاعه اتبوّظ لـnull بيبان "مش مدفوع". فلما حقل
 * **موجود وشكله غلط** (مش لما يكون ناقص — ده عادي في المستندات القديمة) بيتبلّغ Sentry: اسم المجموعة والحقل بس
 * (نصوص ثابتة — مفيش معرّفات: معرّف الميزانية = معرّف فئة)، مرة واحدة لكل (مجموعة، حقل) في الجلسة
 */
const reported = new Set<string>();
export function reportBadShape(collection: string, field: string) {
  const key = `${collection}.${field}`;
  if (reported.has(key)) return;
  reported.add(key);
  Sentry.captureMessage(`firestore doc bad shape: ${key}`, { level: 'warning', tags: { doc_collection: collection, doc_field: field }, fingerprint: ['doc-bad-shape', key] });
}
/** للاختبارات بس */
export function resetBadShapeReports() { reported.clear(); }

const arr = <T>(data: Data, key: string, collection: string): T[] => {
  const v = data[key];
  if (Array.isArray(v)) return v as T[];
  if (key in data) reportBadShape(collection, key);
  return [];
};
const obj = <T>(data: Data, key: string, collection: string): Record<string, T> => {
  const v = data[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, T>;
  if (key in data) reportBadShape(collection, key);
  return {};
};
export const finiteOr = (v: unknown, fallback: number, where?: [string, string]): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (where && v !== undefined) reportBadShape(where[0], where[1]);
  return fallback;
};

/** `{ ...data, id }` — المعرّف من مسار المستند دايمًا */
export function withId<T>(id: string, data: Data): T {
  return { ...data, id } as T;
}

export function debtFromDoc<T>(id: string, data: Data): T {
  return { ...data, payments: arr(data, 'payments', 'debts'), increases: arr(data, 'increases', 'debts'), id } as T;
}

export function subscriptionFromDoc<T>(id: string, data: Data): T {
  return { ...data, history: arr(data, 'history', 'subscriptions'), id } as T;
}

export function gamiyaFromDoc<T>(id: string, data: Data): T {
  return { ...data, months: arr(data, 'months', 'gamiyas'), id } as T;
}

export function incomeFromDoc<T>(id: string, data: Data): T {
  return { ...data, closed: obj(data, 'closed', 'incomes'), id } as T;
}

/** ميزانية/دخل شخبطة: رقم محدود بس — غير كده مفيش قيمة (زي ما يكون مش متسجل) */
export function numberField(data: Data, key: string, collection?: string): number | undefined {
  const v = data[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (collection && key in data) reportBadShape(collection, key);
  return undefined;
}
