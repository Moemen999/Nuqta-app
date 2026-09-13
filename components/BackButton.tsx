import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH } from '@/lib/tokens';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/**
 * زرار الرجوع في أعلى الشاشات الداخلية.
 *
 * حاجتين كانوا غلط في النسخ المكتوبة بالإيد:
 *
 * 1. السهم كان `‹` — بيشاور على الشمال. في واجهة عربية الرجوع بيشاور على
 *    اليمين. والسهم متحطّ في `<Text>` لوحده جوه صف row-reverse بدل ما
 *    يبقى جوه نفس النص، عشان مكانه يتحدد بالتخطيط مش بخوارزمية اتجاه
 *    النص — دي بتحط المحايدات حسب سياقها والنتيجة بتختلف.
 *
 * 2. كان `<Text>` عريان جوه TouchableOpacity من غير أي ارتفاع، يعني هدف
 *    لمس ~18 نقطة. بقى MIN_TOUCH.
 */
export default function BackButton({ onPress }: { onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <TouchableOpacity
      onPress={onPress ?? (() => router.back())}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="رجوع">
      <View style={styles.row}>
        <Text style={styles.text}>›</Text>
        <Text style={styles.text}>رجوع</Text>
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, minHeight: MIN_TOUCH, paddingHorizontal: 4 },
    text: { color: c.accent, fontSize: 14 },
  });
}
