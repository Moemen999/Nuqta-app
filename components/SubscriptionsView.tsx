import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData, type Subscription } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { categoryLabel, fmt, todayStr } from '@/lib/finance';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

function daysUntil(dateStr: string) {
  const today = new Date(todayStr());
  const target = new Date(dateStr);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const FREQ_LABEL: Record<string, string> = { monthly: 'شهري', yearly: 'سنوي', custom: 'مخصص' };

export default function SubscriptionsView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { subscriptions, wallets, categories, deleteSubscription, markSubscriptionPaid } = useData();
  const [showAdd, setShowAdd] = useState(false);

  const active = [...subscriptions].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  function confirmDelete(s: Subscription) {
    Alert.alert('حذف الاشتراك', `متأكد إنك عايز تمسح "${s.name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => deleteSubscription(s.id) },
    ]);
  }
  function confirmPay(s: Subscription) {
    Alert.alert('تسجيل الدفع', `اتخصم ${fmt(s.amount)} ج.م من محفظتك دلوقتي؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'تأكيد', onPress: () => markSubscriptionPaid(s.id, todayStr()) },
    ]);
  }

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13 }}>+ اشتراك جديد</Text>
        </TouchableOpacity>
        <Text style={styles.title}>الاشتراكات</Text>
      </View>

      {active.length === 0 && <Text style={styles.emptyState}>مفيش اشتراكات مسجلة</Text>}
      {active.map(s => {
        const wallet = wallets.find(w => w.id === s.walletId);
        const cat = s.categoryId ? categories.find(c => c.id === s.categoryId) : undefined;
        const days = daysUntil(s.nextDueDate);
        const soon = days <= s.reminderDaysBefore;
        return (
          <View key={s.id} style={[styles.card, soon && { borderColor: colors.warnBorder }]}>
            <View style={styles.cardHead}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.amount}>{fmt(s.amount)} ج.م</Text>
            </View>
            <Text style={styles.sub}>
              {wallet?.name || ''}{cat ? ' · ' + categoryLabel(cat) : ''} · {FREQ_LABEL[s.frequency]}
            </Text>
            <Text style={[styles.due, { color: soon ? colors.accent : colors.textSecondary }]}>
              {days < 0 ? `متأخر ${Math.abs(days)} يوم` : days === 0 ? 'مستحق النهاردة' : `مستحق بعد ${days} يوم (${s.nextDueDate})`}
            </Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.payBtn} onPress={() => confirmPay(s)}>
                <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>اتخصم</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => confirmDelete(s)}>
                <Text style={{ color: colors.danger, fontSize: 12.5 }}>حذف</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <AddSubscriptionModal visible={showAdd} onClose={() => setShowAdd(false)} />
    </ScrollView>
  );
}

function AddSubscriptionModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, addSubscription } = useData();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState(wallets[0]?.id);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [frequency, setFrequency] = useState<'monthly' | 'yearly' | 'custom'>('monthly');
  const [customDays, setCustomDays] = useState('30');
  const [nextDueDate, setNextDueDate] = useState(todayStr());
  const [reminderDays, setReminderDays] = useState('3');
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setName(''); setAmount(''); setFrequency('monthly'); setCustomDays('30');
    setNextDueDate(todayStr()); setReminderDays('3'); setError(''); setCategoryId(undefined);
  }

  async function handleSave() {
    const amt = Number(amount);
    if (!name.trim() || !amt || amt <= 0 || !walletId) { setError('دخّل اسم ومبلغ ومحفظة صحيحين'); return; }
    await addSubscription({
      name: name.trim(), amount: amt, walletId, categoryId,
      frequency, customDays: frequency === 'custom' ? Number(customDays) || 30 : undefined,
      nextDueDate, reminderDaysBefore: Number(reminderDays) || 0,
    });
    reset();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <ScrollView style={styles.sheet} keyboardShouldPersistTaps="handled">
          <Text style={styles.sheetTitle}>اشتراك جديد</Text>

          <Text style={styles.label}>الاسم</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName}
            placeholder="مثلاً: نتفليكس" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ</Text>
          <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {wallets.map(w => (
              <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, { borderColor: walletId === w.id ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>الفئة (اختياري)</Text>
          <View style={styles.chipRow}>
            {categories.map(c => (
              <TouchableOpacity key={c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                style={[styles.chip, { borderColor: categoryId === c.id ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{categoryLabel(c)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>التكرار</Text>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setFrequency('monthly')} style={[styles.typeBtn, { borderColor: frequency === 'monthly' ? colors.accent : colors.borderStrong }]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>شهري</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFrequency('yearly')} style={[styles.typeBtn, { borderColor: frequency === 'yearly' ? colors.accent : colors.borderStrong }]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>سنوي</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFrequency('custom')} style={[styles.typeBtn, { borderColor: frequency === 'custom' ? colors.accent : colors.borderStrong }]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>مخصص</Text>
            </TouchableOpacity>
          </View>

          {frequency === 'custom' && (
            <>
              <Text style={styles.label}>كل كام يوم</Text>
              <TextInput style={styles.input} value={customDays} onChangeText={setCustomDays}
                keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          <Text style={styles.label}>أول موعد استحقاق</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{nextDueDate}</Text>
          </TouchableOpacity>

          <Text style={styles.label}>التذكير قبل الموعد بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { reset(); onClose(); }}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>حفظ</Text>
            </TouchableOpacity>
          </View>

          <CalendarPickerModal visible={showPicker} value={nextDueDate} onSelect={setNextDueDate} onClose={() => setShowPicker(false)} />
        </ScrollView>
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
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    cardHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    name: { color: c.text, fontSize: 14.5, fontWeight: '700' },
    amount: { color: c.text, fontSize: 14, fontWeight: '700' },
    sub: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 4 },
    due: { fontSize: 12, textAlign: 'right', marginTop: 6, fontWeight: '600' },
    actionsRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
    payBtn: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    deleteBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.nav, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
    sheetTitle: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    row: { flexDirection: 'row-reverse', gap: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    actions: { flexDirection: 'row-reverse', gap: 10, marginTop: 20, marginBottom: 6 },
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  });
}