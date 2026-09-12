import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData, type Debt } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { categoryLabel, debtGrandTotal, debtPaid, fmt, todayStr } from '@/lib/finance';
import { selectionStyle } from '@/lib/selection';
import { overlayStyle, sheetStyle, sheetTitleStyle } from '@/lib/tokens';
import { useBusy } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

/**
 * مودالات تسجيل دفعة وزيادة على دين.
 *
 * كانوا جوه شاشة الديون، واتنقلوا هنا عشان كشف حساب الشخص يفتح **نفس**
 * المودالات بدل ما نعمل نسخة تانية منهم. نسختين من فورم بيسجّل فلوس =
 * مكانين لازم يتغيّروا مع كل تعديل، وواحد فيهم هينساه حد.
 */

export function DebtPaymentModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, addDebtPayment } = useData();
  const { busy, run: runBusy } = useBusy();

  const remaining = debtGrandTotal(debt) - debtPaid(debt);

  const [amount, setAmount] = useState(String(remaining > 0 ? remaining : ''));
  const [walletId, setWalletId] = useState(wallets[0]?.id);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    const amt = Number(amount);
    if (!amt || amt <= 0 || !walletId) { setError('دخّل مبلغ ومحفظة صحيحين'); return; }
    await runBusy(async () => {
      try {
        await addDebtPayment(debt.id, amt, walletId, date, debt.direction === 'i_owe' ? categoryId : undefined);
      } catch {
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
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>تسجيل دفعة — {debt.personName}</Text>
          <Text style={styles.hintText}>المتبقي: {fmt(remaining)} ج.م</Text>

          <Text style={styles.label}>المبلغ</Text>
          <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          <Text style={styles.label}>{debt.direction === 'owed_to_me' ? 'المحفظة اللي هتستلم فيها' : 'المحفظة اللي هتدفع منها'}</Text>
          <View style={styles.chipRow}>
            {wallets.map(w => (
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
                {categories.map(c => (
                  <TouchableOpacity key={c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                    style={[styles.chip, selectionStyle(colors, categoryId === c.id)]}>
                    <Text style={{ color: colors.text, fontSize: 13 }}>{categoryLabel(c)}</Text>
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

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
            </TouchableOpacity>
          </View>

          <CalendarPickerModal visible={showPicker} value={date} onSelect={setDate} onClose={() => setShowPicker(false)} />
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function DebtIncreaseModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, addDebtIncrease } = useData();
  const { busy, run: runBusy } = useBusy();

  const [amount, setAmount] = useState('');
  const [linkedToWallet, setLinkedToWallet] = useState(true);
  const [walletId, setWalletId] = useState(wallets[0]?.id);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('دخّل مبلغ صحيح'); return; }
    if (linkedToWallet && !walletId) { setError('اختار محفظة'); return; }
    await runBusy(async () => {
      try {
        await addDebtIncrease(debt.id, amt, date, linkedToWallet ? walletId : undefined);
      } catch {
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
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
          <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          {linkedToWallet && (
            <>
              <Text style={styles.label}>{debt.direction === 'owed_to_me' ? 'من محفظة' : 'إلى محفظة'}</Text>
              <View style={styles.chipRow}>
                {wallets.map(w => (
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

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
            </TouchableOpacity>
          </View>

          <CalendarPickerModal visible={showPicker} value={date} onSelect={setDate} onClose={() => setShowPicker(false)} />
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: sheetStyle(c, { maxHeight: '90%' }),
    sheetTitle: sheetTitleStyle(c, 4),
    hintText: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 6, lineHeight: 16 },
    row: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    actions: { flexDirection: 'row-reverse', gap: 10, marginTop: 20, marginBottom: 10 },
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.6 },
  });
}
