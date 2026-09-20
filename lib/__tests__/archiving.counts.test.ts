import { categoriesPhrase, walletsPhrase } from '@/lib/archiving';

/** أعداد صفوف الإعدادات — نفس قاعدة باقي الصيغ في التطبيق */
describe('صيغة عدد المحافظ والفئات', () => {
  it('المحافظ', () => {
    expect(walletsPhrase(1)).toBe('محفظة واحدة');
    expect(walletsPhrase(2)).toBe('محفظتين');
    expect(walletsPhrase(3)).toBe('3 محافظ');
    expect(walletsPhrase(10)).toBe('10 محافظ');
    expect(walletsPhrase(11)).toBe('11 محفظة');
  });

  it('الفئات', () => {
    expect(categoriesPhrase(1)).toBe('فئة واحدة');
    expect(categoriesPhrase(2)).toBe('فئتين');
    expect(categoriesPhrase(5)).toBe('5 فئات');
    expect(categoriesPhrase(14)).toBe('14 فئة');
  });

  /**
   * الاختبار ده كان بيثبّت "0 محافظ" على إنها حالة نظرية ماتكسرش. طلعت مش
   * نظرية: الصف في الإعدادات بيعرض العدد، وأول ما تفتح التطبيق من غير نت
   * (فايربيز في الموبايل بكاش الذاكرة بس) القوايم بتبقى فاضية فعلاً —
   * فالمستخدم بيقرا "0 محافظ" بالظبط في اللحظة اللي بيخاف فيها على فلوسه.
   */
  it('صفر بيتقال بالعربي مش كرقم', () => {
    expect(walletsPhrase(0)).toBe('مفيش محافظ');
    expect(categoriesPhrase(0)).toBe('مفيش فئات');
  });
});
