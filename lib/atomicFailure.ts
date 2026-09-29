import * as Sentry from '@sentry/react-native';

/**
 * فشل العمليات الذرية (دفعة دين، تسديد اشتراك، تسجيل دخل ثابت…) كان بيروح
 * `console.warn` بس — والـbreadcrumbs بتاعة الـconsole بتتشال بالكامل في
 * `sentryScrub`، فمكانش بيوصل Sentry خالص (TIMELINE 2026-09-28). الشاشة بتقول
 * للمستخدم "ما اتسجلش"، واحنا مكناش هنعرف إن ده بيحصل غير لو اشتكى.
 *
 * **اللي بيخرج:** اسم العملية (نص ثابت من الكود — كل النداءات في
 * `DataContext` حروف ثابتة، مفيش اسم شخص ولا مبلغ) + **كود** الخطأ بس.
 *
 * **اللي مبيخرجش:** رسالة الخطأ نفسها ولا الكائن. رسالة فايرستور ممكن يكون
 * فيها مسار المستند (`users/{uid}/debts/{id}`)، وأي خطأ بتاعنا ممكن حد يحط
 * فيه اسم بعدين. فالكائن مبيتبعتش أصلاً — بنبعت رسالة من عندنا، وهي كمان
 * بتعدّي على `scrubEvent` زي أي حدث.
 */

/**
 * أسامي العمليات — **نصوص ثابتة بس** (security-reviewer). الـtags مبتعدّيش
 * على `redactText`، فلو `op` بقى `string` حد ممكن يعدّي اسم شخص من غير ما
 * ياخد باله. النوع ده بيخلّي ده خطأ compile.
 */
export type AtomicOp =
  | 'دفعة الدين' | 'حذف دفعة الدين' | 'زيادة الدين' | 'حذف زيادة الدين'
  | 'تسديد الاشتراك' | 'فوّت فترة اشتراك' | 'تسجيل الاشتراك' | 'تسجيل الجمعية'
  | 'مسح الدخل الثابت' | 'تسجيل الدخل الثابت' | 'تسديد شهر الجمعية'
  | 'تجهيز الحساب' | 'تجهيز الحساب (السقف خلص)' | 'تجهيز الحساب (المحاولة المتأخرة فشلت)';

/**
 * كود فايرستور ("unavailable"، "permission-denied")، أو اسم نوع الخطأ بتاعنا
 * (`name` متكتوب صريح في كل كلاس في `DataContext` — `constructor.name`
 * بيتلخبط في البناء المضغوط)، أو "unknown"
 */
export function atomicFailureCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[a-z][a-z-]{0,40}$/.test(code)) return code;
  if (e instanceof Error && e.name !== 'Error' && /^[A-Za-z]{3,40}Error$/.test(e.name)) return e.name;
  return 'unknown';
}

/** النت (أو السيرفر مش بيرد) — متوقّع وبيحصل كتير، فتحذير مش خطأ */
const CONNECTIVITY = new Set(['unavailable', 'deadline-exceeded']);

/**
 * قطع النت بيتبعت **مرة واحدة لكل عملية في الجلسة** — أوفلاين كل دوسة كانت
 * هتبقى حدث، ومفيش معلومة جديدة في التاني (security-reviewer: الحصة).
 */
const connectivitySent = new Set<string>();

export function reportAtomicFailure(op: AtomicOp, e: unknown) {
  const code = atomicFailureCode(e);
  const connectivity = CONNECTIVITY.has(code);
  if (connectivity) {
    if (connectivitySent.has(op)) return;
    connectivitySent.add(op);
  }
  Sentry.captureMessage(`atomic operation failed: ${op} (${code})`, {
    level: connectivity ? 'warning' : 'error',
    tags: { atomic_op: op, atomic_code: code },
    // حدث واحد لكل (عملية، كود) في Sentry، مش لكل رسالة
    fingerprint: ['atomic-failure', op, code],
  });
}

/** للاختبارات بس */
export function resetAtomicFailureThrottle() {
  connectivitySent.clear();
}
