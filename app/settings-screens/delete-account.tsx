import BackButton from '@/components/BackButton';
import { Text, TextInput } from '@/components/AppText';
import { useNotice } from '@/components/NoticeProvider';
import { useAuth, type DeleteSignInOutcome, type ReauthOutcome } from '@/context/AuthContext';
import { useAppLock } from '@/context/AppLockContext';
import { deletePendingKey, useData, type DeleteDataResult } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { setupDoneKey } from '@/lib/firstRunSetup';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_REDIRECT_URI, GOOGLE_WEB_CLIENT_ID } from '@/lib/googleAuthConfig';
import { cancelAllReminders } from '@/lib/notifications';
import { MIN_TOUCH, stickyFooterStyle } from '@/lib/tokens';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * مسح الحساب (خط النهاية — `reports/2026-11-03-account-delete-export.md`، **على `main` من دمج `d70a52c`**):
 * 1. الشاشة بتقول بالظبط إيه اللي هيتمسح (والرأي اللي اتبعت معاهم — قرار مؤمن 2026-11-03)، وزرار "صدّر كل بياناتك الأول".
 * 2. تأكيد مكتوب + إعادة دخول (باسورد أو جوجل) — **قبل** أي مسح.
 * 3. `deleteAllMyData` (من السيرفر، لفّات لحد ما يفضى) ← تنضيف الجهاز ← `deleteSignInAccount`.
 * **ممنوع نقول "اتمسح" غير بعد ما حساب الدخول نفسه يتمسح.** وقع في النص ← رسالة بتقول اللي حصل بالظبط، والزرار بيكمّل.
 * الشاشة مقفولة طول المسح (الحقول والرجوع) وبتعلن كل مرحلة (a11y-architect).
 */
export const DELETE_CONFIRM_PHRASE = 'امسح حسابي';

/** المسافات الزيادة والتشكيل مبيكسروش الجملة (كيبورد عربي — a11y-architect) */
export const normalizePhrase = (s: string) => s.replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim();

/** الرسايل في مكان واحد (اختبار + مراجعة نصوص) */
export const DELETE_MSG = {
  reauth: {
    'wrong-password': ['الباسورد مش صح', 'مفيش حاجة اتمسحت. اكتب باسورد حسابك وجرّب تاني.'],
    mismatch: ['حساب جوجل مختلف', 'ده مش نفس حساب جوجل اللي داخل بيه التطبيق، فمفيش حاجة اتمسحت. اختار الحساب الصح وجرّب تاني.'],
    'too-many-requests': ['محاولات كتير', 'مفيش حاجة اتمسحت. استنى شوية وجرّب تاني.'],
    'no-connection': ['مفيش نت دلوقتي', 'مفيش حاجة اتمسحت. جرّب تاني أول ما النت يرجع.'],
    failed: ['ما قدرناش نتأكد إنك انت', 'مفيش حاجة اتمسحت. جرّب تاني.'],
  } as Record<Exclude<ReauthOutcome, 'done'>, [string, string]>,
  /** بيفرّق بين "مفيش حاجة اتمسحت" و"جزء اتمسح" و"مش متأكدين" (silent-failure + money) */
  dataNotDone: (r: Exclude<DeleteDataResult, { outcome: 'done' }>): [string, string] => {
    if (r.uncertain) return ['المسح ما خلصش', 'ممكن يكون جزء من بياناتك اتمسح. دوس "امسح حسابي" تاني عشان نكمّل — اللي اتمسح مبيرجعش، واللي فاضل هيتمسح.'];
    if (r.deleted > 0) return ['المسح ما خلصش', 'جزء من بياناتك اتمسح وفاضل حاجات. دوس "امسح حسابي" تاني عشان نكمّل — اللي اتمسح مبيرجعش، واللي فاضل هيتمسح.'];
    return r.outcome === 'no-connection'
      ? ['مفيش نت دلوقتي', 'مفيش حاجة اتمسحت. جرّب تاني أول ما النت يرجع.']
      : ['المسح ما بدأش', 'ما قدرناش نوصل لبياناتك عشان نمسحها، فمفيش حاجة اتمسحت. جرّب تاني.'];
  },
  account: {
    'requires-recent-login': ['بياناتك اتمسحت، بس الحساب لسه موجود', 'بياناتك اتمسحت. فاضل حساب الدخول نفسه — أكّد إنك انت تاني ودوس "امسح حسابي".'],
    'no-connection': ['بياناتك اتمسحت، بس الحساب لسه موجود', 'بياناتك اتمسحت. النت قطع قبل ما نمسح حساب الدخول — دوس "امسح حسابي" تاني أول ما يرجع.'],
    failed: ['بياناتك اتمسحت، بس الحساب لسه موجود', 'بياناتك اتمسحت. حساب الدخول ما اتمسحش — دوس "امسح حسابي" تاني.'],
  } as Record<Exclude<DeleteSignInOutcome, 'done'>, [string, string]>,
  googleError: ['ما قدرناش نفتح جوجل', 'مفيش حاجة اتمسحت. جرّب تاني.'] as [string, string],
  done: ['اتمسح حسابك', 'بياناتك وحساب الدخول اتمسحوا من عندنا.'] as [string, string],
};

