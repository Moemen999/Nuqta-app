import { Money } from '@/components/Money';
import { INCOME_DELETE_ALERT, INCOME_RECORD_ALERT, useData } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectableOptions } from '@/lib/archiving';
import { todayStr, walletHistoryName } from '@/lib/finance';
import { plainAmount } from '@/lib/money';
import {
  WEEKDAY_NAMES, incomeDueDate, incomeHasRecords, incomeOpenPeriods, incomePeriodLabel, incomeRescheduleStart, incomeScheduleKeysChange, incomeScheduleLabel,
  incomeUpcomingPeriod, validateIncomeDraft, type IncomeFrequency, type IncomeMode, type RecurringIncome,
} from '@/lib/recurringIncome';
import { selectionStyle } from '@/lib/selection';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useBusyKey } from '@/lib/useBusy';
import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';

export const INCOME_MODE_LABEL: Record<IncomeMode, string> = {
  confirm: 'بيسألك الأول',
  auto: 'بيتسجل لوحده',
};

/**
 * "دخل ثابت" — نفس شكل الاشتراكات بالظبط (كارت، اسم ومبلغ فوق، سطر المواعيد،
 * زراير تحت)، بس الفلوس داخلة مش خارجة.
 */
export default function IncomesView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { incomes, wallets, transactions, recordIncomePeriods, setIncomeStatus, deleteIncome } = useData();
  const { busyKey, run } = useBusyKey();
  const [editing, setEditing] = useState<RecurringIncome | 'new' | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const today = todayStr();

  const live = incomes.filter(i => i.status !== 'stopped');
  const stopped = incomes.filter(i => i.status === 'stopped');

  /**
   * "نزل": لو فيه فترة معادها جه ولسه ما اتأكدتش بياخدها هي (الأقدم)، غير
   * كده الجاية — يعني قبل المعاد بيسجل دلوقتي وبيقفلها. الرقم في التأكيد
   * حقيقي حتى لو المبالغ مخفية: ده تأكيد قبل كتابة.
   */
  function confirmArrived(inc: RecurringIncome) {
    const key = incomeOpenPeriods(inc, today)[0] ?? incomeUpcomingPeriod(inc, today);
    if (!key) return;
    const label = incomePeriodLabel(inc, key, today);
    const early = incomeDueDate(inc, key) > today;
    Alert.alert(
      `"${inc.name}" نزل؟`,
      `هنسجل ${plainAmount(inc.amount)} ج.م في "${walletHistoryName(wallets, inc.walletId)}" عن ${label}.`
        + (early ? ` ولما ييجي معاده مش هنسألك عنه تاني.` : ''),
      [
        { text: 'لسه', style: 'cancel' },
        {
          text: 'نزل',
          onPress: () => run(`rec_${inc.id}`, async () => {
            const r = await recordIncomePeriods(inc.id, [{ key, amount: inc.amount }]);
            if (r.outcome !== 'done') Alert.alert(INCOME_RECORD_ALERT[r.outcome].title, INCOME_RECORD_ALERT[r.outcome].body);
          }),
        },
      ],
    );
  }

  function confirmStop(inc: RecurringIncome) {
    Alert.alert(
      `توقف "${inc.name}" خالص؟`,
      'مش هيتسجل ولا هيسألك عنه تاني. اللي اتسجل قبل كده بيفضل في الأرشيف ورصيدك زي ما هو.',
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'وقّفه', style: 'destructive', onPress: () => setIncomeStatus(inc.id, 'stopped') },
      ],
    );
  }

  /**
   * المسح للي عمره ما سجّل حاجة بس — اللي سجّل بيتوقف (تاريخه بيفضل). والذرة
   * بتتأكد تاني من السيرفر، فلو جهاز تاني سجّل في النص بيرجع `has-records`.
   */
  function confirmDelete(inc: RecurringIncome) {
    Alert.alert(
      `تمسح "${inc.name}"؟`,
      'لسه ما اتسجلش منه أي حاجة، فرصيدك مش هيتلمس. هيتشال خالص ومش هنفكرك بيه تاني.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'امسحه',
          style: 'destructive',
          onPress: () => run(`del_${inc.id}`, async () => {
            const r = await deleteIncome(inc.id);
            if (r !== 'done') Alert.alert(INCOME_DELETE_ALERT[r].title, INCOME_DELETE_ALERT[r].body);
          }),
        },
      ],
    );
  }

  function deleteButton(inc: RecurringIncome) {
    const busy = busyKey === `del_${inc.id}`;
    return (
      <TouchableOpacity
        testID={`income_delete_${inc.id}`}
        style={[styles.stopBtn, busy && styles.btnBusy]}
        onPress={() => confirmDelete(inc)}
        disabled={busyKey !== null}
        accessibilityRole="button"
        accessibilityLabel={busy ? `بنمسح "${inc.name}"` : `امسح "${inc.name}"`}
        accessibilityState={{ busy }}>
        {busy ? (
          <View style={styles.btnLoading}>
            <ActivityIndicator size="small" color={colors.danger} />
            <Text style={{ color: colors.danger, fontSize: 12.5 }}>بنمسح</Text>
          </View>
        ) : (
          <Text style={{ color: colors.danger, fontSize: 12.5 }}>امسحه</Text>
        )}
      </TouchableOpacity>
    );
  }

  function nextLine(inc: RecurringIncome) {
    if (inc.status === 'paused') return 'واقف مؤقتًا — مش هيتسجل ولا هيسألك لحد ما ترجّعه';
    const open = incomeOpenPeriods(inc, today);
    if (open.length > 0) {
      return inc.mode === 'confirm'
        ? `مستني تأكيدك عن ${incomePeriodLabel(inc, open[0], today)}`
        : `هيتسجل أول ما النت يبقى متاح`;
    }
    const up = incomeUpcomingPeriod(inc, today);
    return up ? `الجاي: ${incomeDueDate(inc, up)}` : '';
  }

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <TouchableOpacity testID="income_add_button" accessibilityRole="button" style={styles.addBtn} onPress={() => setEditing('new')}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13 }}>+ دخل ثابت</Text>
        </TouchableOpacity>
        <Text style={styles.title}>الدخل الثابت</Text>
      </View>

      {live.length === 0 && (
        <Text style={styles.emptyState}>
          مفيش دخل ثابت لسه. ضيف مرتبك أو أي فلوس بتنزلك بمعاد، وهنفكرك بيه أو نسجله لوحده.
        </Text>
      )}

      {live.map(inc => {
        const recBusy = busyKey === `rec_${inc.id}`;
        const paused = inc.status === 'paused';
        return (
          <View key={inc.id} style={[styles.card, paused && styles.cardPaused]}>
            <View style={styles.cardHead}>
              <Text style={styles.name}>{inc.name}</Text>
              <Money value={inc.amount} sign="+" style={[styles.amount, { color: colors.success }]} />
            </View>
            <Text style={styles.sub}>
              {walletHistoryName(wallets, inc.walletId)} · {incomeScheduleLabel(inc)} · {INCOME_MODE_LABEL[inc.mode]}
            </Text>
            <Text style={styles.due}>{nextLine(inc)}</Text>
            <View style={styles.actionsRow}>
              {!paused && (
                <TouchableOpacity
                  testID={`income_arrived_${inc.id}`}
                  style={[styles.payBtn, recBusy && styles.btnBusy]}
                  onPress={() => confirmArrived(inc)}
                  disabled={busyKey !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`"${inc.name}" نزل`}
                  accessibilityState={{ busy: recBusy }}>
                  {recBusy ? (
                    <View style={styles.btnLoading}>
                      <ActivityIndicator size="small" color={colors.onAccent} />
                      <Text style={styles.payText}>بنسجّل</Text>
                    </View>
                  ) : (
                    <Text style={styles.payText}>نزل</Text>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(inc)} accessibilityRole="button">
                <Text style={styles.editText}>تعديل</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => setIncomeStatus(inc.id, paused ? 'active' : 'paused')}
                accessibilityRole="button">
                <Text style={styles.editText}>{paused ? 'رجّعه' : 'وقّفه مؤقتًا'}</Text>
              </TouchableOpacity>
              {/* اللي عمره ما سجّل: المسح مكان "وقّفه" — التوقيف كان هيسيب كارت مالوش لازمة */}
              {incomeHasRecords(inc, transactions) ? (
                <TouchableOpacity testID={`income_stop_${inc.id}`} style={styles.stopBtn} onPress={() => confirmStop(inc)} accessibilityRole="button">
                  <Text style={{ color: colors.danger, fontSize: 12.5 }}>وقّفه</Text>
                </TouchableOpacity>
              ) : deleteButton(inc)}
            </View>
          </View>
        );
      })}

      {stopped.length > 0 && (
        <TouchableOpacity style={styles.stoppedToggle} onPress={() => setShowStopped(s => !s)} accessibilityRole="button">
          <Text style={styles.stoppedToggleText}>
            {showStopped ? 'اخفي المتوقف' : `المتوقف (${stopped.length})`}
          </Text>
        </TouchableOpacity>
      )}
      {showStopped && stopped.map(inc => (
        <View key={inc.id} style={[styles.card, styles.cardPaused]}>
          <View style={styles.cardHead}>
            <Text style={styles.name}>{inc.name}</Text>
            <Money value={inc.amount} style={styles.amount} />
          </View>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.editBtn} onPress={() => setIncomeStatus(inc.id, 'active')} accessibilityRole="button">
              <Text style={styles.editText}>رجّعه من النهاردة</Text>
            </TouchableOpacity>
            {!incomeHasRecords(inc, transactions) && deleteButton(inc)}
          </View>
        </View>
      ))}

      {editing && (
        <IncomeSetupModal income={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </ScrollView>
  );
}

const STEPS = ['الاسم والمبلغ', 'بينزل فين وامتى', 'تسجّله إزاي'];

/**
 * الإعداد في ٣ خطوات: كل خطوة سؤال واحد، والتحقق بيحصل قبل ما تعدّي — مش
 * آخر الفورم. نفس المودال للتعديل (متعبّي).
 */
function IncomeSetupModal({ income, onClose }: { income: RecurringIncome | null; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, addIncome, updateIncome } = useData();
  const { amountsHidden } = usePrivacy();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(income?.name ?? '');
  // التعديل وهو مخبّي: الخانة فاضية بقناع، والفاضي معناه "زي ما هو"
  const [amount, setAmount] = useState(income && !amountsHidden ? String(income.amount) : '');
  const [walletId, setWalletId] = useState(income?.walletId ?? selectableOptions(wallets)[0]?.id ?? '');
  const [frequency, setFrequency] = useState<IncomeFrequency>(income?.frequency ?? 'monthly');
  const [day, setDay] = useState(String(income?.dayOfMonth ?? 1));
  const [weekday, setWeekday] = useState(income?.weekday ?? 4);
  const [mode, setMode] = useState<IncomeMode>(income?.mode ?? 'confirm');
  const [error, setError] = useState('');

  // `accessibilityLiveRegion` أندرويد بس — VoiceOver كان هيسكت عن الغلط وعن
  // تغيير الخطوة (المحتوى كله بيتغيّر بعد "التالي" من غير ما حد يقول)
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);
  useEffect(() => {
    if (step > 0) AccessibilityInfo.announceForAccessibility(`الخطوة ${step + 1} من 3: ${STEPS[step]}`);
  }, [step]);

  const amt = amount.trim() === '' && income ? income.amount : Number(amount.replace(/,/g, ''));
  const scheduleChanges = !!income
    && incomeScheduleKeysChange(income, { frequency, weekday: frequency === 'weekly' ? weekday : undefined });
  const pendingOnScheduleChange = scheduleChanges ? incomeOpenPeriods(income!, todayStr())[0] ?? null : null;
  const draft = {
    name, amount: amt, walletId, frequency,
    ...(frequency === 'monthly' ? { dayOfMonth: Number(day) } : { weekday }),
  };

  /**
   * بيتحقق من الخطوة دي بس — غلط في خطوة جاية مش ذنب المستخدم دلوقتي. الخطوة
   * الأولى بتتفحص بحقول الخطوة التانية متعبّية بقيم سليمة، فالغلط الوحيد اللي
   * ممكن يرجع هو بتاعها.
   */
  function stepError(s: number) {
    if (s === 0) return validateIncomeDraft({ name, amount: amt, walletId: 'x', frequency: 'monthly', dayOfMonth: 1 });
    // جدول جديد والفترات اللي معادها جه لسه ما اتأكدتش: مفاتيحها مش هتبقى
    // موجودة في الجدول الجديد، فكانت هتختفي من غير ما حد يقول (money-reviewer)
    if (income && pendingOnScheduleChange) {
      return `فيه ${incomePeriodLabel(income, pendingOnScheduleChange, todayStr())} لسه ما اتأكدش. أكّده أو قول "ما نزلش" من الرئيسية الأول، وبعدين غيّر المعاد.`;
    }
    return validateIncomeDraft(draft);
  }

  function next() {
    const e = stepError(step);
    if (e) { setError(e); return; }
    setError('');
    if (step < 2) { setStep(step + 1); return; }
    const full = validateIncomeDraft(draft);
    if (full) { setError(full); return; }
    const payload = {
      ...draft, name: name.trim(), mode,
      // التغيير بين شهري وأسبوعي بيشيل الحقل التاني بدل ما يفضل معلّق
      dayOfMonth: frequency === 'monthly' ? Number(day) : undefined,
      weekday: frequency === 'weekly' ? weekday : undefined,
    };
    if (income) updateIncome(income.id, payload);
    else addIncome(payload);
    onClose();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{income ? 'تعديل الدخل الثابت' : 'دخل ثابت جديد'}</Text>
              <View style={styles.stepsRow} accessible accessibilityLabel={`الخطوة ${step + 1} من 3: ${STEPS[step]}`}>
                {STEPS.map((s, i) => (
                  <View key={s} style={[styles.stepDot, i <= step && { backgroundColor: colors.accent }]} />
                ))}
              </View>
              <Text style={styles.stepTitle}>{STEPS[step]}</Text>

              {step === 0 && (
                <>
                  <Text style={styles.label}>اسمه</Text>
                  <TextInput testID="income_name" style={styles.input} value={name} onChangeText={setName}
                    placeholder="المرتب" placeholderTextColor={colors.textMuted} textAlign="right" autoFocus={!income} />
                  <Text style={styles.label}>المبلغ المعتاد</Text>
                  <TextInput testID="income_amount" style={styles.bigInput} value={amount} onChangeText={setAmount}
                    keyboardType="numeric" textAlign="right" placeholderTextColor={colors.textMuted}
                    placeholder={income && amountsHidden ? '•••• (زي ما هو)' : '0'} />
                  <Text style={styles.hint}>لو شهر نزل مختلف، هتعدّل الشهر ده بس من غير ما الرقم ده يتغيّر.</Text>
                </>
              )}

              {step === 1 && (
                <>
                  <Text style={styles.label}>بينزل في محفظة</Text>
                  <View style={styles.chipRow}>
                    {selectableOptions(wallets, walletId).map(w => (
                      <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
                        accessibilityRole="button" accessibilityState={{ selected: walletId === w.id }}
                        style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                        <Text style={{ color: colors.text, fontSize: 13 }}>{walletHistoryName(wallets, w.id)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.label}>كل قد إيه</Text>
                  <View style={styles.row}>
                    {(['monthly', 'weekly'] as const).map(f => (
                      <TouchableOpacity key={f} onPress={() => setFrequency(f)}
                        accessibilityRole="button" accessibilityState={{ selected: frequency === f }}
                        style={[styles.typeBtn, selectionStyle(colors, frequency === f)]}>
                        <Text style={{ color: colors.text, fontSize: 12.5 }}>{f === 'monthly' ? 'كل شهر' : 'كل أسبوع'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {income && scheduleChanges && !pendingOnScheduleChange && (
                    <Text style={styles.hint}>
                      الجدول الجديد هيبدأ من {incomeRescheduleStart(income, todayStr())} — اللي اتسجل قبل كده مش هيتكرر.
                    </Text>
                  )}
                  {frequency === 'monthly' ? (
                    <>
                      <Text style={styles.label}>يوم كام في الشهر؟</Text>
                      <TextInput testID="income_day" style={styles.input} value={day} onChangeText={setDay}
                        keyboardType="number-pad" textAlign="right" maxLength={2} />
                      {Number(day) >= 29 && Number(day) <= 31 && (
                        <Text style={styles.hint}>الشهور اللي أقصر بتاخد آخر يوم فيها.</Text>
                      )}
                    </>
                  ) : (
                    <>
                      <Text style={styles.label}>أنهي يوم؟</Text>
                      <View style={styles.chipRow}>
                        {WEEKDAY_NAMES.map((n, i) => (
                          <TouchableOpacity key={n} onPress={() => setWeekday(i)}
                            accessibilityRole="button" accessibilityState={{ selected: weekday === i }}
                            style={[styles.chip, selectionStyle(colors, weekday === i)]}>
                            <Text style={{ color: colors.text, fontSize: 13 }}>{n}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  {(['confirm', 'auto'] as const).map(m => (
                    <TouchableOpacity key={m} testID={`income_mode_${m}`} onPress={() => setMode(m)}
                      accessibilityRole="button" accessibilityState={{ selected: mode === m }}
                      style={[styles.modeCard, selectionStyle(colors, mode === m)]}>
                      <Text style={styles.modeTitle}>{INCOME_MODE_LABEL[m]}{m === 'confirm' ? ' (مقترح)' : ''}</Text>
                      <Text style={styles.modeBody}>
                        {m === 'confirm'
                          ? 'يوم المعاد هيجيلك إشعار وكارت في الرئيسية: "نزل؟" — تأكد أو تعدّل المبلغ.'
                          : 'أول ما تفتح التطبيق بعد المعاد هيتسجل، وهيجيلك إشعار إنه اتسجل عشان لو الرقم مختلف تعدّله.'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <Text style={styles.summary}>
                    {`"${name.trim()}"`} · {incomeScheduleLabel(draft)} · {walletHistoryName(wallets, walletId)}
                  </Text>
                </>
              )}

              {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity testID="income_setup_back" accessibilityRole="button" style={styles.cancelBtn}
                onPress={() => { setError(''); if (step === 0) onClose(); else setStep(step - 1); }}>
                <Text style={{ color: colors.textSecondary }}>{step === 0 ? 'إلغاء' : 'رجوع'}</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="income_setup_next" accessibilityRole="button" style={styles.saveBtn} onPress={next}>
                <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{step < 2 ? 'التالي' : 'حفظ'}</Text>
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
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 20, lineHeight: 20 },
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    cardPaused: { opacity: 0.7 },
    cardHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    name: { color: c.text, fontSize: 14.5, fontWeight: '700' },
    amount: { color: c.text, fontSize: 14, fontWeight: '700' },
    sub: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 4 },
    due: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 6, fontWeight: '600' },
    actionsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    payBtn: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 16, minHeight: MIN_TOUCH, justifyContent: 'center' },
    payText: { color: c.onAccent, fontWeight: '700', fontSize: 12.5 },
    btnLoading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
    editBtn: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, paddingHorizontal: 14, minHeight: MIN_TOUCH, justifyContent: 'center' },
    editText: { color: c.text, fontSize: 12.5 },
    stopBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 8, paddingHorizontal: 14, minHeight: MIN_TOUCH, justifyContent: 'center' },
    btnBusy: { opacity: 0.6 },
    stoppedToggle: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, minHeight: MIN_TOUCH, justifyContent: 'center' },
    stoppedToggleText: { color: c.textSecondary, fontSize: 12.5 },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { padding: 20 },
    sheetTitle: sheetTitleStyle(c, 10),
    stepsRow: { flexDirection: 'row-reverse', gap: 6, justifyContent: 'center', marginBottom: 8 },
    stepDot: { width: 28, height: 4, borderRadius: 2, backgroundColor: c.borderStrong },
    stepTitle: { color: c.text, fontSize: 14, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    hint: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 6, lineHeight: 17 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: {
      backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text,
      fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12, fontVariant: ['tabular-nums'],
    },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
    row: { flexDirection: 'row-reverse', gap: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', minHeight: MIN_TOUCH, justifyContent: 'center' },
    modeCard: { borderWidth: 1.5, borderRadius: 12, padding: 14, marginTop: 12 },
    modeTitle: { color: c.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
    modeBody: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 4, lineHeight: 18 },
    summary: { color: c.textMuted, fontSize: 12, textAlign: 'center', marginTop: 16 },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
  });
}
