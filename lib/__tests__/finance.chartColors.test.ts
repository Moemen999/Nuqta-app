import { LIGHT } from '@/context/ThemeContext';
import { assignChartColors } from '@/lib/finance';

const palette = LIGHT.chartPalette;

function items(n: number, name: (i: number) => string = i => `فئة ${i}`) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, name: name(i) }));
}

describe('assignChartColors', () => {
  it('مفيش تصادم لغاية 8 عناصر — حتى لو كلهم بنفس الاسم (أسوأ حالة هاش)', () => {
    for (let n = 1; n <= 8; n++) {
      const list = items(n, () => 'نفس الاسم بالظبط');
      const map = assignChartColors(list, palette);
      const used = new Set(list.map(it => map.get(it.id)));
      expect(used.size).toBe(n);
    }
  });

  it('الناتج ثابت بغض النظر عن ترتيب العناصر في المصفوفة', () => {
    const list = items(6, i => `فئة رقم ${i}`);
    const reversed = [...list].reverse();
    const shuffled = [list[3], list[0], list[5], list[1], list[4], list[2]];

    const original = assignChartColors(list, palette);
    const fromReversed = assignChartColors(reversed, palette);
    const fromShuffled = assignChartColors(shuffled, palette);

    list.forEach(it => {
      expect(fromReversed.get(it.id)).toBe(original.get(it.id));
      expect(fromShuffled.get(it.id)).toBe(original.get(it.id));
    });
  });

  it('نفس الألوان لو اتحسبت مرتين لنفس القائمة — زي شاشتين مختلفين بيقروا نفس المصدر', () => {
    const list = items(8);
    const screenA = assignChartColors(list, palette);
    const screenB = assignChartColors(list, palette);
    list.forEach(it => expect(screenB.get(it.id)).toBe(screenA.get(it.id)));
  });

  it('إضافة عنصر بمعرّف بعدي ترتيبيًا ماتقلبش ألوان اللي قبله', () => {
    const list = items(5);
    const before = assignChartColors(list, palette);
    const afterAdd = assignChartColors([...list, { id: 'id-new', name: 'فئة جديدة' }], palette);
    list.forEach(it => expect(afterAdd.get(it.id)).toBe(before.get(it.id)));
  });

  it('أكتر من حجم الباليتة (8): التكرار حتمي بس مفيش عنصر من غير لون', () => {
    const list = items(12);
    const map = assignChartColors(list, palette);
    list.forEach(it => expect(map.get(it.id)).toBeDefined());
  });
});