/** بعد مسح البيانات وقبل حساب الدخول: التذكيرات المجدولة (التذكير اليومي كان بيفضل) وتفضيلات الإشعارات — بياناتها اتمسحت */
async function cleanReminders() {
  try { await cancelAllReminders(); } catch (e) { console.warn('[delete-account] cancel reminders failed', e instanceof Error ? e.name : 'unknown'); }
  try { await AsyncStorage.multiRemove(['nuqta_notifs_enabled', 'nuqta_notifs_daily', 'nuqta_notifs_daily_hour']); }
  catch (e) { console.warn('[delete-account] notif keys failed', e instanceof Error ? e.name : 'unknown'); }
}
/**
 * **بعد** ما حساب الدخول يتمسح بس (جولة 2 SHOULD-FIX 2): علامة المسح وعلامة التجهيز. قبلها، لو حساب الدخول ما اتمسحش
 * والتطبيق اتقفل، العلامتين لو راحوا كانت "نبدأ بإيه؟" هتظهر على حساب فاضي وتزرع محافظ عليه
 */
async function clearAccountMarks(uid: string) {
  try { await AsyncStorage.multiRemove([setupDoneKey(uid), deletePendingKey(uid)]); }
  catch (e) { console.warn('[delete-account] marks failed', e instanceof Error ? e.name : 'unknown'); }
}

