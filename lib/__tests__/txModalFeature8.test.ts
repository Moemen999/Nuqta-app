import { parseTxAmountInput, TX_AMOUNT_ERROR, storableAmount } from '@/lib/linkedEdit';
import {
  OUTBOX_ADD_UNPROTECTED_BODY, OUTBOX_ADD_UNPROTECTED_TITLE, OUTBOX_EDIT_UNPROTECTED_BODY, OUTBOX_EDIT_UNPROTECTED_TITLE,
  OUTBOX_KEPT_BODY, OUTBOX_KEPT_TITLE, mergePatch, outboxLogoutTitle, outboxSweptBody, OUTBOX_SWEPT_TITLE, rejectedReplayBody,
  repeatedFailReplayBody, walletGoneReplayBody,
} from '@/lib/outbox';
import { outboxLinePhrase } from '@/lib/homeFigures';

/**
 * مراجعة التطبيق كله — الميزة 8 (مودال العملية + الطابور). الجزء الصافي: قارئ المبلغ الواحد والنصوص.
 */

describe('parseTxAmountInput — قارئ واحد للمودال (المتخزّن = المعروض = المقرّب)', () => {
  it.each([
    ['100', 100], ['٢٠٠', 200], ['1,500', 1500], ['١٬٥٠٠٫٥', 1500.5], ['  250.5 ', 250.5], ['1.005', storableAmount(1.005)],
  ])('"%s" ← %s', (raw, value) => {
    expect(parseTxAmountInput(raw)).toEqual({ ok: true, value });
  });

  it.each(['1,5', '12,5', '1,50', '١٬٥'])('"%s" ← الفاصلة غامضة (مرفوض، مش 15)', raw => {
    expect(parseTxAmountInput(raw)).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it.each(['', '  ', '0', '0.004', '-5', 'abc', '1e307', 'Infinity'])('"%s" ← مش مبلغ', raw => {
    expect(parseTxAmountInput(raw)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('رسايل منفصلة: المبلغ لوحده والكسر لوحده', () => {
    expect(TX_AMOUNT_ERROR.invalid).toBe('اكتب مبلغ أكبر من صفر');
    expect(TX_AMOUNT_ERROR.ambiguous).toContain('الكسر بنقطة (1.5)');
    expect(TX_AMOUNT_ERROR.wallet).toBe('اختار المحفظة');
  });
});

describe('نصوص الطابور (arabic-copy-reviewer)', () => {
  it('اسم العملية في الرسالة: «عملية بـ150 ج.م يوم 12 نوفمبر»', () => {
    expect(walletGoneReplayBody(150, '2026-11-12', '2026-11-16')).toMatch(/^عملية بـ150 ج\.م يوم 12 نوفمبر /);
    expect(repeatedFailReplayBody(1500, '2026-11-12', '2026-11-16')).toMatch(/^عملية بـ1,500 ج\.م يوم 12 نوفمبر /);
    expect(walletGoneReplayBody(undefined, '2026-11-12', '2026-11-16')).toMatch(/^عملية يوم 12 نوفمبر /);
  });

  it('الرفض بيقول إن مفيش منها حاجة اتسجلت', () => {
    expect(rejectedReplayBody(150, '2026-11-12', '2026-11-16'))
      .toBe('عملية بـ150 ج.م يوم 12 نوفمبر كانت مستنية النت واترفضت لما حاولنا نرفعها، ومفيش منها حاجة اتسجلت. سجّلها تاني من "+".');
  });

  it('التعديل مش محمي', () => {
    expect(OUTBOX_EDIT_UNPROTECTED_TITLE).toBe('التعديل مش محمي لسه');
    expect(OUTBOX_EDIT_UNPROTECTED_BODY).toBe('التعديل اتحفظ، بس لو قفلت التطبيق قبل ما النت يرجع ممكن ما يترفعش. سيب التطبيق مفتوح لحد ما النت يرجع.');
  });

  it('عملية جديدة مش محمية (النسخة على الموبايل ما اتحفظتش)', () => {
    expect(OUTBOX_ADD_UNPROTECTED_TITLE).toBe('العملية مش محمية لسه');
    expect(OUTBOX_ADD_UNPROTECTED_BODY).toBe('اتسجلت، بس لو قفلت التطبيق قبل ما النت يرجع ممكن تضيع. سيب التطبيق مفتوح لحد ما النت يرجع.');
  });

  it('الكتابة اترفضت برفض مش نهائي والنسخة لسه على الموبايل ← مفيش «اترجع… جرب من الأول»', () => {
    expect(OUTBOX_KEPT_TITLE).toBe('العملية ما اترفعتش لسه');
    expect(OUTBOX_KEPT_BODY).not.toMatch(/اترجع|من الأول/);
    expect(OUTBOX_KEPT_BODY).toContain('هنحاول نرفعها تاني');
  });

  it('عنوان الخروج للمثنى', () => {
    expect(outboxLogoutTitle(2)).toBe('لسه فيه عمليتين ما اترفعوش');
    expect(outboxLogoutTitle(1)).toBe('لسه فيه عملية واحدة ما اترفعتش');
  });

  it('عمليات حساب تاني اتكنست ← رسالة لصاحبها بالعدد (من غير مبالغ)', () => {
    expect(OUTBOX_SWEPT_TITLE).toBe('فيه عمليات ما اترفعتش ضاعت');
    expect(outboxSweptBody(1)).toBe('كان فيه عملية واحدة متسجلة على الموبايل ده وما اترفعتش، واتمسحت لما حساب تاني دخل عليه. سجّلها تاني من "+".');
    expect(outboxSweptBody(2)).toBe('كان فيه عمليتين متسجلين على الموبايل ده وما اترفعوش، واتمسحوا لما حساب تاني دخل عليه. سجّلهم تاني من "+".');
    expect(outboxSweptBody(4)).toContain('كان فيه 4 عمليات متسجلة');
  });

  it('mergePatch بيشيل الحقول اللي النوع الجديد مبيستخدمهاش', () => {
    expect(mergePatch({ type: 'withdraw', amount: 5, toWalletId: 'w2', categoryId: 'c' }, { type: 'expense' }, ['toWalletId']))
      .toEqual({ type: 'expense', amount: 5, categoryId: 'c' });
  });
});

describe('سطر الطابور في الرئيسية', () => {
  it.each([
    [1, 'عندك عملية واحدة متسجلة على الموبايل ولسه ما اترفعتش'],
    [2, 'عندك عمليتين متسجلين على الموبايل ولسه ما اترفعوش'],
    [3, 'عندك 3 عمليات متسجلة على الموبايل ولسه ما اترفعتش'],
    [11, 'عندك 11 عملية متسجلة على الموبايل ولسه ما اترفعتش'],
  ])('%d ← %s', (n, text) => expect(outboxLinePhrase(n)).toBe(text));

  it('والنت شغال: «هنجرب نرفعها تاني لما تفتح التطبيق»', () => {
    expect(outboxLinePhrase(1, { online: true })).toBe('عندك عملية واحدة متسجلة على الموبايل ولسه ما اترفعتش — هنجرب نرفعها تاني لما تفتح التطبيق');
    expect(outboxLinePhrase(2, { online: true })).toBe('عندك عمليتين متسجلين على الموبايل ولسه ما اترفعوش — هنجرب نرفعهم تاني لما تفتح التطبيق');
  });
});
