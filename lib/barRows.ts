import type { PieSlice } from '@/lib/finance';

/**
 * رسم التقارير بأعمدة أفقية بدل الدائري (ترشيح "جرد رسم التقارير" 2026-10-29 — **على فرع، مستني مؤمن**).
 * نفس الشرايح بالظبط (`buildPieSlices`: نفس التجميع والترتيب والألوان) — الفرق الشكل بس.
 *
 * - `share`: طول العمود نسبةً **لأكبر فئة** (أكبر عمود مليان) — مش للإجمالي: لو أكبر فئة 30% العمود كان هيبقى
 *   قصير والفرق بين الفئات مش باين.
 * - `percent`: نصيب الفئة من **الإجمالي** للقراية. أقل من 1% ← "أقل من 1%" مش "0%" (صفر كان بيتقري "مفيش").
 */
export type BarRow = PieSlice & { share: number; percent: string };

export function barRows(slices: PieSlice[], total: number): BarRow[] {
  const max = slices.reduce((m, s) => Math.max(m, s.amount), 0);
  return slices.map(s => {
    const raw = total > 0 ? (s.amount / total) * 100 : 0;
    const percent = s.amount > 0 && raw < 1 ? 'أقل من 1%' : `${Math.round(raw)}%`;
    return { ...s, share: max > 0 ? s.amount / max : 0, percent };
  });
}
