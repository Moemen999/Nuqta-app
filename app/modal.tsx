import { useData } from '@/context/DataContext';
import { todayStr } from '@/lib/finance';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const TYPES = [
  { key: 'expense', label: 'مصروف', color: '#D97878' },
  { key: 'income', label: 'إيراد', color: '#7FA98F' },
  { key: 'withdraw', label: 'سحب', color: '#C9A961' },
] as const;

export default function AddTransactionModal() {
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
        date: existing?.date || todayStr(),
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{isEdit ? 'تعديل عملية' : 'عملية جديدة'}</Text>

      <View style={styles.row}>
        {TYPES.map(t => (
          <TouchableOpacity key={t.key} onPress={() => setType(t.key)}
            style={[styles.typeBtn, { borderColor: type === t.key ? t.color : '#262B33' }]}>
            <Text style={{ color: type === t.key ? t.color : '#8B92A0', fontSize: 13 }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>المبلغ</Text>
      <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
        placeholder="0" placeholderTextColor="#6B7280" keyboardType="numeric" textAlign="right" />

      <Text style={styles.label}>{type === 'withdraw' ? 'من محفظة' : 'المحفظة'}</Text>
      <View style={styles.chipRow}>
        {wallets.map(w => (
          <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
            style={[styles.chip, { borderColor: walletId === w.id ? '#C9A961' : '#262B33' }]}>
            <Text style={{ color: '#EDEBE6', fontSize: 13 }}>{w.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {type === 'withdraw' && (
        <>
          <Text style={styles.label}>إلى محفظة</Text>
          <View style={styles.chipRow}>
            {wallets.filter(w => w.id !== walletId).map(w => (
              <TouchableOpacity key={w.id} onPress={() => setToWalletId(w.id)}
                style={[styles.chip, { borderColor: toWalletId === w.id ? '#C9A961' : '#262B33' }]}>
                <Text style={{ color: '#EDEBE6', fontSize: 13 }}>{w.name}</Text>
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
                style={[styles.chip, { borderColor: categoryId === c.id ? '#C9A961' : '#262B33' }]}>
                <Text style={{ color: '#EDEBE6', fontSize: 13 }}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>ملاحظة</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote}
        placeholder="اختياري" placeholderTextColor="#6B7280" textAlign="right" />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        {isEdit && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <Text style={{ color: '#D97878' }}>حذف</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={{ color: '#8B92A0' }}>إلغاء</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={busy}>
          <Text style={{ color: '#0B0D10', fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },
  content: { padding: 20, paddingBottom: 60 },
  title: { color: '#EDEBE6', fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 16 },
  row: { flexDirection: 'row-reverse', gap: 8, marginBottom: 8 },
  typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  label: { color: '#8B92A0', fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
  bigInput: { backgroundColor: '#1C2027', borderWidth: 1, borderColor: '#262B33', borderRadius: 10, color: '#EDEBE6', fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
  input: { backgroundColor: '#1C2027', borderWidth: 1, borderColor: '#262B33', borderRadius: 10, color: '#EDEBE6', fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
  chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  error: { color: '#D97878', fontSize: 13, textAlign: 'center', marginTop: 12 },
  actions: { flexDirection: 'row-reverse', gap: 10, marginTop: 24 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: '#262B33', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  deleteBtn: { flex: 1, borderWidth: 1, borderColor: '#5A3030', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  saveBtn: { flex: 2, backgroundColor: '#C9A961', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
});