jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import * as Sentry from '@sentry/react-native';
import { resetBadShapeReports } from '@/lib/fromDoc';
import { debtFromDoc, finiteOr, gamiyaFromDoc, incomeFromDoc, numberField, subscriptionFromDoc, withId } from '@/lib/fromDoc';

/** بند B (مراجعة المشروع 2026-11-05): شكل المستند من غير قرار — المعرّف، المصفوفات، الأرقام */

it('المعرّف من المسار بيكسب حقل id متخزّن جوه المستند', () => {
  expect(withId<{ id: string }>('real', { id: 'fake', name: 'كاش' }).id).toBe('real');
  expect(debtFromDoc<{ id: string }>('real', { id: 'fake' }).id).toBe('real');
});

it('مصفوفات null أو نوع تاني ← [] (الافتراضي بالـspread مكانش بيغطي null)', () => {
  const d = debtFromDoc<{ payments: unknown[]; increases: unknown[] }>('d', { payments: null, increases: 'x' });
  expect(d.payments).toEqual([]);
  expect(d.increases).toEqual([]);
  expect(debtFromDoc<{ payments: unknown[] }>('d', { payments: [{ amount: 1 }] }).payments).toHaveLength(1);
  expect(subscriptionFromDoc<{ history: unknown[] }>('s', { history: null }).history).toEqual([]);
  expect(gamiyaFromDoc<{ months: unknown[] }>('g', {}).months).toEqual([]);
  expect(incomeFromDoc<{ closed: object }>('i', { closed: null }).closed).toEqual({});
  expect(incomeFromDoc<{ closed: object }>('i', { closed: [1] }).closed).toEqual({});
});

it('الأرقام: محدود بس', () => {
  expect(numberField({ limit: 500 }, 'limit')).toBe(500);
  for (const v of [undefined, null, '500', NaN, Infinity]) expect(numberField({ limit: v }, 'limit')).toBeUndefined();
  expect(finiteOr('50', 30)).toBe(30);
  expect(finiteOr(NaN, 30)).toBe(30);
  expect(finiteOr(40, 30)).toBe(40);
});

describe('التبليغ (silent-failure-hunter جولة 1)', () => {
  beforeEach(() => { resetBadShapeReports(); (Sentry.captureMessage as jest.Mock).mockClear(); });

  it('حقل موجود وشكله غلط ← تبليغ بالمجموعة والحقل بس، مرة واحدة في الجلسة', () => {
    debtFromDoc('d1', { payments: null });
    debtFromDoc('d2', { payments: null });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('firestore doc bad shape: debts.payments', expect.objectContaining({ tags: { doc_collection: 'debts', doc_field: 'payments' } }));
  });

  it('حقل ناقص (مستند قديم) ← مفيش تبليغ', () => {
    debtFromDoc('d1', {});
    numberField({}, 'limit', 'budgets');
    finiteOr(undefined, 50, ['shakhbata_settings', 'needs']);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ميزانية رقمها نص ← تبليغ', () => {
    numberField({ limit: '500' }, 'limit', 'budgets');
    expect(Sentry.captureMessage).toHaveBeenCalledWith('firestore doc bad shape: budgets.limit', expect.anything());
  });
});

describe('strict قبل كتابة ذرية (silent-failure-hunter جولة 2)', () => {
  const { DocShapeError } = require('@/lib/fromDoc');
  it('قيمة موجودة مش null وشكلها غلط ← بترمي (مفيش كتابة فوقها)', () => {
    expect(() => debtFromDoc('d', { payments: { a: 1 } }, true)).toThrow(DocShapeError);
    expect(() => subscriptionFromDoc('s', { history: 'x' }, true)).toThrow(DocShapeError);
    expect(() => incomeFromDoc('i', { closed: [1] }, true)).toThrow(DocShapeError);
    expect(() => gamiyaFromDoc('g', { months: 5 }, true)).toThrow(DocShapeError);
  });
  it('null أو ناقص ← فاضي عادي حتى في strict', () => {
    expect(debtFromDoc<{ payments: unknown[] }>('d', { payments: null }, true).payments).toEqual([]);
    expect(subscriptionFromDoc<{ history: unknown[] }>('s', {}, true).history).toEqual([]);
  });
  it('من غير strict (العرض) ← فاضي ومبترميش', () => {
    expect(debtFromDoc<{ payments: unknown[] }>('d', { payments: { a: 1 } }).payments).toEqual([]);
  });
});
