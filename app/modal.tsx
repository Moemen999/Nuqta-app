import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { categoryLabel, todayStr } from '@/lib/finance';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TYPES = [
  { key: 'expense', label: 'مصروف' },
  { key: 'income', label: 'إيراد' },
  { key: 'withdraw', label: 'سحب' },
] as const;

export default function AddTransactionModal() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const TYPE_COLORS: Record<string, string> = {
    expense: colors.danger, income: colors.success, withdraw: colors.accent,
  };

  const { id } = useLocalSearchParams<{ id?: string }>();
  const { wallets, categories, transactions, addTransaction, updateTransaction, deleteTransaction } = useData();
  const existing = id ? transactions.find(t => t.id === id) : undefined;
  const isEdit = !!existing;

  const [type, setType] = useState<'expense' | 'income' | 'withdraw'>('expense');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState<string | undefined>(undefined);
  const [toWalletId, setToWalletId] = useState<string | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayStr());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existing && !loaded) {
      setType(existing.type);
      setAmount(String(existing.amount));
      setWalletId(existing.walletId);
      setToWalletId(existing.toWalletId);
      setCategoryId(existing.categoryId);
      setNote(existing.note || '');
      setDate(existing.date);
      setLoaded(true);
    } else if (!id && walletId === undefined && wallets.length > 0) {
      setWalletId(wallets[0]?.id);
      setToWalletId(wallets[1]?.id ?? wallets[0]?.id);
      setCategoryId(categories[0]?.id);
    }
  }, [existing, wallets, categories]);

  async function handleSave() {
    const amt = Number(amount);
    if (!amt || amt <= 0 || !walletId) { setError('من فضلك دخّل مبلغ صحيح ومحفظة'); return; }
    if (type === 'withdraw' && (!toWalletId || toWalletId === walletId)) {
      setError('اختار محفظة وجهة مختلفة'); return;
    }
    setBusy(true);
    try {
      const payload = {
        type, amount: amt, walletId,
        toWalletId: type === 'withdraw' ? toWalletId : undefined,
        categoryId: type === 'expense' ? categoryId : undefined,
        note: note.trim(),
        date,
        ...(isEdit ? {} : { createdAt: new Date().toISOString() }),
      };
      if (isEdit && existing) {
        await updateTransaction(existing.id, payload);
      } else {
        await addTransaction(payload);
      }
      router.back();
    } catch {
      setError('حصل خطأ، جرب تاني');
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    if (!existing) return;
    Alert.alert('حذف العملية', 'متأكد إنك عايز تمسحها؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: async () => {
          await deleteTransaction(existing.id);
          router.back();
        }
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{isEdit ? 'تعديل عملية' : 'عملية جديدة'}</Text>

      <View style={styles.row}>
        {TYPES.map(t => (
          <TouchableOpacity key={t.key} onPress={() => setType(t.key)}
            style={[styles.typeBtn, { borderColor: type === t.key ? TYPE_COLORS[t.key] : colors.borderStrong }]}>
            <Text style={{ color: type === t.key ? TYPE_COLORS[t.key] : colors.textSecondary, fontSize: 13 }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>المبلغ</Text>
      <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
        placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

      <Text style={styles.label}>{type === 'withdraw' ? 'من محفظة' : 'المحفظة'}</Text>
      <View style={styles.chipRow}>
        {wallets.map(w => (
          <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
            style={[styles.chip, { borderColor: walletId === w.id ? colors.accent : colors.borderStrong }]}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {type === 'withdraw' && (
        <>
          <Text style={styles.label}>إلى محفظة</Text>
          <View style={styles.chipRow}>
            {wallets.filter(w => w.id !== walletId).map(w => (
              <TouchableOpacity key={w.id} onPress={() => setToWalletId(w.id)}
                style={[styles.chip, { borderColor: toWalletId === w.id ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {type === 'expense' && (
        <>
          <Text style={styles.label}>الفئة</Text>
          <View style={styles.chipRow}>
            {categories.map(c => (
              <TouchableOpacity key={c.id} onPress={() => setCategoryId(c.id)}
                style={[styles.chip, { borderColor: categoryId === c.id ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{categoryLabel(c)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>التاريخ</Text>
      <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
        <Text style={styles.dateBtnText}>{date}</Text>
      </TouchableOpacity>

      <Text style={styles.label}>ملاحظة</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote}
        placeholder="اختياري" placeholderTextColor={colors.textSecondary} textAlign="right" />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        {isEdit && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <Text style={{ color: colors.danger }}>حذف</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={busy}>
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
        </TouchableOpacity>
      </View>

      <CalendarPickerModal
        visible={showDatePicker}
        value={date}
        onSelect={setDate}
        onClose={() => setShowDatePicker(false)}
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, paddingBottom: 60 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 16 },
    row: { flexDirection: 'row-reverse', gap: 8, marginBottom: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    actions: { flexDirection: 'row-reverse', gap: 10, marginTop: 24 },
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    deleteBtn: { flex: 1, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  });
}