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

/**
 * قراية **قبل كتابة ذرية** (`strict`): حقل موجود بقيمة مش `null` وشكلها غلط ← **مفيش كتابة** (الذرة بترمي والشاشة
 * بتقول "ما اتسجلش"). من غيرها الدفعة كانت هتكتب `[الدفعة]` فوق القيمة البايظة ويضيع اللي كان فيها (silent-failure-hunter
 * جولة 2). `null` أو ناقص ← فاضي عادي (مفيش حاجة تضيع)
 */
export class DocShapeError extends Error { name = 'DocShapeError'; }

const arr = <T>(data: Data, key: string, collection: string, strict?: boolean): T[] => {
  const v = data[key];
  if (Array.isArray(v)) return v as T[];
  if (key in data) {
    reportBadShape(collection, key);
    if (strict && v !== null) throw new DocShapeError();
  }
  return [];
};
const obj = <T>(data: Data, key: string, collection: string, strict?: boolean): Record<string, T> => {
  const v = data[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, T>;
  if (key in data) {
    reportBadShape(collection, key);
    if (strict && v !== null) throw new DocShapeError();
  }
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

export function debtFromDoc<T>(id: string, data: Data, strict?: boolean): T {
  return { ...data, payments: arr(data, 'payments', 'debts', strict), increases: arr(data, 'increases', 'debts', strict), id } as T;
}

export function subscriptionFromDoc<T>(id: string, data: Data, strict?: boolean): T {
  return { ...data, history: arr(data, 'history', 'subscriptions', strict), id } as T;
}

export function gamiyaFromDoc<T>(id: string, data: Data, strict?: boolean): T {
  return { ...data, months: arr(data, 'months', 'gamiyas', strict), id } as T;
}

export function incomeFromDoc<T>(id: string, data: Data, strict?: boolean): T {
  return { ...data, closed: obj(data, 'closed', 'incomes', strict), id } as T;
}

/** ميزانية/دخل شخبطة: رقم محدود بس — غير كده مفيش قيمة (زي ما يكون مش متسجل) */
export function numberField(data: Data, key: string, collection?: string): number | undefined {
  const v = data[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (collection && key in data) reportBadShape(collection, key);
  return undefined;
}

/**
 * بند B — قرار مؤمن 2026-11-06: عملية **مبلغها مش رقم محدود، أو تاريخها مش YYYY-MM-DD، أو نوعها مش واحد من التلاتة**
 * (القواعد بتفحص النوع وقت الكتابة بس — ده من نسخ قديمة أو تعديل من الكونسول) **مبتتشالش ساكت ومبتتحوّلش صفر**:
 * بتطلع من `transactions` (فمبتدخلش أي حسبة: رصيد، مصروف، تقارير، ميزانية) وتروح `brokenTransactions` — بتتعرض في
 * الأرشيف بعلامة «⚠️ بيانات ناقصة» وتتصلّح أو تتمسح، وبانر في الرئيسية بيعدّها. مبلغ صفر أو بالسالب **مش بايظ** هنا:
 * مش عارفين إنه غلط (الإشارة متولّعش على حالة ممكن تكون شرعية).
 */
export type BrokenReason = 'amount' | 'date' | 'type';
export type BrokenTransaction = {
  id: string;
  reasons: BrokenReason[];
  /** اللي اتقري سليم بس — الباقي `undefined` */
  type?: 'expense' | 'income' | 'withdraw';
  amount?: number;
  date?: string;
  walletId?: string;
  toWalletId?: string;
  categoryId?: string;
  note?: string;
  /** مربوطة بدخل ثابت/اشتراك/جمعية بمعرّف ثابت (الدين بيتعرف من `transactionLinkWarning`) */
  incomeId?: string;
  subscriptionId?: string;
  gamiyaId?: string;
};

const TX_TYPES = ['expense', 'income', 'withdraw'] as const;
export function isValidDateStr(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  // يوم موجود فعلاً في الشهر ده (2026-02-31 لأ) — من غير `Date` بالتوقيت المحلي
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** أسباب البوظان من غير تبليغ — التصدير بيستخدمها عشان يعلّم الصف (نفس القاعدة بالظبط) */
export function brokenReasonsOf(data: Data): BrokenReason[] {
  const reasons: BrokenReason[] = [];
  if (!(typeof data.amount === 'number' && Number.isFinite(data.amount))) reasons.push('amount');
  if (!isValidDateStr(data.date)) reasons.push('date');
  if (!(TX_TYPES as readonly unknown[]).includes(data.type)) reasons.push('type');
  return reasons;
}

export function transactionFromDoc<T>(id: string, data: Data):
  { ok: true; tx: T } | { ok: false; broken: BrokenTransaction } {
  const reasons = brokenReasonsOf(data);
  const amountOk = !reasons.includes('amount');
  const dateOk = !reasons.includes('date');
  const typeOk = !reasons.includes('type');
  if (reasons.length === 0) return { ok: true, tx: withId<T>(id, data) };
  for (const r of reasons) reportBadShape('transactions', r);
  return {
    ok: false,
    broken: {
      id, reasons,
      type: typeOk ? data.type as BrokenTransaction['type'] : undefined,
      amount: amountOk ? data.amount as number : undefined,
      date: dateOk ? data.date as string : undefined,
      walletId: str(data.walletId), toWalletId: str(data.toWalletId), categoryId: str(data.categoryId),
      note: str(data.note),
      incomeId: str(data.incomeId), subscriptionId: str(data.subscriptionId), gamiyaId: str(data.gamiyaId),
    },
  };
}

/** يقسم مستندات العمليات: السليمة للحسابات، والبايظة لوحدها */
export function splitTransactions<T>(docs: { id: string; data: () => Data }[]): { transactions: T[]; broken: BrokenTransaction[] } {
  const transactions: T[] = [];
  const broken: BrokenTransaction[] = [];
  for (const d of docs) {
    const r = transactionFromDoc<T>(d.id, d.data());
    if (r.ok) transactions.push(r.tx); else broken.push(r.broken);
  }
  return { transactions, broken };
}

/**
 * المحفظة: رصيد البداية مش رقم محدود ← **صفر + `openingInvalid`** (قرار مؤمن: نفس البانر بيقول). المحفظة نفسها لازم
 * تفضل — من غيرها عملياتها تتيتم. حد التنبيه مش رقم ← صفر (شكل بس، مالوش أثر على الرصيد) + Sentry
 */
export function walletFromDoc<T>(id: string, data: Data): T {
  const opening = data.openingBalance;
  const openingOk = typeof opening === 'number' && Number.isFinite(opening);
  if (!openingOk) reportBadShape('wallets', 'openingBalance');
  return {
    ...data,
    openingBalance: openingOk ? opening : 0,
    ...(openingOk ? {} : { openingInvalid: true }),
    lowAlert: finiteOr(data.lowAlert, 0, ['wallets', 'lowAlert']),
    id,
  } as T;
}
