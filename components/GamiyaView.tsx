import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData, type Gamiya } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { daysUntil, fmt, todayStr } from '@/lib/finance';
import { useBusy, useBusyKey } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function GamiyaView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { gamiyas, wallets, deleteGamiya, markGamiyaMonthDone } = useData();
  const { busyKey, run: runBusy } = useBusyKey();
  const [showAdd, setShowAdd] = useState(false);
  const [editingGamiya, setEditingGamiya] = useState<Gamiya | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function confirmDelete(g: Gamiya) {
    Alert.alert('حذف الجمعية', `متأكد إنك عايز تمسح "${g.name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => runBusy(`del_${g.id}`, () => deleteGamiya(g.id)) },
    ]);
  }
  function confirmMark(g: Gamiya, monthId: string, isPayout: boolean, amount: number) {
    Alert.alert(
      isPayout ? 'استلام الجمعية' : 'تسجيل القسط',
      isPayout ? `هتستلم ${fmt(amount)} ج.م في محفظتك؟` : `هيتخصم ${fmt(amount)} ج.م من محفظتك؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'تأكيد', onPress: () => runBusy(`month_${monthId}`, () => markGamiyaMonthDone(g.id, monthId)) },
      ]
    );
  }

  return (
    <ScrollView
      style={styles.scrollArea}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <View style={styles.titleRow}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13 }}>+ جمعية جديدة</Text>
        </TouchableOpacity>
        <Text style={styles.title}>الجمعية</Text>
      </View>

      {gamiyas.length === 0 && <Text style={styles.emptyState}>مفيش جمعية مسجلة</Text>}
      {gamiyas.map(g => {
        const wallet = wallets.find(w => w.id === g.walletId);
        const doneCount = g.months.filter(m => m.status === 'done').length;
        const pct = g.months.length > 0 ? (doneCount / g.months.length) * 100 : 0;
        const nextPending = g.months.find(m => m.status === 'pending');
        const isExpanded = expanded === g.id;

        return (
          <View key={g.id} style={styles.card}>
            <TouchableOpacity onPress={() => setExpanded(isExpanded ? null : g.id)}>
              <View style={styles.cardHead}>
                <Text style={styles.name}>{g.name}</Text>
                <Text style={styles.sub2}>{wallet?.name || ''}</Text>
              </View>
              <Text style={styles.sub}>
                {fmt(g.monthlyAmount)} ج.م/شهر · شهر الاستلام: {g.payoutMonthIndex} من {g.totalMonths} ({fmt(g.payoutAmount)} ج.م)
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accent }]} />
              </View>
              <Text style={styles.progressText}>اتسدد {doneCount} من {g.months.length} شهر</Text>
              {nextPending && (
                <Text style={[styles.due, { color: daysUntil(nextPending.dueDate) <= g.reminderDaysBefore ? colors.accent : colors.textSecondary }]}>
                  {nextPending.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} الجاي: {nextPending.dueDate} ({fmt(nextPending.amount)} ج.م)
                </Text>
              )}
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.expandedArea}>
                {g.months.map(m => (
                  <View key={m.id} style={styles.monthRow}>
                    <Text style={[styles.monthText, { color: m.status === 'done' ? colors.textMuted : colors.text }]}>
                      شهر {m.monthIndex} {m.isPayoutMonth ? '(استلام)' : ''} · {m.dueDate} · {fmt(m.amount)} ج.م
                    </Text>
                    {m.status === 'pending' ? (
                      <TouchableOpacity
                        onPress={() => confirmMark(g, m.id, m.isPayoutMonth, m.amount)}
                        style={[styles.markBtn, busyKey === `month_${m.id}` && styles.btnBusy]}
                        disabled={busyKey === `month_${m.id}`}>
                        <Text style={{ color: colors.onAccent, fontSize: 11, fontWeight: '700' }}>
                          {busyKey === `month_${m.id}` ? '...' : m.isPayoutMonth ? 'استلمت' : 'اتخصم'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={{ color: colors.success, fontSize: 11 }}>✓ خلص</Text>
                    )}
                  </View>
                ))}
                <View style={styles.gamiyaActions}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => setEditingGamiya(g)}>
                    <Text style={{ color: colors.text, fontSize: 12.5 }}>تعديل</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.deleteBtnFlex, busyKey === `del_${g.id}` && styles.btnBusy]} onPress={() => confirmDelete(g)} disabled={busyKey === `del_${g.id}`}>
                    <Text style={{ color: colors.danger, fontSize: 12.5 }}>{busyKey === `del_${g.id}` ? '...' : 'حذف الجمعية'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}

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
  const [walletId, setWalletId] = useState(wallets[0]?.id);
  const [startDate, setStartDate] = useState(todayStr());
  const [reminderDays, setReminderDays] = useState('3');
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setName(''); setMonthlyAmount(''); setTotalMonths('12'); setPayoutMonthIndex('1');
    setPayoutAmount(''); setStartDate(todayStr()); setReminderDays('3'); setError('');
  }

  async function handleSave() {
    const monthly = Number(monthlyAmount);
    const total = Number(totalMonths);
    const payoutIdx = Number(payoutMonthIndex);
    const payout = Number(payoutAmount);
    if (!name.trim() || !monthly || monthly <= 0 || !total || total <= 0 || !payoutIdx || payoutIdx < 1 || payoutIdx > total || !payout || payout <= 0 || !walletId) {
      setError('راجع البيانات — تأكد إن شهر الاستلام رقم صحيح ضمن عدد الشهور');
      return;
    }
    await runBusy(async () => {
      try {
        await addGamiya({
          name: name.trim(), monthlyAmount: monthly, totalMonths: total,
          payoutMonthIndex: payoutIdx, payoutAmount: payout, walletId, startDate,
          reminderDaysBefore: Number(reminderDays) || 0,
        });
      } catch {
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
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
            {wallets.map(w => (
              <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, { borderColor: walletId === w.id ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>تاريخ أول قسط</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{startDate}</Text>
          </TouchableOpacity>

          <Text style={styles.label}>التذكير قبل كل قسط بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { reset(); onClose(); }}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
            </TouchableOpacity>
          </View>

          <CalendarPickerModal visible={showPicker} value={startDate} onSelect={setStartDate} onClose={() => setShowPicker(false)} />
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
    sub2: { color: c.textSecondary, fontSize: 12 },
    sub: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 4 },
    track: { height: 6, backgroundColor: c.surface2, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3 },
    progressText: { color: c.textSecondary, fontSize: 11, textAlign: 'right', marginTop: 6 },
    due: { fontSize: 12, textAlign: 'right', marginTop: 6, fontWeight: '600' },
    expandedArea: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
    monthRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
    monthText: { fontSize: 12, flex: 1, textAlign: 'right' },
    markBtn: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
    deleteBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 8, alignItems: 'center', paddingVertical: 9, marginTop: 10 },
    gamiyaActions: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
    editBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, alignItems: 'center', paddingVertical: 9 },
    deleteBtnFlex: { flex: 1, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 8, alignItems: 'center', paddingVertical: 9 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.nav, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
    sheetTitle: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    hintNote: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', lineHeight: 17, marginBottom: 4 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    actions: { flexDirection: 'row-reverse', gap: 10, marginTop: 20, marginBottom: 6 },
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
  const [reminderDays, setReminderDays] = useState(String(gamiya.reminderDaysBefore));
  const [error, setError] = useState('');

  const doneCount = gamiya.months.filter(m => m.status === 'done').length;

  async function handleSave() {
    if (!name.trim() || !walletId) { setError('دخّل اسم ومحفظة صحيحين'); return; }
    await runBusy(async () => {
      try {
        await updateGamiya(gamiya.id, {
          name: name.trim(),
          walletId,
          reminderDaysBefore: Number(reminderDays) || 0,
        });
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
            {wallets.map(w => (
              <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, { borderColor: walletId === w.id ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>التذكير قبل كل قسط بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ التعديل'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
