import { LIGHT } from '@/context/ThemeContext';
import { assignDistinctChartColors } from '@/lib/chartColors';

const palette = LIGHT.chartPalette;
const items = (n: number, name: (i: number) => string = i => `فئة ${i}`) =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(2, '0')}`, name: name(i) }));
const usage = (list: { id: string }[], map: Map<string, string>) => {
  const counts = new Map<string, number>();
  list.forEach(it => counts.set(map.get(it.id)!, (counts.get(map.get(it.id)!) ?? 0) + 1));
  return counts;
};

describe('assignDistinctChartColors', () => {
  it('لغاية حجم الباليتة: كل العناصر ألوان مختلفة، حتى بنفس الاسم', () => {
    for (let n = 1; n <= palette.length; n++) {
      const list = items(n, () => 'أخرى');
      expect(new Set(list.map(it => assignDistinctChartColors(list, palette).get(it.id))).size).toBe(n);
    }
  });

  it('أكتر من الباليتة: التكرار موزّع بالتساوي (مفيش لون أكتر من مرتين لـ12، وكل الباليتة مستخدمة) حتى لو الأسامي واحدة', () => {
    const list = items(12, () => 'أخرى');
    const counts = usage(list, assignDistinctChartColors(list, palette));
    expect(counts.size).toBe(palette.length);
    expect(Math.max(...counts.values())).toBe(2);
  });

  it('16 عنصر: كل لون بالظبط مرتين', () => {
    const list = items(16, i => `اسم ${i % 3}`);
    const counts = usage(list, assignDistinctChartColors(list, palette));
    expect([...counts.values()].every(c => c === 2)).toBe(true);
  });

  it('حتمي ومش بيتأثر بترتيب القائمة، وأول 8 بالـid بيحتفظوا بألوانهم لما العدد يزيد', () => {
    const list = items(11);
    const a = assignDistinctChartColors(list, palette);
    const b = assignDistinctChartColors([...list].reverse(), palette);
    list.forEach(it => expect(b.get(it.id)).toBe(a.get(it.id)));
    const eight = assignDistinctChartColors(list.slice(0, 8), palette);
    list.slice(0, 8).forEach(it => expect(a.get(it.id)).toBe(eight.get(it.id)));
  });

  it('قائمة فاضية أو باليتة فاضية مبتقعش', () => {
    expect(assignDistinctChartColors([], palette).size).toBe(0);
    expect(assignDistinctChartColors(items(3), []).size).toBe(0);
  });
});
