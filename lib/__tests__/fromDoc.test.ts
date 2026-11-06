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
