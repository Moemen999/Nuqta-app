import BackButton from '@/components/BackButton';
import { APP_FULL_VERSION, PRIVACY_POLICY_URL } from '@/lib/appInfo';
import { Button } from '@/components/Button';
import { useNotice } from '@/components/NoticeProvider';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cardElevation, space, radius, typeScale } from '@/lib/tokens';


export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const notice = useNotice();
  // الفتح ممكن يفشل (مفيش متصفح، أو الجهاز رافض) ← رسالة فيها اللينك نفسه بدل دوسة ساكتة
  const openPrivacy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() =>
      notice('مقدرناش نفتح الصفحة', `افتح اللينك ده من المتصفح:
${PRIVACY_POLICY_URL}`));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <BackButton />
        <ScreenTitle>عن التطبيق</ScreenTitle>
      </View>

      <View style={styles.card}>
        <Text style={styles.appName}>نقطة</Text>
        <Text testID="about_version" style={styles.version}>الإصدار {APP_FULL_VERSION}</Text>
      </View>

      <Button
        testID="about_privacy"
        variant="secondary"
        icon="shield-checkmark-outline"
        label="سياسة الخصوصية"
        accessibilityHint="بتفتح في المتصفح"
        onPress={openPrivacy}
        style={styles.link}
      />
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxl, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xl },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: 18, ...cardElevation(c), alignItems: 'center' },
    appName: { color: c.text, fontSize: typeScale.figure, fontWeight: '700' },
    link: { marginTop: space.xl },
    version: { color: c.textSecondary, fontSize: typeScale.body, marginTop: space.xs },
  });
}
