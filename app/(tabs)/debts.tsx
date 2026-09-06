import CalendarPickerModal from '@/components/CalendarPickerModal';
import GamiyaView from '@/components/GamiyaView';
import SubscriptionsView from '@/components/SubscriptionsView';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useData, type Debt } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { categoryLabel, debtGrandTotal, debtPaid, fmt, todayStr } from '@/lib/finance';
import { useBusy, useBusyKey } from '@/lib/useBusy';
import * as Contacts from 'expo-contacts';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function debtDate(d: Debt) {
  return d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '0000-00-00');
}

type Tab = 'debts' | 'subscriptions' | 'gamiya';

export default function DebtsTabScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('debts');

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.switcherRow}>
        <TouchableOpacity onPress={() => setTab('debts')}
          style={[styles.switchBtn, { borderColor: tab === 'debts' ? colors.accent : colors.borderStrong }]}>
          <Text style={{ color: tab === 'debts' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>الديون</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('subscriptions')}
          style={[styles.switchBtn, { borderColor: tab === 'subscriptions' ? colors.accent : colors.borderStrong }]}>
          <Text style={{ color: tab === 'subscriptions' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>الاشتراكات</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('gamiya')}
          style={[styles.switchBtn, { borderColor: tab === 'gamiya' ? colors.accent : colors.borderStrong }]}>
          <Text style={{ color: tab === 'gamiya' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>الجمعية</Text>
        </TouchableOpacity>
      </View>

      {tab === 'debts' && <DebtsContent />}
      {tab === 'subscriptions' && <SubscriptionsView />}
      {tab === 'gamiya' && <GamiyaView />}
    </View>
  );
}

function DebtsContent() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { debts, wallets, categories, deleteDebt } = useData();
  const { busyKey, run: runBusy } = useBusyKey();

  const [showAddDebt, setShowAddDebt] = useState(false);
  const [paymentForDebt, setPaymentForDebt] = useState<Debt | null>(null);
  const [increaseForDebt, setIncreaseForDebt] = useState<Debt | null>(null);
  const [expandedDebt, setExpandedDebt] = useState<string | null>(null);

  const owedToMe = debts.filter(d => d.direction === 'owed_to_me');
  const iOwe = debts.filter(d => d.direction === 'i_owe');

  function remainingOf(d: Debt) {
    return debtGrandTotal(d) - debtPaid(d);
  }

  const totalOwedToMe = owedToMe.reduce((s, d) => s + Math.max(0, remainingOf(d)), 0);
  const totalIOwe = iOwe.reduce((s, d) => s + Math.max(0, remainingOf(d)), 0);

  function confirmDeleteDebt(d: Debt) {
    Alert.alert('حذف الدين', `متأكد إنك عايز تمسح دين "${d.personName}"؟ (كل العمليات المرتبطة بيه هتتمسح كمان)`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => runBusy(d.id, () => deleteDebt(d.id)) },
    ]);
  }

  async function openContactCard(d: Debt) {
    try {
      if (d.personContactId) {
        // بيفتح كارت جهة الاتصال الكامل في تطبيق جهات الاتصال
        await Contacts.presentFormAsync(d.personContactId);
        return;
      }
      if (d.personPhone) {
        await Linking.openURL(`tel:${d.personPhone}`);
      }
    } catch {
      if (d.personPhone) {
        Linking.openURL(`tel:${d.personPhone}`).catch(() => {
          Alert.alert('مقدرتش أفتح', 'مقدرتش أفتح جهة الاتصال دي.');
        });
      } else {
        Alert.alert('مقدرتش أفتح', 'مقدرتش أفتح جهة الاتصال دي.');
      }
    }
  }

  function renderDebt(d: Debt) {
    const grandTotal = debtGrandTotal(d);
    const paid = debtPaid(d);
    const remaining = grandTotal - paid;
    const pct = grandTotal > 0 ? Math.min(100, (paid / grandTotal) * 100) : 0;
    const settled = remaining <= 0;
    const color = settled ? colors.success : d.direction === 'owed_to_me' ? colors.success : colors.danger;
    const expanded = expandedDebt === d.id;

    const timeline = [
      { kind: 'initial' as const, date: debtDate(d), amount: d.totalAmount, walletId: d.initialWalletId },
      ...(d.increases || []).map(e => ({ kind: 'increase' as const, ...e })),
      ...d.payments.map(p => ({ kind: 'payment' as const, ...p })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    return (
      <View key={d.id} style={styles.debtCard}>
        <TouchableOpacity onPress={() => setExpandedDebt(expanded ? null : d.id)}>
          <View style={styles.debtHead}>
            {(d.personContactId || d.personPhone) ? (
              <TouchableOpacity onPress={() => openContactCard(d)}>
                <Text style={[styles.personName, styles.personNameLink]}>{d.personName} 👤</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.personName}>{d.personName}</Text>
            )}
            <Text style={[styles.remainingText, { color }]}>
              {settled ? 'اتسدد بالكامل' : `${fmt(remaining)} ج.م`}
            </Text>
          </View>
          {d.note ? <Text style={styles.noteText}>{d.note}</Text> : null}
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.progressText}>
            اتسدد {fmt(paid)} من {fmt(grandTotal)} ج.م {d.isInstallment ? `· أقساط (${d.installmentCount || '-'})` : '· مبلغ واحد'}
          </Text>
        </TouchableOpacity>

        {expanded && (
          <View style={styles.expandedArea}>
            <View style={styles.paymentsList}>
              {timeline.map((t, i) => {
                const w = 'walletId' in t && t.walletId ? wallets.find(x => x.id === t.walletId) : undefined;
                const c = 'categoryId' in t && t.categoryId ? categories.find(x => x.id === t.categoryId) : undefined;
                const label = t.kind === 'initial' ? 'المبلغ الأساسي' : t.kind === 'increase' ? 'زيادة' : 'دفعة';
                const sign = t.kind === 'payment' ? '−' : '+';
                const lineColor = t.kind === 'payment' ? colors.success : colors.textSecondary;
                return (
                  <View key={i} style={styles.paymentRow}>
                    <Text style={[styles.paymentText, { color: lineColor }]}>
                      {label} {sign}{fmt(t.amount)} ج.م{w ? ' · ' + w.name : ''}{c ? ' · ' + categoryLabel(c) : ''}
                    </Text>
                    <Text style={styles.paymentDate}>{t.date}</Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.increaseBtn} onPress={() => setIncreaseForDebt(d)}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>زيادة على الدين</Text>
              </TouchableOpacity>
              {!settled && (
                <TouchableOpacity style={styles.payBtn} onPress={() => setPaymentForDebt(d)}>
                  <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>تسجيل دفعة</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.deleteBtn, busyKey === d.id && styles.btnBusy]} onPress={() => confirmDeleteDebt(d)} disabled={busyKey === d.id}>
                <Text style={{ color: colors.danger, fontSize: 12.5 }}>{busyKey === d.id ? '...' : 'حذف'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddDebt(true)}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13 }}>+ دين جديد</Text>
        </TouchableOpacity>
        <Text style={styles.title}>الديون والأقساط</Text>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>ليا (متبقي)</Text>
          <Text style={[styles.summaryValue, { color: colors.success }]}>{fmt(totalOwedToMe)} ج.م</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>عليا (متبقي)</Text>
          <Text style={[styles.summaryValue, { color: colors.danger }]}>{fmt(totalIOwe)} ج.م</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>فلوس ليا</Text>
      {owedToMe.length === 0 && <Text style={styles.emptyState}>مفيش حد مديون ليك دلوقتي</Text>}
      {owedToMe.map(renderDebt)}

      <Text style={styles.sectionTitle}>فلوس عليا</Text>
      {iOwe.length === 0 && <Text style={styles.emptyState}>مفيش عليك ديون دلوقتي</Text>}
      {iOwe.map(renderDebt)}

      <AddDebtModal visible={showAddDebt} onClose={() => setShowAddDebt(false)} />
      {paymentForDebt && <AddPaymentModal debt={paymentForDebt} onClose={() => setPaymentForDebt(null)} />}
      {increaseForDebt && <AddIncreaseModal debt={increaseForDebt} onClose={() => setIncreaseForDebt(null)} />}
    </ScrollView>
  );
}

function AddDebtModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { addDebt, wallets } = useData();
  const { busy, run: runBusy } = useBusy();

  const [direction, setDirection] = useState<'owed_to_me' | 'i_owe'>('owed_to_me');
  const [personName, setPersonName] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('');
  const [note, setNote] = useState('');
  const [linkedToWallet, setLinkedToWallet] = useState(true);
  const [walletId, setWalletId] = useState(wallets[0]?.id);
  const [date, setDate] = useState(todayStr());
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');
  const [showContacts, setShowContacts] = useState(false);
  const [contactList, setContactList] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [personContactId, setPersonContactId] = useState('');

  function reset() {
    setDirection('owed_to_me'); setPersonName(''); setTotalAmount('');
    setIsInstallment(false); setInstallmentCount(''); setNote('');
    setLinkedToWallet(true); setDate(todayStr()); setError(''); setPersonPhone(''); setPersonContactId('');
  }

  async function pickContact() {
    try {
      // لازم نطلب الصلاحية صراحةً الأول — من غير كده النظام بيقفل التطبيق
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('محتاج إذن', 'عشان تختار من جهات الاتصال، لازم تسمح للتطبيق يوصلها من إعدادات الموبايل.');
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.PhoneNumbers,
        ],
      });
      // بعض الأجهزة بترجّع name فاضي للأسماء العربية، فبنركّب الاسم من الحقول التانية كبديل
      const named = (data || [])
        .map(x => {
          const composed = [x.firstName, x.lastName].filter(Boolean).join(' ').trim();
          const finalName = (x.name && x.name.trim()) || composed;
          const phone = x.phoneNumbers && x.phoneNumbers.length > 0 ? (x.phoneNumbers[0].number || '') : '';
          return { id: x.id || String(Math.random()), name: finalName, phone };
        })
        .filter(x => x.name);
      if (named.length === 0) {
        Alert.alert('مفيش جهات اتصال', 'ملقيتش أسماء محفوظة على الموبايل.');
        return;
      }
      // ترتيب أبجدي بيتعامل مع العربي والإنجليزي مع بعض
      named.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      setContactList(named);
      setShowContacts(true);
    } catch (e: any) {
      Alert.alert('حصل خطأ', String(e?.message || 'مقدرش أفتح جهات الاتصال دلوقتي'));
    }
  }

  async function handleSave() {
    const amt = Number(totalAmount);
    if (!personName.trim() || !amt || amt <= 0) { setError('من فضلك دخّل اسم ومبلغ صحيحين'); return; }
    if (linkedToWallet && !walletId) { setError('اختار محفظة'); return; }
    await runBusy(async () => {
      try {
        await addDebt({
          direction, personName: personName.trim(), personPhone: personPhone.trim() || undefined, personContactId: personContactId || undefined, totalAmount: amt,
          isInstallment,
          installmentCount: isInstallment ? Number(installmentCount) || undefined : undefined,
          note: note.trim() || undefined,
          walletId: linkedToWallet ? walletId : undefined,
          date,
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
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sheetTitle}>دين جديد</Text>

          <View style={styles.row}>
            <TouchableOpacity onPress={() => setDirection('owed_to_me')}
              style={[styles.typeBtn, { borderColor: direction === 'owed_to_me' ? colors.success : colors.borderStrong }]}>
              <Text style={{ color: direction === 'owed_to_me' ? colors.success : colors.textSecondary, fontSize: 13 }}>ليا (أنا قرضته)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDirection('i_owe')}
              style={[styles.typeBtn, { borderColor: direction === 'i_owe' ? colors.danger : colors.borderStrong }]}>
              <Text style={{ color: direction === 'i_owe' ? colors.danger : colors.textSecondary, fontSize: 13 }}>عليا (هو قرضني)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>الدين ده مرتبط بمحفظة دلوقتي؟</Text>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setLinkedToWallet(true)}
              style={[styles.typeBtn, { borderColor: linkedToWallet ? colors.accent : colors.borderStrong }]}>
              <Text style={{ color: linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>أيوة، فلوس حقيقية</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLinkedToWallet(false)}
              style={[styles.typeBtn, { borderColor: !linkedToWallet ? colors.accent : colors.borderStrong }]}>
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
            <TouchableOpacity onPress={pickContact} style={styles.contactBtn}>
              <IconSymbol name="person.crop.circle" size={18} color={colors.accent} />
            </TouchableOpacity>
            <Text style={styles.label}>اسم الشخص</Text>
          </View>
          <TextInput style={styles.input} value={personName} onChangeText={setPersonName}
            placeholder="مثلاً: أحمد (أو دوس أيقونة جهات الاتصال)" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ الإجمالي (أول مرة)</Text>
          <TextInput style={styles.bigInput} value={totalAmount} onChangeText={setTotalAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          {linkedToWallet && (
            <>
              <Text style={styles.label}>{direction === 'owed_to_me' ? 'من محفظة' : 'إلى محفظة'}</Text>
              <View style={styles.chipRow}>
                {wallets.map(w => (
                  <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
                    style={[styles.chip, { borderColor: walletId === w.id ? colors.accent : colors.borderStrong }]}>
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
              style={[styles.typeBtn, { borderColor: !isInstallment ? colors.accent : colors.borderStrong }]}>
              <Text style={{ color: !isInstallment ? colors.text : colors.textSecondary, fontSize: 13 }}>مبلغ واحد</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsInstallment(true)}
              style={[styles.typeBtn, { borderColor: isInstallment ? colors.accent : colors.borderStrong }]}>
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

          <Text style={styles.label}>ملاحظة</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote}
            placeholder="اختياري" placeholderTextColor={colors.textSecondary} textAlign="right" />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { reset(); onClose(); }}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
            </TouchableOpacity>
          </View>

          <CalendarPickerModal visible={showPicker} value={date} onSelect={setDate} onClose={() => setShowPicker(false)} />

          <Modal visible={showContacts} transparent animationType="slide" onRequestClose={() => setShowContacts(false)}>
            <View style={styles.overlay}>
              <View style={[styles.sheet, { maxHeight: '80%' }]}>
                <Text style={styles.sheetTitle}>اختار من جهات الاتصال</Text>
                <TextInput
                  style={styles.input}
                  value={contactSearch}
                  onChangeText={setContactSearch}
                  placeholder="دور بالاسم..."
                  placeholderTextColor={colors.textSecondary}
                  textAlign="right"
                />
                <Text style={styles.contactCount}>
                  {(() => {
                    const q = contactSearch.trim().toLocaleLowerCase('ar');
                    const n = contactList.filter(ct => ct.name.toLocaleLowerCase('ar').includes(q)).length;
                    return q ? `${n} نتيجة من ${contactList.length}` : `${contactList.length} جهة اتصال`;
                  })()}
                </Text>
                <ScrollView style={{ marginTop: 6 }} keyboardShouldPersistTaps="handled">
                  {contactList
                    .filter(ct => ct.name.toLocaleLowerCase('ar').includes(contactSearch.trim().toLocaleLowerCase('ar')))
                    .map(ct => (
                      <TouchableOpacity
                        key={ct.id}
                        style={styles.contactRow}
                        onPress={() => {
                          setPersonName(ct.name);
                          setPersonPhone(ct.phone);
                          setPersonContactId(ct.id);
                          setShowContacts(false);
                          setContactSearch('');
                        }}>
                        <Text style={styles.contactName}>{ct.name}</Text>
                        {!!ct.phone && <Text style={styles.contactPhone}>{ct.phone}</Text>}
                      </TouchableOpacity>
                    ))}
                </ScrollView>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowContacts(false); setContactSearch(''); }}>
                  <Text style={{ color: colors.textSecondary }}>إغلاق</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AddPaymentModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
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
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sheetTitle}>تسجيل دفعة — {debt.personName}</Text>
          <Text style={styles.hintText}>المتبقي: {fmt(remaining)} ج.م</Text>

          <Text style={styles.label}>المبلغ</Text>
          <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          <Text style={styles.label}>{debt.direction === 'owed_to_me' ? 'المحفظة اللي هتستلم فيها' : 'المحفظة اللي هتدفع منها'}</Text>
          <View style={styles.chipRow}>
            {wallets.map(w => (
              <TouchableOpacity key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, { borderColor: walletId === w.id ? colors.accent : colors.borderStrong }]}>
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
                    style={[styles.chip, { borderColor: categoryId === c.id ? colors.accent : colors.borderStrong }]}>
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

function AddIncreaseModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
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
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sheetTitle}>زيادة على دين — {debt.personName}</Text>

          <Text style={styles.label}>مرتبط بمحفظة دلوقتي؟</Text>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setLinkedToWallet(true)}
              style={[styles.typeBtn, { borderColor: linkedToWallet ? colors.accent : colors.borderStrong }]}>
              <Text style={{ color: linkedToWallet ? colors.text : colors.textSecondary, fontSize: 13 }}>أيوة</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLinkedToWallet(false)}
              style={[styles.typeBtn, { borderColor: !linkedToWallet ? colors.accent : colors.borderStrong }]}>
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
                    style={[styles.chip, { borderColor: walletId === w.id ? colors.accent : colors.borderStrong }]}>
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
    container: { flex: 1, backgroundColor: c.bg },
    switcherRow: { flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
    switchBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 9 },
    scrollArea: { flex: 1 },
    content: { padding: 16, paddingBottom: 40 },
    titleRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    title: { color: c.text, fontSize: 18, fontWeight: '700' },
    addBtn: { backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    summaryRow: { flexDirection: 'row-reverse', gap: 10, marginBottom: 10 },
    summaryCard: { flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border },
    summaryLabel: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right' },
    summaryValue: { fontSize: 16, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 20, marginBottom: 8 },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 14 },
    debtCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    debtHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
    personName: { color: c.text, fontSize: 14.5, fontWeight: '700' },
    personNameLink: { color: c.accent, textDecorationLine: 'underline' },
    remainingText: { fontSize: 14, fontWeight: '700' },
    noteText: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 4 },
    track: { height: 6, backgroundColor: c.surface2, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3 },
    progressText: { color: c.textSecondary, fontSize: 11, textAlign: 'right', marginTop: 6 },
    expandedArea: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
    paymentsList: { marginBottom: 10 },
    paymentRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', paddingVertical: 5 },
    paymentText: { fontSize: 12 },
    paymentDate: { color: c.textMuted, fontSize: 11 },
    actionsRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
    increaseBtn: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    payBtn: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    deleteBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.nav, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
    sheetTitle: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 4 },
    hintText: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 6, lineHeight: 16 },
    row: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
    labelRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
    contactBtn: { padding: 4 },
    contactRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    contactName: { color: c.text, fontSize: 14, textAlign: 'right' },
    contactPhone: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
    contactCount: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginTop: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    actions: { flexDirection: 'row-reverse', gap: 10, marginTop: 20, marginBottom: 10 },
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.6 },
  });
}