import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { CURRENCY } from '@/lib/money';
import { typeScale } from '@/lib/tokens';

/**
 * الرقم البطل + «ج.م» صغيرة وباهتة جنبه (شكل «إجمالي رصيدك»): نسخة واحدة للرئيسية والتقارير وكارت الشهر.
 * الرقم (`children`) بيجي من برّه — `Money` أو نص عادي — والوحدة نص تاني جنبه، صف مش Text جوه Text
 * (أندرويد بيفرد المتداخل في عقدة واحدة وبيضيّع `accessibilityLabel` بتاع `Money`).
 * `label`: لو اتبعت، الصف كله عقدة واحدة بتتقري «5,583 ج.م» جملة واحدة — ماتبعتوش لو الرقم ممكن يبقى مخفي
 * (القناع زرار «اكشف» ولازم يفضل لوحده).
 */
export function HeroAmount({ children, style, label, unitTestID }: { children: ReactNode; style?: StyleProp<ViewStyle>; label?: string; unitTestID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.row, style]} {...(label ? { accessible: true, accessibilityLabel: label } : {})}>
      {children}
      <Text testID={unitTestID} style={styles.unit}>{CURRENCY}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 8 },
    unit: { fontSize: typeScale.body, color: c.textSecondary, fontWeight: '400' },
  });
}
