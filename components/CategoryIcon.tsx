import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { LineIcon } from '@/components/LineIcon';
import { useTheme } from '@/context/ThemeContext';
import { DEFAULT_CATEGORY_ICON } from '@/lib/finance';
import { categoryIconGlyph, categoryIconSize, space } from '@/lib/tokens';

/** لون hex (#RRGGBB) بشفافية ~18% — خلفية الدايرة بلون الفئة (نفس لون عمودها في التقارير) */
export function tintBackground(hex: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${categoryIconGlyph.tintAlpha}` : hex;
}

/**
 * حاوية موحّدة لأيقونة الفئة (موجة البريميم 1 — `reports/2026-11-16-premium-gap.md` L2): دايرة بلون سطح من الثيم
 * والإيموجي جواها. من غير أيقونة (أو الأيقونة الافتراضية 🏷️) ← أيقونة خطية محايدة بدل 12 فئة بنفس العلامة.
 * زينة: مخفية عن قارئ الشاشة — الاسم جنبها هو اللي بيتقري. حطها **أول** عنصر في صف `row-reverse` (يمين الاسم).
 */
export function CategoryIcon({ icon, size = categoryIconSize.bar, tint, testID, onSelected }: { icon?: string; size?: number; tint?: string; testID?: string; onSelected?: boolean }) {
  const { colors } = useTheme();
  const custom = !!icon && icon !== DEFAULT_CATEGORY_ICON;
  return (
    <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }, tint
        ? { backgroundColor: tintBackground(tint) }
        : { backgroundColor: colors.surface2 },
        // جوه شريحة مختارة (خلفية selectedBg) الدايرة بتتوه — إطار selectedBorder (≥ 3:1 على selectedBg في theme.contrast)
        onSelected ? { borderWidth: 1, borderColor: colors.selectedBorder } : !tint && { borderWidth: 1, borderColor: colors.borderStrong }]}>
      {custom
        ? <Text style={{ fontSize: Math.round(size * categoryIconGlyph.fontRatio), lineHeight: Math.round(size * categoryIconGlyph.lineRatio), textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false }}>{icon}</Text>
        : <LineIcon name="pricetag-outline" size={Math.round(size * categoryIconGlyph.fontRatio)} color={colors.textSecondary} />}
    </View>
  );
}

/** صف «دايرة + اسم» — الدايرة أول عنصر (يمين الاسم)، والاسم بيتقص/بيلف من نصه */
export const categoryInlineRow = { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm } as const;

/** مكان الدايرة محجوز (من غير فئة) — العناوين على نفس الخط */
export function CategoryIconSpacer({ size = categoryIconSize.row }: { size?: number }) {
  return <View style={{ width: size, height: size }} />;
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
