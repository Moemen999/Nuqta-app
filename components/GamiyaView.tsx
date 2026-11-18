import { Button } from '@/components/Button';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { Money } from '@/components/Money';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import {
  AMOUNT_CHANGED_ALERT, CHARGE_MISSING_ALERT, CHARGE_UNCERTAIN_ALERT, GAMIYA_ALREADY_RECORDED_ALERT, GAMIYA_BAD_AMOUNT_ALERT,
  PAY_OUTCOME_ALERT_GAMIYA, PAY_OUTCOME_ALERT_GAMIYA_PAYOUT, useData, type Gamiya,
} from '@/context/DataContext';
import { walletsNotReadyNotice } from '@/lib/listenerErrors';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { cascadeDeleteBlock, cascadeDeleteConfirm, gamiyaTransactionIds, gamiyasPhrase, linkedTransactions, selectableOptions } from '@/lib/archiving';
import { dateText } from '@/lib/dateText';
import { daysUntil, todayStr, walletHistoryName } from '@/lib/finance';
import { defaultWalletId } from '@/lib/defaultWallet';
import { useWalletDefault } from '@/lib/useWalletDefault';
import { ENTRY_MESSAGES, LEGACY_VALUE_NOTE, gamiyaEntryProblem, parseEntryNumber, validReminderDays } from '@/lib/entryValidation';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import ChargeModePicker from '@/components/ChargeModePicker';
import { gamiyaMarkConfirmBody, type ChargeMode } from '@/lib/autoCharge';
import { MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle, typeScale, bigAmountInputStyle } from '@/lib/tokens';
import { BUSY_NOTICE, useBusy, useBusyKey } from '@/lib/useBusy';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { EmptyHint } from '@/components/EmptyHint';
import FoldedSection from '@/components/FoldedSection';
import { isGamiyaFinished, splitDone } from '@/lib/doneSections';
import { NAME_MAX_LENGTH } from '@/lib/textLimits';

/** «متأخر —» لو المعاد فات، «قرّب —» لو جوّه مهلة التذكير، وإلا ولا حاجة */
export function gamiyaDueCue(days: number, reminderDaysBefore: number): string {
  return days < 0 ? 'متأخر — ' : days <= reminderDaysBefore ? 'قرّب — ' : '';
}