export default function DeleteAccountScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // الـinset بالبارامتر التالت زي باقي الشاشات (visual-identity-reviewer) مش paddingBottom مكتوب فوق التوكن
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);
  const notice = useNotice();
  const { user, reauthenticate, deleteSignInAccount } = useAuth();
  const { wipeLockForDeletedAccount } = useAppLock();
  const { deleteAllMyData, serverReachable } = useData();
  const usesGoogle = !!user?.providerData.some(p => p.providerId === 'google.com');
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [, googleResponse, promptGoogle] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID, androidClientId: GOOGLE_ANDROID_CLIENT_ID, redirectUri: GOOGLE_REDIRECT_URI,
  });
  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type === 'success' && googleResponse.params?.id_token) {
      setGoogleToken(googleResponse.params.id_token);
      AccessibilityInfo.announceForAccessibility('اتأكدنا إنك انت');
    } else if (googleResponse.type === 'error' || googleResponse.type === 'success') {
      // نجاح من غير توكن = زي الفشل — كان بيتبلع (silent-failure-hunter). الإلغاء من المستخدم مش خطأ
      notice(...DELETE_MSG.googleError);
    }
  }, [googleResponse, notice]);

  // الرجوع ممنوع طول المسح — الخروج في النص كان بيسيب مسح نص-خلصان من غير ما المستخدم يشوف النتيجة
  useEffect(() => {
    if (!busy) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [busy]);

  const phraseOk = normalizePhrase(phrase) === DELETE_CONFIRM_PHRASE;
  const proofReady = usesGoogle ? !!googleToken : password.length > 0;
  /** سبب واحد بالأولوية — ظاهر فوق الزرار وهو نفسه الـhint (a11y-architect BLOCKER: الزرار كان مقفول من غير ما يقول ليه) */
  const reason = busy ? null
    : !serverReachable ? 'المسح محتاج نت. وصّل وجرّب تاني.'
    : !phraseOk ? `اكتب «${DELETE_CONFIRM_PHRASE}» بالظبط الأول.`
    : !proofReady ? (usesGoogle ? 'أكّد إنك انت بحساب جوجل الأول.' : 'اكتب باسورد حسابك الأول.')
    : null;
  const canDelete = !busy && reason === null;

  async function run() {
    if (!canDelete) return;
    setBusy(true);
    AccessibilityInfo.announceForAccessibility('بنتأكد إنك انت');
    try {
      const re = await reauthenticate(usesGoogle ? { kind: 'google', idToken: googleToken! } : { kind: 'password', password });
      // التوكن اتستخدم — ميتعادش (security-reviewer)
      setGoogleToken(null);
      if (re !== 'done') { notice(...DELETE_MSG.reauth[re]); return; }
      AccessibilityInfo.announceForAccessibility('بنمسح بياناتك، متقفلش التطبيق');
      const data = await deleteAllMyData();
      if (data.outcome !== 'done') { notice(...DELETE_MSG.dataNotDone(data)); return; }
      const uid = user?.uid;
      await cleanReminders();
      const acc = await deleteSignInAccount();
      if (acc !== 'done') {
        // الإثبات بيتمسح بس لما فايربيز تطلبه تاني — النت والفشل العام مالهمش دعوة بالباسورد (silent-failure-hunter)
        if (acc === 'requires-recent-login') setPassword('');
        notice(...DELETE_MSG.account[acc]);
        return;
      }
      if (uid) await clearAccountMarks(uid);
      // قفل التطبيق ومهلته (بحث + قرار مؤمن 2026-11-03): الثيم والترحيب بيفضلوا — إعدادات جهاز مش بيانات حساب
      try { await wipeLockForDeletedAccount(); } catch (e) { console.warn('[delete-account] wipe lock failed', e instanceof Error ? e.name : 'unknown'); }
      // user بقى null ← التطبيق بيرجع لشاشة الدخول لوحده؛ الرسالة في الجذر فبتفضل ظاهرة
      notice(...DELETE_MSG.done);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <BackButton onPress={busy ? () => {} : undefined} />
          <Text style={styles.title} accessibilityRole="header">مسح الحساب</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle} accessibilityRole="header">اللي هيتمسح</Text>
          <Text style={styles.body}>
            كل محافظك وعملياتك وديونك واشتراكاتك وجمعياتك ودخلك الثابت وميزانيتك وتوزيع دخلك، والرأي اللي بعتّه لنا. ومعاهم حساب الدخول نفسه.{' '}
            <Text style={styles.danger}>ده مبيترجعش.</Text>
          </Text>
        </View>

        <TouchableOpacity testID="delete_export_first" style={styles.secondaryBtn} onPress={() => router.push('/archive')} disabled={busy}
          accessibilityRole="button" accessibilityHint="بيفتح الأرشيف، وفيه تصدير كل بياناتك في ملف إكسيل">
          <Text style={styles.secondaryText}>صدّر كل بياناتك الأول (من الأرشيف)</Text>
        </TouchableOpacity>

        <Text style={styles.label} importantForAccessibility="no">اكتب «{DELETE_CONFIRM_PHRASE}» عشان تأكد</Text>
        <TextInput testID="delete_phrase" style={styles.input} value={phrase} onChangeText={setPhrase} editable={!busy}
          textAlign="right" autoCorrect={false} autoCapitalize="none"
          accessibilityLabel={`اكتب ${DELETE_CONFIRM_PHRASE} عشان تأكد`}
          accessibilityHint="لازم تكتبها زي ما هي، وبعدها زرار المسح بيتفتح" />

        {usesGoogle ? (
          <TouchableOpacity testID="delete_google" style={styles.secondaryBtn} onPress={() => promptGoogle()} disabled={busy} accessibilityRole="button"
            accessibilityLabel={googleToken ? 'اتأكدنا إنك انت' : 'أكّد إنك انت بحساب جوجل'}
            accessibilityHint={googleToken ? undefined : 'بيفتح تسجيل جوجل'}>
            <Text style={styles.secondaryText}>{googleToken ? 'اتأكدنا إنك انت ✓' : 'أكّد إنك انت بحساب جوجل'}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.label} importantForAccessibility="no">باسورد حسابك</Text>
            <TextInput testID="delete_password" style={styles.input} value={password} onChangeText={setPassword} editable={!busy}
              secureTextEntry textAlign="right" autoCapitalize="none" autoComplete="current-password" textContentType="password"
              accessibilityLabel="باسورد حسابك" accessibilityHint="باسورد الحساب اللي دخلت بيه" />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {/* دايمًا متركّب عشان قارئ الشاشة ينطق التغيير (liveRegion على عنصر بيتركّب متأخر مبيتنطقش بثبات) */}
        <View accessibilityLiveRegion="polite" style={styles.reasonWrap}>
          {!!reason && <Text testID="delete_reason" style={styles.hint}>{reason}</Text>}
        </View>
        <TouchableOpacity testID="delete_confirm" style={[styles.dangerBtn, { opacity: canDelete || busy ? 1 : 0.5 }]} onPress={run}
          disabled={!canDelete} accessibilityRole="button" accessibilityLabel={busy ? 'بنمسح حسابك' : 'امسح حسابي'}
          accessibilityHint={reason ?? undefined} accessibilityState={{ disabled: !canDelete, busy }}>
          {busy ? <ActivityIndicator color={colors.dangerText} accessibilityLabel="بنمسح" /> : <Text style={styles.dangerText}>امسح حسابي</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 24 },
    // نفس رأس feedback.tsx وlock.tsx (visual-identity-reviewer)
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    card: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.dangerBorder, padding: 14, gap: 8 },
    cardTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },
    body: { color: c.textSecondary, fontSize: 13.5, lineHeight: 21, textAlign: 'right' },
    danger: { color: c.dangerText, fontWeight: '700' },
    label: { color: c.text, fontSize: 13.5, textAlign: 'right', marginTop: 18, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderRadius: 10, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 12, minHeight: MIN_TOUCH, fontSize: 15 },
    reasonWrap: { width: '100%' },
    hint: { color: c.textSecondary, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
    secondaryBtn: { borderWidth: 1.5, borderColor: c.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH, marginTop: 14, paddingHorizontal: 16 },
    secondaryText: { color: c.accentText, fontWeight: '700', fontSize: 13.5 },
    footer: { ...stickyFooterStyle(c, c.bg, bottomInset), flexDirection: 'column' },
    // نفس شكل زرار الخطر في التأكيد (ConfirmProvider): إطار danger ونص dangerText — danger كنص تحت 4.5
    dangerBtn: { alignSelf: 'stretch', borderWidth: 1.5, borderColor: c.danger, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH + 4 },
    dangerText: { color: c.dangerText, fontWeight: '700', fontSize: 15 },
  });
