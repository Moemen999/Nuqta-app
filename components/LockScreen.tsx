import { useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useAppLock } from '@/context/AppLockContext';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { stickyFooterStyle } from '@/lib/tokens';

export const FORGOT_LABEL = 'نسيت الكود؟';
export const FORGOT_TITLE = 'نسيت كود القفل؟';
/**
 * الرسالة بتقول بالظبط اللي هيحصل **قبل** ما يحصل.
 *
 * كانت بتقول "ترجع تدخل بإيميلك وباسوردك" — وده غلط لناس كتير: اللي سجّل
 * بجوجل معندهوش باسورد أصلاً، فالجملة دي كانت بتخوّفه من غير سبب. دلوقتي
 * بتقول "بنفس الطريقة اللي سجّلت بيها"، وبتوريه إن فيه "نسيت الباسورد؟"
 * في شاشة الدخول لو ده كمان ضايع منه.
 */
export const FORGOT_BODY =
  'هنشيل القفل ونخرجك من حسابك. ترجع تدخل بنفس الطريقة اللي سجّلت بيها — '
  + 'بجوجل أو بالإيميل والباسورد — وبياناتك كلها زي ما هي مستنياك. ولو نسيت '
  + 'باسورد حسابك كمان، هتلاقي "نسيت الباسورد؟" في شاشة الدخول. وبعد ما ترجع '
  + 'تقدر تفعّل القفل من جديد بكود تفتكره.\n\nمحتاج نت عشان ترجع تدخل.';
export const FORGOT_CONFIRM = 'شيل القفل واخرج';

/**
 * من غير نت، شيل القفل + خروج = المستخدم برّه التطبيق ومش قادر يرجع.
 *
 * بس **مش** بنمنعه: `serverReachable` بتبدأ `false` وبتبقى `true` بس بعد أول
 * snapshot من السيرفر، فالثواني الأولى بعد فتح التطبيق بتبان زي "مفيش نت"
 * حتى والنت شغال. لو منعنا على أساسها كنا هنحبس ناس نتهم كويس. فبنحذّر
 * ونسيب له مخرج "النت شغال عندي".
 */
export const FORGOT_OFFLINE_TITLE = 'محتاج نت الأول';
export const FORGOT_OFFLINE_BODY =
  'إحنا مش شايفين نت دلوقتي. لو شيلنا القفل وخرجناك وانت من غير نت، مش هتعرف '
  + 'ترجع تدخل لحد ما النت يرجع — بياناتك مش هتضيع، بس هتفضل برّه التطبيق. '
  + 'وصّل النت وجرب تاني.';
export const FORGOT_OFFLINE_CONTINUE = 'النت شغال عندي، كمّل';

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

