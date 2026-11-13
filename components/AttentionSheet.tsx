import DismissButton from '@/components/DismissButton';
import { TransfersFailedNote } from '@/components/SpendStatus';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { ATTENTION_LINE_HINT, attentionSummaryPhrase } from '@/lib/attentionSummary';
import { DISMISSED_ANNOUNCEMENT, DISMISS_HINT, dismissLabel } from '@/lib/bannerDismiss';
import { visibleAttention, type AttentionItem } from '@/lib/homeAttention';
import { MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle, typeScale } from '@/lib/tokens';
import {
  VERIFY_RESEND_LABEL, VERIFY_SENT_TEXT, VERIFY_SPAM_HINT, type EmailVerification,
} from '@/lib/useEmailVerification';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

/**
 * «حاجات محتاجة انتباهك» في الرئيسية (2026-11-13، قرار مؤمن): الإيميل، «لسه ما سجلتش»، رصيد قرب يخلص،
 * ميزانية فئة، اشتراك وقسط جمعية جايين — كانت 6 بانرات شبه بعض، ودلوقتي **سطر واحد** بيفتح شيت.
 * اللي مش هنا عن قصد (زي `PendingSheet`): بانرات «الأرقام ممكن تكون غلط» و«ما سجلناش» — مكانها الرئيسية.
 *
 * - عنصر واحد (غير الإيميل) ← السطر بيعرض نصه هو نفسه، بـ✕ بتاعه، ودوسته بتروح وجهته من غير شيت.
 * - غير كده (اتنين أو أكتر، أو الإيميل لوحده) ← السطر العام «عندك N حاجات محتاجة انتباهك» وبيفتح الشيت.
 * - كل صف في الشيت: نفس نص البانر، نفس الـ✕ **بنفس نوعه ومفتاحه** (فأي ✕ قديم لسه ساري)، نفس وجهته.
 * - العدّاد = العناصر اللي مش مقفولة بس. لما يوصل صفر السطر بيختفي والشيت بيتقفل.
 */
/** testID السطر في مكان واحد: ممكن يبقى عنصر واحد بـ✕ أو السطر العام، ومش الاتنين مع بعض */
const LINE_TEST_ID = 'home_attention_line';

