import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { LineIcon } from '@/components/LineIcon';
import { useTheme } from '@/context/ThemeContext';
import { DEFAULT_CATEGORY_ICON } from '@/lib/finance';

/**
 * حاوية موحّدة لأيقونة الفئة (موجة البريميم 1 — `reports/2026-11-16-premium-gap.md` L2): دايرة بلون سطح من الثيم
 * والإيموجي جواها. من غير أيقونة (أو الأيقونة الافتراضية 🏷️) ← أيقونة خطية محايدة بدل 12 فئة بنفس العلامة.
 * زينة: مخفية عن قارئ الشاشة — الاسم جنبها هو اللي بيتقري. حطها **أول** عنصر في صف `row-reverse` (يمين الاسم).
 */
export function CategoryIcon({ icon, size = 32 }: { icon?: string; size?: number }) {
  const { colors } = useTheme();
  const custom = !!icon && icon !== DEFAULT_CATEGORY_ICON;
  return (
    <View testID="category_icon" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface2 }]}>
      {custom
        ? <Text style={{ fontSize: Math.round(size * 0.55), lineHeight: Math.round(size * 0.7) }}>{icon}</Text>
        : <LineIcon name="pricetag-outline" size={Math.round(size * 0.55)} color={colors.textSecondary} />}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
