import { PeriodChips } from '@/components/PeriodChips';
import { Money } from '@/components/Money';
import { usePrivacy } from '@/context/PrivacyContext';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import { addDays, buildCategorySpend, buildPieSlices, categoryLabel, endOfMonth, groupDebtsByPerson, periodExpenseTotal, startOfMonth, todayStr } from '@/lib/finance';
import { barRows } from '@/lib/barRows';
import { monthlyTrend, TREND_MONTHS } from '@/lib/monthlyTrend';
import { PREVIOUS_PERIOD_LABEL } from '@/lib/periodPresets';
import { spendingExpenses, transferTransactionIds } from '@/lib/spending';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'custom';
const REPORT_PRESETS: Preset[] = ['thisMonth', 'last7', 'lastMonth', 'custom'];

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categories, transactions, debts, gamiyas, transfersStatus } = useData();
  // بند 11: من غير الديون والجمعية السلفة بتتعدّ مصروف — الأرقام مبتظهرش لحد ما يوصلوا
  const spendLoading = transfersStatus === 'loading';
  // السلفة والجمعية مش مصروف (خطوة 8) — بتتعرف من المعرّفات المتخزّنة جوه الدين والجمعية
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);
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
    () => spendingExpenses(filtered, transfers),
    [filtered, transfers]
  );

  const expenseByCat = useMemo(
    () => buildCategorySpend(periodExpenses, categories, {
      // الشرايح المحايدة (ممسوحة، من غير فئة، فئات تانية) textSecondary مش textMuted: كعمود على surface2 الـMuted
      // كان تحت 3:1 في الثيمين (visual-identity-reviewer) — مش نص، فحد العنصر غير النصي 3:1
      colorFor: id => categoryColors.get(id) || colors.textSecondary,
      deletedColor: colors.textSecondary,
      visibleIds,
    }),
    [periodExpenses, categories, categoryColors, colors.textSecondary, visibleIds]
  );

  const periodExpense = useMemo(
    () => periodExpenseTotal(periodExpenses, visibleIds),
    [periodExpenses, visibleIds]
  );

  // الشرايح الزيادة بتتلمّ في شريحة واحدة بلون محايد برّه باليتة الفئات.
  // التفاصيل (وليه اسمها بالعدد) في `buildPieSlices`.
  const pieSlices = useMemo(
    () => buildPieSlices(expenseByCat, colors.textSecondary),
    [expenseByCat, colors.textSecondary]
  );

  // كل المصروف الحقيقي (من غير سلفة وجمعية) على كل التواريخ — للفترة اللي فاتت وللاتجاه
  const allSpending = useMemo(() => spendingExpenses(transactions, transfers), [transactions, transfers]);

  const change = useMemo(() => {
    const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1);
    const prevFrom = addDays(range.from, -days);
    const prevTo = addDays(range.from, -1);
    // نفس قاعدة الفترة الحالية بالظبط. قبل كده الفترة السابقة كانت بتتفلتر
    // على الفئات الموجودة حتى وإحنا مش فالتين حاجة، فالمصروف اللي فئته
    // اتمسحت كان بيتشال من فترة واحدة بس — ومقارنة بقاعدتين بتدي نسبة غلط
    const prevExpenses = allSpending
      .filter(t => t.date >= prevFrom && t.date <= prevTo);
    const prevExpense = periodExpenseTotal(prevExpenses, visibleIds);
    return prevExpense === 0 ? null : Math.round(((periodExpense - prevExpense) / prevExpense) * 100);
  }, [range, visibleIds, allSpending, periodExpense]);

  // الاتجاه شهور كاملة دايمًا (مش فلتر الفترة)، بس بيمشي مع فلتر الفئات — `lib/monthlyTrend.ts`
  // اليوم في الـdeps: لو الشاشة اترسمت تاني بعد نص الليل/أول الشهر، الشهر الحالي بيتحرّك (silent-failure-hunter)
  const today = todayStr();
  const trend = useMemo(
    () => monthlyTrend(allSpending, today, visibleIds),
    [allSpending, today, visibleIds]
  );
  const trendEmpty = trend.every(m => m.amount === 0);

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

      <PeriodChips keys={REPORT_PRESETS} value={preset} onChange={setPreset} testIDPrefix="reports_preset" />

      {preset === 'custom' && (
        <View style={styles.dateRow}>
          <TouchableOpacity accessibilityRole="button" style={styles.dateBtn} onPress={() => setPickerFor('from')}>
            <Text style={styles.dateBtnText}>من: {customFrom}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.dateBtn} onPress={() => setPickerFor('to')}>
            <Text style={styles.dateBtnText}>لحد: {customTo}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>مصروفات الفترة{catFilter.length > 0 ? ' (الفئات المختارة)' : ''}</Text>
          {spendLoading ? <SpendLoading testID="reports_period_loading" style={styles.metricValue} /> : <Money value={periodExpense} style={styles.metricValue} />}
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>{PREVIOUS_PERIOD_LABEL}</Text>
          {spendLoading ? <SpendLoading style={styles.metricValue} /> : (
            <Text style={[styles.metricValue, { color: change === null ? colors.textSecondary : change > 0 ? colors.dangerText : colors.incomeText }]}>
              {change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}
            </Text>
          )}
        </View>
      </View>
      {transfersStatus === 'failed' && <TransfersFailedNote testID="reports_transfers_failed" />}

      <Text style={styles.sectionTitle}>توزيع المصاريف حسب الفئة</Text>
      <View style={styles.chipRow}>
        {chipCategories.map(c => {
          const active = catFilter.includes(c.id);
          return (
            <TouchableOpacity {...selectionA11y(active)} key={c.id} onPress={() => toggleCat(c.id)}
              style={[styles.chip, selectionStyle(colors, active)]}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: 12.5 }}>{categoryLabel(c)}</Text>
            </TouchableOpacity>
          );
        })}
        {catFilter.length > 0 && (
          <TouchableOpacity accessibilityRole="button" onPress={() => setCatFilter([])} style={[styles.chip, { borderColor: colors.borderStrong }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 12.5 }}>مسح الفلتر</Text>
          </TouchableOpacity>
        )}
      </View>

      {spendLoading ? (
        <SpendLoading testID="reports_bars_loading" style={styles.emptyState} />
      ) : expenseByCat.length === 0 ? (
        <Text style={styles.emptyState}>مفيش مصاريف في الفترة دي</Text>
      ) : (
        <>
          {/* أعمدة أفقية بدل الدائري (ترشيح "جرد رسم التقارير" 2026-10-29 — على فرع، مستني مؤمن): الاسم والمبلغ
              والنسبة في سطر، والعمود تحته بطوله نسبةً لأكبر فئة. نفس الشرايح والألوان (`buildPieSlices`)، من غير اعتمادية */}
          <View testID="reports_bars" style={styles.bars}>
            {barRows(pieSlices, periodExpense).map(c => (
              // الصف مش عنصر واحد لقارئ الشاشة (a11y-architect BLOCKER): كان بيبلع المبلغ وزرار الكشف بتاع Money والعين
              // مقفولة. الاسم، والمبلغ (Money أخ مستقل)، والنسبة — كل واحد محطة، بنفس ترتيب العين
              <View key={c.id} testID={`reports_bar_${c.id}`} style={styles.barRow}>
                <View style={styles.barHead}>
                  <Text style={styles.barName}>{c.name}</Text>
                  <Money value={c.amount} currency={false} style={styles.barValue} />
                  <Text style={styles.barPercent} accessibilityLabel={`${c.percent.replace('%', ' بالمية')} من المصروف`}>{c.percent}</Text>
                </View>
                {/* زخرفي: الرقم والنسبة مكتوبين فوقه */}
                <View style={styles.barTrack} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                  <View style={[styles.barFill, { width: `${Math.max(c.share * 100, c.amount > 0 ? 2 : 0)}%`, backgroundColor: c.color }]} />
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>مصروفك آخر {TREND_MONTHS} شهور{catFilter.length > 0 ? ' (الفئات المختارة)' : ''}</Text>
      {spendLoading ? (
        <SpendLoading testID="reports_trend_loading" style={styles.emptyState} />
      ) : trendEmpty ? (
        <Text style={styles.emptyState}>مفيش مصاريف{catFilter.length > 0 ? ' للفئات دي' : ''} في آخر {TREND_MONTHS} شهور</Text>
      ) : (
        <>
          {/* عمود لكل شهر، الأقدم يمين والأحدث شمال (RTL). العمود زخرفي؛ القارئ بيسمع الشهر (و"لسه ما خلصش" للحالي)
              وبعده المبلغ — Money أخ مستقل عشان القناع والكشف بتاعه ميتبلعوش (نفس قاعدة الأعمدة الأفقية) */}
          <View testID="reports_trend" style={styles.trendRow}>
            {trend.map(m => (
              <View key={m.key} testID={`reports_trend_${m.key}`} style={styles.trendCol}>
                <View style={styles.trendTrack} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                  <View style={[
                    styles.trendFill,
                    { height: `${Math.max(m.share * 100, m.amount > 0 ? 2 : 0)}%` },
                    m.partial && styles.trendFillPartial,
                    // الشهر الحالي إطار من غير ملو، فالعمود لازم يبان حتى لو صغير
                    m.partial && m.amount > 0 && { minHeight: 6 },
                  ]} />
                </View>
                <Text style={styles.trendLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
                  accessibilityLabel={m.partial ? `${m.label}، لسه ما خلصش` : undefined}>{m.label}</Text>
                <Money value={m.amount} currency={false} style={styles.trendValue} />
              </View>
            ))}
          </View>
          <Text style={styles.hintText}>الشهر ده لسه ما خلصش، فعموده محسوب لحد النهارده بس</Text>
        </>
      )}

      <Text style={styles.sectionTitle}>كشف حساب الأشخاص</Text>
      <Text style={styles.hintText}>دوس على أي شخص تشوف كشف حساب تفصيلي زي كشف البنك</Text>
      {personSummaries.length === 0 ? (
        <Text style={styles.emptyState}>مفيش حركة ديون في الفترة دي</Text>
      ) : (
        personSummaries.map(s => (
          <TouchableOpacity accessibilityRole="button"
            key={s.key}
            style={styles.personCard}
            onPress={() => router.push({ pathname: '/person-ledger', params: { personKey: s.key } })}>
            <View style={styles.personHead}>
              <Text style={styles.personName}>{s.personName}</Text>
              <Text style={[styles.personBadge, { color: s.balance > 0 ? colors.incomeText : s.balance < 0 ? colors.dangerText : colors.textSecondary }]}>
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
    bars: { marginTop: 8, gap: 14 },
    barRow: { gap: 6 },
    // بيلف مع تكبير الخط بدل ما يقص الاسم (a11y-architect)
    barHead: { flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
    barName: { flex: 1, minWidth: 120, color: c.text, fontSize: 13, textAlign: 'right' },
    barValue: { color: c.text, fontSize: 13 },
    barPercent: { color: c.textSecondary, fontSize: 12.5, minWidth: 36, textAlign: 'left' },
    // العمود بيبدأ من اليمين (RTL)
    barTrack: { height: 10, borderRadius: 5, backgroundColor: c.surface2, flexDirection: 'row-reverse', overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 5 },
    trendRow: { flexDirection: 'row-reverse', gap: 6, marginTop: 8, marginBottom: 6 },
    trendCol: { flex: 1, alignItems: 'center', gap: 4 },
    // العمود بيطلع من تحت
    trendTrack: { height: 110, width: '70%', justifyContent: 'flex-end', backgroundColor: c.surface2, borderRadius: 6, overflow: 'hidden' },
    // accentText مش accent: الدهبي الفاتح على surface2 في الثيم الفاتح 1.8:1، تحت 3:1 بتاع الرسوم (a11y-architect)
    trendFill: { width: '100%', backgroundColor: c.accentText, borderRadius: 6 },
    // الشهر اللي لسه ما خلصش: إطار بس من غير ملو (مش شفافية — كانت بتخفّي الإطار معاها)، عشان قصره ميتقريش "صرفت أقل"
    trendFillPartial: { backgroundColor: 'transparent', borderWidth: 2, borderColor: c.accentText },
    trendLabel: { color: c.textSecondary, fontSize: 11.5, textAlign: 'center' },
    trendValue: { color: c.text, fontSize: 11, textAlign: 'center' },
    personCard: { backgroundColor: c.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    personHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
    personName: { color: c.text, fontSize: 14, fontWeight: '700' },
    personBadge: { fontSize: 12, fontWeight: '700' },
    personRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 8 },
    personSub: { color: c.textSecondary, fontSize: 12 },
  });
}