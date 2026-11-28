import { MIN_TOUCH, heroIconGap, heroIconSize, radius, space, typeScale } from '@/lib/tokens';
import { HeroIcon } from '@/components/HeroIcon';
import type { LineIconName } from '@/components/LineIcon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { PressableScale } from '@/components/PressableScale';

export const ONBOARDING_KEY = 'nuqta_onboarding_done';

const SLIDES: { icon: LineIconName; title: string; body: string }[] = [
  {
    icon: 'hand-left-outline',
    title: 'أهلًا بيك في نقطة',
    body: 'تطبيق مصاريفك الشخصي — عربي بالكامل، ومبني عشان يفهم طريقتك في الصرف فعلاً.',
  },
  {
    icon: 'home-outline',
    title: 'الرئيسية والتقارير',
    body: 'الرئيسية بتوريك رصيدك في كل محافظك وآخر عملياتك.\nوالتقارير بتقولك فلوسك راحت فين بالظبط، في أي فترة تختارها.',
  },
  {
    icon: 'layers-outline',
    title: 'التخطيط',
    body: 'جواه تلات حاجات:\n• الميزانية — تحدد سقف لصرفك كل شهر\n• توزيع الدخل (شخبطة) — تقسّم دخلك بالنسب اللي انت تحددها (احتياجات، رفاهيات، خطط مستقبلية)\n• دخل ثابت — مرتبك أو أي فلوس بتنزلك بمعاد',
  },
  {
    icon: 'people-outline',
    title: 'الالتزامات',
    body: 'جواه تلات حاجات:\n• الديون — مين عليه فلوس ليك ومين ليه عندك\n• الاشتراكات — بتذكّرك قبل كل خصم\n• الجمعية — بتتابع أقساطك وشهر استلامك',
  },
  {
    icon: 'add',
    title: 'الزرار الدهبي',
    body: 'دوس عليه من الرئيسية أو التقارير أو التخطيط عشان تسجّل مصروف أو إيراد أو تحويل بين محافظك.',
  },
];

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index > 0) AccessibilityInfo.announceForAccessibility(SLIDES[index].title);
  }, [index]);

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
      <PressableScale accessibilityRole="button" testID="onboarding_skip_button" style={styles.skipBtn} onPress={finish}>
        <Text style={styles.skipText}>تخطي</Text>
      </PressableScale>

      <ScrollView contentContainerStyle={styles.slideArea}>
        <View style={styles.iconWrap}><HeroIcon name={slide.icon} size={heroIconSize.welcome} animateKey={index} testID="onboarding_icon" /></View>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </ScrollView>

      <View style={styles.dotsRow} accessible accessibilityLabel={`${index + 1} من ${SLIDES.length}`}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i === index ? colors.accent : colors.surface2, width: i === index ? 22 : 8 }]}
          />
        ))}
      </View>

      <View style={styles.actions}>
        {index > 0 && (
          <PressableScale accessibilityRole="button" style={styles.backBtn} onPress={() => setIndex(i => i - 1)}>
            <Text style={{ color: colors.textSecondary, fontSize: typeScale.body }}>السابق</Text>
          </PressableScale>
        )}
        <PressableScale accessibilityRole="button"
          style={styles.nextBtn}
          onPress={() => (isLast ? finish() : setIndex(i => i + 1))}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: typeScale.body }}>
            {isLast ? 'يلا نبدأ' : 'التالي'}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 24 },
    skipBtn: { alignSelf: 'flex-start', padding: 8, minHeight: MIN_TOUCH, justifyContent: 'center' },
    skipText: { color: c.textMuted, fontSize: typeScale.body },
    slideArea: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
    iconWrap: { marginBottom: heroIconGap },
    title: { color: c.text, fontSize: typeScale.figure, fontWeight: '700', textAlign: 'center', marginBottom: space.xl },
    body: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', lineHeight: 26 },
    dotsRow: { flexDirection: 'row-reverse', gap: 6, justifyContent: 'center', marginBottom: 24 },
    dot: { height: 8, borderRadius: radius.pill },
    actions: { flexDirection: 'row-reverse', gap: 10 },
    backBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.lg, alignItems: 'center', paddingVertical: space.xl },
    nextBtn: { flex: 2, backgroundColor: c.accent, borderRadius: radius.lg, alignItems: 'center', paddingVertical: space.xl },
  });
}
