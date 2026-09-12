import { DARK, LIGHT } from '@/context/ThemeContext';
import {
  MIN_TOUCH, font, overlayCenteredStyle, overlayStyle, radius,
  rowRTL, sheetStyle, sheetTitleStyle, space,
} from '@/lib/tokens';

/**
 * الاختبارات دي بتثبّت إن توحيد الورقة المنسدلة كان بلا أي تغيير في الشكل:
 * القيم المكتوبة هنا هي بالحرف اللي كان مكتوب بإيده في الستة ملفات قبل
 * التوحيد. مفيش اختبارات واجهة في المشروع، فده الضمان الوحيد إن الريفاكتور
 * ما حركش حاجة بصريًا.
 */
describe('sheetStyle — نفس القيم اللي كانت مكتوبة بالإيد', () => {
  it('الغطاء المنسدل زي ما كان', () => {
    expect(overlayStyle).toEqual({
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    });
  });

  it('الغطاء المتوسّط (التقويم) زي ما كان', () => {
    expect(overlayCenteredStyle).toEqual({
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    });
  });

  it('ورقة بـ maxHeight 90% — الديون والاشتراكات والجمعية', () => {
    expect(sheetStyle(DARK, { maxHeight: '90%' })).toEqual({
      backgroundColor: DARK.nav,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      maxHeight: '90%',
    });
  });

  it('ورقة بطول ثابت 80% — جهات الاتصال', () => {
    expect(sheetStyle(LIGHT, { height: '80%' })).toEqual({
      backgroundColor: LIGHT.nav,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      height: '80%',
    });
  });

  it('ورقة من غير أي حد للطول — مودال القفل', () => {
    const s = sheetStyle(DARK);
    expect(s).toEqual({
      backgroundColor: DARK.nav,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
    });
    // مهم: مفيش maxHeight مدسوس — المودال ده مكانش عليه حد قبل التوحيد
    expect('maxHeight' in s).toBe(false);
    expect('height' in s).toBe(false);
  });

  it('عنوان الورقة بنفس المسافة اللي كل شاشة كانت بتحددها', () => {
    expect(sheetTitleStyle(DARK, 4)).toEqual({
      color: DARK.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 4,
    });
    expect(sheetTitleStyle(DARK, 10).marginBottom).toBe(10);
    expect(sheetTitleStyle(DARK, 0).marginBottom).toBe(0);
  });
});

describe('rowRTL', () => {
  it('صف عربي من غير مسافة', () => {
    expect(rowRTL()).toEqual({ flexDirection: 'row-reverse' });
  });

  it('صف عربي بمسافة', () => {
    expect(rowRTL(space.sm)).toEqual({ flexDirection: 'row-reverse', gap: 8 });
  });

  it('مبيحطش gap: undefined لما المسافة مش مطلوبة', () => {
    expect('gap' in rowRTL()).toBe(false);
  });
});

describe('المقاسات', () => {
  it('حد اللمس الأدنى 44', () => {
    expect(MIN_TOUCH).toBe(44);
  });

  it('المقاسات صاعدة من غير تكرار', () => {
    for (const scale of [space, font, radius]) {
      const values = Object.values(scale) as number[];
      expect(values).toEqual([...values].sort((a, b) => a - b));
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('القيم الغالبة في التطبيق موجودة في المقاس', () => {
    // أكتر القيم استخدامًا دلوقتي — لازم تلاقي اسم في المقاس
    expect(Object.values(font)).toEqual(expect.arrayContaining([13, 12.5, 14, 12, 11.5, 17]));
    expect(Object.values(radius)).toEqual(expect.arrayContaining([10, 12, 8]));
    expect(Object.values(space)).toEqual(expect.arrayContaining([8, 10, 12, 14, 16, 20]));
  });
});
