import BackButton from '@/components/BackButton';
import SetLockModal from '@/components/SetLockModal';
import { useAppLock } from '@/context/AppLockContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionStyle } from '@/lib/selection';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** خيارات مهلة السماح — نفس اللي كانت في شاشة الإعدادات القديمة بالظبط */
export const GRACE_OPTIONS = [
  { m: 0, label: 'فورًا' },
  { m: 1, label: 'بعد دقيقة' },
  { m: 5, label: 'بعد 5 دقايق' },
  { m: 15, label: 'بعد 15 دقيقة' },
];

export const LOCK_TYPE_LABEL: Record<string, string> = {
  pin: 'رقم سري',
  password: 'باسورد نصي',
};

/**
 * إعدادات قفل التطبيق.
 *
 * الشاشة دي موجودة عشان إعادة تنظيم الإعدادات ضيّعت نص القسم: صف "قفل
 * التطبيق" كان بيروح على `SetLockModal` في وضع "تغيير" على طول، فاختفى
 * **إلغاء القفل** ومعاه اختيار وقت الطلب ومهلة السماح ونوع القفل. يعني
 * المستخدم اللي فعّل القفل مبقاش يقدر يقفله — وده حبس مش أمان.
 *
 * كل اللي كان موجود قبل التنظيم رجع هنا بنفس النصوص، وزيادة: "نسيت الكود؟"
 * في شاشة القفل نفسها (`LockScreen`) عشان مايفضلش الطريق الوحيد إن المستخدم
 * يمسح التطبيق.
 */
export default function LockScreen_Settings() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    enabled, lockType, frequency, setFrequency, graceMinutes, setGraceMinutes,
  } = useAppLock();
  const [modalMode, setModalMode] = useState<'enable' | 'change' | 'disable' | null>(null);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title}>قفل التطبيق</Text>
      </View>

      {!enabled ? (
        <>
          <Text style={styles.hint}>
            القفل بيطلب منك رقم سري أو باسورد قبل ما تفتح التطبيق. بياناتك محمية بحسابك أصلاً —
            ده بيمنع أي حد ماسك موبايلك إنه يشوفها.
          </Text>
          <TouchableOpacity
            testID="lock_enable_button"
            style={styles.primaryBtn}
            onPress={() => setModalMode('enable')}>
            <Text style={styles.primaryBtnText}>تفعيل قفل التطبيق</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.card}>
          <Text testID="lock_status" style={styles.status}>
            القفل مفعّل ({LOCK_TYPE_LABEL[lockType] ?? lockType})
          </Text>

          <Text style={styles.hint}>يطلب الباسورد إمتى؟</Text>
          <View style={styles.row}>
            <TouchableOpacity
              testID="lock_freq_onOpen"
              onPress={() => setFrequency('onOpen')}
              style={[styles.typeBtn, selectionStyle(colors, frequency === 'onOpen')]}>
              <Text style={styles.btnLabel}>مرة واحدة (فتح التطبيق)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="lock_freq_everyResume"
              onPress={() => setFrequency('everyResume')}
              style={[styles.typeBtn, selectionStyle(colors, frequency === 'everyResume')]}>
              <Text style={styles.btnLabel}>كل مرة ترجع للتطبيق</Text>
            </TouchableOpacity>
          </View>

          {frequency === 'everyResume' && (
            <>
              <Text style={[styles.hint, { marginTop: 14 }]}>يقفل بعد قد إيه من خروجك من التطبيق؟</Text>
              <View style={styles.row}>
                {GRACE_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.m}
                    testID={`lock_grace_${opt.m}`}
                    onPress={() => setGraceMinutes(opt.m)}
                    style={[styles.graceBtn, selectionStyle(colors, graceMinutes === opt.m)]}>
                    <Text style={styles.graceLabel}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={[styles.row, { marginTop: 16 }]}>
            <TouchableOpacity
              testID="lock_change_button"
              style={styles.changeBtn}
              onPress={() => setModalMode('change')}>
              <Text style={styles.btnLabel}>تغيير الباسورد</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="lock_disable_button"
              style={styles.disableBtn}
              onPress={() => setModalMode('disable')}>
              <Text style={{ color: colors.danger, fontSize: 12.5 }}>إلغاء القفل</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {modalMode && (
        <SetLockModal visible={!!modalMode} mode={modalMode} onClose={() => setModalMode(null)} />
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    hint: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginBottom: 10, lineHeight: 17 },
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border },
    status: { color: c.success, fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    row: { flexDirection: 'row-reverse', gap: 8 },
    btnLabel: { color: c.text, fontSize: 12.5 },
    graceLabel: { color: c.text, fontSize: 11.5 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    graceBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 9 },
    changeBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    disableBtn: { flex: 1, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    primaryBtn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 13 },
    primaryBtnText: { color: c.text, fontWeight: '700', fontSize: 13.5 },
  });
}
