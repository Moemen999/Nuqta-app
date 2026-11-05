import { Text } from '@/components/AppText';
import { useTheme } from '@/context/ThemeContext';
import { TRANSFERS_FAILED_NOTE, TRANSFERS_LOADING } from '@/lib/spending';
import type { StyleProp, TextStyle } from 'react-native';

/**
 * بند 11 (قرار مؤمن 2026-11-05): رقم المصروف مبيظهرش لحد ما الديون والجمعية يوصلوا — من غيرهم السلفة وقسط
 * الجمعية بيتعدّوا مصروف لحظة. ده اللي بيتعرض مكان الرقم.
 */
export function SpendLoading({ testID, style }: { testID?: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text testID={testID} style={[{ color: colors.textSecondary, fontSize: 13, textAlign: 'right' }, style]}>
      {TRANSFERS_LOADING}
    </Text>
  );
}

/** الديون أو الجمعية اترفضوا: الرقم بيظهر، والسطر ده بيقول إنه ممكن يكون فيه سلف */
export function TransfersFailedNote({ testID, style }: { testID?: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text testID={testID} style={[{ color: colors.dangerText, fontSize: 12, textAlign: 'right', marginTop: 6 }, style]}>
      {TRANSFERS_FAILED_NOTE}
    </Text>
  );
}
