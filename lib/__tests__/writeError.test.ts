import { WRITE_ERROR_TITLE, namedLabel, writeErrorBody } from '@/lib/writeError';
import {
  categoriesPhrase, debtsPhrase, gamiyasPhrase, lettersPhrase,
  subscriptionsPhrase, transactionsPhrase, walletsPhrase,
} from '@/lib/archiving';

/**
 * الجزء الأول: الصفر في الجُمل العربية.
 * الجزء التاني: رسالة الكتابة الفاشلة لازم تقول **إيه** اللي فشل.
 */

describe('الصفر مبيتكتبش كرقم في الجملة', () => {
  it('"مفيش محافظ" مش "0 محافظ"', () => {
    expect(walletsPhrase(0)).toBe('مفيش محافظ');
    expect(walletsPhrase(0)).not.toContain('0');
  });

  it('وكل الأنواع التانية', () => {
    expect(categoriesPhrase(0)).toBe('مفيش فئات');
    expect(transactionsPhrase(0)).toBe('مفيش عمليات');
    expect(debtsPhrase(0)).toBe('مفيش ديون');
    expect(subscriptionsPhrase(0)).toBe('مفيش اشتراكات');
    expect(gamiyasPhrase(0)).toBe('مفيش جمعيات');
    expect(lettersPhrase(0)).toBe('مفيش حروف');
  });

  it('السالب بيتعامل زي الصفر مش زي رقم', () => {
    expect(walletsPhrase(-3)).toBe('مفيش محافظ');
  });

  it('وباقي الأعداد ما اتغيرتش', () => {
    expect(walletsPhrase(1)).toBe('محفظة واحدة');
    expect(walletsPhrase(2)).toBe('محفظتين');
    expect(walletsPhrase(5)).toBe('5 محافظ');
    expect(walletsPhrase(12)).toBe('12 محفظة');
    expect(categoriesPhrase(2)).toBe('فئتين');
    expect(transactionsPhrase(11)).toBe('11 عملية');
  });
});

describe('رسالة الكتابة اللي ما وصلتش', () => {
  it('من غير اسم بترجع النص العام زي ما كان', () => {
    expect(writeErrorBody()).toBe('التعديل ما وصلش للسيرفر واترجع تاني. راجع البيانات وجرب من الأول.');
  });

  it('مع اسم بتقول إيه اللي فشل بالظبط', () => {
    expect(writeErrorBody('الاشتراك "نتفليكس"'))
      .toBe('التعديل ده ما وصلش للسيرفر واترجع تاني: الاشتراك "نتفليكس". راجع البيانات وجرب من الأول.');
  });

  it('العنوان ثابت', () => {
    expect(WRITE_ERROR_TITLE).toBe('فيه تعديل ما اتحفظش');
  });
});

describe('namedLabel', () => {
  it('بيحط الاسم بين قوسين عشان يتفصل عن كلامنا', () => {
    expect(namedLabel('الدين', 'أحمد')).toBe('الدين "أحمد"');
  });

  it('بيقلّم المسافات', () => {
    expect(namedLabel('المحفظة', '  كاش  ')).toBe('المحفظة "كاش"');
  });

  it('من غير اسم بيرجّع النوع لوحده — مش قوسين فاضيين', () => {
    expect(namedLabel('الجمعية')).toBe('الجمعية');
    expect(namedLabel('الجمعية', '')).toBe('الجمعية');
    expect(namedLabel('الجمعية', '   ')).toBe('الجمعية');
  });
});
