import { useAuth } from '@/context/AuthContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

WebBrowser.maybeCompleteAuthSession();

// الـ Web Client ID بتاع مشروع Firebase "nuqta" — عمومي وآمن يتحط في الكود
const GOOGLE_WEB_CLIENT_ID = '662258111881-r6c7jaudqjeud0oa7dsn119rf0tsv4tu.apps.googleusercontent.com';
// الـ Android Client ID (مرتبط بـ SHA-1 بتاع نسخة preview) — لازم يتحدث لو الـ keystore اتغيّر
const GOOGLE_ANDROID_CLIENT_ID = '662258111881-suhr5mgqa116f56p5439mq5gmaj8682e.apps.googleusercontent.com';

export default function AuthScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signIn, signUp, signInWithGoogleCredential } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const [, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
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

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        <TextInput style={styles.input} placeholder="الاسم" placeholderTextColor={colors.textSecondary}
          value={name} onChangeText={setName} textAlign="right" />
      )}
      <TextInput style={styles.input} placeholder="الإيميل" placeholderTextColor={colors.textSecondary}
        value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textAlign="right" />
      <TextInput style={styles.input} placeholder="الباسورد" placeholderTextColor={colors.textSecondary}
        value={password} onChangeText={setPassword} secureTextEntry textAlign="right" />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : (
          <Text style={styles.buttonText}>{mode === 'login' ? 'دخول' : 'إنشاء حساب'}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => { setError(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>
        <Text style={styles.switchText}>
          {mode === 'login' ? 'لسه معندكش حساب؟ سجّل واحد' : 'عندك حساب بالفعل؟ سجّل دخول'}
        </Text>
      </TouchableOpacity>
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
    default: return 'حصل خطأ، جرب تاني';
  }
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
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
    switchText: { color: c.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 14 },
  });
}
