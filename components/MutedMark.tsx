import { useTheme } from '@/context/ThemeContext';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { LineIcon, type LineIconName } from '@/components/LineIcon';
import { space, typeScale } from '@/lib/tokens';

/**
 * شكل العلامات الهادية جنب تاريخ العملية (لسه بترفع / اتسجلت لوحدها / تحويل): أيقونة خطية + كلمتين باهتين.
 * كانت إيموجي قدام الكلام (ساعة رملية، ترس، سهمين) — 9.5-5: الإيموجي بيترسم بألوان الموبايل مش ألوان التطبيق، وقارئ الشاشة كان بيقرا اسمه.
 * الأيقونة زينة (`LineIcon` مخفية عن قارئ الشاشة)، والاسم المنطوق `label`.
 */
export default function MutedMark({ icon, text, label, testID }: { icon: LineIconName; text: string; label: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={label} testID={testID}>
      <LineIcon name={icon} size={typeScale.caption} color={colors.textMuted} />
      <Text style={[styles.mark, { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xxs, marginTop: 2 },
  mark: { fontSize: typeScale.caption },
});
