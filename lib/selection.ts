import type { ThemeColors } from '@/context/ThemeContext';
import type { ViewStyle } from 'react-native';

/** نبرة الاختيار: العادي دهبي، و"موافق/رافض" بيستخدموا الأخضر والأحمر */
export type SelectionTone = 'accent' | 'success' | 'danger';

/**
 * ستايل العنصر في أي مجموعة اختيار — محفظة، فئة، نوع عملية، تاب، أي حاجة.
 *
 * كل مجموعات الاختيار في التطبيق كانت بتعمل ده بإيدها:
 *   { borderColor: مختار ? colors.accent : colors.borderStrong }
 * وده في الوضع الفاتح مكانش باين (شوف الشرح في ThemeContext). بقى كله
 * بيمر من هنا، فأي تعديل على شكل الاختيار بيتغيّر من مكان واحد.
 *
 * العنصر غير المختار بياخد الإطار العادي بس ومبنلمسش خلفيته، عشان
 * الكومبوننت يفضل يحدد خلفيته الأساسية زي ما هو عايز.
 */
export function selectionStyle(c: ThemeColors, selected: boolean, tone: SelectionTone = 'accent'): ViewStyle {
  if (!selected) return { borderColor: c.borderStrong };
  if (tone === 'success') return { borderColor: c.selectedSuccessBorder, backgroundColor: c.selectedSuccessBg };
  if (tone === 'danger') return { borderColor: c.selectedDangerBorder, backgroundColor: c.selectedDangerBg };
  return { borderColor: c.selectedBorder, backgroundColor: c.selectedBg };
}

/**
 * لون نص العنصر. المختار بياخد لون النص الأساسي — هو الأوضح فوق الخلفية
 * الملوّنة (أكتر من 8:1 في الثيمين)، ولأن الإطار والخلفية بقوا هما اللي
 * بيقولوا إنه أخضر ولا أحمر فالنص مش محتاج يكرر نفس الكلام بلون باهت.
 */
export function selectionTextColor(c: ThemeColors, selected: boolean): string {
  return selected ? c.text : c.textSecondary;
}

/**
 * بند E (مراجعة المشروع 2026-11-05): الاختيار كان باللون والإطار بس — قارئ الشاشة مكانش بيقول "مختار" ولا حتى "زرار"
 * (WCAG 1.4.1 و4.1.2). أي عنصر بياخد `selectionStyle` بياخد ده معاه. `tab` للتابات الفرعية، `button` للباقي
 */
export function selectionA11y(selected: boolean, role: 'button' | 'tab' = 'button') {
  return { accessibilityRole: role, accessibilityState: { selected } } as const;
}
