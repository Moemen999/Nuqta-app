/**
 * بند B (قرار مؤمن 2026-11-06): العمليات اللي مستندها بايظ — قسم في أول الأرشيف + ورقة "صلّح العملية".
 * القسم بيظهر **مهما كانت الفترة** (التاريخ نفسه ممكن يكون هو البايظ). التصليح مبلغ + تاريخ بس، ومن غير تسوية
 * (`brokenFixBlock` بيمنع المحفظة المؤرشفة)؛ والمسح عادي بـ`deleteTransaction` (العملية مكانتش محسوبة، فمفيش تسوية).
 * **الاتنين مستنيين `linkSourcesReady`** (money-reviewer): قبلها دفعة دين بايظة كانت هتبان "مش مربوطة" وتتصلّح لوحدها.
 */
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useConfirm } from '@/components/ConfirmProvider';
import { Money } from '@/components/Money';
import { Text, TextInput } from '@/components/AppText';
import { useData } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import {
  BROKEN_MARK, BROKEN_REASON_LABEL, BROKEN_SECTION_TITLE, FIX_BLOCK_TEXT, FIX_DATE_MISSING, FIX_DELETE, FIX_DELETE_CONFIRM_TITLE,
  FIX_DELETE_PLAIN_BODY, FIX_DELETED, FIX_INVALID_AMOUNT, FIX_PICK_DATE, FIX_SAVED, FIX_TITLE, FIX_WAITING, brokenFixBlock,
} from '@/lib/brokenDocs';
import { TYPE_LABELS, categoryLabelById } from '@/lib/finance';
import type { BrokenTransaction } from '@/lib/fromDoc';
import { storableAmount, transactionLinkKind } from '@/lib/linkedEdit';
import { MIN_TOUCH, font, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle } from '@/lib/tokens';
import { useMemo, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

export function BrokenTransactionsSection() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { money } = usePrivacy();
  const { brokenTransactions, wallets, categories } = useData();
  const [open, setOpen] = useState<BrokenTransaction | null>(null);
  if (brokenTransactions.length === 0) return null;
  const walletName = (id?: string) => wallets.find(w => w.id === id)?.name;
  return (
    <View testID="archive_broken_section" style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{BROKEN_SECTION_TITLE}</Text>
      {brokenTransactions.map(t => {
        const parts = [
          t.type ? TYPE_LABELS[t.type]?.label : undefined,
          t.categoryId ? categoryLabelById(categories, t.categoryId) : undefined,
          walletName(t.walletId),
          t.note,
        ].filter(Boolean) as string[];
        const reasons = t.reasons.map(r => BROKEN_REASON_LABEL[r]).join('، ');
        // الاسم بيغطي اللي جوه، فلازم يقول كل اللي بيفرّق صف عن صف: المبلغ (من قناع الخصوصية) والتاريخ (a11y-architect)
        const spoken = ['بيانات ناقصة', ...parts, reasons, t.date, t.amount !== undefined ? money(t.amount) : undefined].filter(Boolean).join('. ');
        return (
          <TouchableOpacity key={t.id} testID={`archive_broken_${t.id}`} accessibilityRole="button"
            accessibilityLabel={spoken} accessibilityHint={FIX_TITLE} style={styles.row} onPress={() => setOpen(t)}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle} numberOfLines={2}>{parts.join(' · ') || '—'}</Text>
              {t.amount !== undefined ? <Money value={t.amount} style={styles.rowAmount} /> : <Text style={styles.rowAmount}>—</Text>}
            </View>
            <Text style={styles.rowMark}>{BROKEN_MARK} — {reasons}</Text>
            {t.date ? <Text style={styles.rowDate}>{t.date}</Text> : null}
          </TouchableOpacity>
        );
      })}
      {open && <FixBrokenTransactionSheet t={open} onClose={() => setOpen(null)} />}
    </View>
  );
}

