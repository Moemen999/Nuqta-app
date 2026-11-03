import BackButton from '@/components/BackButton';
import { Text, TextInput } from '@/components/AppText';
import { useNotice } from '@/components/NoticeProvider';
import { useAuth, type ReauthOutcome } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_REDIRECT_URI, GOOGLE_WEB_CLIENT_ID } from '@/lib/googleAuthConfig';
import { MIN_TOUCH, stickyFooterStyle } from '@/lib/tokens';
import * as Google from 'expo-auth-session/providers/google';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * مسح الحساب (خط النهاية — `reports/2026-11-03-account-delete-export.md`، **على فرع مستني مؤمن**):
 * 1. الشاشة بتقول بالظبط إيه اللي هيتمسح، وزرار "صدّر بياناتك الأول".
 * 2. تأكيد مكتوب + إعادة دخول (باسورد أو جوجل) — **قبل** أي مسح.
 * 3. `deleteAllMyData` (كل البيانات من السيرفر، دفعات مؤكدة) ← `deleteSignInAccount`.
 * **ممنوع نقول "اتمسح" غير بعد ما حساب الدخول نفسه يتمسح.** وقع في النص ← رسالة بتقول بالظبط فاضل إيه، والزرار بيكمّل
 * (المسح بيتعاد بأمان). بعد النجاح `user` بيبقى null والتطبيق بيرجع لشاشة الدخول لوحده.
 */
export const DELETE_CONFIRM_PHRASE = 'امسح حسابي';

/** الرسايل في مكان واحد (اختبار + مراجعة نصوص) */
export const DELETE_MSG = {
  reauth: {
    'wrong-password': ['الباسورد مش صح', 'مفيش حاجة اتمسحت. اكتب باسورد حسابك وجرّب تاني.'],
    mismatch: ['حساب جوجل مختلف', 'اخترت حساب جوجل غير اللي فاتح بيه التطبيق، فمفيش حاجة اتمسحت.'],
    'no-connection': ['مفيش نت دلوقتي', 'مفيش حاجة اتمسحت. جرّب تاني أول ما النت يرجع.'],
    failed: ['ما قدرناش نتأكد إنه انت', 'مفيش حاجة اتمسحت. جرّب تاني.'],
  } as Record<Exclude<ReauthOutcome, 'done'>, [string, string]>,
  dataNotDone: (remaining: number): [string, string] => [
    'المسح ما خلصش',
    remaining > 0
      ? `جزء من بياناتك اتمسح وفاضل حاجات. دوس "امسح حسابي" تاني عشان نكمّل — اللي اتمسح مبيرجعش، واللي فاضل هيتمسح.`
      : 'ما قدرناش نوصل لبياناتك عشان نمسحها، فمفيش حاجة اتمسحت. اتأكد إن النت شغال وجرّب تاني.',
  ],
  accountNotDone: ['بياناتك اتمسحت، بس الحساب لسه موجود', 'كل بياناتك اتمسحت. فاضل حساب الدخول نفسه — دوس "امسح حسابي" تاني وأكّد إنه انت.'] as [string, string],
  done: ['اتمسح حسابك', 'كل بياناتك وحساب الدخول اتمسحوا من عندنا.'] as [string, string],
};

