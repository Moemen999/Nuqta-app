import AmountPreview from '@/components/AmountPreview';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import ContactPickerModal from '@/components/ContactPickerModal';
import DebtReminderFields from '@/components/DebtReminderFields';
import { useDeviceContacts } from '@/components/useDeviceContacts';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PAY_OUTCOME_ALERT_DEBT, useData, type Debt } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectableOptions } from '@/lib/archiving';
import {
  categoryLabel, debtRemaining, fmt, installmentProgressLabel, installmentValue,
  overpayCheck, projectBalances, todayStr, type DebtPrefill,
} from '@/lib/finance';
import { selectionStyle, selectionTextColor } from '@/lib/selection';
import { overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useBusy } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

/**
 * مودالات تسجيل دفعة وزيادة على دين ودين جديد.
 *
 * كانوا جوه شاشة الديون، واتنقلوا هنا عشان كشف حساب الشخص (وكارت الدين نفسه
 * لدين جديد بالاتجاه العكسي) يفتحوا **نفس** المودالات بدل ما نعمل نسخة
 * تانية منهم. نسختين من فورم بيسجّل فلوس = مكانين لازم يتغيّروا مع كل
 * تعديل، وواحد فيهم هينساه حد.
 */

export const INSTALLMENTS_CHANGED_TITLE = 'عدد الأقساط اتظبط';
export const INSTALLMENT_COUNT_REQUIRED = 'دخّل عدد الأقساط — رقم صحيح أكبر من صفر.';

