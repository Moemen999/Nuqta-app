import { DebtIncreaseModal, DebtPaymentModal } from '@/components/DebtEntryModals';
import { useData, type Debt } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { debtGrandTotal, debtPaid, findPersonGroup, fmt } from '@/lib/finance';
import { MIN_TOUCH } from '@/lib/tokens';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Row = {
  date: string;
  label: string;
  delta: number; // موجب = زوّد رصيدك عنده، سالب = قلل
  /** الدين اللي الحركة دي منه — الصفحة بتجمّع كذا دين لنفس الشخص */
  debtLabel: string;
};

/** وصف قصير يفرّق الدين عن باقي ديون نفس الشخص */
function debtLabelOf(d: Debt) {
  const side = d.direction === 'owed_to_me' ? 'ليا' : 'عليا';
  const when = d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '');
  return d.note?.trim() ? `${side} · ${d.note.trim()}` : `${side} · ${when}`;
}

export default function PersonLedgerScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // personKey جاي من groupDebtsByPerson — مش الاسم، عشان نفس الشخص ميتقسمش
  // لو اسمه مكتوب بمسافة زايدة أو اتعدّل في دين من ديونه
  const { personKey } = useLocalSearchParams<{ personKey?: string }>();
  const { debts } = useData();

  const group = useMemo(() => (personKey ? findPersonGroup(debts, personKey) : undefined), [debts, personKey]);
  const personName = group?.displayName || '';

  const [paymentForDebt, setPaymentForDebt] = useState<Debt | null>(null);
  const [increaseForDebt, setIncreaseForDebt] = useState<Debt | null>(null);

  /**
   * الصفحة بتجمّع كذا دين لنفس الشخص، فسؤال "الدفعة دي على أنهي دين؟" مالوش
   * إجابة تلقائية — أي اختيار من عندنا (الأقدم؟ الأكبر؟ بالتوزيع؟) بيبقى
   * سياسة محاسبية المستخدم ما اختارهاش. فالأزرار بتبقى **لكل دين لوحده**،
   * والمستخدم هو اللي بيحدد بالدوس. الاستثناء المريح: لو فيه دين واحد مفتوح
   * بس، الزرار الرئيسي بيشتغل عليه على طول وبيقول اسمه — الحالة الشايعة
   * بتبقى دوسة واحدة وبرضه من غير أي تخمين.
   */
  const openDebts = useMemo(
    () => (group?.debts || []).filter(d => debtGrandTotal(d) - debtPaid(d) > 0.001),
    [group]
  );
  const soleOpenDebt = openDebts.length === 1 ? openDebts[0] : null;

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    (group?.debts || []).forEach((d: Debt) => {
      const sign = d.direction === 'owed_to_me' ? 1 : -1;
      const initDate = d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '');
      const debtLabel = debtLabelOf(d);
      list.push({
        date: initDate,
        label: d.direction === 'owed_to_me' ? 'دين جديد (أنت اداه)' : 'دين جديد (هو اداك)',
        delta: sign * d.totalAmount,
        debtLabel,
      });
      (d.increases || []).forEach(inc => {
        list.push({
          date: inc.date,
          label: d.direction === 'owed_to_me' ? 'زيادة (أنت اداه)' : 'زيادة (هو اداك)',
          delta: sign * inc.amount,
          debtLabel,
        });
      });
      d.payments.forEach(p => {
        list.push({
          date: p.date,
          label: d.direction === 'owed_to_me' ? 'سداد (هو دفعلك)' : 'سداد (أنت دفعتله)',
          delta: -sign * p.amount,
          debtLabel,
        });
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [group]);

  let running = 0;
  const rowsWithBalance = rows.map(r => {
    running += r.delta;
    return { ...r, balance: running };
  });

  const finalBalance = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1].balance : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ رجوع</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{personName ? `كشف حساب — ${personName}` : 'كشف حساب'}</Text>
      </View>

      {!group ? (
        <Text style={styles.emptyState}>الشخص ده مبقى لوش ديون — يمكن اتمسحت.</Text>
      ) : (
      <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>الرصيد الحالي</Text>
        <Text style={[styles.summaryValue, { color: finalBalance > 0 ? colors.success : finalBalance < 0 ? colors.danger : colors.textSecondary }]}>
          {finalBalance > 0 ? `ليك عنده ${fmt(finalBalance)} ج.م` : finalBalance < 0 ? `عليك له ${fmt(Math.abs(finalBalance))} ج.م` : 'متسدد بالكامل'}
        </Text>
      </View>

      <View style={styles.tableHead}>
        <Text style={[styles.th, { flex: 1.4 }]}>البيان</Text>
        <Text style={[styles.th, { flex: 0.9 }]}>الحركة</Text>
        <Text style={[styles.th, { flex: 0.9 }]}>الرصيد</Text>
        <Text style={[styles.th, { flex: 0.9 }]}>التاريخ</Text>
      </View>

      {rowsWithBalance.length === 0 && <Text style={styles.emptyState}>مفيش حركات لسه</Text>}

      {rowsWithBalance.map((r, i) => (
        <View key={i} style={styles.tableRow}>
          <View style={{ flex: 1.4 }}>
            <Text style={styles.td}>{r.label}</Text>
            <Text style={styles.rowDebtLabel} numberOfLines={1}>{r.debtLabel}</Text>
          </View>
          <Text style={[styles.td, { flex: 0.9, color: r.delta >= 0 ? colors.success : colors.danger, fontWeight: '700' }]}>
            {r.delta >= 0 ? '+' : ''}{fmt(r.delta)}
          </Text>
          <Text style={[styles.td, { flex: 0.9, color: r.balance > 0 ? colors.success : r.balance < 0 ? colors.danger : colors.textSecondary }]}>
            {fmt(r.balance)}
          </Text>
          <Text style={[styles.td, { flex: 0.9, color: colors.textMuted, fontSize: 10.5 }]}>{r.date}</Text>
        </View>
      ))}

      <Text style={styles.footNote}>موجب (+) = ليك عنده أكتر · سالب (−) = عليك له أكتر</Text>

      <Text style={styles.sectionTitle}>سجّل حركة</Text>
      {soleOpenDebt ? (
        <>
          <Text style={styles.hintText}>دين واحد مفتوح بس، فالحركة هتتسجل عليه</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.payBtn} onPress={() => setPaymentForDebt(soleOpenDebt)}>
              <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>
                تسجيل دفعة على: {debtLabelOf(soleOpenDebt)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setIncreaseForDebt(soleOpenDebt)}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>زيادة</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.hintText}>
            {openDebts.length === 0
              ? 'مفيش دين مفتوح دلوقتي — كل حاجة متسددة. الزيادة بتتسجل من شاشة الديون.'
              : 'اختار الدين اللي الحركة عليه — الصفحة دي فيها أكتر من دين لنفس الشخص.'}
          </Text>
          {openDebts.map(d => {
            const remaining = debtGrandTotal(d) - debtPaid(d);
            return (
              <View key={d.id} style={styles.debtBlock}>
                <View style={styles.debtBlockHead}>
                  <Text style={styles.debtBlockTitle}>{debtLabelOf(d)}</Text>
                  <Text style={[styles.debtBlockRemaining, { color: d.direction === 'owed_to_me' ? colors.success : colors.danger }]}>
                    متبقي {fmt(remaining)} ج.م
                  </Text>
                </View>
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.payBtn} onPress={() => setPaymentForDebt(d)}>
                    <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>تسجيل دفعة</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => setIncreaseForDebt(d)}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>زيادة</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </>
      )}

      {paymentForDebt && <DebtPaymentModal debt={paymentForDebt} onClose={() => setPaymentForDebt(null)} />}
      {increaseForDebt && <DebtIncreaseModal debt={increaseForDebt} onClose={() => setIncreaseForDebt(null)} />}
      </>
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    backText: { color: c.accent, fontSize: 14 },
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    summaryCard: { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, alignItems: 'center', marginBottom: 20 },
    summaryLabel: { color: c.textSecondary, fontSize: 12 },
    summaryValue: { fontSize: 18, fontWeight: '700', marginTop: 6 },
    tableHead: { flexDirection: 'row-reverse', borderBottomWidth: 1.5, borderBottomColor: c.borderStrong, paddingBottom: 8, marginBottom: 4 },
    th: { color: c.textSecondary, fontSize: 11, fontWeight: '700', textAlign: 'center' },
    tableRow: { flexDirection: 'row-reverse', borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 8, alignItems: 'center' },
    td: { fontSize: 12, textAlign: 'center', color: c.text },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    footNote: { color: c.textMuted, fontSize: 10.5, textAlign: 'center', marginTop: 14 },
    rowDebtLabel: { color: c.textMuted, fontSize: 10, textAlign: 'center', marginTop: 2 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 24, marginBottom: 6 },
    hintText: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginBottom: 10, lineHeight: 16 },
    debtBlock: { backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, marginBottom: 10 },
    debtBlockHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 },
    debtBlockTitle: { color: c.text, fontSize: 13, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
    debtBlockRemaining: { fontSize: 12.5, fontWeight: '700' },
    actionsRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
    payBtn: { flexShrink: 1, minHeight: MIN_TOUCH, justifyContent: 'center', backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 14 },
    secondaryBtn: { minHeight: MIN_TOUCH, justifyContent: 'center', borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14 },
  });
}