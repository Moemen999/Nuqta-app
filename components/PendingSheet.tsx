import ChargeHomeCards, { usePendingCharges } from '@/components/ChargeHomeCards';
import IncomeHomeCards, { usePendingIncomes } from '@/components/IncomeHomeCards';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { pendingSummaryPhrase } from '@/lib/pendingSummary';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/**
 * سطر "عندك … مستنيين ردك" في الرئيسية + الشيت اللي بيفتحه (2026-09-29).
 *
 * كروت "نزل؟" و"اتخصم؟" و"اتدفع؟"/"استلمت؟" كانت كل واحدة بتاخد حتة من
 * الرئيسية، ومع بعض زحموها وغطّوا الزرار "+". دلوقتي سطر واحد بعددهم، والكروت
 * نفسها (بنفس زرايرها) جوه الشيت متقسمة بالنوع.
 *
 * **اللي مش هنا عن قصد:** بانر "مقدرناش نجيب بياناتك" (listener اترفض) ورسايل
 * "ما سجلناش …" — دول بيقولوا إن رقم في الشاشة ممكن يكون غلط، ومكانهم الرئيسية
 * نفسها. تخبيتهم في شيت بتخلي المستخدم يقرا رصيد غلط وهو فاكره مظبوط.
 */

export default function PendingSummary() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const incomes = usePendingIncomes().length;
  const charges = usePendingCharges();
  const subscriptions = charges.filter(p => p.kind === 'subscription').length;
  const gamiyas = charges.filter(p => p.kind === 'gamiya').length;
  const count = incomes + charges.length;
  const phrase = pendingSummaryPhrase(count);
  const [open, setOpen] = useState(false);

  // آخر حاجة اتردّ عليها ← الشيت بيتقفل لوحده بدل ما يفضل فاضي
  useEffect(() => {
    if (count === 0 && open) setOpen(false);
  }, [count, open]);

  if (!phrase) return null;

  return (
    <>
      <TouchableOpacity
        testID="home_pending_summary"
        style={styles.line}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={phrase}
        accessibilityHint="بيفتح الحاجات المستنية">
        <Text style={styles.lineText}>{phrase}</Text>
        <Text style={styles.chevron} accessible={false}>‹</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View testID="pending_sheet" style={styles.sheet} accessibilityViewIsModal>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.content}>
              <Text style={styles.title} accessibilityRole="header">{phrase}</Text>
              {incomes > 0 && (
                <>
                  <Text style={styles.group} accessibilityRole="header">الدخل الثابت</Text>
                  <IncomeHomeCards />
                </>
              )}
              {subscriptions > 0 && (
                <>
                  <Text style={styles.group} accessibilityRole="header">الاشتراكات</Text>
                  <ChargeHomeCards kind="subscription" />
                </>
              )}
              {gamiyas > 0 && (
                <>
                  <Text style={styles.group} accessibilityRole="header">الجمعية</Text>
                  <ChargeHomeCards kind="gamiya" />
                </>
              )}
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity testID="pending_sheet_close" style={styles.closeBtn}
                onPress={() => setOpen(false)} accessibilityRole="button">
                <Text style={styles.closeText}>اقفل</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    // نفس شكل كروت "نزل؟" (خط دهبي على الجنب) — ده مكانهم دلوقتي
    line: {
      flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border,
      borderRightWidth: 4, borderRightColor: c.accent,
      paddingHorizontal: 14, minHeight: MIN_TOUCH + 8, marginTop: 10,
    },
    lineText: { flex: 1, color: c.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
    chevron: { color: c.textSecondary, fontSize: 20 },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '85%' }), padding: 0, overflow: 'hidden' },
    content: { padding: 20 },
    title: sheetTitleStyle(c, 6),
    group: { color: c.textSecondary, fontSize: 13, fontWeight: '700', textAlign: 'right', marginTop: 12, marginBottom: 8 },
    footer: stickyFooterStyle(c, c.nav),
    closeBtn: {
      flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH,
    },
    closeText: { color: c.text, fontSize: 14, fontWeight: '700' },
  });
}
