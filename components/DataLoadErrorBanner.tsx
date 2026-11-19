import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { LOAD_ERROR_RETRY, LOAD_ERROR_TITLE, listenerNamesPhrase, loadErrorBody } from '@/lib/listenerErrors';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAnnounceOnAppear } from '@/lib/useAnnounceOnAppear';
import DismissButton from '@/components/DismissButton';
import { DISMISSED_ANNOUNCEMENT, DISMISS_HINT, dismissLabel } from '@/lib/bannerDismiss';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, typeScale } from '@/lib/tokens';

/**
 * «جرّب تاني» (الميزة 7): الدوسة بتفتح الـlisteners من الأول، ولو فشلوا تاني مفيش حاجة بتتغيّر — فالزرار بيلف لحد ما
 * اللي وقع يتغيّر أو المهلة تخلص، وبيتقال النتيجة. فايربيز مبتقولش «فشل تاني» لـlistener اترفض (`loadErrors` بيفضل زي ما هو)،
 * فالمهلة هي الإجابة.
 */
export const RETRY_WAIT_MS = 8000;
export const RETRY_BUSY_TEXT = 'بنجرّب…';
export const RETRY_DONE_ANNOUNCEMENT = 'بياناتك وصلت';
export const RETRY_STILL_FAILED = 'لسه ما وصلتش — جرّب كمان شوية';

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
  const { hidden, dismiss, clear } = useBannerDismiss();
  // المفتاح بأسامي اللي وقعوا (silent-failure-hunter): listener تاني وقع بعد الـ✕ ← بانر
  // جديد (وزرار "جرّب تاني" معاه). ولما كله يرجع، القفل بيتشال
  const instance = [...loadErrors].sort().join(',');
  useEffect(() => { if (loadErrors.length === 0) clear('loadError'); }, [loadErrors.length, clear]);

  const [busy, setBusy] = useState(false);
  const pressedWith = useRef('');
  useEffect(() => {
    if (!busy) return;
    // اللي وقع اتغيّر ← في نتيجة: كله وصل، أو جزء (البانر بيقول الباقي بالاسم)
    if (instance !== pressedWith.current) {
      setBusy(false);
      AccessibilityInfo.announceForAccessibility(instance ? `جزء من بياناتك وصل، ولسه بيانات ${listenerNamesPhrase(loadErrors)} ما وصلتش` : RETRY_DONE_ANNOUNCEMENT);
      return;
    }
    const t = setTimeout(() => { setBusy(false); AccessibilityInfo.announceForAccessibility(RETRY_STILL_FAILED); }, RETRY_WAIT_MS);
    return () => clearTimeout(t);
  }, [busy, instance, loadErrors]);
  const retry = () => {
    pressedWith.current = instance;
    setBusy(true);
    retryLoad();
  };

  const visible = loadErrors.length > 0 && !hidden('loadError', instance);
  // ظهر متأخر ← نفس نمط بانرات الرئيسية (iOS إعلان، أندرويد liveRegion)
  useAnnounceOnAppear(visible ? `${LOAD_ERROR_TITLE}. ${loadErrorBody(loadErrors)}` : null);

  // الـ✕ (قرار مؤمن 2026-10-28): بيتقفل ويرجع بعد المدة — والحالة نفسها (البيانات ما وصلتش)
  // فاضلة، فلو لسه موجودة بعد المدة البانر بيرجع
  if (!visible) return null;

  return (
    <View testID="data_load_error_banner" style={[styles.wrap, { paddingTop: insets.top + 8 }]} accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      <View style={styles.titleRow}>
        <Text style={[styles.title, styles.titleFlex]}>{LOAD_ERROR_TITLE}</Text>
        <DismissButton testID="data_load_error_dismiss" onPress={() => dismiss('loadError', instance)} hint={DISMISS_HINT}
          label={dismissLabel('loadError')} announce={DISMISSED_ANNOUNCEMENT} />
      </View>
      <Text testID="data_load_error_body" style={styles.body}>{loadErrorBody(loadErrors)}</Text>
      <TouchableOpacity
        testID="data_load_error_retry"
        style={styles.btn}
        onPress={retry}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={busy ? RETRY_BUSY_TEXT : LOAD_ERROR_RETRY}
        accessibilityState={{ busy, disabled: busy }}>
        <View style={styles.btnRow}>
          {busy && <ActivityIndicator size="small" color={colors.dangerText} />}
          <Text style={styles.btnText}>{busy ? RETRY_BUSY_TEXT : LOAD_ERROR_RETRY}</Text>
        </View>
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
    title: { color: c.dangerText, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
    titleRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8 },
    titleFlex: { flex: 1 },
    body: { color: c.text, fontSize: typeScale.body, textAlign: 'right', marginTop: space.xxs, lineHeight: 20 },
    btn: {
      alignSelf: 'flex-end', marginTop: space.sm, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: radius.md,
      paddingVertical: 8, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center',
    },
    btnText: { color: c.dangerText, fontSize: typeScale.body, fontWeight: '700' },
    btnRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  });
}
