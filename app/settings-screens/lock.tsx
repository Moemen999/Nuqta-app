import BackButton from '@/components/BackButton';
import SetLockModal from '@/components/SetLockModal';
import { useAppLock } from '@/context/AppLockContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { cardElevation, MIN_TOUCH, space, typeScale, radius } from '@/lib/tokens';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Text } from '@/components/AppText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useNotice } from '@/components/NoticeProvider';
import { LOCK_SETTING_NOT_SAVED } from '@/lib/lockMessages';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/PressableScale';

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
  const notice = useNotice();
  // الحفظ في التخزين الآمن ممكن يفشل — الاختيار القديم بيفضل ظاهر، والرسالة بتقول (بند A؛ كان unhandled rejection ساكت)
  const saveSetting = (p: Promise<boolean>) => { p.then(ok => { if (!ok) notice(LOCK_SETTING_NOT_SAVED.title, LOCK_SETTING_NOT_SAVED.body); }); };
  const [modalMode, setModalMode] = useState<'enable' | 'change' | 'disable' | 'verify' | null>(null);
  /**
   * تخفيف القفل (الميزة 11، بند 13): «عند الفتح بس» بدل «كل مرة»، أو مهلة أطول = نفس أثر الإلغاء جزئيًا، فبيطلب الكود الأول
   * زي الإلغاء. التشديد على طول. الاختيار بيتحفظ بعد الكود الصح بس
   */
  const [weaken, setWeaken] = useState<(() => Promise<boolean>) | null>(null);
  function chooseFrequency(f: 'onOpen' | 'everyResume') {
    if (f === frequency) return;
    if (frequency === 'everyResume' && f === 'onOpen') { setWeaken(() => () => setFrequency(f)); setModalMode('verify'); return; }
    saveSetting(setFrequency(f));
  }
  function chooseGrace(m: number) {
    if (m === graceMinutes) return;
    if (m > graceMinutes) { setWeaken(() => () => setGraceMinutes(m)); setModalMode('verify'); return; }
    saveSetting(setGraceMinutes(m));
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <BackButton />
        <ScreenTitle>قفل التطبيق</ScreenTitle>
      </View>

      {!enabled ? (
        <>
          <Text style={styles.hint}>
            القفل بيطلب منك رقم سري أو باسورد قبل ما تفتح التطبيق. بياناتك محمية بحسابك أصلاً —
            ده بيمنع أي حد ماسك موبايلك إنه يشوفها.
          </Text>
          <Button testID="lock_enable_button" variant="secondary" label="تفعيل قفل التطبيق" onPress={() => setModalMode('enable')} />
        </>
      ) : (
        <View style={styles.card}>
          <Text testID="lock_status" style={styles.status}>
            القفل مفعّل ({LOCK_TYPE_LABEL[lockType] ?? lockType})
          </Text>

          <Text style={styles.hint}>يطلب الكود إمتى؟</Text>
          <View style={styles.row}>
            <PressableScale
              testID="lock_freq_on_open"
              {...selectionA11y(frequency === 'onOpen', 'radio')}
              onPress={() => chooseFrequency('onOpen')}
              style={[styles.typeBtn, selectionStyle(colors, frequency === 'onOpen')]}>
              <Text style={styles.btnLabel}>مرة واحدة (فتح التطبيق)</Text>
            </PressableScale>
            <PressableScale
              testID="lock_freq_every_resume"
              {...selectionA11y(frequency === 'everyResume', 'radio')}
              onPress={() => chooseFrequency('everyResume')}
              style={[styles.typeBtn, selectionStyle(colors, frequency === 'everyResume')]}>
              <Text style={styles.btnLabel}>كل مرة ترجع للتطبيق</Text>
            </PressableScale>
          </View>

          {frequency === 'everyResume' && (
            <>
              <Text style={[styles.hint, { marginTop: space.xl }]}>يقفل بعد قد إيه من خروجك من التطبيق؟</Text>
              <View style={styles.row}>
                {GRACE_OPTIONS.map(opt => (
                  <PressableScale
                    key={opt.m}
                    testID={`lock_grace_${opt.m}`}
                    {...selectionA11y(graceMinutes === opt.m, 'radio')}
                    onPress={() => chooseGrace(opt.m)}
                    style={[styles.graceBtn, selectionStyle(colors, graceMinutes === opt.m)]}>
                    <Text style={styles.graceLabel}>{opt.label}</Text>
                  </PressableScale>
                ))}
              </View>
            </>
          )}

          <View style={[styles.row, { marginTop: space.xxl }]}>
            <Button variant="secondary" testID="lock_change_button" label="تغيير الكود" style={styles.flexBtn}
              onPress={() => setModalMode('change')} />
            <Button variant="danger" testID="lock_disable_button" label="إلغاء القفل" style={styles.flexBtn}
              onPress={() => setModalMode('disable')} />
          </View>
        </View>
      )}

      {modalMode && (
        <SetLockModal visible={!!modalMode} mode={modalMode}
          onClose={() => { setModalMode(null); if (modalMode === 'verify') setWeaken(null); }}
          onVerified={weaken ? () => { saveSetting(weaken()); setWeaken(null); } : undefined} />
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxl, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xl },
    hint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.md, lineHeight: 17 },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.xl, ...cardElevation(c) },
    status: { color: c.incomeText, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right', marginBottom: space.md },
    row: { flexDirection: 'row-reverse', gap: space.sm },
    btnLabel: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    graceLabel: { color: c.text, fontSize: typeScale.caption },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', paddingVertical: space.md, justifyContent: 'center', minHeight: MIN_TOUCH },
    graceBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingVertical: space.sm, minHeight: MIN_TOUCH },
    flexBtn: { flex: 1 },
  });
}
