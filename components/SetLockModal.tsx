import { useAppLock, type VerifyResult } from '@/context/AppLockContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { MIN_TOUCH, overlayStyle, sheetStyle, stickyFooterStyle, typeScale, space, radius } from '@/lib/tokens';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button } from '@/components/Button';
import { Text, TextInput } from '@/components/AppText';
import { LOCK_STORAGE_ERROR } from '@/lib/lockMessages';
import { LOCK_WAIT_REASON, PIN_PATTERN, lockWaitMessage } from '@/lib/lockThrottle';

/** علامة «استنى» — النص بيتحسب وقت الرسم من `waitUntil` (الحالة بتتحدّث بعد ما `verify` يرجع) */
const WAIT = '__lock_wait__';
/** رسالة نتيجة التحقق — `wrongText` بيختلف بين الإلغاء («غلط، جرّب تاني») والتغيير («الكود القديم غلط») */
function verifyError(res: VerifyResult, wrongText: string): string {
  return res === 'error' ? LOCK_STORAGE_ERROR : res === 'wait' ? WAIT : wrongText;
}

/** `verify`: تخفيف القفل (الميزة 11، بند 13) — الكود الحالي بس، وبعده `onVerified` بيحفظ الاختيار */
type Mode = 'enable' | 'change' | 'disable' | 'verify';

const TITLE: Record<Mode, string> = { enable: 'تفعيل القفل', change: 'تغيير الكود', disable: 'إلغاء القفل', verify: 'أكّد إنك انت' };
/** سطر تحت العنوان في التأكيد بس — ليه بنطلب الكود (arabic-copy-reviewer) */
export const VERIFY_SUBLINE = 'عشان نخفّف القفل لازم نتأكد إنك انت.';
/** زرار التأكيد بيقول هيعمل إيه (arabic-copy-reviewer) — كان «تأكيد» في الأربعة */
const SUBMIT: Record<Mode, string> = { enable: 'فعّل القفل', change: 'غيّر الكود', disable: 'الغي القفل', verify: 'كمّل' };
export const CODES_MISMATCH = 'الكودين مش زي بعض — اكتبهم تاني نفس الحاجة';
/** بيبان أول ما خانة التأكيد توصل لطول الأولى وتبقى مختلفة — من غير ما يستنى «حفظ» */
export function codesMismatch(code1: string, code2: string): boolean {
  return code1.length > 0 && code2.length >= code1.length && code1 !== code2;
}
export const PIN_FORMAT_ERROR = 'الرقم السري لازم يكون 4 أرقام بس، من غير حروف ولا مسافات';
export const PASSWORD_SHORT_ERROR = 'الباسورد لازم يكون 4 حروف أو أرقام على الأقل';

