import { plainAmount } from '@/lib/money';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { Money } from '@/components/Money';
import AmountPreview from '@/components/AmountPreview';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import ContactPickerModal from '@/components/ContactPickerModal';
import DebtReminderFields from '@/components/DebtReminderFields';
import { useDeviceContacts } from '@/components/useDeviceContacts';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LEFTOVER_CHANGED_ALERT, PAY_OUTCOME_ALERT_DEBT, useData, type Debt } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { installmentsPhrase, selectableOptions } from '@/lib/archiving';
import { isCreditPurchase } from '@/lib/spending';
import { DUE_MOVED_TITLE } from '@/lib/reopenDue';
import {
  categoryLabel, debtRemaining, INSTALLMENT_VALUE_TOO_SMALL, installmentProgressLabel, planInstallments, storableCount, suggestedInstallmentPayment, toMoneyAmount,
  overpayCheck, projectBalances, todayStr, type DebtPrefill,
  increaseLeftoverChoice, leftoverSeen, pinInstallmentAmount, type LeftoverMode,
} from '@/lib/finance';
import { selectionA11y, selectionStyle, selectionTextColor } from '@/lib/selection';
import { overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useBusy } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';

/**
 * مودالات تسجيل دفعة وزيادة على دين ودين جديد.
 *
 * كانوا جوه شاشة الديون، واتنقلوا هنا عشان كشف حساب الشخص (وكارت الدين نفسه
 * لدين جديد بالاتجاه العكسي) يفتحوا **نفس** المودالات بدل ما نعمل نسخة
 * تانية منهم. نسختين من فورم بيسجّل فلوس = مكانين لازم يتغيّروا مع كل
 * تعديل، وواحد فيهم هينساه حد.
 */

export const INSTALLMENTS_CHANGED_TITLE = 'عدد الأقساط اتظبط';

/**
 * سؤال الباقي بعد الزيادة (D1، 2026-10-30) — النص اتقرر مع مؤمن بعد arabic-copy-reviewer
 * (سطر TIMELINE "بند 8 — نص D1 اتقرر")
 */
export const LEFTOVER_REQUIRED = 'اختار الأول: يتضاف على آخر قسط ولا قسط منفصل.';
export const LAST_INSTALMENT_ADJUSTED_TITLE = 'آخر قسط اتظبط';
/** "تقريبًا ضعف" من 1.5 من القسط (قرار مؤمن) — تحت كده الرقمين في الجملة كفاية */
const NEAR_DOUBLE = 1.5;
export const DEBT_SETTLED_TITLE = 'الدين اتسدد بالكامل';
// جملة عامة صح في الشاشتين (الديون وكشف الشخص) — مش "نزل تحت" (arabic-copy-reviewer +
// silent-failure-hunter، جولة 2)
export const DEBT_SETTLED_BODY = 'الديون اللي اتسددت بتتجمع في قسم "ديون اتسددت" في تاب الديون، ودوس عليه عشان تفتحه.';
export const INSTALLMENT_COUNT_REQUIRED = 'دخّل عدد الأقساط — رقم صحيح أكبر من صفر.';