export default function DeleteAccountScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const notice = useNotice();
  const { user, reauthenticate, deleteSignInAccount } = useAuth();
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
    if (googleResponse?.type === 'success' && googleResponse.params?.id_token) setGoogleToken(googleResponse.params.id_token);
  }, [googleResponse]);

  const phraseOk = phrase.trim() === DELETE_CONFIRM_PHRASE;
  const proofReady = usesGoogle ? !!googleToken : password.length > 0;
  const canDelete = phraseOk && proofReady && serverReachable && !busy;

  async function run() {
    if (!canDelete) return;
    setBusy(true);
    try {
      const re = await reauthenticate(usesGoogle ? { kind: 'google', idToken: googleToken! } : { kind: 'password', password });
      if (re !== 'done') { setGoogleToken(null); notice(...DELETE_MSG.reauth[re]); return; }
      const data = await deleteAllMyData();
      if (data.outcome !== 'done') { notice(...DELETE_MSG.dataNotDone(data.remaining)); return; }
      const acc = await deleteSignInAccount();
      if (acc !== 'done') { setGoogleToken(null); setPassword(''); notice(...DELETE_MSG.accountNotDone); return; }
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
          <BackButton />
          <Text style={styles.title} accessibilityRole="header">مسح الحساب</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>اللي هيتمسح</Text>
          <Text style={styles.body}>
            كل محافظك وعملياتك وديونك واشتراكاتك وجمعياتك ودخلك الثابت وميزانيتك وشخبطة — ومعاهم حساب الدخول نفسه.
          </Text>
          <Text style={[styles.body, styles.danger]}>ده مبيترجعش.</Text>
        </View>

        <TouchableOpacity testID="delete_export_first" style={styles.secondaryBtn} onPress={() => router.push('/archive')} accessibilityRole="button">
          <Text style={styles.secondaryText}>صدّر بياناتك الأول (من الأرشيف)</Text>
        </TouchableOpacity>

        <Text style={styles.label}>اكتب «{DELETE_CONFIRM_PHRASE}» عشان تأكد</Text>
        <TextInput testID="delete_phrase" style={styles.input} value={phrase} onChangeText={setPhrase}
          placeholder={DELETE_CONFIRM_PHRASE} placeholderTextColor={colors.textSecondary} textAlign="right" autoCorrect={false}
          accessibilityLabel={`اكتب ${DELETE_CONFIRM_PHRASE} عشان تأكد`} />

        {usesGoogle ? (
          <TouchableOpacity testID="delete_google" style={styles.secondaryBtn} onPress={() => promptGoogle()} disabled={busy} accessibilityRole="button"
            accessibilityState={{ checked: !!googleToken }}>
            <Text style={styles.secondaryText}>{googleToken ? 'اتأكدنا إنه انت ✓' : 'أكّد إنه انت بحساب جوجل'}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.label}>باسورد حسابك</Text>
            <TextInput testID="delete_password" style={styles.input} value={password} onChangeText={setPassword}
              secureTextEntry textAlign="right" autoCapitalize="none" accessibilityLabel="باسورد حسابك" />
          </>
        )}
        {!serverReachable && (
          <Text testID="delete_offline" style={styles.hint} accessibilityLiveRegion="polite">المسح محتاج نت عشان نتأكد إن كل حاجة اتمسحت فعلاً.</Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity testID="delete_confirm" style={[styles.dangerBtn, { opacity: canDelete ? 1 : 0.5 }]} onPress={run}
          disabled={!canDelete} accessibilityRole="button" accessibilityLabel={busy ? 'بنمسح حسابك' : 'امسح حسابي'}
          accessibilityState={{ disabled: !canDelete, busy }}>
          {busy ? <ActivityIndicator color={colors.dangerText} /> : <Text style={styles.dangerText}>امسح حسابي</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 24 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 16 },
    title: { color: c.text, fontSize: 20, fontWeight: '700', textAlign: 'right' },
    card: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.dangerBorder, padding: 14, gap: 8 },
    cardTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },
    body: { color: c.textSecondary, fontSize: 13.5, lineHeight: 21, textAlign: 'right' },
    danger: { color: c.dangerText, fontWeight: '700' },
    label: { color: c.text, fontSize: 13.5, textAlign: 'right', marginTop: 18, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderRadius: 10, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 12, minHeight: MIN_TOUCH, fontSize: 15 },
    hint: { color: c.textSecondary, fontSize: 12.5, lineHeight: 19, textAlign: 'right', marginTop: 12 },
    secondaryBtn: { borderWidth: 1.5, borderColor: c.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH, marginTop: 14 },
    secondaryText: { color: c.accentText, fontWeight: '700', fontSize: 13.5 },
    footer: { ...stickyFooterStyle(c, c.bg) },
    // نفس شكل زرار الخطر في التأكيد (ConfirmProvider): إطار danger ونص dangerText — danger كنص تحت 4.5
    dangerBtn: { flex: 1, borderWidth: 1.5, borderColor: c.danger, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH + 4 },
    dangerText: { color: c.dangerText, fontWeight: '700', fontSize: 15 },
  });
