import { useData } from '@/context/DataContext';
import { fmt, monthSpend, todayStr } from '@/lib/finance';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const PALETTE = ['#7FA98F', '#C9A961', '#7C93C9', '#C97C9B', '#9B7CC9', '#C98F5A', '#6FB3B8', '#B08FC9'];
function hashColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

const TOTAL_KEY = 'total_budget';

export default function BudgetScreen() {
  const { categories, transactions, budgets, setBudget } = useData();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const nowMonth = todayStr().slice(0, 7);

  function handleChange(key: string, value: string) {
    setDrafts(d => ({ ...d, [key]: value }));
  }
  function handleBlur(key: string) {
    const raw = drafts[key];
    if (raw === undefined) return;
    const num = Number(raw);
    setBudget(key, isNaN(num) ? 0 : num);
  }
  function valueFor(key: string) {
    return drafts[key] !== undefined ? drafts[key] : (budgets[key] ? String(budgets[key]) : '');
  }

  const totalBudget = budgets[TOTAL_KEY] || 0;
  const allocated = categories.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  const remaining = totalBudget - allocated;
  const totalMonthSpend = transactions
    .filter(t => t.type === 'expense' && t.date.slice(0, 7) === nowMonth)
    .reduce((s, t) => s + t.amount, 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>الميزانية الشهرية</Text>

      <View style={styles.totalCard}>
        <View style={styles.head}>
          <Text style={styles.totalLabel}>الميزانية الإجمالية الشهرية</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#6B7280"
            value={valueFor(TOTAL_KEY)}
            onChangeText={v => handleChange(TOTAL_KEY, v)}
            onBlur={() => handleBlur(TOTAL_KEY)}
            textAlign="right"
          />
        </View>
        {totalBudget > 0 && (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.totalSub}>موزّع على الفئات: {fmt(allocated)}</Text>
              <Text style={[styles.totalSub, { color: remaining < 0 ? '#D97878' : '#7FA98F' }]}>
                {remaining < 0 ? 'تجاوزت الإجمالي بـ ' + fmt(Math.abs(remaining)) : 'متبقي للتوزيع: ' + fmt(remaining)}
              </Text>
            </View>
            <Text style={styles.totalSub}>مصروف الشهر الفعلي: {fmt(totalMonthSpend)} / {fmt(totalBudget)}</Text>
          </>
        )}
      </View>

      <Text style={styles.sectionTitle}>توزيع الميزانية على الفئات</Text>
      {categories.map(c => {
        const limit = drafts[c.id] !== undefined ? Number(drafts[c.id]) || 0 : (budgets[c.id] || 0);
        const spend = monthSpend(transactions, c.id, nowMonth);
        const pct = limit > 0 ? Math.min(100, (spend / limit) * 100) : 0;
        const color = pct >= 100 ? '#D97878' : pct >= 80 ? '#C9A961' : '#7FA98F';

        return (
          <View key={c.id} style={styles.card}>
            <View style={styles.head}>
              <View style={styles.nameRow}>
                <View style={[styles.dot, { backgroundColor: hashColor(c.name) }]} />
                <Text style={styles.name}>{c.name}</Text>
              </View>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="السقف"
                placeholderTextColor="#6B7280"
                value={valueFor(c.id)}
                onChangeText={v => handleChange(c.id, v)}
                onBlur={() => handleBlur(c.id)}
                textAlign="right"
              />
            </View>
            {limit > 0 && (
              <>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
                </View>
                <Text style={[styles.sub, { color }]}>{fmt(spend)} / {fmt(limit)} ج.م</Text>
              </>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: '#EDEBE6', fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 16 },
  totalCard: { backgroundColor: '#15181D', borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: '#C9A961', marginBottom: 20 },
  totalLabel: { color: '#EDEBE6', fontSize: 14, fontWeight: '700' },
  totalRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 10 },
  totalSub: { color: '#8B92A0', fontSize: 12, textAlign: 'right', marginTop: 4 },
  sectionTitle: { color: '#EDEBE6', fontSize: 15, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
  card: { backgroundColor: '#15181D', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1C2027' },
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nameRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { color: '#EDEBE6', fontSize: 14, fontWeight: '500' },
  input: { width: 110, backgroundColor: '#1C2027', borderWidth: 1, borderColor: '#262B33', borderRadius: 8, color: '#EDEBE6', paddingHorizontal: 10, paddingVertical: 7, fontSize: 13 },
  track: { height: 6, backgroundColor: '#1C2027', borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  sub: { fontSize: 11.5, marginTop: 6, textAlign: 'right' },
});