/**
 * بند B (قرار مؤمن 2026-11-06): العمليات اللي مستندها بايظ — قسم في أول الأرشيف + ورقة "صلّح العملية".
 * القسم بيظهر **مهما كانت الفترة** (التاريخ نفسه ممكن يكون هو البايظ). التصليح مبلغ + تاريخ بس، ومن غير تسوية
 * (`brokenFixBlock` بيمنع المحفظة المؤرشفة)؛ والمسح عادي بـ`deleteTransaction` (العملية مكانتش محسوبة، فمفيش تسوية).
 */
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useConfirm } from '@/components/ConfirmProvider';
import { useNotice } from '@/components/NoticeProvider';
import { Text, TextInput } from '@/components/AppText';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import {
  BROKEN_MARK, BROKEN_REASON_LABEL, BROKEN_SECTION_TITLE, FIX_BLOCK_TEXT, FIX_DELETE, FIX_DELETE_CONFIRM_TITLE,
  FIX_DELETE_PLAIN_BODY, FIX_INVALID_AMOUNT, FIX_TITLE, brokenFixBlock,
} from '@/lib/brokenDocs';
import { Money } from '@/components/Money';
import { TYPE_LABELS, categoryLabelById, todayStr } from '@/lib/finance';
import type { BrokenTransaction } from '@/lib/fromDoc';
import { storableAmount, transactionLinkKind } from '@/lib/linkedEdit';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

export function BrokenTransactionsSection() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        ].filter(Boolean);
        const reasons = t.reasons.map(r => BROKEN_REASON_LABEL[r]).join('، ');
        return (
          <TouchableOpacity key={t.id} testID={`archive_broken_${t.id}`} accessibilityRole="button"
            accessibilityLabel={`${BROKEN_MARK}. ${parts.join('، ')}. ${reasons}`}
            accessibilityHint={FIX_TITLE} style={styles.row} onPress={() => setOpen(t)}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle} numberOfLines={1}>{parts.join(' · ') || '—'}</Text>
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
  const notice = useNotice();
  const { wallets, debts, subscriptions, gamiyas, incomes, updateTransaction, deleteTransaction, transactionLinkWarning } = useData();
  const linkKind = transactionLinkKind(t.id, { debts, subscriptions, gamiyas, incomes });
  const block = brokenFixBlock(t, linkKind, wallets);
  const [amount, setAmount] = useState(t.amount !== undefined ? String(t.amount) : '');
  const [date, setDate] = useState(t.date ?? todayStr());
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save() {
    const stored = storableAmount(Number(amount));
    if (stored === null) { setError(FIX_INVALID_AMOUNT); return; }
    // من غير تسوية: `brokenFixBlock` ضامن إن المحفظة (والوجهة) شغالة، والعملية مكانتش محسوبة قبل كده
    void updateTransaction(t.id, { amount: stored, date });
    onClose();
  }
  function remove() {
    const body = transactionLinkWarning(t.id) ?? FIX_DELETE_PLAIN_BODY;
    confirm(FIX_DELETE_CONFIRM_TITLE, body, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: FIX_DELETE, style: 'destructive',
        onPress: () => {
          Promise.resolve().then(() => deleteTransaction(t.id)).then(onClose, () => {
            notice('ما اتمسحتش', 'حصلت مشكلة وإحنا بنمسح العملية. جرّب تاني.');
          });
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle} accessibilityRole="header">{FIX_TITLE}</Text>
              <Text style={styles.reasons}>{t.reasons.map(r => BROKEN_REASON_LABEL[r]).join('، ')}</Text>
              {block ? (
                <Text testID="broken_fix_blocked" style={styles.blocked}>{FIX_BLOCK_TEXT[block]}</Text>
              ) : (
                <>
                  <Text style={styles.label}>المبلغ</Text>
                  <TextInput testID="broken_fix_amount" style={styles.input} value={amount}
                    onChangeText={v => { setAmount(v); setError(null); }} keyboardType="numeric" textAlign="right"
                    placeholder="0" placeholderTextColor={colors.textSecondary} accessibilityLabel="المبلغ" />
                  <Text style={styles.label}>التاريخ</Text>
                  <TouchableOpacity testID="broken_fix_date" accessibilityRole="button" accessibilityLabel={`التاريخ ${date}`}
                    style={styles.input} onPress={() => setPicker(true)}>
                    <Text style={styles.inputText}>{date}</Text>
                  </TouchableOpacity>
                  {error ? <Text testID="broken_fix_error" style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                </>
              )}
            </ScrollView>
            <View style={styles.footer}>
              {!block && (
                <TouchableOpacity testID="broken_fix_save" accessibilityRole="button" style={[styles.btn, styles.btnPrimary]} onPress={save}>
                  <Text style={styles.btnPrimaryText}>احفظ</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity testID="broken_fix_delete" accessibilityRole="button" style={[styles.btn, styles.btnDanger]} onPress={remove}>
                <Text style={styles.btnDangerText}>{FIX_DELETE}</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="broken_fix_cancel" accessibilityRole="button" style={styles.btn} onPress={onClose}>
                <Text style={styles.btnText}>إلغاء</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      <CalendarPickerModal visible={picker} value={date} onSelect={setDate} onClose={() => setPicker(false)} />
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    section: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 12, padding: 12, marginBottom: 12 },
    sectionTitle: { color: c.dangerText, fontSize: 14, fontWeight: '700', textAlign: 'right', marginBottom: 6 },
    row: { minHeight: MIN_TOUCH, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
    rowTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 8 },
    rowTitle: { flex: 1, color: c.text, fontSize: 14, textAlign: 'right' },
    rowAmount: { color: c.textSecondary, fontSize: 14 },
    rowMark: { color: c.dangerText, fontSize: 12, textAlign: 'right', marginTop: 2 },
    rowDate: { color: c.textMuted, fontSize: 12, textAlign: 'right' },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), paddingBottom: 0, paddingHorizontal: 0 },
    sheetTitle: { ...sheetTitleStyle(c), paddingHorizontal: 24 },
    reasons: { color: c.dangerText, fontSize: 13, textAlign: 'right', paddingHorizontal: 24, marginBottom: 12 },
    blocked: { color: c.textSecondary, fontSize: 14, textAlign: 'right', paddingHorizontal: 24, lineHeight: 22 },
    label: { color: c.textSecondary, fontSize: 13, textAlign: 'right', paddingHorizontal: 24, marginTop: 8, marginBottom: 4 },
    input: { marginHorizontal: 24, minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center', color: c.text, backgroundColor: c.surface2 },
    inputText: { color: c.text, textAlign: 'right' },
    error: { color: c.dangerText, fontSize: 13, textAlign: 'right', paddingHorizontal: 24, marginTop: 8 },
    footer: stickyFooterStyle(c, c.nav),
    btn: { flex: 1, minHeight: MIN_TOUCH, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 },
    btnText: { color: c.text },
    btnPrimary: { backgroundColor: c.accent },
    btnPrimaryText: { color: c.onAccent, fontWeight: '700' },
    btnDanger: { borderWidth: 1, borderColor: c.dangerBorder, backgroundColor: c.surface },
    btnDangerText: { color: c.dangerText, fontWeight: '700' },
  });
}
