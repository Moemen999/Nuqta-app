import { useAppLock, type VerifyResult } from '@/context/AppLockContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { MIN_TOUCH, overlayStyle, sheetStyle, stickyFooterStyle } from '@/lib/tokens';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { LOCK_STORAGE_ERROR } from '@/lib/lockMessages';
import { LOCK_WAIT_REASON, lockWaitMessage } from '@/lib/lockThrottle';

/** علامة «استنى» — النص بيتحسب وقت الرسم من `waitUntil` (الحالة بتتحدّث بعد ما `verify` يرجع) */
const WAIT = '__lock_wait__';
/** رسالة نتيجة التحقق — `wrongText` بيختلف بين الإلغاء («غلط، جرّب تاني») والتغيير («الكود القديم غلط») */
function verifyError(res: VerifyResult, wrongText: string): string {
  return res === 'error' ? LOCK_STORAGE_ERROR : res === 'wait' ? WAIT : wrongText;
}

type Mode = 'enable' | 'change' | 'disable';

export default function SetLockModal({ visible, mode, onClose }: { visible: boolean; mode: Mode; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { lockType: currentType, setupLock, changeCode, disableLock, waitUntil } = useAppLock();

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
    if (mode === 'disable') {
      if (!oldCode) { setError('دخّل الباسورد/الرقم الحالي'); return; }
      setBusy(true);
      const res = await disableLock(oldCode);
      setBusy(false);
      // "error" = التخزين نفسه فشل، مش الكود اللي غلط (بند A)
      if (res !== 'ok') { setError(verifyError(res, 'غلط، جرّب تاني')); return; }
      reset(); onClose();
      return;
    }
    if (mode === 'change' && !oldCode) { setError('دخّل الباسورد/الرقم القديم'); return; }
    if (!code1 || code1 !== code2) { setError('الكود الجديد مش متطابق في الحقلين'); return; }
    if (type === 'pin' && code1.length !== 4) { setError('الرقم السري لازم 4 أرقام بالظبط'); return; }
    if (type === 'password' && code1.length < 4) { setError('الباسورد لازم 4 حروف على الأقل'); return; }

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
            {mode === 'enable' ? 'تفعيل القفل' : mode === 'change' ? 'تغيير الباسورد' : 'إلغاء القفل'}
          </Text>

          {mode !== 'enable' && (
            <>
              <Text style={styles.label}>{currentType === 'pin' ? 'الرقم السري الحالي' : 'الباسورد الحالي'}</Text>
              <TextInput testID="setlock_old_code" style={styles.input} value={oldCode} onChangeText={setOldCode}
                accessibilityLabel={currentType === 'pin' ? 'الرقم السري الحالي' : 'الباسورد الحالي'}
                secureTextEntry keyboardType={currentType === 'pin' ? 'numeric' : 'default'}
                placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          {mode !== 'disable' && (
            <>
              <Text style={styles.label}>نوع القفل</Text>
              <View style={styles.row}>
                <TouchableOpacity testID="setlock_type_pin" {...selectionA11y(type === 'pin')} onPress={() => setType('pin')} style={[styles.typeBtn, selectionStyle(colors, type === 'pin')]}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>رقم سري (4 أرقام)</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="setlock_type_password" {...selectionA11y(type === 'password')} onPress={() => setType('password')} style={[styles.typeBtn, selectionStyle(colors, type === 'password')]}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>باسورد نصي</Text>
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
            </>
          )}

          {/* دايمًا متركّب: live region بيتركّب ونصه جواه مبيتقريش على أندرويد (a11y-architect) */}
          {waitShown
            ? <Text testID="setlock_wait" style={styles.error}>{`${LOCK_WAIT_REASON}. ${lockWaitMessage(waitUntil - now)}`}</Text>
            : <Text style={[styles.error, !error && { marginTop: 0 }]} accessibilityLiveRegion="assertive">{error || ''}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity testID="setlock_cancel" accessibilityRole="button" style={styles.cancelBtn} onPress={() => { reset(); onClose(); }}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="setlock_submit" accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} accessibilityLabel={busy ? 'استنى شوية' : 'تأكيد'} style={styles.saveBtn} onPress={handleSubmit} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'تأكيد'}</Text>
          </TouchableOpacity>
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
    sheetContent: { padding: 20 },
    title: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 12, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, padding: 12, fontSize: 15 },
    row: { flexDirection: 'row-reverse', gap: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 10, justifyContent: 'center', minHeight: MIN_TOUCH },
    error: { color: c.dangerText, fontSize: 13, textAlign: 'center', marginTop: 12 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  });
}