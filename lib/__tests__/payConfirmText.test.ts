import { gamiyaMarkConfirmBody, subscriptionPayConfirmBody } from '@/lib/autoCharge';
import { walletHistoryName } from '@/lib/finance';

const TODAY = '2026-11-12';

describe('نص تأكيد دفع الاشتراك', () => {
  it('في معاده: بيسمّي الاشتراك والمعاد والمبلغ والمحفظة، من غير جملة التاريخ', () => {
    expect(subscriptionPayConfirmBody({ name: 'Netflix', nextDueDate: '2026-11-12', amount: 240 }, 'CIB', TODAY))
      .toBe('اشتراك "Netflix" بتاع 12 نوفمبر 2026 — هيتخصم 240 ج.م من CIB؟');
  });

  it('معاده لسه جاي: برضو من غير جملة التاريخ', () => {
    expect(subscriptionPayConfirmBody({ name: 'Netflix', nextDueDate: '2026-12-20', amount: 240 }, 'CIB', TODAY))
      .toBe('اشتراك "Netflix" بتاع 20 ديسمبر 2026 — هيتخصم 240 ج.م من CIB؟');
  });

  it('متأخر: بيقول إن العملية هتتسجل بتاريخ النهارده', () => {
    expect(subscriptionPayConfirmBody({ name: 'Netflix', nextDueDate: '2026-10-15', amount: 240 }, 'CIB', TODAY))
      .toBe('اشتراك "Netflix" بتاع 15 أكتوبر 2026 — هيتخصم 240 ج.م من CIB؟ هيتسجل بتاريخ النهارده.');
  });

  it('محفظة مؤرشفة: الاسم بيجي من walletHistoryName زي ما هو', () => {
    const wallets = [{ id: 'w1', name: 'CIB', archived: true }];
    const name = walletHistoryName(wallets, 'w1');
    const body = subscriptionPayConfirmBody({ name: 'Netflix', nextDueDate: '2026-11-12', amount: 240 }, name, TODAY);
    expect(body).toContain(`من ${name}؟`);
    expect(name).not.toBe('CIB');
  });

  it('اسم فيه علامة تنصيص: يفضل زوج واحد بس حوالين الاسم', () => {
    const body = subscriptionPayConfirmBody({ name: 'نت "فاست"', nextDueDate: '2026-11-12', amount: 240 }, 'CIB', TODAY);
    expect(body.match(/"/g)).toHaveLength(2);
    expect(body.startsWith('اشتراك "')).toBe(true);
    expect(body).toContain('فاست');
  });
});

describe('نص تأكيد شهر الجمعية', () => {
  const base = { name: 'Work', monthIndex: 2, dueDate: '2026-11-05', amount: 1500 };

  it('قسط متأخر: بيقول إنه هيتسجل بتاريخ المعاد مش النهارده', () => {
    expect(gamiyaMarkConfirmBody({ ...base, isPayout: false }, 'CIB', TODAY))
      .toBe('قسط شهر 2 من جمعية "Work" (5 نوفمبر 2026) — هيتخصم 1,500 ج.م من CIB؟ هيتسجل بتاريخ المعاد مش النهارده.');
  });

  it('قسط معاده النهارده: من غير جملة التاريخ', () => {
    expect(gamiyaMarkConfirmBody({ ...base, dueDate: TODAY, isPayout: false }, 'CIB', TODAY))
      .toBe('قسط شهر 2 من جمعية "Work" (12 نوفمبر 2026) — هيتخصم 1,500 ج.م من CIB؟');
  });

  it('استلام: بصيغة الاستلام والمحفظة اللي هتدخل فيها', () => {
    expect(gamiyaMarkConfirmBody({ name: 'Work', monthIndex: 4, dueDate: '2027-01-05', amount: 15000, isPayout: true }, 'CIB', TODAY))
      .toBe('استلام جمعية "Work" (شهر 4، 5 يناير 2027) — هتستلم 15,000 ج.م في CIB؟ هيتسجل بتاريخ المعاد مش النهارده.');
  });

  it('اسم فيه علامة تنصيص: زوج واحد بس', () => {
    const body = gamiyaMarkConfirmBody({ ...base, name: 'ج"مية', isPayout: false }, 'CIB', TODAY);
    expect(body.match(/"/g)).toHaveLength(2);
  });
});
