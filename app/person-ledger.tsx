import { useData, type Debt } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { fmt } from '@/lib/finance';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Row = {
  date: string;
  label: string;
  delta: number; // موجب = زوّد رصيدك عنده، سالب = قلل
};

export default function PersonLedgerScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { name } = useLocalSearchParams<{ name?: string }>();
  const { debts } = useData();

  const personName = name || '';
  const personDebts = debts.filter(d => d.personName === personName);

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    personDebts.forEach((d: Debt) => {
      const sign = d.direction === 'owed_to_me' ? 1 : -1;
      const initDate = d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '');
      list.push({
        date: initDate,
        label: d.direction === 'owed_to_me' ? 'دين جديد (أنت اداه)' : 'دين جديد (هو اداك)',
        delta: sign * d.totalAmount,
      });
      (d.increases || []).forEach(inc => {
        list.push({
          date: inc.date,
          label: d.direction === 'owed_to_me' ? 'زيادة (أنت اداه)' : 'زيادة (هو اداك)',
          delta: sign * inc.amount,
        });
      });
      d.payments.forEach(p => {
        list.push({
          date: p.date,
          label: d.direction === 'owed_to_me' ? 'سداد (هو دفعلك)' : 'سداد (أنت دفعتله)',
          delta: -sign * p.amount,
        });
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [personDebts]);

  let running = 0;
  const rowsWithBalance = rows.map(r => {
    running += r.delta;
    return { ...r, balance: running };
  });

  const finalBalance = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1].balance : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ رجوع</Text>
        </TouchableOpacity>
        <Text style={styles.title}>كشف حساب — {personName}</Text>
      </View>

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
          <Text style={[styles.td, { flex: 1.4 }]}>{r.label}</Text>
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
  });
}