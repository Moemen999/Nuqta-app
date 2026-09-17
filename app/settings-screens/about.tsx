import BackButton from '@/components/BackButton';
import { APP_VERSION } from '@/lib/appInfo';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title}>عن التطبيق</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.appName}>نقطة</Text>
        <Text style={styles.version}>الإصدار {APP_VERSION}</Text>
      </View>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 18, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
    appName: { color: c.text, fontSize: 22, fontWeight: '700' },
    version: { color: c.textSecondary, fontSize: 13, marginTop: 6 },
  });
}
