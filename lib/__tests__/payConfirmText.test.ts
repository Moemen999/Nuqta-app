import { gamiyaMarkConfirmBody, subscriptionPayConfirmBody, subscriptionPayKey, subscriptionManualKey } from '@/lib/autoCharge';

const TODAY = '2026-11-12';
const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'Netflix', amount: 240, frequency: 'monthly' as const, nextDueDate: '2026-11-12', ...over,
});
/** زي الشاشة بالظبط: المفتاح بيتحسب مرة، وبيتبعت للجملة */
const payBody = (s: ReturnType<typeof sub>, wallet = 'CIB') => subscriptionPayConfirmBody(s, wallet, TODAY, subscriptionPayKey(s, TODAY)!);

describe('نص تأكيد دفع الاشتراك', () => {
  it('معاده النهارده: بيسمّي الاشتراك والمعاد والمبلغ والمحفظة، من غير جملة التاريخ', () => {
    expect(payBody(sub()))
      .toBe('اشتراك "Netflix" بتاع 12 نوفمبر — نسجّل خصم 240 ج.م من CIB؟');
  });

  it('متأخر: بيقول إن العملية هتتسجل بتاريخ النهارده', () => {
    expect(payBody(sub({ nextDueDate: '2026-10-15' })))
      .toBe('اشتراك "Netflix" بتاع 15 أكتوبر — نسجّل خصم 240 ج.م من CIB؟ هيتسجل بتاريخ النهاردة.');
  });

  it('دفع بدري: برضو بيقول إنها هتتسجل بتاريخ النهارده (العملية دايمًا بتاريخ اليوم)', () => {
    expect(payBody(sub({ nextDueDate: '2026-12-20' })))
      .toBe('اشتراك "Netflix" بتاع 20 ديسمبر — نسجّل خصم 240 ج.م من CIB؟ هيتسجل بتاريخ النهاردة.');
  });

  it('الجملة بتسمّي المفتاح اللي اتبعتلها بالظبط (مش بتحسب لوحدها)', () => {
    // nextDueDate نوفمبر، بس المفتاح المبعوت 15 سبتمبر ← الجملة بتقول سبتمبر
    expect(subscriptionPayConfirmBody(sub({ nextDueDate: '2026-11-15' }), 'CIB', TODAY, '2026-09-15'))
      .toContain('بتاع 15 سبتمبر');
  });

  it('سبتمبر رجعت تسأل و nextDueDate 15 نوفمبر: بيسمّي 15 سبتمبر مش 15 نوفمبر', () => {
    const s = sub({
      nextDueDate: '2026-11-15',
      closed: {
        '2026-09-15': { txId: 't1', at: '2026-09-15T00:00:00Z', reopened: true },
        '2026-10-15': { txId: 't2', at: '2026-10-15T00:00:00Z' },
      },
    });
    expect(subscriptionManualKey(s, TODAY)).toBe('2026-09-15');
    expect(subscriptionPayKey(s, TODAY)).toBe('2026-09-15');
    const body = payBody(s);
    expect(body).toContain('بتاع 15 سبتمبر');
    expect(body).not.toContain('نوفمبر');
    expect(body.endsWith('هيتسجل بتاريخ النهاردة.')).toBe(true);
  });

  it('البناء بياخد اسم محفظة شغالة زي ما هو (مفيش لاحقة مؤرشفة بتتحط هنا — الشاشة بتمنع قبل كده)', () => {
    expect(payBody(sub(), 'الكاش')).toContain('من الكاش؟');
  });

  it('اسم فيه علامة تنصيص: يفضل زوج واحد بس حوالين الاسم', () => {
    const body = payBody(sub({ name: 'نت "فاست"' }));
    expect(body.match(/"/g)).toHaveLength(2);
    expect(body.startsWith('اشتراك "')).toBe(true);
    expect(body).toContain('فاست');
  });

  it('مبلغ NaN: جملة عامة من غير 0 ج.م ولا NaN', () => {
    const body = payBody(sub({ amount: NaN }));
    expect(body).toBe('اشتراك "Netflix" — نسجّل خصم الاشتراك ده؟');
    expect(body).not.toMatch(/NaN|0 ج\.م/);
  });
});

describe('subscriptionPayKey — مفتاح الفترة اللي الشاشة بتبعته للكتابة', () => {
  it('اشتراك سليم ← نفس subscriptionManualKey', () => {
    expect(subscriptionPayKey(sub({ nextDueDate: '2026-10-15' }), TODAY)).toBe(subscriptionManualKey(sub({ nextDueDate: '2026-10-15' }), TODAY));
  });

  it.each([
    ['معاد ناقص', { nextDueDate: undefined }],
    ['معاد مش تاريخ', { nextDueDate: 'بكرة' }],
    ['معاد رقم', { nextDueDate: 20261112 }],
  ])('%s ← null (الشاشة ترفض ومتفتحش تأكيد)', (_label, over) => {
    expect(subscriptionPayKey(sub(over), TODAY)).toBeNull();
  });
});

describe('نص تأكيد شهر الجمعية', () => {
  const base = { name: 'Work', monthIndex: 2, dueDate: '2026-11-05', amount: 1500 };

  it('قسط متأخر: بيقول إنه هيتسجل بتاريخ المعاد مش النهارده', () => {
    expect(gamiyaMarkConfirmBody({ ...base, isPayout: false }, 'CIB', TODAY))
      .toBe('قسط شهر 2 من جمعية "Work" (5 نوفمبر) — نسجّل خصم 1,500 ج.م من CIB؟ هيتسجل بتاريخ المعاد مش النهاردة.');
  });

  it('قسط معاده النهارده: من غير جملة التاريخ', () => {
    expect(gamiyaMarkConfirmBody({ ...base, dueDate: TODAY, isPayout: false }, 'CIB', TODAY))
      .toBe('قسط شهر 2 من جمعية "Work" (12 نوفمبر) — نسجّل خصم 1,500 ج.م من CIB؟');
  });

  it('استلام: بصيغة الاستلام والمحفظة اللي هيتسجل فيها', () => {
    expect(gamiyaMarkConfirmBody({ name: 'Work', monthIndex: 4, dueDate: '2027-01-05', amount: 15000, isPayout: true }, 'CIB', TODAY))
      .toBe('استلام جمعية "Work" (شهر 4، 5 يناير 2027) — نسجّل استلام 15,000 ج.م في CIB؟ هيتسجل بتاريخ المعاد مش النهاردة.');
  });

  it('اسم فيه علامة تنصيص: زوج واحد بس', () => {
    const body = gamiyaMarkConfirmBody({ ...base, name: 'ج"مية', isPayout: false }, 'CIB', TODAY);
    expect(body.match(/"/g)).toHaveLength(2);
  });

  it('معاد ناقص: جملة عامة للقسط وللاستلام', () => {
    const noDate = { ...base, dueDate: undefined as unknown as string };
    expect(gamiyaMarkConfirmBody({ ...noDate, isPayout: false }, 'CIB', TODAY)).toBe('جمعية "Work" — نسجّل خصم القسط ده؟');
    expect(gamiyaMarkConfirmBody({ ...noDate, isPayout: true }, 'CIB', TODAY)).toBe('جمعية "Work" — نسجّل استلام الجمعية؟');
  });

  it('مبلغ NaN: جملة عامة من غير 0 ج.م', () => {
    const body = gamiyaMarkConfirmBody({ ...base, amount: NaN, isPayout: false }, 'CIB', TODAY);
    expect(body).toBe('جمعية "Work" — نسجّل خصم القسط ده؟');
    expect(body).not.toMatch(/NaN|0 ج\.م/);
  });

  it('رقم شهر مش منتهي (NaN/Infinity): جملة عامة من غير "شهر NaN"', () => {
    for (const monthIndex of [NaN, Infinity]) {
      const body = gamiyaMarkConfirmBody({ ...base, monthIndex, isPayout: false }, 'CIB', TODAY);
      expect(body).toBe('جمعية "Work" — نسجّل خصم القسط ده؟');
      expect(body).not.toMatch(/NaN|Infinity/);
    }
    expect(gamiyaMarkConfirmBody({ ...base, monthIndex: NaN, isPayout: true }, 'CIB', TODAY)).toBe('جمعية "Work" — نسجّل استلام الجمعية؟');
  });
});
