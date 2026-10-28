import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';

/**
 * الـ✕ الواحد في التطبيق — نفس شكل اللي كان على رسايل "سجلنا/ما سجلناش" للدخل الثابت
 * والاشتراكات (\`IncomeHomeCards\`/\`ChargeHomeCards\`، اتنقل من هناك): 28×28 + hitSlop 8
 * = 44 نقطة للمس. ودلوقتي على كل بانرات الرئيسية كمان (2026-10-28).
 */
export default function DismissButton({ onPress, testID, label = 'اقفل التنبيه', hint }: {
  onPress: () => void;
  testID?: string;
  label?: string;
  hint?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity onPress={onPress} style={styles.btn} testID={testID}
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} hitSlop={8}>
      <Text style={styles.x}>✕</Text>
    </TouchableOpacity>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    btn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
    x: { color: c.textMuted, fontSize: 14 },
  });
}
