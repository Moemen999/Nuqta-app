import { useTheme } from '@/context/ThemeContext';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

/** نص العلامة (قرار مؤمن 2026-11-06 على الترشيح) — مصدر واحد للرئيسية والأرشيف */
export const TRANSFER_MARK = '↔️ تحويل — مش محسوب';

/**
 * علامة جنب عملية **تحويل** (سلفة/استلاف وسدادهم، الجمعية — `transferTransactionIds`): ظاهرة في القايمة بفئتها وبتحرّك
 * الرصيد، بس **مش داخلة** في الدخل ولا المصروف ولا الميزانية. من غير العلامة سداد "عليا" القديم بفئة كان بينزل من
 * الميزانية والتقارير ساكت (silent-failure-hunter، لوب 3). نفس هدوء "⚙️ اتسجلت لوحدها".
 */
export default function TransferMark() {
  const { colors } = useTheme();
  return (
    <Text style={[styles.mark, { color: colors.textMuted }]} accessibilityLabel="تحويل، مش محسوب في الدخل ولا المصروف">
      {TRANSFER_MARK}
    </Text>
  );
}

const styles = StyleSheet.create({
  mark: { fontSize: 10.5, marginTop: 2 },
});
