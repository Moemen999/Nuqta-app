import { readFileSync } from 'fs';
import * as Sentry from '@sentry/react-native';
import { atomicFailureCode, reportAtomicFailure, resetAtomicFailureThrottle } from '@/lib/atomicFailure';
import { scrubEvent } from '@/lib/sentryScrub';

/**
 * فشل العملية الذرية لازم يوصل Sentry (قبل كده كان console بس، والـbreadcrumbs
 * بتاعة الـconsole بتتشال) — ومن غير أي حاجة من بيانات المستخدم: لا مبلغ ولا
 * اسم ولا إيميل ولا ملاحظة ولا مسار مستند فيه الـuid.
 */

jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
const capture = Sentry.captureMessage as jest.Mock;

// خطأ فايرستور شكله حقيقي، ورسالته فيها كل اللي ممنوع يخرج
const leaky = Object.assign(new Error(
  'Missing or insufficient permissions: users/UID_SECRET_123/debts/d9 "أحمد" 1,500.50 ج.م ahmed@example.com ملاحظة: سلفة الإيجار',
), { code: 'permission-denied', name: 'FirebaseError' });

const SECRETS = ['UID_SECRET_123', 'أحمد', '1,500.50', '1500', 'ahmed@example.com', 'سلفة الإيجار', 'd9'];

beforeEach(() => { capture.mockClear(); resetAtomicFailureThrottle(); });

function sentEvent() {
  expect(capture).toHaveBeenCalledTimes(1);
  const [message, ctx] = capture.mock.calls[0];
  return { message, ...ctx };
}

describe('reportAtomicFailure', () => {
  it('بيبعت حدث واحد باسم العملية وكود الخطأ', () => {
    reportAtomicFailure('دفعة الدين', leaky);
    const ev = sentEvent();
    expect(ev.message).toBe('atomic operation failed: دفعة الدين (permission-denied)');
    expect(ev.tags).toEqual({ atomic_op: 'دفعة الدين', atomic_code: 'permission-denied' });
    expect(ev.level).toBe('error');
  });

  it('ولا حاجة من رسالة الخطأ بتخرج — لا uid ولا اسم ولا مبلغ ولا إيميل ولا ملاحظة', () => {
    reportAtomicFailure('تسديد الاشتراك', leaky);
    const serialized = JSON.stringify(capture.mock.calls[0]);
    for (const s of SECRETS) expect(serialized).not.toContain(s);
  });

  it('وبعد scrubEvent الحدث زي ما هو (مفيش حاجة يشيلها)، ومفيش extra', () => {
    reportAtomicFailure('تسجيل الجمعية', leaky);
    const ev = sentEvent();
    const scrubbed = scrubEvent({ message: ev.message, tags: ev.tags, extra: { e: leaky } })!;
    expect(scrubbed.message).toBe(ev.message);
    expect(scrubbed.extra).toBeUndefined();
    for (const s of SECRETS) expect(JSON.stringify(scrubbed)).not.toContain(s);
  });

  it('قطع النت = تحذير مش خطأ، ومرة واحدة بس لكل عملية في الجلسة', () => {
    reportAtomicFailure('دفعة الدين', { code: 'unavailable', message: 'offline users/UID_SECRET_123' });
    reportAtomicFailure('دفعة الدين', { code: 'unavailable' });
    reportAtomicFailure('دفعة الدين', { code: 'deadline-exceeded' });
    expect(sentEvent().level).toBe('warning');
    // عملية تانية ليها حدثها، والأخطاء الحقيقية مبتتقفلش
    reportAtomicFailure('تسديد الاشتراك', { code: 'unavailable' });
    reportAtomicFailure('دفعة الدين', { code: 'permission-denied' });
    reportAtomicFailure('دفعة الدين', { code: 'permission-denied' });
    expect(capture).toHaveBeenCalledTimes(4);
  });
});

describe('atomicFailureCode — الكود بس، مش الرسالة', () => {
  // نفس شكل كلاسات DataContext: الاسم متكتوب صريح عشان البناء المضغوط
  class DebtMissingError extends Error { name = 'DebtMissingError'; }
  class Mangled extends Error {}
  it.each<[unknown, string]>([
    [{ code: 'unavailable' }, 'unavailable'],
    [new DebtMissingError('دين "أحمد" 500'), 'DebtMissingError'],
    [new Error('users/UID_SECRET_123 أحمد'), 'unknown'],
    [new Mangled('x'), 'unknown'],
    ['نص خطأ فيه "أحمد" 1500', 'unknown'],
    [{ code: 'حاجة غريبة "أحمد"' }, 'unknown'],
    [null, 'unknown'],
  ])('%p ← %s', (e, code) => {
    expect(atomicFailureCode(e)).toBe(code);
  });
});

describe('التوصيل', () => {
  const src = readFileSync('context/DataContext.tsx', 'utf8');

  it('noteAtomicFailure بيبعت لـSentry مش console بس، واسم العملية من النوع الثابت', () => {
    const start = src.indexOf('function noteAtomicFailure(');
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    expect(body).toContain('function noteAtomicFailure(op: AtomicOp,');
    expect(body).toContain('reportAtomicFailure(op, e)');
  });

  it('كل كلاس خطأ في DataContext اسمه متكتوب صريح', () => {
    const classes = [...src.matchAll(/^class (\w+Error) extends Error (.*)$/gm)];
    expect(classes.length).toBeGreaterThan(0);
    for (const [, name, body] of classes) expect(body).toBe(`{ name = '${name}'; }`);
  });

  it('Sentry بتعدّي كل حدث على scrubEvent (beforeSend)', () => {
    const sentry = readFileSync('lib/sentry.ts', 'utf8');
    expect(sentry).toMatch(/beforeSend: event => scrubEvent\(/);
    expect(sentry).toMatch(/sendDefaultPii: false/);
  });
});
