import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const EMPTY_OFFLINE_NOTE =
  'وإحنا مش شايفين نت دلوقتي، فيمكن تكون لسه ما وصلتش — مش ضايعة.';

/**
 * الحالة الفاضية في شاشات المحافظ والفئات.
 *
 * كانت `.map()` على قايمة فاضية وخلاص: مفيش ولا سطر. والمشكلة مش إنها
 * وحشة — المشكلة إن **الفاضي من غير نت شكله زي الفاضي الحقيقي بالظبط**.
 * فايربيز في الموبايل شغالة بكاش الذاكرة بس، فأول فتحة من غير نت بتدّي
 * قايمة فاضية فعلاً. المستخدم يفتح الإعدادات يلاقي مفيش محافظ خالص، وهو
 * عامل خمسة. دي نفس الحكاية اللي بانر الرئيسية اتكتب عشانها.
 *
 * فالسطر هنا بيفرّق بين الحالتين: لو مفيش نت بيقول كده صريح.
 */
export default function ListEmptyState({ testID, message }: { testID: string; message: string }) {
  const { colors } = useTheme();
  const { serverReachable } = useData();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View testID={testID} style={styles.box}>
      <Text style={styles.text}>
        {message}
        {!serverReachable ? ` ${EMPTY_OFFLINE_NOTE}` : ''}
      </Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    box: {
      backgroundColor: c.surface2, borderRadius: 12, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 14, paddingVertical: 16, marginTop: 4,
    },
    text: { color: c.textSecondary, fontSize: 12.5, textAlign: 'right', lineHeight: 19 },
  });
}
