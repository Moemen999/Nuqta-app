import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { categoryLabel, fmt, monthSpend, todayStr } from '@/lib/finance';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TOTAL_KEY = 'total_budget';

export default function BudgetScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>الميزانية الشهرية</Text>

        <View style={styles.totalCard}>
          <View style={styles.head}>
            <Text style={styles.totalLabel}>الميزانية الإجمالية الشهرية</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
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
                <Text style={[styles.totalSub, { color: remaining < 0 ? colors.danger : colors.success }]}>
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
          const color = pct >= 100 ? colors.danger : pct >= 80 ? colors.accent : colors.success;

          return (
            <View key={c.id} style={styles.card}>
              <View style={styles.head}>
                <Text style={styles.name}>{categoryLabel(c)}</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="السقف"
                  placeholderTextColor={colors.textSecondary}
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
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 16 },
    totalCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: c.accent, marginBottom: 20 },
    totalLabel: { color: c.text, fontSize: 14, fontWeight: '700' },
    totalRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 10 },
    totalSub: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 4 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    name: { color: c.text, fontSize: 14, fontWeight: '500' },
    input: { width: 110, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, color: c.text, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13 },
    track: { height: 6, backgroundColor: c.surface2, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3 },
    sub: { fontSize: 11.5, marginTop: 6, textAlign: 'right' },
  });
}