/** شهر الاستلام ما اتسجلش فيه "خصم" — الرسايل بتقول استلام (مراجعة 2026-11-18: مش المحفظة بس، كل نتايج الفشل) */
const payAlerts = (isPayout: boolean) => (isPayout ? PAY_OUTCOME_ALERT_GAMIYA_PAYOUT : PAY_OUTCOME_ALERT_GAMIYA);
const walletMissingAlert = (isPayout: boolean) => payAlerts(isPayout)['wallet-missing'];

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
    // نفس قايمة المسح (بند C): المربوطة في الشهور + المعرّف الثابت + أي عملية عليها gamiyaId — فالعدّ والحظر عن نفس العمليات
    const txIds = gamiyaTransactionIds(g, transactions);
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
  function confirmMark(g: Gamiya, monthId: string, isPayout: boolean, amount: number, dueDate: string, monthIndex: number) {
    // محفظة مؤرشفة أو ممسوحة ← الكتابة الذرية هترفض (wallet-missing)، فمنوعدش بخصم من غير ما نفتح التأكيد
    // المحافظ لسه ما وصلتش (أو الـlistener وقع) ← مش نحكم إن المحفظة مفقودة
    const notReady = walletsNotReadyNotice(loadErrors, figuresPending);
    if (notReady) { notice(notReady.title, notReady.body); return; }
    const wallet = wallets.find(w => w.id === g.walletId);
    if (!wallet || wallet.archived) {
      const m = walletMissingAlert(isPayout);
      notice(m.title, m.body);
      return;
    }
    confirm(
      isPayout ? 'استلام الجمعية' : 'تسجيل القسط',
      gamiyaMarkConfirmBody({ name: g.name, monthIndex, dueDate, amount, isPayout }, walletHistoryName(wallets, g.walletId), todayStr()),
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تأكيد',
          onPress: () => runBusy(`month_${monthId}`, async () => {
            // المبلغ اللي في جملة التأكيد بالظبط — لو اتعدّل من جهاز تاني والتأكيد مفتوح، الذرة بترفض
            const outcome = await markGamiyaMonthDone(g.id, monthId, amount);
            if (outcome === 'done') return;
            const m = outcome === 'amount-changed' ? AMOUNT_CHANGED_ALERT.gamiya
              : outcome === 'missing' ? CHARGE_MISSING_ALERT.gamiya
              : outcome === 'already-recorded' ? GAMIYA_ALREADY_RECORDED_ALERT
              : outcome === 'bad-amount' ? GAMIYA_BAD_AMOUNT_ALERT
              // ممكن يكون اتسجل — ممنوع "ما اتسجلش" (المستخدم كان هيعيد ويتسجل مرتين)
              : outcome === 'uncertain' ? CHARGE_UNCERTAIN_ALERT
              : payAlerts(isPayout)[outcome];
            notice(m.title, m.body);
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
            <Text style={[styles.due, { color: daysUntil(nextPending.dueDate) < 0 ? colors.dangerText : daysUntil(nextPending.dueDate) <= g.reminderDaysBefore ? colors.accentText : colors.textSecondary }]}>
              {/* القرب والتأخير بالكلمة كمان، مش باللون بس. المتأخر كان بيطلع «قرّب» (اتلقى على الجهاز 2026-11-06) */}
              {gamiyaDueCue(daysUntil(nextPending.dueDate), g.reminderDaysBefore)}{nextPending.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} الجاي: {dateText(nextPending.dueDate, todayStr())} (<Money value={nextPending.amount} />)
            </Text>
          )}
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedArea}>
            {g.months.map(m => (
              <View key={m.id} style={styles.monthRow}>
                <Text style={[styles.monthText, { color: m.status === 'done' ? colors.textMuted : colors.text }]}>
                  شهر {m.monthIndex} {m.isPayoutMonth ? '(استلام)' : ''} · {dateText(m.dueDate, todayStr())} · <Money value={m.amount} />
                </Text>
                {m.status === 'pending' ? (
                  <Button size="sm"
                    label={m.isPayoutMonth ? 'استلمت' : 'اتخصم'}
                    // الاسم فيه الشهر — كانت كل الأزرار «اتخصم» بس (اتلقى على الجهاز)
                    accessibilityLabel={`${m.isPayoutMonth ? 'استلمت' : 'اتخصم'} شهر ${m.monthIndex}`}
                    onPress={() => confirmMark(g, m.id, m.isPayoutMonth, m.amount, m.dueDate, m.monthIndex)}
                    busy={busyKey === `month_${m.id}`} />
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
        <Button testID="gamiya_add_button" label="+ جمعية جديدة" size="sm" onPress={() => setShowAdd(true)} />
        <Text style={styles.title}>الجمعية</Text>
      </View>

      {gamiyas.length === 0 && <EmptyHint testID="gamiya_empty" icon="people-outline" message="مفيش جمعية مسجلة" />}
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
  const { wallets, transactions, addGamiya } = useData();
  const { busy, run: runBusy } = useBusy();

  const [name, setName] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [totalMonths, setTotalMonths] = useState('12');
  const [payoutMonthIndex, setPayoutMonthIndex] = useState('1');
  const [payoutAmount, setPayoutAmount] = useState('');
  // المحفظة: آخر محفظة اتستخدمت، بتتبع البيانات لحد أول إدخال وبعدها بتتثبّت. والمودال ده متركّب طول
  // الوقت (`visible` بس بيتغيّر) فكل فتحة بتبدأ من الأول — مبنفضلش على اختيار الفتحة اللي فاتت،
  // اللي ممكن تكون اتأرشفت في الفاصل (ب4)
  const { walletId, pickWallet, freeze, reopen } = useWalletDefault(
    useMemo(() => defaultWalletId({ wallets, transactions, nowMs: Date.now() }), [wallets, transactions]),
  );
  useEffect(() => { if (visible) reopen(); }, [visible, reopen]);
  const [startDate, setStartDate] = useState(todayStr());
  const [reminderDays, setReminderDays] = useState('3');
  const [chargeMode, setChargeMode] = useState<ChargeMode>('confirm');
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    reopen();
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
        if (result.outcome !== 'done') { setError(result.message); return; }
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
          <TextInput maxLength={NAME_MAX_LENGTH} style={styles.input} value={name} onChangeText={v => { freeze(); setName(v); }}
            placeholder="مثلاً: جمعية الشغل" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>القسط الشهري</Text>
          <TextInput style={styles.bigInput} value={monthlyAmount} onChangeText={v => { freeze(); setMonthlyAmount(v); }}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          <Text style={styles.label}>عدد الشهور الكلي</Text>
          <TextInput style={styles.input} value={totalMonths} onChangeText={v => { freeze(); setTotalMonths(v); }}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>هتستلم في الشهر رقم كام؟ (من 1 لـ {totalMonths || '؟'})</Text>
          <TextInput style={styles.input} value={payoutMonthIndex} onChangeText={v => { freeze(); setPayoutMonthIndex(v); }}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>مبلغ الاستلام</Text>
          <TextInput style={styles.input} value={payoutAmount} onChangeText={v => { freeze(); setPayoutAmount(v); }}
            placeholder="عادة = القسط × عدد الأعضاء" keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <TouchableOpacity {...selectionA11y(walletId === w.id, 'radio')} key={w.id} onPress={() => pickWallet(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: typeScale.body }}>{walletHistoryName(wallets, w.id)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>تاريخ أول قسط</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{dateText(startDate, todayStr())}</Text>
          </TouchableOpacity>

          <Text style={styles.label}>التذكير قبل كل قسط بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={v => { freeze(); setReminderDays(v); }}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <ChargeModePicker value={chargeMode} onChange={m => { freeze(); setChargeMode(m); }} what="القسط" verb="اتدفع" testIDPrefix="gamiya" />
          {!!error && <Text style={styles.error}>{error}</Text>}


          <CalendarPickerModal visible={showPicker} value={startDate} onSelect={d => { freeze(); setStartDate(d); }} onClose={() => setShowPicker(false)} />
        </ScrollView>

        <View style={styles.footer}>
          <Button variant="secondary" testID="gamiya_add_cancel" label="إلغاء" style={styles.cancelBtn} onPress={() => { reset(); onClose(); }} />
          <Button testID="gamiya_add_save" label="حفظ" style={styles.saveBtn} onPress={handleSave} busy={busy} />
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
    content: { padding: space.xxl, paddingBottom: 40 },
    titleRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xxl },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700' },
    // دراسة الشكل خطوة 3: نفس كارت الدين — من غير إطار، المقاسات من `typeScale`
    card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.md },
    cardHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    name: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    sub2: { color: c.textSecondary, fontSize: typeScale.caption },
    sub: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    track: { height: 6, backgroundColor: c.surface2, borderRadius: radius.track, marginTop: space.md, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.track },
    progressText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs },
    due: { fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs, fontWeight: '600' },
    expandedArea: { marginTop: space.lg, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.md },
    monthRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.xs },
    monthText: { fontSize: typeScale.caption, flex: 1, textAlign: 'right' },
    // كان ~28 طول — 44 للمس (دراسة الشكل)
    deleteBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: radius.sm, alignItems: 'center', paddingVertical: space.sm, marginTop: space.md },
    gamiyaActions: { flexDirection: 'row-reverse', gap: space.sm, marginTop: space.md },
    editBtn: { flex: 1, borderWidth: 1.5, borderColor: c.controlEdge, backgroundColor: c.surface2, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
    deleteBtnFlex: { flex: 1, borderWidth: 1.5, borderColor: c.danger, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { padding: space.xxxl },
    sheetTitle: sheetTitleStyle(c, 10),
    hintNote: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', lineHeight: 17, marginBottom: space.xxs },
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xl, marginBottom: space.xs },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, fontSize: typeScale.body, paddingHorizontal: space.xl, paddingVertical: space.md },
    bigInput: bigAmountInputStyle(c),
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: space.xl, paddingVertical: space.lg },
    dateBtnText: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', marginTop: space.lg },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
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
        if (result.outcome !== 'done') { setError(result.message); return; }
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
          <TextInput maxLength={NAME_MAX_LENGTH} style={styles.input} value={name} onChangeText={setName}
            placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <TouchableOpacity {...selectionA11y(walletId === w.id, 'radio')} key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: typeScale.body }}>{walletHistoryName(wallets, w.id)}</Text>
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
          <Button variant="secondary" testID="gamiya_edit_cancel" label="إلغاء" style={styles.cancelBtn} onPress={onClose} />
          <Button testID="gamiya_edit_save" label="حفظ التعديل" style={styles.saveBtn} onPress={handleSave} busy={busy} />
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
