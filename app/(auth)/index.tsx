import { useAuth } from '@/context/AuthContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export const RESET_LABEL = 'نسيت الباسورد؟';
export const RESET_NEEDS_EMAIL = 'اكتب إيميلك الأول، وبعدين دوس "نسيت الباسورد؟"';
export const RESET_TITLE = 'بعتنالك رابط';
export function resetSentBody(email: string) {
  return `بعتنا رابط على ${email} تقدر تغيّر منه الباسورد. لو ملقتهوش في الوارد، بصّ في الـSpam.`;
}
/**
 * جوجل مبتقولش "الإيميل ده مش موجود" عن قصد (عشان محدش يعرف مين مسجّل
 * ومين لأ)، وفايربيز بقت بتعمل نفس الحاجة. فالرسالة دي مبتأكدش إن الحساب
 * موجود — بتقول إننا بعتنا لو كان موجود، وخلاص.
 */
export const RESET_GOOGLE_HINT =
  'ولو انت سجّلت بجوجل من الأول، مش هيوصلك حاجة — ادخل بزرار جوجل فوق على طول.';

// الـ Web Client ID بتاع مشروع Firebase "nuqta" — عمومي وآمن يتحط في الكود
const GOOGLE_WEB_CLIENT_ID = '662258111881-r6c7jaudqjeud0oa7dsn119rf0tsv4tu.apps.googleusercontent.com';
// الـ Android Client ID (مرتبط بـ SHA-1 بتاع نسخة preview) — لازم يتحدث لو الـ keystore اتغيّر
const GOOGLE_ANDROID_CLIENT_ID = '662258111881-suhr5mgqa116f56p5439mq5gmaj8682e.apps.googleusercontent.com';
// جوجل بترفض الـ scheme العادي لتطبيقات أندرويد وبتطلب الصيغة دي المبنية على الـ Client ID نفسه (معكوسة)
const GOOGLE_REVERSED_SCHEME = 'com.googleusercontent.apps.662258111881-suhr5mgqa116f56p5439mq5gmaj8682e';

export default function AuthScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signIn, signUp, signInWithGoogleCredential, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // جوجل بتطلب شرطة واحدة بعد النقطتين في الصيغة دي (scheme:/path مش scheme://path)
  const redirectUri = useMemo(
    () => `${GOOGLE_REVERSED_SCHEME}:/oauth2redirect`,
    []
  );

  const [, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    redirectUri,
  });

  useEffect(() => {
    (async () => {
      if (response?.type === 'success') {
        const idToken = response.params?.id_token;
        if (idToken) {
          setGoogleBusy(true);
          try {
            await signInWithGoogleCredential(idToken);
          } catch {
            setError('حصل خطأ في تسجيل الدخول بجوجل، جرب تاني');
          } finally {
            setGoogleBusy(false);
          }
        }
      } else if (response?.type === 'error') {
        setError('حصل خطأ في تسجيل الدخول بجوجل');
      }
    })();
  }, [response]);

  async function handleSubmit() {
    setError('');
    if (!email.trim() || !password.trim() || (mode === 'signup' && !name.trim())) {
      setError('من فضلك املأ كل الحقول');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, name.trim());
      }
    } catch (e: any) {
      setError(mapError(e.code));
    } finally {
      setBusy(false);
    }
  }

  /**
   * الرابط ده هو الطرف التاني لمخرج "نسيت الكود؟" في شاشة القفل: هناك
   * بنخرّج المستخدم من حسابه وبنفترض إنه يقدر يدخل تاني. من غير ده، اللي
   * نسي كود القفل **و**باسورد حسابه مكانش ليه أي طريق يرجع لفلوسه.
   */
  async function handleReset() {
    setError('');
    const target = email.trim();
    if (!target) { setError(RESET_NEEDS_EMAIL); return; }
    setResetBusy(true);
    try {
      await resetPassword(target);
      Alert.alert(RESET_TITLE, `${resetSentBody(target)} ${RESET_GOOGLE_HINT}`);
    } catch (e: any) {
      setError(mapError(e?.code));
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>نقطة</Text>
      <Text style={styles.tagline}>نقطة على السطر</Text>
      <Text style={styles.subtitle}>{mode === 'login' ? 'سجّل دخولك' : 'أنشئ حسابك'}</Text>

      <TouchableOpacity style={styles.googleBtn} onPress={() => promptAsync()} disabled={googleBusy}>
        {googleBusy ? <ActivityIndicator color={colors.text} /> : (
          <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>تسجيل الدخول بحساب جوجل</Text>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>أو</Text>
        <View style={styles.dividerLine} />
      </View>

      {mode === 'signup' && (
        <TextInput testID="auth_name_input" style={styles.input} placeholder="الاسم" placeholderTextColor={colors.textSecondary}
          value={name} onChangeText={setName} textAlign="right" />
      )}
      <TextInput testID="auth_email_input" style={styles.input} placeholder="الإيميل" placeholderTextColor={colors.textSecondary}
        value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textAlign="right" />
      <TextInput testID="auth_password_input" style={styles.input} placeholder="الباسورد" placeholderTextColor={colors.textSecondary}
        value={password} onChangeText={setPassword} secureTextEntry textAlign="right" />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity testID="auth_submit_button" style={styles.button} onPress={handleSubmit} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : (
          <Text style={styles.buttonText}>{mode === 'login' ? 'دخول' : 'إنشاء حساب'}</Text>
        )}
      </TouchableOpacity>

      {mode === 'login' && (
        <TouchableOpacity testID="auth_reset_button" onPress={handleReset} disabled={resetBusy}>
          <Text style={[styles.resetText, resetBusy && { opacity: 0.6 }]}>
            {resetBusy ? '...' : RESET_LABEL}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => { setError(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>
        <Text style={styles.switchText}>
          {mode === 'login' ? 'لسه معندكش حساب؟ سجّل واحد' : 'عندك حساب بالفعل؟ سجّل دخول'}
        </Text>
      </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function mapError(code: string) {
  switch (code) {
    case 'auth/invalid-email': return 'الإيميل مش صحيح';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'الإيميل أو الباسورد غلط';
    case 'auth/email-already-in-use': return 'الإيميل ده مستخدم قبل كده';
    case 'auth/weak-password': return 'الباسورد لازم يكون 6 حروف/أرقام على الأقل';
    case 'auth/missing-email': return 'اكتب إيميلك الأول';
    case 'auth/too-many-requests': return 'جرّبت كتير أوي. استنى شوية وحاول تاني';
    case 'auth/network-request-failed': return 'مفيش نت. وصّل النت وحاول تاني';
    default: return 'حصل خطأ، جرب تاني';
  }
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    container: { flexGrow: 1, backgroundColor: c.bg, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40, gap: 12 },
    title: { color: c.accent, fontSize: 36, fontWeight: '700', textAlign: 'center', marginBottom: 2 },
    tagline: { color: c.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 18 },
    subtitle: { color: c.textSecondary, fontSize: 15, textAlign: 'center', marginBottom: 4 },
    googleBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
    dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
    dividerText: { color: c.textMuted, fontSize: 12 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
    error: { color: c.danger, fontSize: 13, textAlign: 'center' },
    button: { backgroundColor: c.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    buttonText: { color: c.onAccent, fontSize: 15, fontWeight: '700' },
    resetText: { color: c.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 12, textDecorationLine: 'underline' },
    switchText: { color: c.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 14 },
  });
}
