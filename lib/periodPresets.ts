/**
 * شرايح الفترة في التقارير والأرشيف — الأسامي من مكان واحد عشان الشاشتين
 * والدليل (`app/user-guide.tsx`) يقولوا نفس الكلمة.
 *
 * **عامية مصري** (قاعدة 1): كانت "هذا الشهر" و"الشهر الماضي" و"مخصص" —
 * فصحى في شاشتين من أكتر الشاشات استعمالاً.
 *
 * **والمسافة مبتتكسرش (U+00A0):** "هذا الشهر" كانت بتترسم "هذا" بس على
 * الجهاز (بناء 1.0.0.002). نفس شكل باج اسم الفئة (2026-09-21،
 * `categoryLabelWrap.test.ts`): لو عرض النص اتقاس أقل بكام بكسل من اللي
 * بيترسم، السطر بيتكسر عند المسافة والشريحة طولها على سطر واحد فالتاني
 * بيتقص. **السبب نفسه ماتشافش على الجهاز** — ولا هنا ولا في الفئة. وخط
 * Tajawal مش متطبّق أصلاً (`applyGlobalFont`، TIMELINE)، فمش هو. الإصلاح مش
 * معتمد على السبب: من غير مكان كسر، أقصى أثر لفرق المقاس قصّة صغيرة في الآخر
 * مش كلمة كاملة بتختفي. والشاشة بتحط `numberOfLines={1}` كمان.
 */

export type PeriodPresetKey = 'thisMonth' | 'last7' | 'lastMonth' | 'all' | 'custom';

/** الكلام زي ما بيتقال — المسافات العادية هنا للدليل والقراية */
export const PERIOD_PRESET_WORDS: Record<PeriodPresetKey, string> = {
  thisMonth: 'الشهر ده',
  last7: 'آخر 7 أيام',
  lastMonth: 'الشهر اللي فات',
  all: 'الكل',
  custom: 'تواريخ تانية',
};

/** للشريحة نفسها: نفس الكلام بمسافات مبتتكسرش */
export function chipText(words: string): string {
  return words.replace(/ /g, ' ');
}

export function periodPresets(keys: PeriodPresetKey[]): { key: PeriodPresetKey; label: string }[] {
  return keys.map(key => ({ key, label: chipText(PERIOD_PRESET_WORDS[key]) }));
}

/** نص خانة المقارنة في التقارير */
export const PREVIOUS_PERIOD_LABEL = 'مقارنة بالفترة اللي قبلها';