export default function SetLockModal({ visible, mode, onClose, onVerified }: {
  visible: boolean; mode: Mode; onClose: () => void; onVerified?: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { lockType: currentType, setupLock, changeCode, disableLock, verify, waitUntil } = useAppLock();
  const missingCurrent = currentType === 'pin' ? 'دخّل الرقم السري الحالي' : 'دخّل الباسورد الحالي';

  const [type, setType] = useState<'pin' | 'password'>('pin');
  const [oldCode, setOldCode] = useState('');
  const [code1, setCode1] = useState('');
  const [code2, setCode2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // «استنى»: العدّ بينزل كل ثانية، وأول ما يخلص الرسالة بتتشال (كانت واقفة وبتقول «ثانية» للأبد — silent-failure-hunter).
  // قارئ الشاشة بيسمعها مرة واحدة؛ العدّ نفسه برّه الـlive region
  const [now, setNow] = useState(() => Date.now());
  const waitShown = error === WAIT;
  useEffect(() => {
    if (!waitShown) return;
    if (waitUntil <= Date.now()) { setError(''); return; }
    AccessibilityInfo.announceForAccessibility(`${LOCK_WAIT_REASON}. ${lockWaitMessage(waitUntil - Date.now())}`);
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= waitUntil) { clearInterval(id); setError(''); }
    }, 1000);
    return () => clearInterval(id);
  }, [waitShown, waitUntil]);

  function reset() {
    setType('pin'); setOldCode(''); setCode1(''); setCode2(''); setError('');
  }

  async function handleSubmit() {
    setError('');
    if (mode === 'verify') {
      if (!oldCode) { setError(missingCurrent); return; }
      setBusy(true);
      const res = await verify(oldCode).catch(() => 'error' as const);
      setBusy(false);
      if (res !== 'ok') { setError(verifyError(res, 'غلط، جرّب تاني')); return; }
      reset(); onClose(); onVerified?.();
      return;
    }
    if (mode === 'disable') {
      if (!oldCode) { setError(missingCurrent); return; }
      setBusy(true);
      const res = await disableLock(oldCode);
      setBusy(false);
      // "error" = التخزين نفسه فشل، مش الكود اللي غلط (بند A)
      if (res !== 'ok') { setError(verifyError(res, 'غلط، جرّب تاني')); return; }
      reset(); onClose();
      return;
    }
    if (mode === 'change' && !oldCode) { setError(missingCurrent); return; }
    if (!code1 || code1 !== code2) { setError(CODES_MISMATCH); return; }
    // أرقام إنجليزي بس (بند 9): «12a4» أو «1 23» كانوا بيعدّوا بالطول ولوحة الأرقام في شاشة القفل مبتكتبهمش = مقفول برّه
    if (type === 'pin' && !PIN_PATTERN.test(code1)) { setError(PIN_FORMAT_ERROR); return; }
    if (type === 'password' && code1.length < 4) { setError(PASSWORD_SHORT_ERROR); return; }

    setBusy(true);
    let res: VerifyResult = 'ok';
    try {
      if (mode === 'enable') {
        // بيرمي لو الحفظ فشل — والقفل القديم (أو مفيش قفل) زي ما هو، مش نص-نص (بند A)
        await setupLock(type, code1);
      } else {
        res = await changeCode(oldCode, code1, type);
      }
    } catch {
      res = 'error';
    } finally {
      // كان على المسار السعيد بس: رمية كانت بتسيب الزرار "..." للأبد
      setBusy(false);
    }
    if (res !== 'ok') { setError(verifyError(res, 'الكود القديم غلط')); return; }
    reset();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <Text style={styles.title} accessibilityRole="header">
            {TITLE[mode]}
          </Text>
          {mode === 'verify' && <Text testID="setlock_verify_subline" style={styles.subline}>{VERIFY_SUBLINE}</Text>}

          {mode !== 'enable' && (
            <>
              <Text style={styles.label}>{currentType === 'pin' ? 'الرقم السري الحالي' : 'الباسورد الحالي'}</Text>
              <TextInput testID="setlock_old_code" style={styles.input} value={oldCode} onChangeText={setOldCode}
                accessibilityLabel={currentType === 'pin' ? 'الرقم السري الحالي' : 'الباسورد الحالي'}
                secureTextEntry keyboardType={currentType === 'pin' ? 'numeric' : 'default'}
                placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          {(mode === 'enable' || mode === 'change') && (
            <>
              <Text style={styles.label}>نوع القفل</Text>
              <View style={styles.row}>
                <TouchableOpacity testID="setlock_type_pin" {...selectionA11y(type === 'pin', 'radio')} onPress={() => setType('pin')} style={[styles.typeBtn, selectionStyle(colors, type === 'pin')]}>
                  <Text style={{ color: colors.text, fontSize: typeScale.body, textAlign: 'center' }}>رقم سري (4 أرقام)</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="setlock_type_password" {...selectionA11y(type === 'password', 'radio')} onPress={() => setType('password')} style={[styles.typeBtn, selectionStyle(colors, type === 'password')]}>
                  <Text style={{ color: colors.text, fontSize: typeScale.body, textAlign: 'center' }}>باسورد نصي</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>{type === 'pin' ? 'الرقم السري الجديد' : 'الباسورد الجديد'}</Text>
              <TextInput testID="setlock_code1" style={styles.input} value={code1} onChangeText={setCode1}
                accessibilityLabel={type === 'pin' ? 'الرقم السري الجديد' : 'الباسورد الجديد'}
                secureTextEntry keyboardType={type === 'pin' ? 'numeric' : 'default'}
                maxLength={type === 'pin' ? 4 : undefined}
                placeholderTextColor={colors.textSecondary} textAlign="right" />

              <Text style={styles.label}>تأكيد {type === 'pin' ? 'الرقم' : 'الباسورد'}</Text>
              <TextInput testID="setlock_code2" style={styles.input} value={code2} onChangeText={setCode2}
                accessibilityLabel={type === 'pin' ? 'تأكيد الرقم' : 'تأكيد الباسورد'}
                secureTextEntry keyboardType={type === 'pin' ? 'numeric' : 'default'}
                maxLength={type === 'pin' ? 4 : undefined}
                placeholderTextColor={colors.textSecondary} textAlign="right" />
              {codesMismatch(code1, code2) && (
                <Text testID="setlock_mismatch" style={styles.mismatch} accessibilityLiveRegion="polite">{CODES_MISMATCH}</Text>
              )}
            </>
          )}

        </ScrollView>

        {/* برّه الـScrollView فوق الفوتر: جوّاه كانت بتقع تحت الكيبورد ومحدش بيشوفها (ملاحظة مؤمن على 1.0.0.036).
            دايمًا متركّب: live region بيتركّب ونصه جواه مبيتقريش على أندرويد (a11y-architect) */}
        {waitShown
          ? <Text testID="setlock_wait" style={styles.error}>{`${LOCK_WAIT_REASON}. ${lockWaitMessage(waitUntil - now)}`}</Text>
          : <Text testID="setlock_error" style={[styles.error, !error && styles.errorEmpty]} accessibilityLiveRegion="assertive">{error || ''}</Text>}

        <View style={styles.footer}>
          <Button variant="secondary" testID="setlock_cancel" label="إلغاء" style={styles.cancelBtn} onPress={() => { reset(); onClose(); }} />
          <Button testID="setlock_submit" label={SUBMIT[mode]} style={styles.saveBtn} onPress={handleSubmit} busy={busy} />
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    // الشاشة دي كانت أسوأ حالة في القايمة: مفيش `ScrollView` خالص. في وضع
    // "تغيير الباسورد" الفورم بيبقى تلات حقول + اختيار نوع، ومع الكيبورد
    // مفتوح مكانش فيه ولا تمرير احتياطي — الزرار يروح تحت الكيبورد وخلاص.
    sheet: { ...sheetStyle(c), padding: 0, overflow: 'hidden', maxHeight: '90%' },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { padding: space.xxxl },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginBottom: space.md },
    subline: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right' },
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.lg, marginBottom: space.xs },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, padding: space.lg, fontSize: typeScale.title },
    row: { flexDirection: 'row-reverse', gap: space.sm },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', paddingVertical: space.md, justifyContent: 'center', minHeight: MIN_TOUCH },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', paddingHorizontal: space.lg, paddingTop: space.sm },
    errorEmpty: { paddingTop: 0 },
    mismatch: { color: c.dangerText, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
  });
}