export function DebtPaymentModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, transactions, addDebtPayment } = useData();
  const notice = useNotice();
  const confirm = useConfirm();
  const { busy, run: runBusy } = useBusy();

  const remaining = debtRemaining(debt);

  /**
   * دين الأقساط بيقترح **قيمة القسط** مش المتبقي كله.
   *
   * قبل كده الخانة كانت بتتملّى بالمتبقي بالكامل، فاللي بيسدد قسط من ستة
   * كان لازم يمسح الرقم ويكتب قسطه كل مرة. ولسه يقدر يعدّله — الاقتراح
   * اقتراح مش قفل، ودي نص القاعدة: يدفع أقل أو أكتر والعدد يتظبط لوحده.
   */
  // والقسط الأخير = المتبقي كله بنفس قاعدة العدد (`suggestedInstallmentPayment`، 2026-09-30)
  const suggested = useMemo(() => suggestedInstallmentPayment(debt), [debt]);
  const progressLabel = installmentProgressLabel(debt);

  const [amount, setAmount] = useState(String(suggested > 0 ? suggested : ''));
  const [walletId, setWalletId] = useState(selectableOptions(wallets)[0]?.id);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  // الفئة لسداد الشرا بالأجل بس — هو اللي بيفضل مصروف (قرار مؤمن 2026-11-05)؛ باقي الديون تحويل والفئة مكانتش هتتعدّ
  const creditPurchase = isCreditPurchase(debt);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  // السداد بيولّد عملية فعلية: إيراد لو الدين ليك، مصروف لو عليك
  const projections = useMemo(() => projectBalances({
    transactions, wallets, amount: toMoneyAmount(Number(amount)) ?? 0, walletId,
    type: debt.direction === 'owed_to_me' ? 'income' : 'expense',
  }), [transactions, wallets, amount, walletId, debt.direction]);

  /**
   * تأكيد قبل تسجيل دفعة أكبر من المتبقي.
   *
   * بيرجّع Promise عشان الديالوج يخلص **قبل** ما `runBusy` تشتغل — من غير كده
   * الزرار هيفضل بيلف وإحنا لسه مستنيين المستخدم يرد.
   */
  function confirmOverpay(kind: 'exceeds' | 'settled', amt: number) {
    const excess = amt - (remaining > 0 ? remaining : 0);
    const title = kind === 'settled' ? 'الدين ده متسدد بالكامل' : 'المبلغ أكبر من المتبقي';
    const body = kind === 'settled'
      ? `مفيش متبقي على ${debt.personName}.\nاللي هيتسجّل: ${plainAmount(amt)} ج.م\nنسجّله؟`
      : `المتبقي على ${debt.personName}: ${plainAmount(remaining)} ج.م\nاللي هيتسجّل: ${plainAmount(amt)} ج.م\nيعني زيادة ${plainAmount(excess)} ج.م — نسجّله؟`;
    return new Promise<boolean>(resolve => {
      confirm(title, body, [
        { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
        { text: 'أيوة، سجّل', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  }

  async function handleSave() {
    // مقرّب للقرش ورقم حقيقي (`toMoneyAmount`): "1e999" وInfinity و0.004 بيترفضوا هنا
    // برسالتهم، وفحص الزيادة عن المتبقي على نفس المبلغ اللي هيتسجل
    const amt = toMoneyAmount(Number(amount));
    if (amt === null || !walletId) { setError('دخّل مبلغ ومحفظة صحيحين'); return; }
    const check = overpayCheck(amt, remaining);
    if (check !== 'none' && !(await confirmOverpay(check, amt))) return;
    await runBusy(async () => {
      let result: Awaited<ReturnType<typeof addDebtPayment>>;
      try {
        result = await addDebtPayment(debt.id, amt, walletId, date, creditPurchase ? categoryId : undefined);
      } catch {
        // الدفعة بقت عملية ذرية بترجّع نتيجة بدل ما ترمي، فالرمي هنا مابقاش
        // متوقع خالص — فاضل للأخطاء المتزامنة (تجهيز البيانات، التنقل)
        setError('حصل خطأ، جرب تاني');
        return;
      }
      // النتيجة قاطعة: يا اتسجلت يا مفيش أي خصم اتسجل. والمودال بيفضل مفتوح
      // لو ما اتسجلتش، عشان يقدر يغيّر المحفظة أو يجرب تاني من غير ما يعيد
      // كتابة كل حاجة
      if (result.outcome !== 'done') {
        const alert = PAY_OUTCOME_ALERT_DEBT[result.outcome];
        notice(alert.title, alert.body);
        return;
      }
      // الدفعة دي سددت الدين ← الكارت بيروح "ديون اتسددت" المطوي، فبيتقال بدل ما يختفي من
      // قدامه (silent-failure-hunter). من **السيرفر** (`settledNow` جوه الذرة)، مش من نسخة الدين
      // اللي المودال اتفتح بيها — جهاز تاني ممكن يكون غيّره
      if (result.settledNow) {
        notice(DEBT_SETTLED_TITLE, DEBT_SETTLED_BODY);
      } else if (result.note) {
        // "دفعت 700 بدل 1000، الأقساط بقت 7" — التغيير بيتقال بالكلام، عشان
        // المستخدم ميلاقيش العدد اتغيّر لوحده ومحدش قاله ليه
        notice(INSTALLMENTS_CHANGED_TITLE, result.note);
      }
      onClose();
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>تسجيل دفعة — {debt.personName}</Text>
          <Text style={styles.hintText}>المتبقي: <Money value={remaining} /></Text>
          {!!progressLabel && <Text style={styles.installmentText}>{progressLabel}</Text>}

          <Text style={styles.label}>المبلغ</Text>
          <TextInput testID="debt_payment_amount" style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />
          <AmountPreview amount={amount} projections={projections} />

          <Text style={styles.label}>{debt.direction === 'owed_to_me' ? 'المحفظة اللي هتستلم فيها' : 'المحفظة اللي هتدفع منها'}</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets).map(w => (
              <TouchableOpacity {...selectionA11y(walletId === w.id)} key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {creditPurchase && (
            <>
              <Text style={styles.label}>الفئة (اختياري)</Text>
              <View style={styles.chipRow}>
                {selectableOptions(categories).map(c => (
                  <TouchableOpacity {...selectionA11y(categoryId === c.id)} key={c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                    style={[styles.chip, selectionStyle(colors, categoryId === c.id)]}>
                    <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: 13 }}>{categoryLabel(c)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>التاريخ</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{date}</Text>
          </TouchableOpacity>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <CalendarPickerModal visible={showPicker} value={date} onSelect={setDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity testID="debt_payment_cancel" style={styles.cancelBtn} onPress={onClose}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="debt_payment_save" style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function DebtIncreaseModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, transactions, addDebtIncrease } = useData();
  const notice = useNotice();
  const { busy, run: runBusy } = useBusy();

  const [amount, setAmount] = useState('');
  const [linkedToWallet, setLinkedToWallet] = useState(true);
  const [walletId, setWalletId] = useState(selectableOptions(wallets)[0]?.id);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');
  // الأرقام من `money` مش `fmt` (جرد الإخفاء): نفس تنسيق باقي الشاشات
  const { money } = usePrivacy();
  // نفس الدالة اللي الكتابة بتتأكد بيها على السيرفر، على الدين بعد التثبيت زي `addDebtIncrease`
  const choice = useMemo(() => {
    const typed = toMoneyAmount(Number(amount));
    return typed === null ? null : increaseLeftoverChoice({ ...debt, ...pinInstallmentAmount(debt) }, typed);
  }, [debt, amount]);
  // D1: مفيش اختيار افتراضي (قرار مؤمن). الاختيار مربوط بالأرقام اللي اتختار عليها: لو
  // الأرقام اتغيّرت (المبلغ، أو الدين من جهاز تاني والشيت مفتوحة) بيرجع من غير اختيار
  // (silent-failure-hunter، جولة 1) — مش اختيار قديم على أرقام ما اتشافتش
  const choiceKey = choice
    ? [choice.leftover, choice.value, choice.absorb.count, choice.absorb.last, choice.separate.count, choice.separate.last].join('|')
    : '';
  const [picked, setPicked] = useState<{ mode: LeftoverMode; key: string } | null>(null);
  const leftoverMode = picked && picked.key === choiceKey ? picked.mode : null;
  const setLeftoverMode = (mode: LeftoverMode | null) => setPicked(mode ? { mode, key: choiceKey } : null);
  // الخطأ القديم ("اختار الأول") مبيفضلش بعد ما المبلغ يتغيّر والسؤال يمشي
  const changeAmount = (v: string) => { setAmount(v); setLeftoverMode(null); setError(''); };

  // الزيادة بالأجل مش بتلمس محفظة خالص، فمفيش رصيد نعرضه — ولا صفر ولا شرطة
  const projections = useMemo(() => projectBalances({
    transactions, wallets, amount: toMoneyAmount(Number(amount)) ?? 0,
    walletId: linkedToWallet ? walletId : undefined,
    type: debt.direction === 'owed_to_me' ? 'expense' : 'income',
  }), [transactions, wallets, amount, walletId, linkedToWallet, debt.direction]);

  async function handleSave() {
    // isFinite: "1e999" بيطلع Infinity ويعدّي من `amt <= 0` (silent-failure-hunter)،
    // والتقريب قبل الفحص: 1e307 بيطلع Infinity بعد التقريب، و0.004 بيطلع 0 (`toMoneyAmount`)
    const amt = toMoneyAmount(Number(amount));
    if (amt === null) { setError('دخّل مبلغ صحيح'); return; }
    if (linkedToWallet && !walletId) { setError('اختار محفظة'); return; }
    if (choice && !leftoverMode) { setError(LEFTOVER_REQUIRED); return; }
    // اللي المستخدم شافه وقت الاختيار — عشان الأرقام في الرسالة بعد الحفظ تبقى نفسها
    const seen = choice;
    await runBusy(async () => {
      let result: Awaited<ReturnType<typeof addDebtIncrease>>;
      try {
        const wallet = linkedToWallet ? walletId : undefined;
        // الباقي اللي المستخدم شافه بيتبعت عشان الذرة تتأكد إنه لسه هو (D1)
        result = seen && leftoverMode
          ? await addDebtIncrease(debt.id, amt, date, wallet, leftoverSeen(seen, leftoverMode))
          : await addDebtIncrease(debt.id, amt, date, wallet);
      } catch {
        // الزيادة بقت عملية ذرية بترجّع نتيجة بدل ما ترمي — فاضل للأخطاء
        // المتزامنة بس
        setError('حصل خطأ، جرب تاني');
        return;
      }
      if (result.outcome === 'leftover-changed') {
        // الدين اتغيّر من جهاز تاني: مفيش حاجة اتسجلت، والسؤال بيتحسب تاني من الدين الحي
        // ويتسأل من الأول (من غير اختيار قديم)
        setLeftoverMode(null);
        notice(LEFTOVER_CHANGED_ALERT.title, LEFTOVER_CHANGED_ALERT.body);
        return;
      }
      if (result.outcome !== 'done') {
        const alert = PAY_OUTCOME_ALERT_DEBT[result.outcome];
        notice(alert.title, alert.body);
        return;
      }
      // "بعد الزيادة، الأقساط بقت 8 بدل 6" — نفس تنبيه الدفعة بالظبط: العدد
      // مبيتغيّرش لوحده من غير ما حد يقول ليه. ولو الباقي اتضاف على آخر قسط (D1) ← آخر قسط
      // اتغيّر فعلاً والمستخدم هيدفع مبلغ مختلف، فبيتقال حتى لو العدد ثابت
      const absorbed = seen && leftoverMode === 'absorb' ? seen.absorb.last : null;
      // "المعاد الجاي بقى …" (بند 12): الزيادة فتحت دين متسدد وقدّمت المعاد — ميتغيّرش ساكت. بيتلزق في نفس
      // الرسالة لو فيه واحدة، ولوحده لو مفيش
      const withDue = (body: string) => (result.dueNote ? `${body}\n${result.dueNote}` : body);
      if (result.note) {
        notice(INSTALLMENTS_CHANGED_TITLE, withDue(absorbed === null ? result.note : `${result.note} آخر قسط بقى ${money(absorbed)} ج.م.`));
      } else if (absorbed !== null && seen) {
        notice(LAST_INSTALMENT_ADJUSTED_TITLE, withDue(`آخر قسط بقى ${money(absorbed)} ج.م بدل ${money(seen.value)} ج.م.`));
      } else if (result.dueNote) {
        notice(DUE_MOVED_TITLE, result.dueNote);
      }
      onClose();
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>زيادة على دين — {debt.personName}</Text>

          <Text style={styles.label}>مرتبط بمحفظة دلوقتي؟</Text>
          <View style={styles.row}>
            <TouchableOpacity {...selectionA11y(linkedToWallet)} onPress={() => setLinkedToWallet(true)}
              style={[styles.typeBtn, selectionStyle(colors, linkedToWallet)]}>
              <Text style={{ color: linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>أيوة</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(!linkedToWallet)} onPress={() => setLinkedToWallet(false)}
              style={[styles.typeBtn, selectionStyle(colors, !linkedToWallet)]}>
              <Text style={{ color: !linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>لأ (بالأجل)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>المبلغ الإضافي</Text>
          <TextInput testID="debt_increase_amount" style={styles.bigInput} value={amount} onChangeText={changeAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />
          <AmountPreview amount={amount} projections={projections} />

          {/* D1 (قرار مؤمن): الباقي أقل من قسط ← بيتسأل كل مرة، من غير افتراضي، حتى للقروش */}
          {choice && (
            <View testID="debt_leftover_question">
              <Text style={styles.leftoverQuestion}>
                {`الزيادة سابت ${money(choice.leftover)} ج.م، أقل من قسط كامل. تعمل فيه إيه؟`}
              </Text>
              {(['absorb', 'separate'] as const).map(mode => {
                const selected = leftoverMode === mode;
                const caption = mode === 'absorb'
                  ? `الأقساط هتبقى ${installmentsPhrase(choice.absorb.count)}، وآخر قسط ${money(choice.absorb.last)} ج.م بدل ${money(choice.value)} ج.م${choice.absorb.last >= NEAR_DOUBLE * choice.value ? '، يعني تقريبًا ضعف القسط العادي' : ''}.`
                  : `هيتضاف قسط أخير قيمته ${money(choice.leftover)} ج.م، والأقساط هتبقى ${installmentsPhrase(choice.separate.count)}.`;
                return (
                  <TouchableOpacity key={mode} testID={mode === 'absorb' ? 'debt_leftover_absorb' : 'debt_leftover_separate'}
                    accessibilityRole="radio" accessibilityState={{ selected }}
                    onPress={() => { setLeftoverMode(mode); setError(e => (e === LEFTOVER_REQUIRED ? '' : e)); }}
                    style={[styles.leftoverOption, selectionStyle(colors, selected)]}>
                    <Text style={[styles.leftoverTitle, { color: selected ? colors.text : colors.textSecondary }]}>
                      {mode === 'absorb' ? 'يتضاف على آخر قسط' : 'قسط منفصل في الآخر'}
                    </Text>
                    <Text style={styles.leftoverCaption}>{caption}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {linkedToWallet && (
            <>
              <Text style={styles.label}>{debt.direction === 'owed_to_me' ? 'من محفظة' : 'إلى محفظة'}</Text>
              <View style={styles.chipRow}>
                {selectableOptions(wallets).map(w => (
                  <TouchableOpacity {...selectionA11y(walletId === w.id)} key={w.id} onPress={() => setWalletId(w.id)}
                    style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                    <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>التاريخ</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{date}</Text>
          </TouchableOpacity>


          <CalendarPickerModal visible={showPicker} value={date} onSelect={setDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

        {/* فوق الأزرار مش آخر الـScrollView (جولة 1): "اختار الأول" كانت بتقع تحت الشاشة والحفظ "مبيعملش حاجة" */}
        {!!error && <Text testID="debt_increase_error" style={styles.footerError} accessibilityLiveRegion="polite">{error}</Text>}

        <View style={styles.footer}>
          <TouchableOpacity testID="debt_increase_cancel" style={styles.cancelBtn} onPress={onClose}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="debt_increase_save" style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * دين جديد — بتاخد `prefill` اختياري عشان تتفتح من أكتر من مكان لنفس
 * الشخص: زرار "دين جديد" العادي (من غير prefill)، زرار "سجّل الاتجاه
 * العكسي" في كارت الدين (اتجاه مقفول)، وكشف الحساب (اسم بس، من غير اتجاه
 * مقفول). لازم `prefill.personContactId`/`personName` يوصلوا زي ما هما من
 * `reverseDebtPrefill` (`lib/finance.ts`) عشان الدين الجديد يقع في نفس
 * مجموعة `groupDebtsByPerson` بتاعة الشخص — مش نص جديد المستخدم يكتبه تاني.
 */
export function AddDebtModal({ onClose, prefill }: { onClose: () => void; prefill?: DebtPrefill }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { addDebt, wallets } = useData();
  const { busy, run: runBusy } = useBusy();
  const picker = useDeviceContacts();

  const [direction, setDirection] = useState<'owed_to_me' | 'i_owe'>(prefill?.direction ?? 'owed_to_me');
  const [personName, setPersonName] = useState(prefill?.personName ?? '');
  const [personPhone, setPersonPhone] = useState(prefill?.personPhone ?? '');
  const [personContactId, setPersonContactId] = useState(prefill?.personContactId ?? '');
  const [totalAmount, setTotalAmount] = useState('');
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('');
  const [note, setNote] = useState('');
  const [linkedToWallet, setLinkedToWallet] = useState(true);
  const [walletId, setWalletId] = useState(selectableOptions(wallets)[0]?.id);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number | null>(null);

  async function handleSave() {
    // "1e999" كان بيعدّي من فحص الصفر لوحده ويتسجل دين Infinity (`toMoneyAmount`)
    const amt = toMoneyAmount(Number(totalAmount));
    if (!personName.trim() || amt === null) { setError('من فضلك دخّل اسم ومبلغ صحيحين'); return; }
    if (linkedToWallet && !walletId) { setError('اختار محفظة'); return; }
    // دين أقساط من غير عدد = ميزة شكلها شغّال ومبتعملش حاجة: مفيش قيمة قسط،
    // مفيش "القسط 3 من 6"، ومفيش تظبيط للعدد. لازم يتقال دلوقتي مش بعدين.
    const count = isInstallment ? Number(installmentCount) : 0;
    // آمن مش صحيح بس (`storableCount`) — نفس فحص تعديل العدد
    if (isInstallment && !storableCount(count)) {
      setError(INSTALLMENT_COUNT_REQUIRED);
      return;
    }
    // قسط أقل من قرش (0.05 على 10) كان بيتسجل من غير قيمة قسط خالص
    if (isInstallment && !planInstallments(amt, count)) { setError(INSTALLMENT_VALUE_TOO_SMALL); return; }
    await runBusy(async () => {
      try {
        await addDebt({
          direction, personName: personName.trim(), personPhone: personPhone.trim() || undefined, personContactId: personContactId || undefined, totalAmount: amt,
          isInstallment,
          installmentCount: isInstallment ? count : undefined,
          note: note.trim() || undefined,
          walletId: linkedToWallet ? walletId : undefined,
          date,
          dueDate: dueDate || undefined,
          reminderDaysBefore: dueDate && reminderDaysBefore !== null ? reminderDaysBefore : undefined,
        });
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
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>دين جديد</Text>

          <View style={styles.row}>
            <TouchableOpacity {...selectionA11y(direction === 'owed_to_me')} onPress={() => setDirection('owed_to_me')}
              style={[styles.typeBtn, selectionStyle(colors, direction === 'owed_to_me', 'success')]}>
              <Text style={{ color: selectionTextColor(colors, direction === 'owed_to_me'), fontSize: 13 }}>ليا (أنا قرضته)</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(direction === 'i_owe')} onPress={() => setDirection('i_owe')}
              style={[styles.typeBtn, selectionStyle(colors, direction === 'i_owe', 'danger')]}>
              <Text style={{ color: selectionTextColor(colors, direction === 'i_owe'), fontSize: 13 }}>عليا (هو قرضني)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>الدين ده مرتبط بمحفظة دلوقتي؟</Text>
          <View style={styles.row}>
            <TouchableOpacity {...selectionA11y(linkedToWallet)} onPress={() => setLinkedToWallet(true)}
              style={[styles.typeBtn, selectionStyle(colors, linkedToWallet)]}>
              <Text style={{ color: linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>أيوة، فلوس حقيقية</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(!linkedToWallet)} onPress={() => setLinkedToWallet(false)}
              style={[styles.typeBtn, selectionStyle(colors, !linkedToWallet)]}>
              <Text style={{ color: !linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>لأ (بالأجل مثلاً)</Text>
            </TouchableOpacity>
          </View>
          {linkedToWallet ? (
            <Text style={styles.hintText}>
              {direction === 'owed_to_me' ? 'الفلوس هتتخصم من المحفظة اللي هتختارها (لأنك بتديها له)' : 'الفلوس هتتضاف للمحفظة اللي هتختارها (لأنه بيديهالك)'}
            </Text>
          ) : (
            <Text style={styles.hintText}>الدين هيتسجل بس من غير ما يأثر على أي رصيد دلوقتي — وقت السداد بس هيتسجل كعملية حقيقية</Text>
          )}

          <View style={styles.labelRow}>
            <Text style={styles.labelInRow}>اسم الشخص</Text>
            <TouchableOpacity
              onPress={picker.open}
              style={styles.contactBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="اختار من جهات الاتصال">
              <IconSymbol name="person.crop.circle" size={20} color={colors.accent} />
              <Text style={styles.contactBtnText}>من جهات الاتصال</Text>
            </TouchableOpacity>
          </View>
          <TextInput testID="debt_add_person" style={styles.input} value={personName} onChangeText={setPersonName}
            placeholder="مثلاً: أحمد" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ الإجمالي (أول مرة)</Text>
          <TextInput testID="debt_add_amount" style={styles.bigInput} value={totalAmount} onChangeText={setTotalAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          {linkedToWallet && (
            <>
              <Text style={styles.label}>{direction === 'owed_to_me' ? 'من محفظة' : 'إلى محفظة'}</Text>
              <View style={styles.chipRow}>
                {selectableOptions(wallets).map(w => (
                  <TouchableOpacity {...selectionA11y(walletId === w.id)} key={w.id} onPress={() => setWalletId(w.id)}
                    style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                    <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>التاريخ</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{date}</Text>
          </TouchableOpacity>

          <View style={styles.row}>
            <TouchableOpacity {...selectionA11y(!isInstallment)} onPress={() => setIsInstallment(false)}
              style={[styles.typeBtn, selectionStyle(colors, !isInstallment)]}>
              <Text style={{ color: !isInstallment ? colors.text : colors.textSecondary, fontSize: 13 }}>مبلغ واحد</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(isInstallment)} onPress={() => setIsInstallment(true)}
              style={[styles.typeBtn, selectionStyle(colors, isInstallment)]}>
              <Text style={{ color: isInstallment ? colors.text : colors.textSecondary, fontSize: 13 }}>أقساط</Text>
            </TouchableOpacity>
          </View>

          {isInstallment && (
            <>
              <Text style={styles.label}>عدد الأقساط</Text>
              <TextInput style={styles.input} value={installmentCount} onChangeText={setInstallmentCount}
                placeholder="مثلاً: 6" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />
            </>
          )}

          <DebtReminderFields
            dueDate={dueDate}
            reminderDaysBefore={reminderDaysBefore}
            onChangeDueDate={setDueDate}
            onChangeReminder={setReminderDaysBefore}
          />

          <Text style={styles.label}>ملاحظة</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote}
            placeholder="اختياري" placeholderTextColor={colors.textSecondary} textAlign="right" />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <CalendarPickerModal visible={showPicker} value={date} onSelect={setDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity testID="debt_add_cancel" style={styles.cancelBtn} onPress={onClose}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="debt_add_save" style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
          </TouchableOpacity>
        </View>
        </View>

        <ContactPickerModal
          visible={picker.visible}
          contacts={picker.contacts}
          onClose={picker.close}
          onPick={ct => {
            setPersonName(ct.name);
            setPersonPhone(ct.phone);
            setPersonContactId(ct.id);
            picker.close();
          }}
          onCreateContact={picker.createContact}
        />
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    scrollArea: { flexShrink: 1 },
    sheetContent: { padding: 20 },
    sheetTitle: sheetTitleStyle(c, 4),
    hintText: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 6, lineHeight: 17 },
    installmentText: { color: c.accentText, fontSize: 12.5, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    row: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    labelRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 6 },
    labelInRow: { color: c.textSecondary, fontSize: 12, textAlign: 'right' },
    contactBtn: {
      flexDirection: 'row-reverse', alignItems: 'center', gap: 6, minHeight: 44,
      paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1.5, borderColor: c.accent, borderRadius: 10, backgroundColor: c.surface2,
    },
    contactBtnText: { color: c.accentText, fontSize: 12.5, fontWeight: '700' },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    // اختيارين فوق بعض بعرض كامل، كل واحد بشرحه (arabic-copy-reviewer: جنب بعض مش هيكفي الشرح)
    leftoverQuestion: { color: c.text, fontSize: 13, textAlign: 'right', marginTop: 14, marginBottom: 8, lineHeight: 20 },
    leftoverOption: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, minHeight: 44 },
    leftoverTitle: { fontSize: 13.5, fontWeight: '700', textAlign: 'right' },
    leftoverCaption: { color: c.textSecondary, fontSize: 12.5, textAlign: 'right', marginTop: 4, lineHeight: 19 },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.dangerText, fontSize: 13, textAlign: 'center', marginTop: 12 },
    footerError: { color: c.dangerText, fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.6 },
  });
}
