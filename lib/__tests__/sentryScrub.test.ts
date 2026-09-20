import {
  REDACTED, REDACTED_NUMBER, redactText, scrubBreadcrumb, scrubEvent,
} from '@/lib/sentryScrub';
import { namedLabel, writeErrorBody } from '@/lib/writeError';
// الـSDK نفسه مش محتاجينه هنا، وتحميله بيسيب مؤقتات مفتوحة بعد الاختبارات
jest.mock('@sentry/react-native', () => ({ init: jest.fn(), setTag: jest.fn() }));
// eslint-disable-next-line import/first
import { SENTRY_DIST, SENTRY_RELEASE, sentryEnabled } from '@/lib/sentry';

/**
 * القاعدة: **مفيش مبالغ، مفيش أرصدة، مفيش أسامي محافظ أو فئات، مفيش أسامي
 * ناس، مفيش نص الرأي** بيخرج من التطبيق لـSentry.
 *
 * الاختبارات دي مش شكلية: `reportWriteError` بيعمل `console.warn` باسم
 * السجل، وSentry بتاخد الـconsole كـbreadcrumbs أوتوماتيك. يعني من غير
 * التنضيف ده، أول كتابة تفشل كانت هتبعتلنا اسم صاحب الدين.
 */

describe('redactText', () => {
  it('بيشيل أي حاجة بين علامتي تنصيص — هناك بالظبط بتتحط أسامي الناس', () => {
    expect(redactText('الدين "أحمد محمد" ما وصلش')).toBe(`الدين "${REDACTED}" ما وصلش`);
    expect(redactText("المحفظة 'كاش' فشلت")).toBe(`المحفظة "${REDACTED}" فشلت`);
    expect(redactText('الاشتراك «نتفليكس» فشل')).toBe(`الاشتراك "${REDACTED}" فشل`);
  });

  it('بيشيل الأرقام اللي شكلها فلوس', () => {
    expect(redactText('الرصيد 12,500.75')).toBe(`الرصيد ${REDACTED_NUMBER}`);
    expect(redactText('المبلغ 4500')).toBe(`المبلغ ${REDACTED_NUMBER}`);
    expect(redactText('باقي 99.5')).toBe(`باقي ${REDACTED_NUMBER}`);
  });

  it('بيسيب الأرقام القصيرة — أكواد وأرقام سطور مفيدة ومش فلوس', () => {
    expect(redactText('status 404')).toBe('status 404');
    expect(redactText('line 42')).toBe('line 42');
    expect(redactText('code 7')).toBe('code 7');
  });

  it('مبيقعش على مدخل مش نص', () => {
    expect(redactText(undefined)).toBe('');
    expect(redactText(null)).toBe('');
    expect(redactText(12345)).toBe('');
  });
});

describe('الرسالة الحقيقية اللي التطبيق بيطبعها', () => {
  /** ده النص بالحرف اللي `reportWriteError` بيعمله console.warn */
  it('اسم صاحب الدين مبيخرجش', () => {
    const real = writeErrorBody(namedLabel('الدين', 'أحمد محمد'));
    expect(real).toContain('أحمد محمد');
    expect(redactText(real)).not.toContain('أحمد');
    expect(redactText(real)).not.toContain('محمد');
  });

  it('واسم المحفظة كمان', () => {
    const real = writeErrorBody(namedLabel('المحفظة', 'حساب البنك'));
    expect(redactText(real)).not.toContain('حساب البنك');
  });
});

describe('scrubBreadcrumb', () => {
  it('breadcrumbs الـconsole بتتشال بالكامل — مش بتتنضّف', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'الدين "أحمد" فشل' })).toBeNull();
  });

  it('الباقي بيتنضّف و`data` بتتشال', () => {
    const out = scrubBreadcrumb({
      category: 'navigation',
      message: 'راح لـ "المحفظة الرئيسية"',
      data: { balance: 12500 },
    });
    expect(out?.data).toBeUndefined();
    expect(out?.message).not.toContain('المحفظة الرئيسية');
  });

  it('null بيرجع null', () => {
    expect(scrubBreadcrumb(null)).toBeNull();
  });
});

describe('scrubEvent', () => {
  const dirty = () => ({
    message: 'فشل حفظ الدين "أحمد" بمبلغ 12,500',
    exception: { values: [{ type: 'FirebaseError', value: 'رفض كتابة "كاش" رصيد 8400' }] },
    breadcrumbs: [
      { category: 'console', message: 'كتابة فشلت: الدين "أحمد"' },
      { category: 'navigation', message: 'من "الرئيسية"' },
    ],
    extra: { walletBalance: 12500, categories: ['أكل', 'مواصلات'] },
    request: { data: { feedbackText: 'التطبيق وحش' } },
    contexts: { os: { name: 'Android' }, device: { model: 'SM-A546B' }, state: { balances: [1, 2] } },
    user: { id: 'uid-123', email: 'moemen@example.com', ip_address: '1.2.3.4' },
  });

  it('الرسالة والاستثناء بيتنضّفوا', () => {
    const out = scrubEvent(dirty())!;
    expect(out.message).not.toContain('أحمد');
    expect(out.message).not.toContain('12,500');
    expect(out.exception!.values![0].value).not.toContain('كاش');
    expect(out.exception!.values![0].value).not.toContain('8400');
  });

  it('نوع الاستثناء بيفضل — من غيره مفيش تشخيص', () => {
    expect(scrubEvent(dirty())!.exception!.values![0].type).toBe('FirebaseError');
  });

  it('`extra` و`request` بيتشالوا بالكامل', () => {
    const out = scrubEvent(dirty())!;
    expect(out.extra).toBeUndefined();
    expect(out.request).toBeUndefined();
  });

  it('`contexts` بتتقصّ على الجهاز بس — حالة التطبيق بتتشال', () => {
    const out = scrubEvent(dirty())!;
    expect(out.contexts).toEqual({ os: { name: 'Android' }, device: { model: 'SM-A546B' } });
    expect(out.contexts!.state).toBeUndefined();
  });

  it('المستخدم بيفضل المعرّف بس — من غير إيميل ولا IP', () => {
    expect(scrubEvent(dirty())!.user).toEqual({ id: 'uid-123' });
  });

  it('breadcrumbs الـconsole بتختفي من الحدث', () => {
    const out = scrubEvent(dirty())!;
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.breadcrumbs![0].category).toBe('navigation');
  });

  it('مفيش أي أثر لأي بيانات مالية في الحدث كله', () => {
    const serialized = JSON.stringify(scrubEvent(dirty()));
    ['أحمد', 'كاش', 'أكل', 'مواصلات', '12500', '12,500', '8400',
     'التطبيق وحش', 'moemen@example.com', '1.2.3.4'].forEach(secret => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('null بيرجع null', () => {
    expect(scrubEvent(null)).toBeNull();
  });
});

describe('ربط الإصدار برقم البناء', () => {
  it('اسم الإصدار في Sentry = نفس اللي المستخدم شايفه في "عن التطبيق"', () => {
    const { APP_FULL_VERSION, BUILD_NUMBER } = require('@/lib/appInfo');
    expect(SENTRY_RELEASE).toBe(APP_FULL_VERSION);
    expect(SENTRY_DIST).toBe(BUILD_NUMBER);
  });

  it('من غير DSN، Sentry مقفولة — والتطبيق بيشتغل عادي', () => {
    expect(sentryEnabled).toBe(false);
  });
});
