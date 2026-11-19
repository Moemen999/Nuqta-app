import ChargeHomeCards, { usePendingCharges } from '@/components/ChargeHomeCards';
import IncomeHomeCards, { usePendingIncomes } from '@/components/IncomeHomeCards';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { pendingSummaryPhrase } from '@/lib/pendingSummary';
import DismissButton from '@/components/DismissButton';
import { DISMISSED_ANNOUNCEMENT, DISMISS_HINT, dismissLabel } from '@/lib/bannerDismiss';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle, glyphSize, radius, space, typeScale } from '@/lib/tokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

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

const PENDING_ANNOUNCE_AFTER_MS = 2500;

export default function PendingSummary() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pendingIncomes = usePendingIncomes();
  const incomes = pendingIncomes.length;
  const charges = usePendingCharges();
  const subscriptions = charges.filter(p => p.kind === 'subscription').length;
  const gamiyas = charges.filter(p => p.kind === 'gamiya').length;
  const count = incomes + charges.length;
  const phrase = pendingSummaryPhrase(count);
  const [open, setOpen] = useState(false);
  const { hidden, dismiss } = useBannerDismiss();

  // آخر حاجة اتردّ عليها ← الشيت بيتقفل لوحده بدل ما يفضل فاضي
  useEffect(() => {
    if (count === 0 && open) setOpen(false);
  }, [count, open]);

  /**
   * المفتاح بالحاجات نفسها مش بالعدد (الميزة 7 — MEDIUM): السطر ده الطريق الوحيد للكروت، فحاجة جديدة مستنية رد
   * بترجّعه حتى لو اللي قبلها اتقفل — وبالعدد بس، الرد على حاجة ومجي غيرها بنفس العدد كان بيسيبه مقفول. نفس فكرة
   * مفاتيح الميزانية: الفترة جوه المفتاح، فدورة جديدة لنفس الاشتراك حاجة جديدة.
   */
  const dismissKey = useMemo(() => [
    ...pendingIncomes.map(x => `inc:${x.inc?.id}:${(x.keys ?? []).join('+')}`),
    ...charges.map(p => `${p.kind}:${p.id}:${(p.charges ?? []).map(c => c.key).join('+')}`),
  ].sort().join(','), [pendingIncomes, charges]);

  // العدد زاد بعد أول رسمة ← بيتقال لقارئ الشاشة (نفس نمط `AttentionSheet`): السطر بيظهر جوه التمرير ومحدش بيعدّي عليه.
  // أول رسمة مش بتتقال (موجود من الفتح)
  // وبعد مهلة تحميل الرئيسية (2.5 ثانية) بس: البيانات بتوصل في أول ثواني والعدد بيطلع من صفر — ده مش «جديد»
  const mountedAt = useRef(Date.now());
  const lastCount = useRef(0);
  useEffect(() => {
    if (Date.now() - mountedAt.current >= PENDING_ANNOUNCE_AFTER_MS && count > lastCount.current && phrase) {
      AccessibilityInfo.announceForAccessibility(phrase);
    }
    lastCount.current = count;
  }, [count, phrase]);

  if (!phrase || hidden('pending', dismissKey)) return null;

  return (
    <>
      <View testID="home_pending_row" style={styles.lineRow}>
      <TouchableOpacity
        testID="home_pending_summary"
        style={[styles.line, styles.lineFlex]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={phrase}
        accessibilityHint="بيفتح الحاجات المستنية">
        <Text style={styles.lineText}>{phrase}</Text>
        <Text style={styles.chevron} accessible={false}>‹</Text>
      </TouchableOpacity>
      <DismissButton testID="home_pending_dismiss" onPress={() => dismiss('pending', dismissKey)} hint={DISMISS_HINT}
        label={dismissLabel('pending')} announce={DISMISSED_ANNOUNCEMENT} />
      </View>

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
      // دراسة الشكل: من غير إطار حواليه — الشريط الدهبي على البداية بس (زي البانرات)
      backgroundColor: c.surface, borderRadius: radius.lg,
      borderRightWidth: 4, borderRightColor: c.accentText,
      paddingHorizontal: 14, minHeight: MIN_TOUCH + 8,
    },
    // الـ✕ جنب السطر مش جوّاه: زرار جوه زرار قارئ الشاشة بيدمجهم في عنصر واحد
    lineRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
    lineFlex: { flex: 1 },
    lineText: { flex: 1, color: c.text, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
    chevron: { color: c.textSecondary, fontSize: glyphSize.chevron },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '85%' }), padding: 0, overflow: 'hidden' },
    content: { padding: 20 },
    title: sheetTitleStyle(c, 6),
    group: { color: c.textSecondary, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right', marginTop: space.lg, marginBottom: space.sm },
    footer: stickyFooterStyle(c, c.nav),
    closeBtn: {
      flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH,
    },
    closeText: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
  });
}