export default function AttentionSheet({ items, email, loadWindowPassed, transfersFailed }: {
  /** كل العناصر الموجودة حالتها دلوقتي (قبل الـ✕) — من `buildAttentionItems` */
  items: AttentionItem[];
  email: EmailVerification;
  /** مهلة التحميل بتاعة الرئيسية — الإعلان بعدها بس */
  loadWindowPassed: boolean;
  /** الديون/الجمعية فشلوا: الميزانية بتظهر وتحتها إن الرقم ممكن يكون زيادة */
  transfersFailed: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { hidden, dismiss } = useBannerDismiss();
  const [open, setOpen] = useState(false);

  const visible = visibleAttention(items, hidden);
  const count = visible.length;
  const phrase = attentionSummaryPhrase(count);
  const single = count === 1 && visible[0].kind !== 'verifyEmail' ? visible[0] : null;

  // آخر حاجة اتقفلت ← الشيت بيتقفل لوحده بدل ما يفضل فاضي (نفس `PendingSheet`)
  useEffect(() => {
    if (count === 0 && open) setOpen(false);
  }, [count, open]);

  // إعلان لقارئ الشاشة لما العدد **يزيد** بعد مهلة التحميل — مش في أول فتحة (نفس نمط `announced` في كروت الدخل).
  // قبل المهلة بنحدّث العدد من غير إعلان، فاللي كان موجود من أول الفتح مبيتقالش
  const lastCount = useRef(0);
  useEffect(() => {
    if (loadWindowPassed && count > lastCount.current && phrase) AccessibilityInfo.announceForAccessibility(phrase);
    lastCount.current = count;
  }, [count, loadWindowPassed, phrase]);

  if (!phrase) return null;

  const toneColor = (t: AttentionItem['tone']) => (t === 'danger' ? colors.dangerText : t === 'warn' ? colors.accentText : colors.textSecondary);
  const barColor = (t: AttentionItem['tone']) => (t === 'danger' ? colors.danger : t === 'warn' ? colors.accentText : 'transparent');

  const go = (route: NonNullable<AttentionItem['route']>) => {
    setOpen(false);
    router.push(route);
  };

  const dismissBtn = (it: AttentionItem, testID: string) => (
    <DismissButton testID={testID} onPress={() => dismiss(it.type, it.instance)} hint={DISMISS_HINT}
      label={dismissLabel(it.type, it.dismissName)} announce={DISMISSED_ANNOUNCEMENT} />
  );

  const budgetShown = visible.some(v => v.kind === 'budget');
  // الديون/الجمعية فشلوا: الميزانية بتظهر وتحتها إن الرقم ممكن يكون زيادة — تحت السطر (عنصر واحد) أو آخر الشيت
  const failedNote = <TransfersFailedNote testID="home_budget_transfers_failed" style={{ marginTop: 6 }} />;

  return (
    <>
      {/* الشيت مفتوح وفاضل عنصر واحد (بعد ✕): السطر الفردي مبيتعرضش ورا الشيت — الصف جوه الشيت هو اللي بيتعرض، من غير testID مكرر */}
      {single && open ? null : single ? (
        <>
          <View testID={LINE_TEST_ID} style={[styles.singleRow, { borderColor: barColor(single.tone) }]}>
            {/* الـ✕ أخ للجزء اللي بيتداس مش جوّاه: زرار جوه زرار قارئ الشاشة مبيوصلوش */}
            {single.route ? (
              <TouchableOpacity style={styles.flex} onPress={() => go(single.route!)} accessibilityRole="button"
                accessibilityLabel={single.label}>
                <Text style={[styles.lineText, { color: toneColor(single.tone) }]}>{single.text}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.flex} accessible accessibilityLabel={single.label}>
                <Text style={[styles.lineText, { color: toneColor(single.tone) }]}>{single.text}</Text>
              </View>
            )}
            {dismissBtn(single, `attention_dismiss_${single.id}`)}
          </View>
          {single.kind === 'budget' && transfersFailed && failedNote}
        </>
      ) : (
        <TouchableOpacity
          testID={LINE_TEST_ID}
          style={styles.line}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={phrase}
          accessibilityHint={ATTENTION_LINE_HINT}>
          <Text style={[styles.lineText, { color: colors.text, fontWeight: '700' }]}>{phrase}</Text>
          <Text style={styles.chevron} accessible={false}>‹</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View testID="attention_sheet" style={styles.sheet} accessibilityViewIsModal>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.content}>
              <Text style={styles.title} accessibilityRole="header">{phrase}</Text>
              {visible.map(it => (
                <View key={it.id} testID={`attention_row_${it.id}`} style={[styles.row, { borderColor: barColor(it.tone) }]}>
                  <View style={styles.rowMain}>
                    {it.route ? (
                      <TouchableOpacity style={styles.flex} onPress={() => go(it.route!)} accessibilityRole="button"
                        accessibilityLabel={it.label}>
                        <Text style={[styles.rowText, { color: toneColor(it.tone) }]}>{it.text}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.flex} accessible={it.kind !== 'verifyEmail'} accessibilityLabel={it.kind === 'verifyEmail' ? undefined : it.label}>
                        <Text style={[styles.rowText, { color: toneColor(it.tone) }]}>{it.text}</Text>
                      </View>
                    )}
                    {dismissBtn(it, `attention_dismiss_${it.id}`)}
                  </View>
                  {it.kind === 'verifyEmail' && (
                    <>
                      {email.sent && !email.error ? (
                        <Text style={styles.bodyText}>{VERIFY_SENT_TEXT}</Text>
                      ) : (
                        <TouchableOpacity testID="attention_verify_resend" accessibilityRole="button" onPress={email.resend}
                          disabled={email.busy} style={styles.action}>
                          <Text style={[styles.actionText, email.busy && { opacity: 0.6 }]}>
                            {email.busy ? '...' : VERIFY_RESEND_LABEL}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {/* بعد "بعتنالك رسالة جديدة" مش قبلها — النصيحة على آخر رسالة اتقال إنها اتبعتت */}
                      <Text testID="verify_spam_hint" style={styles.bodyText}>{VERIFY_SPAM_HINT}</Text>
                      {!!email.error && <Text style={[styles.bodyText, { color: colors.dangerText }]}>{email.error}</Text>}
                    </>
                  )}
                </View>
              ))}
              {/* بتمشي مع صفوف الميزانية الظاهرة بس (لو اتقفلت كلها السطر بيختفي) */}
              {transfersFailed && budgetShown && failedNote}
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity testID="attention_sheet_close" style={styles.closeBtn}
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
    flex: { flex: 1, justifyContent: 'center', minHeight: MIN_TOUCH },
    // نفس شكل سطر «مستنيين ردك» (شريط على البداية بس) — بس بلون التحذير مش بلون الدعوة
    line: {
      flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      backgroundColor: c.surface, borderRadius: radius.lg, borderRightWidth: 3, borderColor: c.accentText,
      paddingHorizontal: 14, minHeight: MIN_TOUCH + 8, marginTop: space.md,
    },
    singleRow: {
      flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
      backgroundColor: c.surface, borderRadius: radius.lg, borderRightWidth: 3,
      paddingHorizontal: 14, minHeight: MIN_TOUCH + 8, marginTop: space.md,
    },
    lineText: { flex: 1, fontSize: typeScale.body, textAlign: 'right', lineHeight: 21 },
    chevron: { color: c.textSecondary, fontSize: 20 },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '85%' }), padding: 0, overflow: 'hidden' },
    content: { padding: 20 },
    title: sheetTitleStyle(c, 6),
    row: {
      backgroundColor: c.surface, borderRadius: radius.lg, borderRightWidth: 3,
      paddingHorizontal: 14, paddingVertical: space.sm, marginTop: space.md,
    },
    rowMain: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
    rowText: { fontSize: typeScale.body, textAlign: 'right', lineHeight: 21 },
    bodyText: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', lineHeight: 21 },
    action: { alignSelf: 'flex-end', marginTop: 6, minHeight: MIN_TOUCH, justifyContent: 'center' },
    actionText: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700', textDecorationLine: 'underline' },
    footer: stickyFooterStyle(c, c.nav),
    closeBtn: {
      flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH,
    },
    closeText: { color: c.text, fontSize: 14, fontWeight: '700' },
  });
}
