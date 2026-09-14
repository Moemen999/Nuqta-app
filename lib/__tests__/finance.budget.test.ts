import { parseBudgetInput } from '@/lib/finance';

/**
 * سقف الميزانية كان بياخد أي رقم: `isNaN(num) ? 0 : num` من غير أي فحص للإشارة،
 * يعني سقف بالسالب بيتحفظ زي ما هو ويدخل في حسابات المتبقي وبانرات الرئيسية.
 *
 * القرار: نرفض مش نحوّل لصفر. تحويل -500 لصفر في السكوت كدبة صغيرة — التطبيق
 * بيقول "تمام" وبعدين يعرض حاجة تانية.
 */

describe('parseBudgetInput — سقف الميزانية', () => {
  it('الرقم الموجب بيعدّي زي ما هو', () => {
    expect(parseBudgetInput('1500')).toBe(1500);
  });

  it('الكسور بتعدّي', () => {
    expect(parseBudgetInput('99.5')).toBe(99.5);
  });

  it('صفر بيعدّي', () => {
    expect(parseBudgetInput('0')).toBe(0);
  });

  it('الفاضي بيرجّع صفر — ده الطريقة الطبيعية لمسح السقف', () => {
    expect(parseBudgetInput('')).toBe(0);
  });

  it('السالب مترفوض مش متحوّل لصفر', () => {
    expect(parseBudgetInput('-500')).toBeNull();
  });

  it('السالب الصغير كمان مترفوض', () => {
    expect(parseBudgetInput('-0.01')).toBeNull();
  });

  it('الكلام اللي مش رقم مترفوض', () => {
    expect(parseBudgetInput('مية جنيه')).toBeNull();
    expect(parseBudgetInput('abc')).toBeNull();
  });

  it('اللانهاية مترفوضة', () => {
    expect(parseBudgetInput('Infinity')).toBeNull();
    expect(parseBudgetInput('-Infinity')).toBeNull();
  });
});
