import { useTheme } from '@/context/ThemeContext';
import { StyleSheet, Text } from 'react-native';

/**
 * علامة صغيرة جنب تاريخ العملية معناها إنها اتحفظت على الموبايل ولسه بترفع.
 * مقصود إنها باهتة ومش لافتة: مش خطأ (مش أحمر) ومش مطلوب من المستخدم يعمل حاجة
 * (مش دهبي)، والأرقام لازم تفضل هي الأوضح في الصف — دي بيانات فلوس، القراية أهم
 * من التمييز البصري.
 * "لسه بترفع" مش "لسه ما اترفعتش": الأولى بتقول إنها شغالة، التانية بتوحي بفشل.
 */
export default function PendingSyncMark() {
  const { colors } = useTheme();
  return <Text style={[styles.mark, { color: colors.textMuted }]}>⏳ لسه بترفع</Text>;
}

const styles = StyleSheet.create({
  mark: { fontSize: 10.5, marginTop: 2 },
});