function FixBrokenTransactionSheet({ t, onClose }: { t: BrokenTransaction; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const confirm = useConfirm();
  const {
    wallets, debts, subscriptions, gamiyas, incomes, linkSourcesReady, updateTransaction, deleteTransaction, transactionLinkWarning,
  } = useData();
  const linkKind = transactionLinkKind(t.id, { debts, subscriptions, gamiyas, incomes });
  const block = brokenFixBlock(t, linkKind, wallets);
  const [amount, setAmount] = useState(t.amount !== undefined ? String(t.amount) : '');
  // التاريخ الناقص بيفضل فاضي لحد ما يتختار — "النهارده" من غير ما حد يقول كان هيتسجل ساكت (silent-failure-hunter)
  const [date, setDate] = useState(t.date ?? '');
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function fail(msg: string) {
    setError(msg);
    // بيتقال حتى لو نفس الرسالة اتكررت — نص مبيتغيّرش مبيتقريش تاني (a11y-architect)
    AccessibilityInfo.announceForAccessibility(msg);
  }
  function save() {
    if (!linkSourcesReady) return;
    const stored = storableAmount(Number(amount));
    if (stored === null) { fail(FIX_INVALID_AMOUNT); return; }
    if (!date) { fail(FIX_PICK_DATE); return; }
    // من غير تسوية: `brokenFixBlock` ضامن إن المحفظة (والوجهة) شغالة، والعملية مكانتش محسوبة قبل كده.
    // فشل الكتابة بيتعرض من `track` (رسالة "الكتابة ما وصلتش")
    void updateTransaction(t.id, { amount: stored, date });
    onClose();
    AccessibilityInfo.announceForAccessibility(FIX_SAVED);
  }
  function remove() {
    if (!linkSourcesReady || deleting) return;
    const body = transactionLinkWarning(t.id) ?? FIX_DELETE_PLAIN_BODY;
    confirm(FIX_DELETE_CONFIRM_TITLE, body, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: FIX_DELETE, style: 'destructive',
        onPress: () => {
          setDeleting(true);
          // فشل الكتابة بيتعرض من `track` جوه `deleteTransaction`
          void deleteTransaction(t.id);
          onClose();
          AccessibilityInfo.announceForAccessibility(FIX_DELETED);
        },
      },
    ]);
  }

  const waiting = !linkSourcesReady;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
        <View style={styles.overlay}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              <Text style={styles.sheetTitle} accessibilityRole="header">{FIX_TITLE}</Text>
              <Text style={styles.reasons}>{t.reasons.map(r => BROKEN_REASON_LABEL[r]).join('، ')}</Text>
              {waiting ? (
                <Text testID="broken_fix_waiting" style={styles.blocked}>{FIX_WAITING}</Text>
              ) : block ? (
                <Text testID="broken_fix_blocked" style={styles.blocked}>{FIX_BLOCK_TEXT[block]}</Text>
              ) : (
                <>
                  <Text style={styles.label} accessible={false}>المبلغ</Text>
                  <TextInput testID="broken_fix_amount" style={styles.input} value={amount}
                    onChangeText={v => { setAmount(v); setError(null); }} keyboardType="numeric" textAlign="right"
                    placeholder="0" placeholderTextColor={colors.textSecondary} accessibilityLabel="المبلغ" />
                  <Text style={styles.label} accessible={false}>التاريخ</Text>
                  <TouchableOpacity testID="broken_fix_date" accessibilityRole="button"
                    accessibilityLabel={date ? `التاريخ ${date}` : `التاريخ. ${FIX_DATE_MISSING}`} accessibilityHint="بيفتح التقويم"
                    style={styles.input} onPress={() => setPicker(true)}>
                    <Text style={[styles.inputText, !date && { color: colors.textSecondary }]}>{date || FIX_DATE_MISSING}</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
            {error ? <Text testID="broken_fix_error" style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <View style={styles.footer}>
              <TouchableOpacity testID="broken_fix_cancel" accessibilityRole="button" style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="broken_fix_delete" accessibilityRole="button" disabled={waiting || deleting}
                accessibilityState={{ disabled: waiting || deleting, busy: deleting }}
                style={[styles.deleteBtn, (waiting || deleting) && styles.btnBusy]} onPress={remove}>
                <Text style={styles.deleteText}>{FIX_DELETE}</Text>
              </TouchableOpacity>
              {!block && !waiting && (
                <TouchableOpacity testID="broken_fix_save" accessibilityRole="button" style={styles.saveBtn} onPress={save}>
                  <Text style={styles.saveText}>حفظ</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      <CalendarPickerModal visible={picker} value={date} onSelect={d => { setDate(d); setError(null); }} onClose={() => setPicker(false)} />
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    section: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg },
    sectionTitle: { color: c.dangerText, fontSize: font.subtitle, fontWeight: '700', textAlign: 'right', marginBottom: space.xs },
    row: { minHeight: MIN_TOUCH, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: c.border },
    rowTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: space.sm },
    rowTitle: { flex: 1, color: c.text, fontSize: font.subtitle, textAlign: 'right' },
    rowAmount: { color: c.textSecondary, fontSize: font.subtitle },
    rowMark: { color: c.dangerText, fontSize: font.label, textAlign: 'right', marginTop: space.xxs / 2 },
    rowDate: { color: c.textSecondary, fontSize: font.label, textAlign: 'right' },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    body: { padding: space.xxxl },
    sheetTitle: sheetTitleStyle(c),
    reasons: { color: c.dangerText, fontSize: font.text, textAlign: 'right', marginBottom: space.lg },
    blocked: { color: c.textSecondary, fontSize: font.subtitle, textAlign: 'right', lineHeight: 22 },
    label: { color: c.textSecondary, fontSize: font.text, textAlign: 'right', marginTop: space.sm, marginBottom: space.xxs },
    input: {
      minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: space.lg,
      justifyContent: 'center', color: c.text, backgroundColor: c.surface2, fontSize: font.subtitle,
    },
    inputText: { color: c.text, textAlign: 'right', fontSize: font.subtitle },
    error: { color: c.dangerText, fontSize: font.text, textAlign: 'center', marginTop: space.sm, paddingHorizontal: space.xxxl },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    cancelText: { color: c.textSecondary },
    deleteBtn: { flex: 1, minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    deleteText: { color: c.dangerText, fontWeight: '700' },
    saveBtn: { flex: 2, minHeight: MIN_TOUCH, backgroundColor: c.accent, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    saveText: { color: c.onAccent, fontWeight: '700' },
    btnBusy: { opacity: 0.6 },
  });
}
