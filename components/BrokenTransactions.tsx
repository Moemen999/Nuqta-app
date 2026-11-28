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
import { txDeleteOutcomeAlert, useData } from '@/context/DataContext';
import { useNotice } from '@/components/NoticeProvider';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import { dueNotRestoredNotice } from '@/lib/reopenDue';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import {
  BROKEN_MARK, BROKEN_NO_DETAILS, BROKEN_REASON_LABEL, BROKEN_SECTION_TITLE, FIX_BLOCK_TEXT, FIX_DATE_MISSING, FIX_DELETE, FIX_DELETE_CONFIRM_TITLE,
  FIX_DELETE_FAILED, FIX_DELETE_FAILED_BODY, FIX_DELETE_FAILED_TITLE, FIX_DELETE_PLAIN_BODY, FIX_DELETED, FIX_INVALID_AMOUNT, FIX_LOAD_FAILED, FIX_RETRY,
  FIX_PICK_DATE, FIX_SAVED, FIX_SAVE_FAILED, FIX_SAVE_FAILED_BODY, FIX_SAVE_FAILED_TITLE, FIX_TITLE, FIX_WAITING, brokenFixBlock,
} from '@/lib/brokenDocs';
import { dateText, dayText } from '@/lib/dateText';
import { TYPE_LABELS, categoryLabelById, todayStr } from '@/lib/finance';
import type { BrokenTransaction } from '@/lib/fromDoc';
import { storableAmount, transactionLinkKind } from '@/lib/linkedEdit';
import { MIN_TOUCH, font, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle, leading } from '@/lib/tokens';
import { announceAfterLeave } from '@/lib/announceLater';
import { useFormError } from '@/lib/useFormError';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { PressableScale } from '@/components/PressableScale';

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
        const spoken = ['بيانات ناقصة', ...parts, reasons, dayText(t.date ?? '', todayStr()), t.amount !== undefined ? money(t.amount) : undefined].filter(Boolean).join('. ');
        return (
          <PressableScale key={t.id} testID={`archive_broken_${t.id}`} accessibilityRole="button"
            accessibilityLabel={spoken} accessibilityHint={FIX_TITLE} style={styles.row} onPress={() => setOpen(t)}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle} numberOfLines={2}>{parts.join(' · ') || BROKEN_NO_DETAILS}</Text>
              {t.amount !== undefined ? <Money value={t.amount} style={styles.rowAmount} /> : <Text style={styles.rowAmount}>—</Text>}
            </View>
            <Text style={styles.rowMark}>{BROKEN_MARK} — {reasons}</Text>
            {t.date ? <Text style={styles.rowDate}>{dayText(t.date, todayStr())}</Text> : null}
          </PressableScale>
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
  const {
    wallets, debts, subscriptions, gamiyas, incomes, linkSourcesReady, loadErrors, retryLoad, updateTransaction, deleteTransaction, transactionLinkWarning,
  } = useData();
  const linkKind = transactionLinkKind(t.id, { debts, subscriptions, gamiyas, incomes }, t);
  const block = brokenFixBlock(t, linkKind, wallets);
  const [amount, setAmount] = useState(t.amount !== undefined ? String(t.amount) : '');
  // التاريخ الناقص بيفضل فاضي لحد ما يتختار — "النهارده" من غير ما حد يقول كان هيتسجل ساكت (silent-failure-hunter)
  const [date, setDate] = useState(t.date ?? '');
  const [picker, setPicker] = useState(false);
  // بيتقال حتى لو نفس الرسالة اتكررت، والسطر متركّب دايمًا (الجولة 2، بند 3 — `useFormError`)
  const { error, setError, errorA11y } = useFormError();
  const [deleting, setDeleting] = useState(false);
  // الورقة ممكن تتقفل («إلغاء»/رجوع) والحفظ أو المسح لسه شغال (الجولة 2، بند 7): الفشل وقتها رسالة التطبيق، والنجاح
  // من غير إعلان على ورقة مش موجودة
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function fail(msg: string, title: string, body: string) {
    if (mounted.current) setError(msg);
    else notice(title, body);
  }
  const [saving, setSaving] = useState(false);
  function save() {
    if (!linkSourcesReady || saving) return;
    const stored = storableAmount(Number(amount));
    if (stored === null) { setError(FIX_INVALID_AMOUNT); return; }
    if (!date) { setError(FIX_PICK_DATE); return; }
    // من غير تسوية: `brokenFixBlock` ضامن إن المحفظة (والوجهة) شغالة، والعملية مكانتش محسوبة قبل كده.
    // فشل الكتابة بيتعرض من `track` (رسالة "الكتابة ما وصلتش"). التجهيز نفسه ممكن يرمي (الطابور، بيانات مش صالحة) —
    // قبل كده `void` والورقة بتتقفل و«اتحفظت» بتتقال والتعديل ما اتكتبش (الميزة 8، L)
    setSaving(true);
    // مفيش سقف زمني: `updateTransaction` بيرجع بعد الكتابة المحلية والطابور (تخزين على الموبايل)، مش بعد السيرفر
    Promise.resolve().then(() => updateTransaction(t.id, { amount: stored, date })).then(() => {
      if (!mounted.current) return;
      onClose();
      announceAfterLeave(FIX_SAVED);
    }, e => {
      if (mounted.current) setSaving(false);
      reportAtomicFailure('حفظ العملية', e);
      fail(FIX_SAVE_FAILED, FIX_SAVE_FAILED_TITLE, FIX_SAVE_FAILED_BODY);
    });
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
          // العادي: batch وفشل الكتابة بيتعرض من `track` جوه `deleteTransaction`. عملية دفعة/زيادة دين بقت ذرة من
          // السيرفر بنتيجة (الجولة 2، بند 1) ← مش `done` = الورقة مفتوحة والرسالة بتقول، مش «اتمسحت» وهي لسه موجودة
          deleteTransaction(t.id).then(result => {
            if (result.outcome !== 'done') {
              if (mounted.current) setDeleting(false);
              const alert = txDeleteOutcomeAlert(result.outcome, result.subject);
              notice(alert.title, alert.body);
              return;
            }
            if (result.dueNotRestored) {
              const n = dueNotRestoredNotice(result.dueNotRestored);
              notice(n.title, n.body);
            }
            if (!mounted.current) return;
            onClose();
            announceAfterLeave(FIX_DELETED);
          }, e => {
            if (mounted.current) setDeleting(false);
            reportAtomicFailure('حذف العملية', e);
            fail(FIX_DELETE_FAILED, FIX_DELETE_FAILED_TITLE, FIX_DELETE_FAILED_BODY);
          });
        },
      },
    ]);
  }

  const waiting = !linkSourcesReady;
  // "استنى" بس لو لسه بيحمّل — لو الـlistener وقع مفيش حاجة هتيجي لوحدها (silent-failure-hunter جولة 2)
  const loadFailed = waiting && loadErrors.some(n => ['transactions', 'debts', 'subscriptions', 'gamiyas', 'incomes'].includes(n));
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
        <View style={styles.overlay}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              <Text style={styles.sheetTitle} accessibilityRole="header">{FIX_TITLE}</Text>
              <Text style={styles.reasons}>{t.reasons.map(r => BROKEN_REASON_LABEL[r]).join('، ')}</Text>
              {loadFailed ? (
                <>
                  <Text testID="broken_fix_load_failed" style={styles.blocked}>{FIX_LOAD_FAILED}</Text>
                  <PressableScale testID="broken_fix_retry" accessibilityRole="button" style={styles.retryBtn} onPress={retryLoad}>
                    <Text style={styles.retryText}>{FIX_RETRY}</Text>
                  </PressableScale>
                </>
              ) : waiting ? (
                <Text testID="broken_fix_waiting" style={styles.blocked}>{FIX_WAITING}</Text>
              ) : block ? (
                <Text testID="broken_fix_blocked" style={styles.blocked}>{FIX_BLOCK_TEXT[block]}</Text>
              ) : (
                <>
                  <Text style={styles.label} accessible={false}>المبلغ</Text>
                  <TextInput testID="broken_fix_amount" style={styles.input} value={amount}
                    onChangeText={v => { setAmount(v); setError(''); }} keyboardType="numeric" textAlign="right"
                    placeholder="0" placeholderTextColor={colors.textSecondary} accessibilityLabel="المبلغ" />
                  <Text style={styles.label} accessible={false}>التاريخ</Text>
                  <PressableScale testID="broken_fix_date" accessibilityRole="button"
                    accessibilityLabel={date ? `التاريخ ${dateText(date, todayStr())}` : FIX_DATE_MISSING} accessibilityHint="بيفتح التقويم"
                    style={styles.input} onPress={() => setPicker(true)}>
                    <Text style={[styles.inputText, !date && { color: colors.textSecondary }]}>{date ? dateText(date, todayStr()) : FIX_DATE_MISSING}</Text>
                  </PressableScale>
                </>
              )}
            </ScrollView>
            {/* متركّب دايمًا وفاضي من غير خطأ — المنطقة الحية على أندرويد بتتقري (الجولة 2، بند 3) */}
            <Text testID="broken_fix_error" style={error ? styles.error : styles.errorEmpty} {...errorA11y}>{error}</Text>
            <View style={styles.footer}>
              <Button variant="secondary" testID="broken_fix_cancel" label="إلغاء" style={styles.cancelBtn} onPress={onClose} />
              <Button variant="danger" testID="broken_fix_delete" label={FIX_DELETE} style={styles.deleteBtn}
                disabled={waiting || saving} busy={deleting} onPress={remove} />
              {!block && !waiting && (
                <Button testID="broken_fix_save" label="حفظ" style={styles.saveBtn} onPress={save} busy={saving} disabled={deleting} />
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      <CalendarPickerModal visible={picker} value={date} onSelect={d => { setDate(d); setError(''); }} onClose={() => setPicker(false)} />
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
    blocked: { color: c.textSecondary, fontSize: font.subtitle, textAlign: 'right', lineHeight: leading.body },
    label: { color: c.textSecondary, fontSize: font.text, textAlign: 'right', marginTop: space.sm, marginBottom: space.xxs },
    input: {
      minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: space.lg,
      justifyContent: 'center', color: c.text, backgroundColor: c.surface2, fontSize: font.subtitle,
    },
    inputText: { color: c.text, textAlign: 'right', fontSize: font.subtitle },
    error: { color: c.dangerText, fontSize: font.text, textAlign: 'center', marginTop: space.sm, paddingHorizontal: space.xxxl },
    errorEmpty: { height: 0, margin: 0, padding: 0 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    deleteBtn: { flex: 1 },
    saveBtn: { flex: 2 },
    retryBtn: { alignSelf: 'flex-end', minHeight: MIN_TOUCH, justifyContent: 'center', marginTop: space.sm },
    retryText: { color: c.accentText, fontWeight: '700', textDecorationLine: 'underline' },
  });
}