export default function LockScreen() {
  const { colors } = useTheme();
  const { lockType, verify, unlock, clearLock } = useAppLock();
  const { logOut } = useAuth();
  const { serverReachable } = useData();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const styles = makeStyles(colors);

  /**
   * القفل بيتحط قدام التطبيق كله قبل حتى شاشة الدخول، فاللي بينسى كوده مكانش
   * قدامه أي طريق غير إنه يمسح التطبيق — ودي حبسة مش حماية.
   *
   * الخروج منها مربوط بالحساب نفسه: بنشيل القفل وبنسجّل خروج، فالمستخدم
   * لازم يقدر يدخل حسابه تاني (بجوجل أو بالإيميل والباسورد) عشان يرجع
   * لبياناته. يعني الاسترجاع محمي بحاجة أقوى من الكود المحلي، مش أضعف منه.
   */
  /**
   * **الترتيب مقصود: خروج الأول، وبعدين شيل القفل.**
   *
   * بالعكس (شيل القفل الأول) فيه ثغرة: `clearLock` بتخلي `enabled` و
   * `isLocked` بـ false على طول، والبوابة في `app/_layout.tsx` بتفتح —
   * فلو التطبيق اتقفل بالعافية (أو الـOS قتله) بين السطرين، مفاتيح القفل
   * بتبقى اتمسحت خلاص لكن جلسة فايربيز لسه محفوظة على الجهاز. الفتحة
   * الجاية بتدخل على الحساب كامل من غير كود ولا باسورد — تجاوز دائم.
   *
   * بالترتيب ده أسوأ حاجة ممكنة إن المستخدم يلاقي نفسه قدام القفل تاني
   * ويدوس "نسيت الكود؟" مرة كمان. بيقع في الاتجاه الآمن.
   */
  async function runForgot() {
    await logOut();
    await clearLock();
  }

  function confirmForgot() {
    Alert.alert(FORGOT_TITLE, FORGOT_BODY, [
      { text: 'إلغاء', style: 'cancel' },
      { text: FORGOT_CONFIRM, style: 'destructive', onPress: runForgot },
    ]);
  }

  function handleForgot() {
    if (!serverReachable) {
      Alert.alert(FORGOT_OFFLINE_TITLE, FORGOT_OFFLINE_BODY, [
        { text: 'تمام', style: 'cancel' },
        { text: FORGOT_OFFLINE_CONTINUE, onPress: confirmForgot },
      ]);
      return;
    }
    confirmForgot();
  }

  async function handleSubmit(value?: string) {
    const toCheck = value ?? code;
    if (!toCheck) return;
    const ok = await verify(toCheck);
    if (ok) {
      unlock();
      setCode('');
      setError('');
    } else {
      setError('غلط، جرب تاني');
      setCode('');
    }
  }

  function pressDigit(d: string) {
    if (code.length >= 4) return;
    const next = code + d;
    setCode(next);
    if (next.length === 4) handleSubmit(next);
  }
  function backspace() {
    setCode(c => c.slice(0, -1));
  }

  return (
    <KeyboardAvoidingView
      testID="lock_kav"
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        testID="lock_scroll"
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}>
      <Text style={styles.lockEmoji}>🔒</Text>
      <Text style={styles.title}>نقطة مقفولة</Text>

      {lockType === 'pin' ? (
        <>
          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[styles.dot, { backgroundColor: i < code.length ? colors.accent : colors.surface2, borderColor: colors.borderStrong }]} />
            ))}
          </View>
          <Text style={styles.error}>{error || ' '}</Text>

          <View style={styles.keypad}>
            {KEY_ROWS.map((row, ri) => (
              <View key={ri} style={styles.keyRow}>
                {row.map((k, ki) => (
                  <TouchableOpacity
                    key={ki}
                    style={[styles.key, k === '' && styles.keyHidden, { backgroundColor: colors.surface }]}
                    disabled={k === ''}
                    activeOpacity={0.6}
                    onPress={() => (k === '⌫' ? backspace() : k !== '' && pressDigit(k))}>
                    <Text style={[styles.keyText, { color: colors.text }]}>{k}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.passwordArea}>
          <TextInput
            testID="lock_password_input"
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="الباسورد"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            textAlign="right"
            autoFocus
          />
          <Text style={styles.error}>{error || ' '}</Text>
          <TouchableOpacity testID="lock_submit_button" style={styles.submitBtn} onPress={() => handleSubmit()}>
            <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 16 }}>دخول</Text>
          </TouchableOpacity>
        </View>
      )}

      </ScrollView>

      {/*
        المخرج برّه الـ`ScrollView` في فوتر لاصق عن قصد. مع الباسورد النصي
        الكيبورد بيفتح لوحده (`autoFocus`)، وقبل كده الشاشة مكانش فيها لا
        `KeyboardAvoidingView` ولا تمرير — فعلى موبايل قصير زرار "دخول"
        و"نسيت الكود؟" كانوا بيقعوا تحت الكيبورد من غير أي طريق توصلهم.
        يعني المخرج الوحيد من الحبسة كان هو نفسه محبوس.
      */}
      <View testID="lock_footer" style={styles.footer}>
        <TouchableOpacity testID="lock_forgot_button" style={styles.forgotBtn} onPress={handleForgot}>
          <Text style={styles.forgotText}>{FORGOT_LABEL}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    footer: { ...stickyFooterStyle(c, c.bg), justifyContent: 'center' },
    lockEmoji: { fontSize: 44, marginBottom: 10 },
    title: { color: c.text, fontSize: 20, fontWeight: '700', marginBottom: 28 },
    dotsRow: { flexDirection: 'row', gap: 18, marginBottom: 14 },
    dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1 },
    error: { color: c.danger, fontSize: 13, marginBottom: 18, minHeight: 18, textAlign: 'center' },
    keypad: { gap: 18 },
    keyRow: { flexDirection: 'row', gap: 22, justifyContent: 'center' },
    key: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' },
    keyHidden: { backgroundColor: 'transparent' },
    keyText: { fontSize: 28, fontWeight: '500' },
    passwordArea: { width: '100%', maxWidth: 320 },
    input: { width: '100%', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, color: c.text, padding: 16, fontSize: 17 },
    submitBtn: { backgroundColor: c.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 15, marginTop: 4 },
    forgotBtn: { padding: 8 },
    forgotText: { color: c.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
  });
}
