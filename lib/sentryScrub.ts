/**
 * تنضيف أي حاجة رايحة لـSentry من بيانات المستخدم المالية.
 *
 * القاعدة اللي اتفقنا عليها: **مفيش مبالغ، مفيش أرصدة، مفيش أسامي محافظ أو
 * فئات، مفيش أسامي ناس، مفيش نص الرأي.** ودي مش نظرية — الكود بيلمس
 * الحاجات دي فعلاً في مسارات الخطأ:
 *
 * - `reportWriteError` بيعمل `console.warn` باسم السجل («الدين "أحمد"»)،
 *   وSentry بياخد الـconsole كـbreadcrumbs أوتوماتيك.
 * - رسايل أخطاء فايرستور ممكن تحمل جزء من المستند.
 * - `extra`/`contexts` بيتحطّ فيهم حالة الكومبوننت بسهولة من غير ما حد ياخد باله.
 *
 * فالمنطق هنا **مش** قايمة ممنوعات (denylist) — الممنوعات بتفوّت اللي
 * منعرفوش. المنطق: نبعت اللي محتاجينه للتشخيص (نوع الخطأ، الستاك، الإصدار،
 * نوع الجهاز) ونقصّ كل اللي غيره.
 */

export const REDACTED = '[محذوف]';
export const REDACTED_NUMBER = '[رقم]';

/**
 * أي حاجة بين علامتي تنصيص — هناك بالظبط `namedLabel` بتحط أسامي المستخدمين.
 *
 * كل زوج متكتوب لوحده عن قصد: العلامات المزدوجة («») بدايتها مش زي نهايتها،
 * فقاعدة واحدة بـbackreference كانت بتتلخبط وتقصّ نص الجملة.
 */
const QUOTED = /"[^"]{1,120}"|'[^']{1,120}'|«[^»]{1,120}»|“[^”]{1,120}”/g;

/**
 * رقم شكله فلوس: فيه كسر عشري، أو فاصلة آلاف، أو 4 خانات فما فوق.
 *
 * الأرقام القصيرة (زي 404 أو رقم سطر) بتفضل — هي مفيدة للتشخيص ومش بتقول
 * حاجة عن فلوس حد. الحد عند 4 خانات لأن أقل مبلغ بيهم حد في تطبيق مصاريف
 * مصري أكبر من كده بكتير، والأكواد التلاتية شائعة.
 */
const MONEYISH = /\b\d{1,3}(?:[,٬]\d{3})+(?:[.٫]\d+)?\b|\b\d+[.٫]\d+\b|\b\d{4,}\b/g;

export function redactText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(QUOTED, `"${REDACTED}"`).replace(MONEYISH, REDACTED_NUMBER);
}

type Breadcrumb = { category?: string; message?: string; data?: unknown; [k: string]: unknown };

/**
 * الـbreadcrumbs بتاعة الـconsole بتتشال بالكامل.
 *
 * مش بنحاول ننضّفها: `console.log` ممكن ياخد أي حاجة، ومحدش بيراجع كل
 * نداء console في التطبيق كل ما يتكتب واحد جديد. القرار إنها كلها تتشال،
 * والتشخيص يعتمد على الاستثناء نفسه.
 */
export function scrubBreadcrumb(b: Breadcrumb | null): Breadcrumb | null {
  if (!b) return null;
  if (b.category === 'console') return null;
  const out: Breadcrumb = { ...b };
  delete out.data;
  if (typeof out.message === 'string') out.message = redactText(out.message);
  return out;
}

type SentryEventLike = {
  message?: unknown;
  exception?: { values?: { type?: string; value?: string; [k: string]: unknown }[] };
  breadcrumbs?: Breadcrumb[];
  extra?: unknown;
  contexts?: Record<string, unknown>;
  request?: unknown;
  user?: { id?: string; email?: string; username?: string; ip_address?: string; [k: string]: unknown };
  tags?: Record<string, unknown>;
  [k: string]: unknown;
};

/** الحاجات الوحيدة اللي بنسيبها في `contexts` — كلها عن الجهاز مش عن المستخدم */
const SAFE_CONTEXTS = ['os', 'device', 'app', 'runtime', 'trace'];

export function scrubEvent(event: SentryEventLike | null): SentryEventLike | null {
  if (!event) return null;
  const out: SentryEventLike = { ...event };

  if (typeof out.message === 'string') out.message = redactText(out.message);

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map(v => ({ ...v, value: redactText(v.value) })),
    };
  }

  // `extra` و`request` بيتشالوا بالكامل — دول أكتر مكانين البيانات بتتسرّب منهم
  delete out.extra;
  delete out.request;

  if (out.contexts) {
    const kept: Record<string, unknown> = {};
    SAFE_CONTEXTS.forEach(k => { if (out.contexts![k] !== undefined) kept[k] = out.contexts![k]; });
    out.contexts = kept;
  }

  // المعرّف بس. الإيميل والاسم والـIP مالهمش لازمة للتشخيص.
  out.user = out.user?.id ? { id: out.user.id } : undefined;

  out.breadcrumbs = (out.breadcrumbs || [])
    .map(scrubBreadcrumb)
    .filter((b): b is Breadcrumb => b !== null);

  return out;
}
