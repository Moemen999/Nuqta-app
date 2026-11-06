import { plainAmount } from '@/lib/money';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { Money } from '@/components/Money';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { AMOUNT_CHANGED_ALERT, PAY_OUTCOME_ALERT_GAMIYA, useData, type Gamiya } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { cascadeDeleteBlock, cascadeDeleteConfirm, gamiyaTransactionIds, gamiyasPhrase, linkedTransactions, selectableOptions } from '@/lib/archiving';
import { daysUntil, todayStr, walletHistoryName } from '@/lib/finance';
import { ENTRY_MESSAGES, LEGACY_VALUE_NOTE, gamiyaEntryProblem, parseEntryNumber, validReminderDays } from '@/lib/entryValidation';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import ChargeModePicker from '@/components/ChargeModePicker';
import type { ChargeMode } from '@/lib/autoCharge';
import { MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle, typeScale } from '@/lib/tokens';
import { BUSY_NOTICE, useBusy, useBusyKey } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import FoldedSection from '@/components/FoldedSection';
import { isGamiyaFinished, splitDone } from '@/lib/doneSections';

export default function GamiyaView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { gamiyas, wallets, transactions, loadErrors, figuresPending, deleteGamiya, markGamiyaMonthDone } = useData();
  const notice = useNotice();
  // دوسة اتسقطت عشان عملية تانية شغالة ← بتتقال (مش بتختفي)
  const onBusy = () => notice(BUSY_NOTICE.title, BUSY_NOTICE.body);
  const confirm = useConfirm();
  const { busyKey, run: runBusy } = useBusyKey(onBusy);
  const [showAdd, setShowAdd] = useState(false);
  const [editingGamiya, setEditingGamiya] = useState<Gamiya | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  /** نفس فحص الدين: شهر متسدد من محفظة مؤرشفة ← ممنوع قبل التأكيد */
  function confirmDelete(g: Gamiya) {
    const txIds = gamiyaTransactionIds(g);
    const blocked = cascadeDeleteBlock({ kind: 'gamiya', name: g.name, txIds, transactions, wallets, loadErrors, loading: figuresPending });
    if (blocked) { notice(blocked.title, blocked.body); return; }
    // الشهور المتسددة والاستلام بيتمسحوا معاها والرصيد بيتحرك — التأكيد لازم يقول كده
    const { title, body } = cascadeDeleteConfirm('gamiya', g.name, linkedTransactions(txIds, transactions).length);
    confirm(title, body, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: () => runBusy(`del_${g.id}`, async () => {
          const result = await deleteGamiya(g.id);
          if (result.outcome === 'blocked') notice(result.title, result.body);
        }),
      },
    ]);
  }
  function confirmMark(g: Gamiya, monthId: string, isPayout: boolean, amount: number) {
    confirm(
      isPayout ? 'استلام الجمعية' : 'تسجيل القسط',
      isPayout ? `هتستلم ${plainAmount(amount)} ج.م في محفظتك؟` : `هيتخصم ${plainAmount(amount)} ج.م من محفظتك؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تأكيد',
          onPress: () => runBusy(`month_${monthId}`, async () => {
            // المبلغ اللي في جملة التأكيد بالظبط — لو اتعدّل من جهاز تاني والتأكيد مفتوح، الذرة بترفض
            const outcome = await markGamiyaMonthDone(g.id, monthId, amount);
            if (outcome === 'amount-changed') {
              notice(AMOUNT_CHANGED_ALERT.gamiya.title, AMOUNT_CHANGED_ALERT.gamiya.body);
            } else if (outcome !== 'done') {
              const m = PAY_OUTCOME_ALERT_GAMIYA[outcome];
              notice(m.title, m.body);
            }
          }),
        },
      ],
      // نفس النص لشهرين بنفس القسط — المفتاح هو الشهر (money-reviewer)
      { key: `month_${g.id}_${monthId}` },
    );
  }

  // قسم "جمعيات خلصت" المطوي (2026-11-02): محسوب، ومسح قسط بيرجّعها للنشطة لوحدها
  const { active: activeGamiyas, done: finishedGamiyas } = splitDone(gamiyas, isGamiyaFinished);

  function renderGamiya(g: Gamiya) {
    const walletLabel = walletHistoryName(wallets, g.walletId);
    const doneCount = g.months.filter(m => m.status === 'done').length;
    const pct = g.months.length > 0 ? (doneCount / g.months.length) * 100 : 0;
    const nextPending = g.months.find(m => m.status === 'pending');
    const isExpanded = expanded === g.id;

    return (
      <View key={g.id} style={styles.card}>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: isExpanded }} onPress={() => setExpanded(isExpanded ? null : g.id)}>
          <View style={styles.cardHead}>
            <Text style={styles.name}>{g.name}</Text>
            <Text style={styles.sub2}>{walletLabel}</Text>
          </View>
          <Text style={styles.sub}>
            <Money value={g.monthlyAmount} />/شهر · شهر الاستلام: {g.payoutMonthIndex} من {g.totalMonths} (<Money value={g.payoutAmount} />)
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accentText }]} />
          </View>
          <Text style={styles.progressText}>اتسدد {doneCount} من {g.months.length} شهر</Text>
          {nextPending && (
            <Text style={[styles.due, { color: daysUntil(nextPending.dueDate) <= g.reminderDaysBefore ? colors.accentText : colors.textSecondary }]}>
              {/* القرب بالكلمة كمان، مش باللون بس (visual-identity-reviewer) */}
              {daysUntil(nextPending.dueDate) <= g.reminderDaysBefore ? 'قرّب — ' : ''}{nextPending.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} الجاي: {nextPending.dueDate} (<Money value={nextPending.amount} />)
            </Text>
          )}
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedArea}>
            {g.months.map(m => (
              <View key={m.id} style={styles.monthRow}>
                <Text style={[styles.monthText, { color: m.status === 'done' ? colors.textMuted : colors.text }]}>
                  شهر {m.monthIndex} {m.isPayoutMonth ? '(استلام)' : ''} · {m.dueDate} · <Money value={m.amount} />
                </Text>
                {m.status === 'pending' ? (
                  <TouchableOpacity accessibilityRole="button"
                    onPress={() => confirmMark(g, m.id, m.isPayoutMonth, m.amount)}
                    style={[styles.markBtn, busyKey === `month_${m.id}` && styles.btnBusy]}
                    disabled={busyKey === `month_${m.id}`}>
                    {busyKey === `month_${m.id}` ? (
                      // الزرار ده صغير، فالدايرة اللي بتلف لوحدها أوضح من كلمة
                      <ActivityIndicator size="small" color={colors.onAccent} />
                    ) : (
                      <Text style={{ color: colors.onAccent, fontSize: typeScale.caption, fontWeight: '700' }}>
                        {m.isPayoutMonth ? 'استلمت' : 'اتخصم'}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <Text style={{ color: colors.incomeText, fontSize: typeScale.caption }}>✓ خلص</Text>
                )}
              </View>
            ))}
            <View style={styles.gamiyaActions}>
              <TouchableOpacity accessibilityRole="button" style={styles.editBtn} onPress={() => setEditingGamiya(g)}>
                <Text style={{ color: colors.text, fontSize: typeScale.body }}>تعديل</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.deleteBtnFlex, busyKey === `del_${g.id}` && styles.btnBusy]} onPress={() => confirmDelete(g)} disabled={busyKey === `del_${g.id}`}>
                <Text style={{ color: colors.dangerText, fontSize: typeScale.body }}>{busyKey === `del_${g.id}` ? '...' : 'حذف الجمعية'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scrollArea}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <View style={styles.titleRow}>
        <TouchableOpacity accessibilityRole="button" testID="gamiya_add_button" style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13 }}>+ جمعية جديدة</Text>
        </TouchableOpacity>
        <Text style={styles.title}>الجمعية</Text>
      </View>

      {gamiyas.length === 0 && <Text style={styles.emptyState}>مفيش جمعية مسجلة</Text>}
      {activeGamiyas.map(renderGamiya)}
      <FoldedSection testID="gamiyas_finished" title="جمعيات خلصت" a11yLabel={`جمعيات خلصت، ${gamiyasPhrase(finishedGamiyas.length)}`} count={finishedGamiyas.length}>
        {finishedGamiyas.map(renderGamiya)}
      </FoldedSection>

      <AddGamiyaModal visible={showAdd} onClose={() => setShowAdd(false)} />
      {editingGamiya && <EditGamiyaModal gamiya={editingGamiya} onClose={() => setEditingGamiya(null)} />}
    </ScrollView>
  );
}

function AddGamiyaModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, addGamiya } = useData();
  const { busy, run: runBusy } = useBusy();

  const [name, setName] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [totalMonths, setTotalMonths] = useState('12');
  const [payoutMonthIndex, setPayoutMonthIndex] = useState('1');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [walletId, setWalletId] = useState(selectableOptions(wallets)[0]?.id);
  const [startDate, setStartDate] = useState(todayStr());
  const [reminderDays, setReminderDays] = useState('3');
  const [chargeMode, setChargeMode] = useState<ChargeMode>('confirm');
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setName(''); setMonthlyAmount(''); setTotalMonths('12'); setPayoutMonthIndex('1');
    setPayoutAmount(''); setStartDate(todayStr()); setReminderDays('3'); setError(''); setChargeMode('confirm');
  }

  async function handleSave() {
    // D-B: كانت بتقول "شهر الاستلام" والمشكلة اسم أو محفظة — نفس رسالة تعديل الجمعية
    if (!name.trim() || !walletId) { setError('دخّل اسم ومحفظة صحيحين'); return; }
    // بند 15: كل قيمة غلط بتترفض برسالتها (نفس الفحص جوه DataContext) — المبالغ
    // Infinity، والشهور كسور أو برّه 1..60، والتذكير `Number(x) || 0` الساكت
    const data = {
      name: name.trim(), monthlyAmount: parseEntryNumber(monthlyAmount), totalMonths: parseEntryNumber(totalMonths),
      payoutMonthIndex: parseEntryNumber(payoutMonthIndex), payoutAmount: parseEntryNumber(payoutAmount), walletId, startDate,
      reminderDaysBefore: parseEntryNumber(reminderDays),
      chargeMode,
    };
    const problem = gamiyaEntryProblem(data);
    if (problem) { setError(problem.message); return; }
    await runBusy(async () => {
      try {
        const result = await addGamiya(data);
        if (result.outcome === 'invalid') { setError(result.message); return; }
      } catch {
        // مبيمسكش فشل الكتابة: الكتابة بتعدي من `track` اللي بيبلع الرفض
        // ويعرضه بنفسه مسمّى بالسجل (`lib/writeError.ts`) — والمودال بيكون
        // اتقفل خلاص قبل ما الرفض يوصل، فرسالة جوه الفورم مستحيلة أصلاً.
        // فاضل هنا للأخطاء المتزامنة جوه الـtry نفسه (تجهيز البيانات، التنقل).
        setError('حصل خطأ، جرب تاني');
        return;
      }
      reset();
      onClose();
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>جمعية جديدة</Text>

          <Text style={styles.label}>اسم الجمعية</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName}
            placeholder="مثلاً: جمعية الشغل" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>القسط الشهري</Text>
          <TextInput style={styles.bigInput} value={monthlyAmount} onChangeText={setMonthlyAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          <Text style={styles.label}>عدد الشهور الكلي</Text>
          <TextInput style={styles.input} value={totalMonths} onChangeText={setTotalMonths}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>هتستلم في الشهر رقم كام؟ (من 1 لـ {totalMonths || '؟'})</Text>
          <TextInput style={styles.input} value={payoutMonthIndex} onChangeText={setPayoutMonthIndex}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>مبلغ الاستلام</Text>
          <TextInput style={styles.input} value={payoutAmount} onChangeText={setPayoutAmount}
            placeholder="عادة = القسط × عدد الأعضاء" keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <TouchableOpacity {...selectionA11y(walletId === w.id)} key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{walletHistoryName(wallets, w.id)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>تاريخ أول قسط</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{startDate}</Text>
          </TouchableOpacity>

          <Text style={styles.label}>التذكير قبل كل قسط بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <ChargeModePicker value={chargeMode} onChange={setChargeMode} what="القسط" verb="اتدفع" testIDPrefix="gamiya" />
          {!!error && <Text style={styles.error}>{error}</Text>}


          <CalendarPickerModal visible={showPicker} value={startDate} onSelect={setStartDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity accessibilityRole="button" testID="gamiya_add_cancel" style={styles.cancelBtn} onPress={() => { reset(); onClose(); }}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="gamiya_add_save" style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scrollArea: { flex: 1 },
    content: { padding: 16, paddingBottom: 40 },
    titleRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    addBtn: { backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    // دراسة الشكل خطوة 3: نفس كارت الدين — من غير إطار، المقاسات من `typeScale`
    card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.md },
    cardHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    name: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    sub2: { color: c.textSecondary, fontSize: typeScale.caption },
    sub: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    track: { height: 6, backgroundColor: c.surface2, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3 },
    progressText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs },
    due: { fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs, fontWeight: '600' },
    expandedArea: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
    monthRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
    monthText: { fontSize: typeScale.caption, flex: 1, textAlign: 'right' },
    // كان ~28 طول — 44 للمس (دراسة الشكل)
    markBtn: { backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: space.lg, minHeight: MIN_TOUCH, minWidth: MIN_TOUCH + space.lg, alignItems: 'center', justifyContent: 'center' },
    deleteBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 8, alignItems: 'center', paddingVertical: 9, marginTop: 10 },
    gamiyaActions: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
    editBtn: { flex: 1, borderWidth: 1.5, borderColor: c.controlEdge, backgroundColor: c.surface2, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
    deleteBtnFlex: { flex: 1, borderWidth: 1.5, borderColor: c.danger, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { padding: 20 },
    sheetTitle: sheetTitleStyle(c, 10),
    hintNote: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', lineHeight: 17, marginBottom: 4 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.dangerText, fontSize: 13, textAlign: 'center', marginTop: 12 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.6 },
  });
}
function EditGamiyaModal({ gamiya, onClose }: { gamiya: Gamiya; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, updateGamiya } = useData();
  const { busy, run: runBusy } = useBusy();

  const [name, setName] = useState(gamiya.name);
  const [walletId, setWalletId] = useState(gamiya.walletId);
  const [reminderDays, setReminderDays] = useState(String(gamiya.reminderDaysBefore ?? 0));
  const [chargeMode, setChargeMode] = useState<ChargeMode>(gamiya.chargeMode ?? 'confirm');
  // C2: تذكير قديم برّه الحدود ← رسالته بتبان من أول ما التعديل يتفتح
  const [error, setError] = useState(() =>
    validReminderDays(gamiya.reminderDaysBefore ?? 0) ? '' : `${LEGACY_VALUE_NOTE} ${ENTRY_MESSAGES.reminderDays}`);

  const doneCount = gamiya.months.filter(m => m.status === 'done').length;

  async function handleSave() {
    if (!name.trim() || !walletId) { setError('دخّل اسم ومحفظة صحيحين'); return; }
    // `Number(x) || 0` كان بيحوّل الغلط لصفر ساكت ويقبل Infinity والسالب (بند 15)
    const reminderDaysBefore = parseEntryNumber(reminderDays);
    if (!validReminderDays(reminderDaysBefore)) { setError(ENTRY_MESSAGES.reminderDays); return; }
    await runBusy(async () => {
      try {
        const result = await updateGamiya(gamiya.id, { name: name.trim(), walletId, reminderDaysBefore, chargeMode });
        if (result.outcome === 'invalid') { setError(result.message); return; }
      } catch {
        // مبيمسكش فشل الكتابة: الكتابة بتعدي من `track` اللي بيبلع الرفض
        // ويعرضه بنفسه مسمّى بالسجل (`lib/writeError.ts`) — والمودال بيكون
        // اتقفل خلاص قبل ما الرفض يوصل، فرسالة جوه الفورم مستحيلة أصلاً.
        // فاضل هنا للأخطاء المتزامنة جوه الـtry نفسه (تجهيز البيانات، التنقل).
        setError('حصل خطأ، جرب تاني');
        return;
      }
      onClose();
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>تعديل جمعية</Text>
          <Text style={styles.hintNote}>
            المبالغ وعدد الشهور وشهر الاستلام مش بيتعدلوا هنا عشان الجدول اتبنى عليهم بالفعل
            {doneCount > 0 ? ` (واتسدد منهم ${doneCount} شهر)` : ''}. لو محتاج تغيّرهم، امسح الجمعية واعملها من جديد.
          </Text>

          <Text style={styles.label}>اسم الجمعية</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName}
            placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <TouchableOpacity {...selectionA11y(walletId === w.id)} key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{walletHistoryName(wallets, w.id)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>التذكير قبل كل قسط بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <ChargeModePicker value={chargeMode} onChange={setChargeMode} what="القسط" verb="اتدفع" testIDPrefix="gamiya" />
          {!!error && <Text style={styles.error}>{error}</Text>}

        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity accessibilityRole="button" testID="gamiya_edit_cancel" style={styles.cancelBtn} onPress={onClose}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="gamiya_edit_save" style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ التعديل'}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
