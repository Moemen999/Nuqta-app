import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { useAppLock } from '@/context/AppLockContext';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH, stickyFooterStyle } from '@/lib/tokens';
import { LOCK_READ_FAILED, LOCK_RETRY, LOCK_STORAGE_ERROR } from '@/lib/lockMessages';
import { LOCK_WAIT_REASON, lockWaitMessage } from '@/lib/lockThrottle';
import { LineIcon } from '@/components/LineIcon';

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

/** تقدّم الـPIN لقارئ الشاشة — العدد بالكلام ومتفق مع المعدود (arabic-copy-reviewer) */
export function pinProgressLabel(n: number) {
  return n <= 0 ? 'لسه مكتبتش أي رقم'
    : n === 1 ? 'اتكتب رقم واحد من 4'
    : n === 2 ? 'اتكتب رقمين من 4'
    : `اتكتب ${n} أرقام من 4`;
}

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

export default function LockScreen() {
  const { colors } = useTheme();
  const { lockType, verify, unlock, clearLock, readFailed, retryRead, waitUntil } = useAppLock();
  // حد المحاولات (2026-11-07): عدّ تنازلي كل ثانية طول ما فيه انتظار، والأرقام و«دخول» مقفولين. «نسيت الكود؟» شغال دايمًا
  const [now, setNow] = useState(() => Date.now());
  const waiting = waitUntil > now;
  useEffect(() => {
    if (waitUntil <= Date.now()) { setNow(Date.now()); return; }
    setNow(Date.now());
    // بيقف لوحده أول ما الوقت يخلص (كان بيفضل يعدّ لحد ما waitUntil يتغيّر)
    const id = setInterval(() => { const t = Date.now(); setNow(t); if (t >= waitUntil) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [waitUntil]);
  // العدّ بيتغيّر كل ثانية — لو جوه live region قارئ الشاشة هيقراه كل ثانية. فبيتقال مرة واحدة أول ما الانتظار يبدأ
  const announcedFor = useRef(0);
  useEffect(() => {
    if (waiting && announcedFor.current !== waitUntil) {
      announcedFor.current = waitUntil;
      AccessibilityInfo.announceForAccessibility(`${LOCK_WAIT_REASON}. ${lockWaitMessage(waitUntil - Date.now())}`);
    }
  }, [waiting, waitUntil]);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    const res = await retryRead();
    setRetrying(false);
    // بس لو فشلت فعلاً — `null` (قراية تانية كانت شغالة) مش فشل (silent-failure-hunter جولة 2)
    if (res === false) setRetryFailed(true);
  }
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
    // مسح القفل ممكن يرمي (التخزين) بعد الخروج — كان unhandled ساكت والقفل فاضل (silent-failure-hunter)
    try { await clearLock(); }
    catch { Alert.alert(LOCK_STORAGE_ERROR); }
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

  // الغلطة اللي بدأت الانتظار: «غلط» بتتمسح — كانت بتستخبى ورا العدّ وترجع لوحدها بعده (silent-failure-hunter)
  // بيتمسح مع البداية **والنهاية** — مش معتمد على إن setError وsetWaitUntil يترسموا في نفس الدفعة (silent-failure-hunter جولة 2)
  useEffect(() => { setError(''); }, [waiting]);

  // سطر الحالة تحت الكود (نفسه للرقم والباسورد): السبب + العدّ التنازلي، أو رسالة الغلط
  // مساحة ثابتة لسطرين: لوحة الأرقام كانت بتنط لفوق لما سطر السبب يختفي (اتشاف على الشاومي، بناء 1.0.0.008)
  const statusLine = (
    <View testID="lock_screen_status" style={styles.status}>
      {waiting
        ? <>
            <Text testID="lock_wait_reason" style={styles.statusText}>{LOCK_WAIT_REASON}</Text>
            <Text testID="lock_wait" style={styles.statusText}>{lockWaitMessage(waitUntil - now)}</Text>
          </>
        : <>
            <Text style={styles.statusText} accessibilityLiveRegion="assertive">{error || ' '}</Text>
            {/* السطر التاني فاضي عن قصد: نفس ارتفاع حالة الانتظار مهما كان حجم الخط (visual-identity-reviewer) */}
            <Text style={styles.statusText} accessible={false} importantForAccessibility="no">{' '}</Text>
          </>}
    </View>
  );

  async function handleSubmit(value?: string) {
    const toCheck = value ?? code;
    if (!toCheck) return;
    if (waiting) return;
    const res = await verify(toCheck);
    if (res === 'ok') {
      unlock();
      setCode('');
      setError('');
    } else {
      // "error" = التخزين فشل، الكود ممكن يكون صح (بند A)
      // "wait" = الرسالة من العدّ التنازلي نفسه (waitUntil اتحدّث)
      setError(res === 'error' ? LOCK_STORAGE_ERROR : res === 'wait' ? '' : 'غلط، جرّب تاني');
      setCode('');
    }
  }

  function pressDigit(d: string) {
    if (waiting || code.length >= 4) return;
    // نفس رسالة "غلط" مرتين ورا بعض مبتتقريش تاني (الـlive region بيتكلم مع التغيير بس) — فبتتمسح أول ما يكتب (a11y-architect)
    if (error) setError('');
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
      <View style={styles.lockIcon}><LineIcon name="lock-closed-outline" size={44} color={colors.accentText} /></View>
      <Text style={styles.title} accessibilityRole="header">نقطة مقفولة</Text>

      {readFailed ? (
        // الإعدادات ما اتقرتش: مقفول (مش مفتوح) ومفيش لوحة كود — منعرفش نوعه. المخرج: جرّب تاني أو "نسيت الكود؟" (بند A)
        <View style={styles.passwordArea}>
          <Text testID="lock_read_failed" style={styles.readFailed} accessibilityLiveRegion="polite">{LOCK_READ_FAILED}</Text>
          {retryFailed && !retrying && <Text testID="lock_read_retry_failed" style={styles.error} accessibilityLiveRegion="polite">{LOCK_STORAGE_ERROR}</Text>}
          <TouchableOpacity testID="lock_read_retry" accessibilityRole="button" accessibilityState={{ busy: retrying, disabled: retrying }}
            disabled={retrying} style={[styles.submitBtn, retrying && { opacity: 0.6 }]} onPress={retry}>
            <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 16 }}>{retrying ? '...' : LOCK_RETRY}</Text>
          </TouchableOpacity>
        </View>
      ) : lockType === 'pin' ? (
        <>
          {/* النقط لقارئ الشاشة جملة واحدة بتتحدّث مع كل رقم (a11y-architect، بند E) */}
          <View style={styles.dotsRow} accessible accessibilityLabel={pinProgressLabel(code.length)} accessibilityLiveRegion="polite">
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[styles.dot, { backgroundColor: i < code.length ? colors.accent : colors.surface2, borderColor: colors.borderStrong }]} />
            ))}
          </View>
          {statusLine}

          <View style={styles.keypad}>
            {KEY_ROWS.map((row, ri) => (
              <View key={ri} style={styles.keyRow}>
                {row.map((k, ki) => (
                  <TouchableOpacity
                    key={ki}
                    testID={k === '⌫' ? 'lock_key_backspace' : k === '' ? 'lock_key_empty' : `lock_key_${k}`}
                    // الخانة الفاضية مش زرار (كانت بتتقري "زرار" من غير اسم)، والمسح ليه اسم بدل "⌫"
                    {...(k === ''
                      ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const }
                      : { accessibilityRole: 'button' as const, accessibilityLabel: k === '⌫' ? 'امسح آخر رقم' : k })}
                    style={[styles.key, k === '' && styles.keyHidden, { backgroundColor: colors.surface }]}
                    disabled={k === '' || (waiting && k !== '⌫')}
                    accessibilityState={k === '' ? undefined : { disabled: waiting && k !== '⌫' }}
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
            onChangeText={v => { setCode(v); if (error) setError(''); }}
            accessibilityLabel="الباسورد"
            placeholder="الباسورد"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            textAlign="right"
            autoFocus
          />
          {statusLine}
          <TouchableOpacity testID="lock_submit_button" accessibilityRole="button" accessibilityState={{ disabled: waiting }}
            disabled={waiting} style={[styles.submitBtn, waiting && { opacity: 0.6 }]} onPress={() => handleSubmit()}>
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
        <TouchableOpacity testID="lock_forgot_button" accessibilityRole="button" style={styles.forgotBtn} onPress={handleForgot}>
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
    lockIcon: { marginBottom: 10 },
    title: { color: c.text, fontSize: 20, fontWeight: '700', marginBottom: 28 },
    dotsRow: { flexDirection: 'row', gap: 18, marginBottom: 14 },
    dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1 },
    error: { color: c.dangerText, fontSize: 13, marginBottom: 18, minHeight: 18, textAlign: 'center' },
    status: { marginBottom: 18, gap: 4 },
    // ارتفاع سطر صريح: سطرين دايمًا × ارتفاع ثابت = اللوحة مبتنطش حتى مع تكبير الخط
    statusText: { color: c.dangerText, fontSize: 13, lineHeight: 20, textAlign: 'center' },
    keypad: { gap: 18 },
    keyRow: { flexDirection: 'row', gap: 22, justifyContent: 'center' },
    key: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' },
    keyHidden: { backgroundColor: 'transparent' },
    keyText: { fontSize: 28, fontWeight: '500' },
    passwordArea: { width: '100%', maxWidth: 320 },
    input: { width: '100%', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, color: c.text, padding: 16, fontSize: 17 },
    submitBtn: { backgroundColor: c.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 15, marginTop: 4 },
    readFailed: { color: c.text, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 18 },
    forgotBtn: { padding: 8, minHeight: MIN_TOUCH, justifyContent: 'center' },
    forgotText: { color: c.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
  });
}
