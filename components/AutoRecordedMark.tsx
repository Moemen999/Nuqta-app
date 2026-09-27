import { useTheme } from '@/context/ThemeContext';
import { StyleSheet, Text } from 'react-native';

/**
 * علامة جنب تاريخ العملية معناها إنها **اتسجلت لوحدها** (دخل ثابت أو اشتراك أو
 * قسط جمعية "تلقائي") — عشان المستخدم يفرّقها عن اللي سجّله بإيده ويراجع
 * رقمها. نفس هدوء "⏳ لسه بترفع": مش خطأ ومش مطلوب منه حاجة، والرقم يفضل
 * هو الأوضح في الصف.
 */
export default function AutoRecordedMark() {
  const { colors } = useTheme();
  return (
    <Text style={[styles.mark, { color: colors.textMuted }]} accessibilityLabel="اتسجلت لوحدها">
      ⚙️ اتسجلت لوحدها
    </Text>
  );
}

const styles = StyleSheet.create({
  mark: { fontSize: 10.5, marginTop: 2 },
});
