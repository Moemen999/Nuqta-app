import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { LOAD_ERROR_RETRY } from '@/lib/listenerErrors';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { radius, typeScale } from '@/lib/tokens';

type Kind = 'wallets' | 'categories';

const COPY: Record<Kind, { empty: string; offline: string; failed: string }> = {
  wallets: {
    empty: 'لسه مفيش محافظ شغالة. اعمل واحدة من تحت.',
    offline: 'مفيش نت دلوقتي، فمحافظك ممكن تكون لسه ما وصلتش — مش ضايعة. استنى لحد ما النت يرجع قبل ما تعمل واحدة جديدة.',
    failed: `محافظك ما وصلتش من السيرفر، فالقايمة دي ممكن تبان فاضية وهي مش فاضية — مش ضايعة. دوس "${LOAD_ERROR_RETRY}" فوق.`,
  },
  categories: {
    empty: 'لسه مفيش فئات شغالة. اعمل واحدة من تحت.',
    offline: 'مفيش نت دلوقتي، ففئاتك ممكن تكون لسه ما وصلتش — مش ضايعة. استنى لحد ما النت يرجع قبل ما تعمل واحدة جديدة.',
    failed: `فئاتك ما وصلتش من السيرفر، فالقايمة دي ممكن تبان فاضية وهي مش فاضية — مش ضايعة. دوس "${LOAD_ERROR_RETRY}" فوق.`,
  },
};

/** الجملة من غير نت — بتتعرض **بدل** "اعمل واحدة" مش بعدها (الميزة 10): "اعمل واحدة… ومفيش نت" كانت بتقول الاتنين */
export const emptyOfflineText = (kind: Kind) => COPY[kind].offline;

/**
 * الحالة الفاضية في شاشات المحافظ والفئات.
 *
 * كانت `.map()` على قايمة فاضية وخلاص: مفيش ولا سطر. والمشكلة مش إنها
 * وحشة — المشكلة إن **الفاضي من غير نت شكله زي الفاضي الحقيقي بالظبط**.
 * فايربيز في الموبايل شغالة بكاش الذاكرة بس، فأول فتحة من غير نت بتدّي
 * قايمة فاضية فعلاً. المستخدم يفتح الإعدادات يلاقي مفيش محافظ خالص، وهو
 * عامل خمسة. دي نفس الحكاية اللي بانر الرئيسية اتكتب عشانها.
 *
 * تلات حالات غير "فاضية فعلاً" (الميزة 10، الجولة الأخيرة):
 * - الـlistener اترفض ← مبنقولش "اعمل واحدة" (هيعمل نسخة من حاجة موجودة)، بنقول دوس "جرّب تاني" اللي في البانر فوق.
 * - مفيش نت ← جملة النت لوحدها، بتقول استنى قبل ما تعمل جديدة.
 * - لسه ما وصلتش والنت شغال ← ولا حاجة (ثواني بعد الفتح) — "مفيش" كانت بتلمع قبل ما القايمة توصل.
 */
export default function ListEmptyState({ testID, kind }: { testID: string; kind: Kind }) {
  const { colors } = useTheme();
  const { serverReachable, loadErrors, figuresPending, undelivered } = useData();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const failed = loadErrors.includes(kind);
  // المحافظ: `figuresPending` (لسه ما جاش snapshot)؛ الفئات: `undelivered`
  const arriving = kind === 'wallets' ? figuresPending.includes('wallets') : undelivered.includes('categories');
  const copy = COPY[kind];
  const text = failed ? copy.failed : !serverReachable ? copy.offline : arriving ? null : copy.empty;
  if (text === null) return null;

  return (
    <View testID={testID} style={styles.box}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    box: {
      backgroundColor: c.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 14, paddingVertical: 16, marginTop: 4,
    },
    text: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', lineHeight: 19 },
  });
}
