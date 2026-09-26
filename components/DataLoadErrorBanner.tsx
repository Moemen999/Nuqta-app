import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { LOAD_ERROR_RETRY, LOAD_ERROR_TITLE, loadErrorBody } from '@/lib/listenerErrors';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * بانر فوق كل التابات لما listener من بتوع `DataContext` يترفض ويتقفل.
 *
 * فوق التابات كلها مش في الرئيسية بس: الـlistener اللي وقع ممكن يكون بتاع
 * الديون أو الدخل الثابت، والقايمة الفاضية بتبان في التاب بتاعها هي. والبانر
 * بيقول **إيه** اللي ما وصلش بالاسم، عشان المستخدم يعرف أنهي فاضي مش حقيقي.
 *
 * ده حالة خطأ نادرة، فالمسافة اللي فوق الشاشة بتزيد وهو ظاهر (الشاشات نفسها
 * بتحسب مسافة الـnotch) — مقبول قصاد إن البانر ميغطيش حاجة.
 */
export default function DataLoadErrorBanner() {
  const { loadErrors, retryLoad } = useData();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (loadErrors.length === 0) return null;

  return (
    <View testID="data_load_error_banner" style={[styles.wrap, { paddingTop: insets.top + 8 }]} accessibilityRole="alert">
      <Text style={styles.title}>{LOAD_ERROR_TITLE}</Text>
      <Text testID="data_load_error_body" style={styles.body}>{loadErrorBody(loadErrors)}</Text>
      <TouchableOpacity
        testID="data_load_error_retry"
        style={styles.btn}
        onPress={retryLoad}
        accessibilityRole="button"
        accessibilityLabel={LOAD_ERROR_RETRY}>
        <Text style={styles.btnText}>{LOAD_ERROR_RETRY}</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.dangerBorder,
      paddingHorizontal: 16, paddingBottom: 12,
    },
    title: { color: c.danger, fontSize: 15, fontWeight: '700', textAlign: 'right' },
    body: { color: c.text, fontSize: 13, textAlign: 'right', marginTop: 4, lineHeight: 20 },
    btn: {
      alignSelf: 'flex-end', marginTop: 8, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10,
      paddingVertical: 8, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center',
    },
    btnText: { color: c.danger, fontSize: 14, fontWeight: '700' },
  });
}
