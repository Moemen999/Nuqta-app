import { Money } from '@/components/Money';
import { usePrivacy } from '@/context/PrivacyContext';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import { addDays, buildCategorySpend, buildPieSlices, categoryLabel, endOfMonth, groupDebtsByPerson, periodExpenseTotal, startOfMonth, todayStr } from '@/lib/finance';
import { selectionStyle } from '@/lib/selection';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PieChart } from 'react-native-chart-kit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const screenWidth = Dimensions.get('window').width;
type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'custom';

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categories, transactions, debts } = useData();
  const { money } = usePrivacy();
  const { categoryColors } = useChartColors();
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

  const filtered = useMemo(
    () => transactions.filter(t => t.date >= range.from && t.date <= range.to),
    [transactions, range]
  );
  // `undefined` معناها مفيش فلتر — وساعتها بس الشريحة الممسوحة بتظهر،
  // عشان الرسم والرقم اللي جنبه يفضلوا محسوبين بنفس القاعدة
  const visibleIds = catFilter.length > 0 ? catFilter : undefined;

  const periodExpenses = useMemo(
    () => filtered.filter(t => t.type === 'expense'),
    [filtered]
  );

  const expenseByCat = useMemo(
    () => buildCategorySpend(periodExpenses, categories, {
      colorFor: id => categoryColors.get(id) || colors.textMuted,
      deletedColor: colors.textMuted,
      visibleIds,
    }),
    [periodExpenses, categories, categoryColors, colors.textMuted, visibleIds]
  );

  const periodExpense = useMemo(
    () => periodExpenseTotal(periodExpenses, visibleIds),
    [periodExpenses, visibleIds]
  );

  // الشرايح الزيادة بتتلمّ في شريحة واحدة بلون محايد برّه باليتة الفئات.
  // التفاصيل (وليه اسمها بالعدد) في `buildPieSlices`.
  const pieSlices = useMemo(
    () => buildPieSlices(expenseByCat, colors.textMuted),
    [expenseByCat, colors.textMuted]
  );

  const change = useMemo(() => {
    const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1);
    const prevFrom = addDays(range.from, -days);
    const prevTo = addDays(range.from, -1);
    // نفس قاعدة الفترة الحالية بالظبط. قبل كده الفترة السابقة كانت بتتفلتر
    // على الفئات الموجودة حتى وإحنا مش فالتين حاجة، فالمصروف اللي فئته
    // اتمسحت كان بيتشال من فترة واحدة بس — ومقارنة بقاعدتين بتدي نسبة غلط
    const prevExpenses = transactions
      .filter(t => t.type === 'expense' && t.date >= prevFrom && t.date <= prevTo);
    const prevExpense = periodExpenseTotal(prevExpenses, visibleIds);
    return prevExpense === 0 ? null : Math.round(((periodExpense - prevExpense) / prevExpense) * 100);
  }, [range, visibleIds, transactions, periodExpense]);

  /**
   * الفئة المؤرشفة مالهاش لازمة في الفلتر إلا لو ليها مصروف في الفترة دي
   * فعلاً — وإلا القايمة بتطول بفئات المستخدم أرشفها خلاص. بنسيبها كمان لو
   * هي مختارة دلوقتي، عشان يقدر يشيلها من الفلتر.
   */
  const chipCategories = useMemo(() => {
    const spent = new Set(periodExpenses.map(t => t.categoryId).filter(Boolean) as string[]);
    return categories.filter(c => !c.archived || spent.has(c.id) || catFilter.includes(c.id));
  }, [categories, periodExpenses, catFilter]);

  function toggleCat(id: string) {
    setCatFilter(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
  }

  const pieData = pieSlices.map(c => ({
    name: c.name, amount: c.amount, color: c.color,
    legendFontColor: colors.textSecondary, legendFontSize: 12,
  }));

  // كشف حساب موحّد لكل شخص — مجمّع على الشخص (مش على الاتجاه)، زي كشف حساب بنكي.
  // التجميع بيمر من groupDebtsByPerson عشان جهة الاتصال هي اللي تحدد الشخص،
  // مش تطابق الاسم بالحرف — قبل كده مسافة زايدة في الاسم كانت بتقسم الحساب نصين.
  type PersonSummary = { key: string; personName: string; outFlow: number; inFlow: number; balance: number };
  const personSummaries = useMemo(() => {
    return groupDebtsByPerson(debts)
      .map(group => {
        const s: PersonSummary = { key: group.key, personName: group.displayName, outFlow: 0, inFlow: 0, balance: 0 };
        group.debts.forEach(d => {
          const initDate = d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '');
          const sign = d.direction === 'owed_to_me' ? 1 : -1;

          if (initDate >= range.from && initDate <= range.to) {
            if (d.direction === 'owed_to_me') s.outFlow += d.totalAmount; else s.inFlow += d.totalAmount;
          }
          s.balance += sign * d.totalAmount;

          (d.increases || []).forEach(inc => {
            if (inc.date >= range.from && inc.date <= range.to) {
              if (d.direction === 'owed_to_me') s.outFlow += inc.amount; else s.inFlow += inc.amount;
            }
            s.balance += sign * inc.amount;
          });
          d.payments.forEach(p => {
            if (p.date >= range.from && p.date <= range.to) {
              if (d.direction === 'owed_to_me') s.inFlow += p.amount; else s.outFlow += p.amount;
            }
            s.balance -= sign * p.amount;
          });
        });
        return s;
      })
      .filter(s => s.outFlow > 0 || s.inFlow > 0 || Math.abs(s.balance) > 0.001);
  }, [debts, range]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <Text style={styles.title}>التقارير</Text>

      <View style={styles.presetRow}>
        {[
          { key: 'thisMonth', label: 'هذا الشهر' },
          { key: 'last7', label: 'آخر 7 أيام' },
          { key: 'lastMonth', label: 'الشهر الماضي' },
          { key: 'custom', label: 'مخصص' },
        ].map(p => (
          <TouchableOpacity key={p.key} onPress={() => setPreset(p.key as Preset)}
            testID={`reports_preset_${p.key}`}
            style={[styles.presetBtn, selectionStyle(colors, preset === p.key)]}>
            <Text style={{ color: colors.text, fontSize: 12.5 }}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === 'custom' && (
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor('from')}>
            <Text style={styles.dateBtnText}>من: {customFrom}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textSecondary }}>إلى</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor('to')}>
            <Text style={styles.dateBtnText}>إلى: {customTo}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>مصروفات الفترة{catFilter.length > 0 ? ' (الفئات المختارة)' : ''}</Text>
          <Money value={periodExpense} style={styles.metricValue} />
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>مقارنة بالفترة السابقة</Text>
          <Text style={[styles.metricValue, { color: change === null ? colors.textSecondary : change > 0 ? colors.danger : colors.success }]}>
            {change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>توزيع المصاريف حسب الفئة</Text>
      <View style={styles.chipRow}>
        {chipCategories.map(c => {
          const active = catFilter.includes(c.id);
          return (
            <TouchableOpacity key={c.id} onPress={() => toggleCat(c.id)}
              style={[styles.chip, selectionStyle(colors, active)]}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: 12.5 }}>{categoryLabel(c)}</Text>
            </TouchableOpacity>
          );
        })}
        {catFilter.length > 0 && (
          <TouchableOpacity onPress={() => setCatFilter([])} style={[styles.chip, { borderColor: colors.borderStrong }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 12.5 }}>مسح الفلتر</Text>
          </TouchableOpacity>
        )}
      </View>

      {expenseByCat.length === 0 ? (
        <Text style={styles.emptyState}>مفيش مصاريف في الفترة دي</Text>
      ) : (
        <>
          <PieChart
            data={pieData}
            width={screenWidth - 32}
            height={200}
            accessor="amount"
            backgroundColor="transparent"
            paddingLeft="0"
            hasLegend={false}
            chartConfig={{ color: () => colors.text }}
          />
          <View style={styles.legendWrap}>
            {pieSlices.map(c => (
              <View key={c.id} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: c.color }]} />
                <Text style={styles.legendText}>
                  {c.name} · <Money value={c.amount} currency={false} /> ({Math.round((c.amount / periodExpense) * 100)}%)
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>كشف حساب الأشخاص</Text>
      <Text style={styles.hintText}>دوس على أي شخص تشوف كشف حساب تفصيلي زي كشف البنك</Text>
      {personSummaries.length === 0 ? (
        <Text style={styles.emptyState}>مفيش حركة ديون في الفترة دي</Text>
      ) : (
        personSummaries.map(s => (
          <TouchableOpacity
            key={s.key}
            style={styles.personCard}
            onPress={() => router.push({ pathname: '/person-ledger', params: { personKey: s.key } })}>
            <View style={styles.personHead}>
              <Text style={styles.personName}>{s.personName}</Text>
              <Text style={[styles.personBadge, { color: s.balance > 0 ? colors.success : s.balance < 0 ? colors.danger : colors.textSecondary }]}>
                {s.balance > 0 ? `ليك عنده ${money(s.balance)}` : s.balance < 0 ? `عليك له ${money(Math.abs(s.balance))}` : 'متسدد بالكامل'}
              </Text>
            </View>
            <View style={styles.personRow}>
              <Text style={styles.personSub}>منك ليه: <Money value={s.outFlow} currency={false} /></Text>
              <Text style={styles.personSub}>منه ليك: <Money value={s.inFlow} currency={false} /></Text>
            </View>
          </TouchableOpacity>
        ))
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

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 14 },
    presetRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
    presetBtn: { backgroundColor: c.surface2, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
    dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    dateBtnText: { color: c.text, fontSize: 12.5, textAlign: 'center' },
    metricRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
    metricCard: { flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border },
    metricLabel: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right' },
    metricValue: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 22, marginBottom: 4 },
    hintText: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginBottom: 10 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    legendWrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, marginTop: 14, justifyContent: 'flex-end' },
    legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: c.textSecondary, fontSize: 11.5 },
    personCard: { backgroundColor: c.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    personHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
    personName: { color: c.text, fontSize: 14, fontWeight: '700' },
    personBadge: { fontSize: 12, fontWeight: '700' },
    personRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 8 },
    personSub: { color: c.textSecondary, fontSize: 12 },
  });
}