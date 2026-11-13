import { assignChartColors } from '@/lib/finance';

/**
 * ألوان الرسوم لكل فئات/محافظ المستخدم مرة واحدة (`hooks/use-chart-colors.ts`).
 *
 * `assignChartColors` بتضمن إن مفيش لونين زي بعض لغاية حجم الباليتة (8). بعد كده كانت العناصر الزيادة بتاخد خانة
 * الهاش بتاعتها مباشرة — فلو عند المستخدم أكتر من 8 فئات، التكرار كان بيتجمّع على خانات بالصدفة (كل الأسامي المتشابهة
 * في خانة واحدة)، وفئتين بيبانوا في نفس الرسم بنفس اللون حتى لو اللي ظاهر منهم أقل من 8.
 *
 * هنا: أول `palette.length` عنصر (بترتيب الـid) بياخدوا نفس ألوانهم القديمة بالظبط، والزيادة بتاخد **أقل خانة
 * استخدامًا** (الأقرب لخانة الهاش لو اتساووا) — التكرار بيتوزّع بالتساوي بدل ما يتكوّم، وحتمي (نفس القائمة ← نفس
 * النتيجة بغض النظر عن ترتيبها). اللون لسه تبع العنصر مش تبع الشاشة.
 */
export function assignDistinctChartColors<T extends { id: string; name: string }>(
  items: T[],
  palette: string[],
): Map<string, string> {
  const size = palette.length;
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const result = assignChartColors(sorted.slice(0, size), palette);
  if (size === 0 || sorted.length <= size) return result;

  const uses = new Array<number>(size).fill(0);
  const slotOf = new Map<string, number>();
  for (const it of sorted.slice(0, size)) {
    const slot = palette.indexOf(result.get(it.id) as string);
    uses[slot]++;
    slotOf.set(it.id, slot);
  }
  for (const it of sorted.slice(size)) {
    const preferred = hash(it.name, size);
    let best = preferred;
    for (let step = 1; step < size; step++) {
      const slot = (preferred + step) % size;
      if (uses[slot] < uses[best]) best = slot;
    }
    uses[best]++;
    result.set(it.id, palette[best]);
  }
  return result;
}

// نفس هاش `assignChartColors` (مش مصدّر من finance) — لو اتغيّر هناك الفرق بيطلع في الاختبار بس على الأولويّة مش الضمان
function hash(str: string, length: number) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % length;
}