export function DebtPaymentModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, transactions, addDebtPayment } = useData();
  const { busy, run: runBusy } = useBusy();

  const remaining = debtRemaining(debt);

  /**
   * دين الأقساط بيقترح **قيمة القسط** مش المتبقي كله.
   *
   * قبل كده الخانة كانت بتتملّى بالمتبقي بالكامل، فاللي بيسدد قسط من ستة
   * كان لازم يمسح الرقم ويكتب قسطه كل مرة. ولسه يقدر يعدّله — الاقتراح
   * اقتراح مش قفل، ودي نص القاعدة: يدفع أقل أو أكتر والعدد يتظبط لوحده.
   */
  const suggested = useMemo(() => {
    const value = installmentValue(debt);
    if (value && remaining > value + 0.005) return Math.round(value * 100) / 100;
    return remaining;
  }, [debt, remaining]);
  const progressLabel = installmentProgressLabel(debt);

  const [amount, setAmount] = useState(String(suggested > 0 ? suggested : ''));
  const [walletId, setWalletId] = useState(selectableOptions(wallets)[0]?.id);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  // السداد بيولّد عملية فعلية: إيراد لو الدين ليك، مصروف لو عليك
  const projections = useMemo(() => projectBalances({
    transactions, wallets, amount: Number(amount), walletId,
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
      ? `مفيش متبقي على ${debt.personName}.\nاللي هيتسجّل: ${fmt(amt)} ج.م\nنسجّله؟`
      : `المتبقي على ${debt.personName}: ${fmt(remaining)} ج.م\nاللي هيتسجّل: ${fmt(amt)} ج.م\nيعني زيادة ${fmt(excess)} ج.م — نسجّله؟`;
    return new Promise<boolean>(resolve => {
      Alert.alert(title, body, [
        { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
        { text: 'أيوة، سجّل', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  }

  async function handleSave() {
    const amt = Number(amount);
    if (!amt || amt <= 0 || !walletId) { setError('دخّل مبلغ ومحفظة صحيحين'); return; }
    const check = overpayCheck(amt, remaining);
    if (check !== 'none' && !(await confirmOverpay(check, amt))) return;
    await runBusy(async () => {
      let result: Awaited<ReturnType<typeof addDebtPayment>>;
      try {
        result = await addDebtPayment(debt.id, amt, walletId, date, debt.direction === 'i_owe' ? categoryId : undefined);
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
        Alert.alert(alert.title, alert.body);
        return;
      }
      // "دفعت 700 بدل 1000، الأقساط بقت 7" — التغيير بيتقال بالكلام، عشان
      // المستخدم ميلاقيش العدد اتغيّر لوحده ومحدش قاله ليه
      if (result.note) Alert.alert(INSTALLMENTS_CHANGED_TITLE, result.note);
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
          <Text style={styles.hintText}>المتبقي: {fmt(remaining)} ج.م</Text>
          {!!progressLabel && <Text style={styles.installmentText}>{progressLabel}</Text>}

          <Text style={styles.label}>المبلغ</Text>
          <TextInput testID="debt_payment_amount" style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />
          <AmountPreview amount={amount} projections={projections} />

          <Text style={styles.label}>{debt.direction === 'owed_to_me' ? 'المحفظة اللي هتستلم فيها' : 'المحفظة اللي هتدفع منها'}</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets).map(w => (
              <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {debt.direction === 'i_owe' && (
            <>
              <Text style={styles.label}>الفئة (اختياري)</Text>
              <View style={styles.chipRow}>
                {selectableOptions(categories).map(c => (
                  <TouchableOpacity key={c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
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
  const { busy, run: runBusy } = useBusy();

  const [amount, setAmount] = useState('');
  const [linkedToWallet, setLinkedToWallet] = useState(true);
  const [walletId, setWalletId] = useState(selectableOptions(wallets)[0]?.id);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  // الزيادة بالأجل مش بتلمس محفظة خالص، فمفيش رصيد نعرضه — ولا صفر ولا شرطة
  const projections = useMemo(() => projectBalances({
    transactions, wallets, amount: Number(amount),
    walletId: linkedToWallet ? walletId : undefined,
    type: debt.direction === 'owed_to_me' ? 'expense' : 'income',
  }), [transactions, wallets, amount, walletId, linkedToWallet, debt.direction]);

  async function handleSave() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('دخّل مبلغ صحيح'); return; }
    if (linkedToWallet && !walletId) { setError('اختار محفظة'); return; }
    await runBusy(async () => {
      let outcome: Awaited<ReturnType<typeof addDebtIncrease>>;
      try {
        outcome = await addDebtIncrease(debt.id, amt, date, linkedToWallet ? walletId : undefined);
      } catch {
        // الزيادة بقت عملية ذرية بترجّع نتيجة بدل ما ترمي — فاضل للأخطاء
        // المتزامنة بس
        setError('حصل خطأ، جرب تاني');
        return;
      }
      if (outcome !== 'done') {
        const alert = PAY_OUTCOME_ALERT_DEBT[outcome];
        Alert.alert(alert.title, alert.body);
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
          <Text style={styles.sheetTitle}>زيادة على دين — {debt.personName}</Text>

          <Text style={styles.label}>مرتبط بمحفظة دلوقتي؟</Text>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setLinkedToWallet(true)}
              style={[styles.typeBtn, selectionStyle(colors, linkedToWallet)]}>
              <Text style={{ color: linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>أيوة</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLinkedToWallet(false)}
              style={[styles.typeBtn, selectionStyle(colors, !linkedToWallet)]}>
              <Text style={{ color: !linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>لأ (بالأجل)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>المبلغ الإضافي</Text>
          <TextInput testID="debt_increase_amount" style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />
          <AmountPreview amount={amount} projections={projections} />

          {linkedToWallet && (
            <>
              <Text style={styles.label}>{debt.direction === 'owed_to_me' ? 'من محفظة' : 'إلى محفظة'}</Text>
              <View style={styles.chipRow}>
                {selectableOptions(wallets).map(w => (
                  <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
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

          {!!error && <Text style={styles.error}>{error}</Text>}

          <CalendarPickerModal visible={showPicker} value={date} onSelect={setDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

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
    const amt = Number(totalAmount);
    if (!personName.trim() || !amt || amt <= 0) { setError('من فضلك دخّل اسم ومبلغ صحيحين'); return; }
    if (linkedToWallet && !walletId) { setError('اختار محفظة'); return; }
    // دين أقساط من غير عدد = ميزة شكلها شغّال ومبتعملش حاجة: مفيش قيمة قسط،
    // مفيش "القسط 3 من 6"، ومفيش تظبيط للعدد. لازم يتقال دلوقتي مش بعدين.
    const count = isInstallment ? Number(installmentCount) : 0;
    if (isInstallment && (!Number.isInteger(count) || count <= 0)) {
      setError(INSTALLMENT_COUNT_REQUIRED);
      return;
    }
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
            <TouchableOpacity onPress={() => setDirection('owed_to_me')}
              style={[styles.typeBtn, selectionStyle(colors, direction === 'owed_to_me', 'success')]}>
              <Text style={{ color: selectionTextColor(colors, direction === 'owed_to_me'), fontSize: 13 }}>ليا (أنا قرضته)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDirection('i_owe')}
              style={[styles.typeBtn, selectionStyle(colors, direction === 'i_owe', 'danger')]}>
              <Text style={{ color: selectionTextColor(colors, direction === 'i_owe'), fontSize: 13 }}>عليا (هو قرضني)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>الدين ده مرتبط بمحفظة دلوقتي؟</Text>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setLinkedToWallet(true)}
              style={[styles.typeBtn, selectionStyle(colors, linkedToWallet)]}>
              <Text style={{ color: linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>أيوة، فلوس حقيقية</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLinkedToWallet(false)}
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
          <TextInput style={styles.input} value={personName} onChangeText={setPersonName}
            placeholder="مثلاً: أحمد" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ الإجمالي (أول مرة)</Text>
          <TextInput style={styles.bigInput} value={totalAmount} onChangeText={setTotalAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          {linkedToWallet && (
            <>
              <Text style={styles.label}>{direction === 'owed_to_me' ? 'من محفظة' : 'إلى محفظة'}</Text>
              <View style={styles.chipRow}>
                {selectableOptions(wallets).map(w => (
                  <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
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
            <TouchableOpacity onPress={() => setIsInstallment(false)}
              style={[styles.typeBtn, selectionStyle(colors, !isInstallment)]}>
              <Text style={{ color: !isInstallment ? colors.text : colors.textSecondary, fontSize: 13 }}>مبلغ واحد</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsInstallment(true)}
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
    hintText: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 6, lineHeight: 16 },
    installmentText: { color: c.accent, fontSize: 12.5, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    row: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    labelRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 6 },
    labelInRow: { color: c.textSecondary, fontSize: 12, textAlign: 'right' },
    contactBtn: {
      flexDirection: 'row-reverse', alignItems: 'center', gap: 6, minHeight: 44,
      paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1.5, borderColor: c.accent, borderRadius: 10, backgroundColor: c.surface2,
    },
    contactBtnText: { color: c.accent, fontSize: 12.5, fontWeight: '700' },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.6 },
  });
}
