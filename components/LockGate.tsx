import LockScreen from '@/components/LockScreen';
import { Text } from '@/components/AppText';
import { useTheme } from '@/context/ThemeContext';
import { glyphSize } from '@/lib/tokens';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';

export const PRIVACY_COVER_TEST_ID = 'privacy_cover';

/** اللي تحت القفل/الغطا: مش بيتقري (قارئ الشاشة) ومبيتداسش */
const HIDDEN = {
  importantForAccessibility: 'no-hide-descendants' as const,
  accessibilityElementsHidden: true,
  pointerEvents: 'none' as const,
};

/**
 * غطا الخصوصية (الميزة 11، بند 6): التطبيق بيروح الخلفية والقفل مفعّل ← لقطة «التطبيقات الأخيرة» متبيّنش الأرصدة.
 * `inactive` (iOS) و`background` الاتنين بيغطّوا، و`active` بيشيل. **من غير FLAG_SECURE ولا مكتبة جديدة** (قرار مؤمن مستني) —
 * فاللقطة بتتاخد بعد ما الغطا يترسم ولا قبله دي حاجة بتتشاف على الجهاز بس.
 */
export function usePrivacyCover(lockEnabled: boolean): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!lockEnabled) { setCovered(false); return; }
    const sub = AppState.addEventListener('change', s => { setCovered(s !== 'active'); });
    return () => sub.remove();
  }, [lockEnabled]);
  return lockEnabled && covered;
}

/**
 * القفل **فوق** الشجرة مش بدلها (الميزة 11، بند 7). قبل كده `app/_layout.tsx` كان بيرجّع `<LockScreen />` مكان الـStack،
 * فكل حاجة تحت بتتشال: الرجوع من صفحة جوجل (Custom Tab) مع «كل مرة ترجع» كان بيشيل شاشة الدخول وردّ جوجل يضيع، ومسح الحساب
 * في نصه، وأي فورم ما اتحفظش. دلوقتي الشجرة فاضلة ومستخبية: مش بتتقري ومبتتداسش، والقفل في `Modal` عشان يغطّي كمان أي
 * شيت/مودال كان مفتوح (نافذة لوحده فوق الشاشة). زرار الرجوع وهو مقفول مبيعملش حاجة.
 */
export default function LockGate({ locked, covered, children }: { locked: boolean; covered: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  const hide = locked || covered;
  return (
    <>
      <View style={styles.fill} {...(hide ? HIDDEN : null)}>{children}</View>
      {/* الغطا المعتم **مع** القفل كمان (silent M2): الـModal نافذة لوحدها، ولحظة ما بيتقفل أو بيترسم الشجرة اللي تحت
          كانت بتبان في نفس النافذة. والقفل فوقه */}
      {hide ? (
        <View testID={PRIVACY_COVER_TEST_ID} style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.bg }]}
          {...(locked ? { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true } : { accessible: true, accessibilityLabel: 'نقطة' })}>
          <Text style={{ color: colors.accentText, fontSize: glyphSize.logo, fontWeight: '700' }}>نقطة</Text>
        </View>
      ) : null}
      {locked ? (
        <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => {}}>
          <LockScreen />
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { alignItems: 'center', justifyContent: 'center' },
});
