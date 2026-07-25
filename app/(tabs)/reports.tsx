import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData } from '@/context/DataContext';
import { fmt, todayStr } from '@/lib/finance';
import { useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PieChart } from 'react-native-chart-kit';

const PALETTE = ['#7FA98F', '#C9A961', '#7C93C9', '#C97C9B', '#9B7CC9', '#C98F5A', '#6FB3B8', '#B08FC9'];
function hashColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}
function startOfMonth(dateStr: string) { return dateStr.slice(0, 7) + '-01'; }
function endOfMonth(dateStr: string) {
  const d = new Date(dateStr); const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return end.toISOString().slice(0, 10);
}

const screenWidth = Dimensions.get('window').width;
type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'custom';

export default function ReportsScreen() {
  const { categories, transactions } = useData();
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [catFilter, setCatFilter] = useState<string[]>([]);
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null);

  const range = useMemo(() => {
    const today = todayStr();
    if (preset === 'last7') return { from: addDays(today, -6), to: today };
    if (preset === 'lastMonth') {
      const prevMonthDay = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prevMonthDay), to: endOfMonth(prevMonthDay) };
    }
    if (preset === 'custom') {
      const from = customFrom <= customTo ? customFrom : customTo;
      const to = customFrom <= customTo ? customTo : customFrom;
      return { from, to };
    }
    return { from: startOfMonth(today), to: endOfMonth(today) };
  }, [preset, customFrom, customTo]);

  const filtered = transactions.filter(t => t.date >= range.from && t.date <= range.to);
  const visibleCats = catFilter.length > 0 ? categories.filter(c => catFilter.includes(c.id)) : categories;
  const expenseByCat = visibleCats
    .map(c => ({
      name: c.name,
      amount: filtered.filter(t => t.type === 'expense' && t.categoryId === c.id).reduce((s, t) => s + t.amount, 0),
      color: hashColor(c.name),
      legendFontColor: '#8B92A0',
      legendFontSize: 12,
    }))
    .filter(c => c.amount > 0);

  const periodExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1);
  const prevFrom = addDays(range.from, -days);
  const prevTo = addDays(range.from, -1);
  const prevExpense = transactions
    .filter(t => t.type === 'expense' && t.date >= prevFrom && t.date <= prevTo)
    .reduce((s, t) => s + t.amount, 0);
  const change = prevExpense === 0 ? null : Math.round(((periodExpense - prevExpense) / prevExpense) * 100);

  function toggleCat(id: string) {
    setCatFilter(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>التقارير</Text>

      <View style={styles.presetRow}>
        {[
          { key: 'thisMonth', label: 'هذا الشهر' },
          { key: 'last7', label: 'آخر 7 أيام' },
          { key: 'lastMonth', label: 'الشهر الماضي' },
          { key: 'custom', label: 'مخصص' },
        ].map(p => (
          <TouchableOpacity key={p.key} onPress={() => setPreset(p.key as Preset)}
            style={[styles.presetBtn, { backgroundColor: preset === p.key ? '#C9A961' : '#1C2027' }]}>
            <Text style={{ color: preset === p.key ? '#0B0D10' : '#EDEBE6', fontSize: 12.5 }}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === 'custom' && (
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor('from')}>
            <Text style={styles.dateBtnText}>من: {customFrom}</Text>
          </TouchableOpacity>
          <Text style={{ color: '#8B92A0' }}>إلى</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor('to')}>
            <Text style={styles.dateBtnText}>إلى: {customTo}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>مصروفات الفترة</Text>
          <Text style={styles.metricValue}>{fmt(periodExpense)} ج.م</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>مقارنة بالفترة السابقة</Text>
          <Text style={[styles.metricValue, { color: change === null ? '#8B92A0' : change > 0 ? '#D97878' : '#7FA98F' }]}>
            {change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>توزيع المصاريف حسب الفئة</Text>
      <View style={styles.chipRow}>
        {categories.map(c => {
          const active = catFilter.includes(c.id);
          return (
            <TouchableOpacity key={c.id} onPress={() => toggleCat(c.id)}
              style={[styles.chip, { borderColor: active ? hashColor(c.name) : '#262B33' }]}>
              <Text style={{ color: '#EDEBE6', fontSize: 12.5 }}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
        {catFilter.length > 0 && (
          <TouchableOpacity onPress={() => setCatFilter([])} style={[styles.chip, { borderColor: '#262B33' }]}>
            <Text style={{ color: '#8B92A0', fontSize: 12.5 }}>مسح الفلتر</Text>
          </TouchableOpacity>
        )}
      </View>

      {expenseByCat.length === 0 ? (
        <Text style={styles.emptyState}>مفيش مصاريف في الفترة دي</Text>
      ) : (
        <PieChart
          data={expenseByCat}
          width={screenWidth - 32}
          height={200}
          accessor="amount"
          backgroundColor="transparent"
          paddingLeft="0"
          chartConfig={{ color: () => '#EDEBE6' }}
          hasLegend
        />
      )}

      <CalendarPickerModal
        visible={pickerFor !== null}
        value={pickerFor === 'from' ? customFrom : customTo}
        onSelect={(d) => { if (pickerFor === 'from') setCustomFrom(d); else setCustomTo(d); }}
        onClose={() => setPickerFor(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: '#EDEBE6', fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 14 },
  presetRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
  presetBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
  dateBtn: { flex: 1, backgroundColor: '#1C2027', borderWidth: 1, borderColor: '#262B33', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  dateBtnText: { color: '#EDEBE6', fontSize: 12.5, textAlign: 'center' },
  metricRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
  metricCard: { flex: 1, backgroundColor: '#15181D', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1C2027' },
  metricLabel: { color: '#8B92A0', fontSize: 11.5, textAlign: 'right' },
  metricValue: { color: '#EDEBE6', fontSize: 17, fontWeight: '700', textAlign: 'right', marginTop: 4 },
  sectionTitle: { color: '#EDEBE6', fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 22, marginBottom: 10 },
  chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  emptyState: { color: '#8B92A0', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
});