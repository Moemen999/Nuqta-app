import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { LineIcon } from '@/components/LineIcon';
import { useTheme } from '@/context/ThemeContext';
import { DEFAULT_CATEGORY_ICON } from '@/lib/finance';
import { categoryIconSize, space } from '@/lib/tokens';

/** لون hex (#RRGGBB) بشفافية ~18% — خلفية الدايرة بلون الفئة (نفس لون عمودها في التقارير) */
export function tintBackground(hex: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}2E` : hex;
}

/**
 * حاوية موحّدة لأيقونة الفئة (موجة البريميم 1 — `reports/2026-11-16-premium-gap.md` L2): دايرة بلون سطح من الثيم
 * والإيموجي جواها. من غير أيقونة (أو الأيقونة الافتراضية 🏷️) ← أيقونة خطية محايدة بدل 12 فئة بنفس العلامة.
 * زينة: مخفية عن قارئ الشاشة — الاسم جنبها هو اللي بيتقري. حطها **أول** عنصر في صف `row-reverse` (يمين الاسم).
 */
export function CategoryIcon({ icon, size = categoryIconSize.bar, tint, testID }: { icon?: string; size?: number; tint?: string; testID?: string }) {
  const { colors } = useTheme();
  const custom = !!icon && icon !== DEFAULT_CATEGORY_ICON;
  return (
    <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }, tint
        ? { backgroundColor: tintBackground(tint) }
        : { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong }]}>
      {custom
        ? <Text style={{ fontSize: Math.round(size * 0.55), lineHeight: Math.round(size * 0.7), textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false }}>{icon}</Text>
        : <LineIcon name="pricetag-outline" size={Math.round(size * 0.55)} color={colors.textSecondary} />}
    </View>
  );
}

/** صف «دايرة + اسم» — الدايرة أول عنصر (يمين الاسم)، والاسم بيتقص/بيلف من نصه */
export const categoryInlineRow = { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm } as const;

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
