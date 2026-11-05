import { Text } from '@/components/AppText';
import { useTheme } from '@/context/ThemeContext';
import { TRANSFERS_FAILED_NOTE, TRANSFERS_LOADING, TRANSFERS_SLOW, TRANSFERS_SLOW_MS } from '@/lib/spending';
import { useEffect, useState } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

/**
 * بند 11 (قرار مؤمن 2026-11-05): رقم المصروف مبيظهرش لحد ما الديون والجمعية يوصلوا — من غيرهم السلفة وقسط
 * الجمعية بيتعدّوا مصروف لحظة. ده اللي بيتعرض مكان الرقم.
 */
export function SpendLoading({ testID, style }: { testID?: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  // لو الديون مبتوصلش (أوفلاين من أول فتحة) — الرسالة بتتغيّر بدل ما "بنحمّل…" تفضل للأبد (silent-failure-hunter جولة 1)
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), TRANSFERS_SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <Text testID={testID} style={[{ color: colors.textSecondary, fontSize: 13, textAlign: 'right' }, style]}>
      {slow ? TRANSFERS_SLOW : TRANSFERS_LOADING}
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
