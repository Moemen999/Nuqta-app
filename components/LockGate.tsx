import LockScreen from '@/components/LockScreen';
import { Text } from '@/components/AppText';
import { useTheme } from '@/context/ThemeContext';
import { glyphSize } from '@/lib/tokens';
import type { ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

export const PRIVACY_COVER_TEST_ID = 'privacy_cover';

/** اللي تحت القفل: مش بيتقري (قارئ الشاشة) ومبيتداسش */
const HIDDEN = {
  importantForAccessibility: 'no-hide-descendants' as const,
  accessibilityElementsHidden: true,
  pointerEvents: 'none' as const,
};

/*
 * غطا الخصوصية في الخلفية (`usePrivacyCover`) اتشال 2026-11-20 — اتجرّب على الـSamsung (1.0.0.036) والأرصدة كانت باينة في قايمة
 * التطبيقات: أندرويد بياخد اللقطة قبل ما الـJS يرسم الغطا، فمبيشتغلش. قرار مؤمن: «نسيبها» (من غير FLAG_SECURE).
 */

/**
 * القفل **فوق** الشجرة مش بدلها (الميزة 11، بند 7). قبل كده `app/_layout.tsx` كان بيرجّع `<LockScreen />` مكان الـStack،
 * فكل حاجة تحت بتتشال: الرجوع من صفحة جوجل (Custom Tab) مع «كل مرة ترجع» كان بيشيل شاشة الدخول وردّ جوجل يضيع، ومسح الحساب
 * في نصه، وأي فورم ما اتحفظش. دلوقتي الشجرة فاضلة ومستخبية: مش بتتقري ومبتتداسش، والقفل في `Modal` عشان يغطّي كمان أي
 * شيت/مودال كان مفتوح (نافذة لوحده فوق الشاشة). زرار الرجوع وهو مقفول مبيعملش حاجة.
 */
export default function LockGate({ locked, children }: { locked: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  const hide = locked;
  return (
    <>
      <View style={styles.fill} {...(hide ? HIDDEN : null)}>{children}</View>
      {/* الغطا المعتم **مع** القفل كمان (silent M2): الـModal نافذة لوحدها، ولحظة ما بيتقفل أو بيترسم الشجرة اللي تحت
          كانت بتبان في نفس النافذة. والقفل فوقه */}
      {hide ? (
        <View testID={PRIVACY_COVER_TEST_ID} style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.bg }]}
          importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
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
