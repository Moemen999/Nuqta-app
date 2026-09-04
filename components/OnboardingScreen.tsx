import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';

export const ONBOARDING_KEY = 'nuqta_onboarding_done';

const SLIDES = [
  {
    emoji: '👋',
    title: 'أهلًا بيك في نقطة',
    body: 'تطبيق مصاريفك الشخصي — عربي بالكامل، ومبني عشان يفهم طريقتك في الصرف فعلاً.',
  },
  {
    emoji: '🏠',
    title: 'الرئيسية والتقارير',
    body: 'الرئيسية بتوريك رصيدك في كل محافظك وآخر عملياتك.\nوالتقارير بتقولك فلوسك راحت فين بالظبط، في أي فترة تختارها.',
  },
  {
    emoji: '📊',
    title: 'التخطيط',
    body: 'جواه حاجتين:\n• الميزانية — تحدد سقف لصرفك كل شهر\n• شخبطة — تقسّم دخلك بالنسب اللي انت تحددها (احتياجات، رفاهيات، مستقبل)',
  },
  {
    emoji: '👥',
    title: 'الديون',
    body: 'جواه تلات حاجات:\n• الديون — مين عليه فلوس ليك ومين ليه عندك\n• الاشتراكات — بتذكّرك قبل كل خصم\n• الجمعية — بتتابع أقساطك وشهر استلامك',
  },
  {
    emoji: '➕',
    title: 'الزرار الذهبي',
    body: 'أهم زرار في التطبيق. اضغطه في أي وقت عشان تسجّل مصروف أو إيراد أو تحويل بين محافظك.',
  },
];

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [index, setIndex] = useState(0);
  const width = Dimensions.get('window').width;

  const isLast = index === SLIDES.length - 1;

  async function finish() {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // لو التخزين فشل، منمنعش المستخدم من الدخول
    }
    onDone();
  }

  const slide = SLIDES[index];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <TouchableOpacity style={styles.skipBtn} onPress={finish}>
        <Text style={styles.skipText}>تخطي</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.slideArea}>
        <Text style={styles.emoji}>{slide.emoji}</Text>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </ScrollView>

      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i === index ? colors.accent : colors.surface2, width: i === index ? 22 : 8 }]}
          />
        ))}
      </View>

      <View style={styles.actions}>
        {index > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setIndex(i => i - 1)}>
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>السابق</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.nextBtn}
          onPress={() => (isLast ? finish() : setIndex(i => i + 1))}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 15 }}>
            {isLast ? 'يلا نبدأ' : 'التالي'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 24 },
    skipBtn: { alignSelf: 'flex-start', padding: 8 },
    skipText: { color: c.textMuted, fontSize: 13 },
    slideArea: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
    emoji: { fontSize: 64, marginBottom: 24 },
    title: { color: c.text, fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
    body: { color: c.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 26 },
    dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 24 },
    dot: { height: 8, borderRadius: 4 },
    actions: { flexDirection: 'row-reverse', gap: 10 },
    backBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, alignItems: 'center', paddingVertical: 14 },
    nextBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14 },
  });
}
