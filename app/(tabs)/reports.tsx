import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { PeriodChips } from '@/components/PeriodChips';
import { Money } from '@/components/Money';
import { usePrivacy } from '@/context/PrivacyContext';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import { addDays, buildCategorySpend, buildPieSlices, categoryLabel, endOfMonth, groupDebtsByPerson, PIASTRE_EPS, periodExpenseTotal, snapPiastre, startOfMonth, todayStr } from '@/lib/finance';
import { barRows } from '@/lib/barRows';
import { rangeText, sixMonthsStart, spendTimeline, TIMELINE_TITLE, type TimelineBucket } from '@/lib/spendTimeline';
import { previousPeriodLabel } from '@/lib/periodPresets';
import { comparisonWindows } from '@/lib/periodCompare';
import { spendingExpenses, transferTransactionIds } from '@/lib/spending';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { quietSelectionStyle, selectionA11y } from '@/lib/selection';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'last6Months' | 'custom';
const REPORT_PRESETS: Preset[] = ['thisMonth', 'last7', 'lastMonth', 'last6Months', 'custom'];

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
  const [selectedCats, setCatFilter] = useState<string[]>([]);
  // فئة اتمسحت والشاشة مفتوحة تخرج من الفلتر: الرقم كان هيعدّها والشرايح لأ، فالعمود يبقى من غير جزء يوضّحه
  const catFilter = useMemo(() => selectedCats.filter(id => categories.some(c => c.id === id)), [selectedCats, categories]);
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null);

  // اليوم في الـdeps: لو الشاشة فضلت مفتوحة بعد نص الليل، الفترة والعمود الحالي بيتحرّكوا معاه
  const today = todayStr();
  const range = useMemo(() => {
    if (preset === 'last7') return { from: addDays(today, -6), to: today };
    if (preset === 'lastMonth') {
      const prevMonthDay = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prevMonthDay), to: endOfMonth(prevMonthDay) };
    }
    if (preset === 'last6Months') return { from: sixMonthsStart(today), to: endOfMonth(today) };
    if (preset === 'custom') {
      const from = customFrom <= customTo ? customFrom : customTo;
      const to = customFrom <= customTo ? customTo : customFrom;
      return { from, to };
    }
    return { from: startOfMonth(today), to: endOfMonth(today) };
  }, [preset, customFrom, customTo, today]);

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

  // كل المصروف الحقيقي (من غير سلفة وجمعية) على كل التواريخ — للفترة اللي فاتت
  const allSpending = useMemo(() => spendingExpenses(transactions, transfers), [transactions, transfers]);

  const change = useMemo(() => {
    const windows = comparisonWindows(range, today, preset);
    if (!windows) return null;
    const { current, previous } = windows;
    // البسط مصروف الفترة لحد النهارده بس، عشان عملية تاريخها جاي ميبوّظش النسبة
    const curExpense = periodExpenseTotal(
      allSpending.filter(t => t.date >= current.from && t.date <= current.to),
      visibleIds,
    );
    // نفس قاعدة الفترة الحالية بالظبط. قبل كده الفترة السابقة كانت بتتفلتر
    // على الفئات الموجودة حتى وإحنا مش فالتين حاجة، فالمصروف اللي فئته
    // اتمسحت كان بيتشال من فترة واحدة بس — ومقارنة بقاعدتين بتدي نسبة غلط
    const prevExpenses = allSpending
      .filter(t => t.date >= previous.from && t.date <= previous.to);
    const prevExpense = periodExpenseTotal(prevExpenses, visibleIds);
    return Math.abs(prevExpense) < PIASTRE_EPS ? null : Math.round(((curExpense - prevExpense) / prevExpense) * 100);
  }, [range, today, preset, visibleIds, allSpending]);

  // الأعمدة من الفترة والفئات المختارين ومن نفس صفوف الرقم البطل — `lib/spendTimeline.ts`
  const sliceIds = useMemo(() => visibleIds ? pieSlices.map(s => s.id) : undefined, [visibleIds, pieSlices]);
  const timeline = useMemo(
    () => spendTimeline(periodExpenses, range, today, visibleIds, sliceIds),
    [periodExpenses, range, today, visibleIds, sliceIds]
  );
  const timelineEmpty = timeline.buckets.every(b => b.amount === 0);
  const timelineHasPartial = timeline.buckets.some(b => b.partial);
  // فئة واحدة = عمود بلونها، أكتر من فئة = العمود متقسم بألوانهم، ومن غير فلتر = الإجمالي بلون التطبيق.
  // اللون تبع الفئة مش ترتيبها (`useChartColors`)، فالفلتر مبيغيّرش لون اللي فضل
  const stacked = catFilter.length > 0 && pieSlices.length > 1;
  const columnColor = catFilter.length > 0 && pieSlices.length === 1 ? pieSlices[0].color : colors.accentText;
  const sliceColors = useMemo(() => new Map(pieSlices.map(s => [s.id, s.color])), [pieSlices]);
  const sliceNames = useMemo(() => new Map(pieSlices.map(s => [s.id, s.name])), [pieSlices]);
  // فوق 6 أعمدة العرض حوالي 36 نقطة: القروش بتصغّر الرقم لحد ما يتقص. الرسم للمقارنة، والرقم بالقرش في الرقم البطل
  const roundColumns = timeline.buckets.length > 6;
  // القارئ مبيشوفش ألوان العمود: نسب مش مبالغ عشان القناع يفضل شغال
  function columnLabel(b: TimelineBucket) {
    const parts = stacked ? b.segments.map(s => {
      const pct = (s.amount / b.amount) * 100;
      return `${sliceNames.get(s.id) ?? ''} ${pct < 1 ? 'أقل من 1' : Math.round(pct)} بالمية`;
    }) : [];
    return [b.spoken, ...(b.partial ? ['مش فترة كاملة'] : []), ...parts].join('، ');
  }

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
        // نص قرش زي كشف الشخص و`isDebtSettled`: كسور الجمع كانت بتطلّع "ليك عنده 0.00"
        s.balance = snapPiastre(s.balance);
        return s;
      })
      .filter(s => s.outFlow > 0 || s.inFlow > 0 || s.balance !== 0);
  }, [debts, range]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
    <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content}
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

      {/* دراسة الشكل خطوة 5: رقم بطل واحد (مصروف الفترة) والمقارنة سطر صغير تحته — كانوا كارتين بنفس الوزن */}
      <View testID="reports_hero" style={styles.heroCard}>
        <Text style={styles.metricLabel}>مصروفات الفترة{catFilter.length > 0 ? ' (الفئات المختارة)' : ''}</Text>
        {spendLoading ? <SpendLoading testID="reports_period_loading" style={styles.heroLoading} /> : <Money value={periodExpense} fit style={styles.heroValue} />}
        <View style={styles.changeRow}>
          <Text style={styles.metricLabel}>{previousPeriodLabel(preset)}</Text>
          {spendLoading ? <SpendLoading style={styles.changeValue} /> : (
            <Text style={[styles.changeValue, { color: change === null || change === 0 ? colors.textSecondary : change > 0 ? colors.dangerText : colors.incomeText }]}>
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
              style={[styles.chip, quietSelectionStyle(colors, active)]}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: typeScale.body }}>{categoryLabel(c)}</Text>
            </TouchableOpacity>
          );
        })}
        {catFilter.length > 0 && (
          <TouchableOpacity accessibilityRole="button" onPress={() => setCatFilter([])} style={[styles.chip, { borderColor: colors.borderStrong }]}>
            <Text style={{ color: colors.textSecondary, fontSize: typeScale.body }}>مسح الفلتر</Text>
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

      <Text style={styles.sectionTitle}>{TIMELINE_TITLE[timeline.unit]}{catFilter.length > 0 ? ' (الفئات المختارة)' : ''}</Text>
      <Text testID="reports_trend_range" style={styles.hintText}>{rangeText(range.from, range.to)}</Text>
      {spendLoading ? (
        <SpendLoading testID="reports_trend_loading" style={styles.emptyState} />
      ) : timelineEmpty ? (
        <Text style={styles.emptyState}>مفيش مصاريف{catFilter.length > 0 ? ' للفئات دي' : ''} في الفترة دي</Text>
      ) : (
        <>
          {/* الأقدم يمين والأحدث شمال (RTL). العمود زخرفي؛ القارئ بيسمع التاريخ كامل (و"مش فترة كاملة" لو ناقص)
              وبعده المبلغ — Money أخ مستقل عشان القناع والكشف بتاعه ميتبلعوش (نفس قاعدة الأعمدة الأفقية) */}
          <View testID="reports_trend" style={styles.trendRow}>
            {timeline.buckets.map(b => (
              <View key={b.key} testID={`reports_trend_${b.key}`} style={styles.trendCol}>
                <View style={styles.trendTrack} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                  <View style={[
                    styles.trendFill,
                    { height: `${Math.max(b.share * 100, b.amount > 0 ? 2 : 0)}%`, backgroundColor: stacked ? 'transparent' : columnColor },
                    b.partial && { backgroundColor: 'transparent', borderWidth: 2, borderColor: columnColor },
                    // العمود الناقص إطار، فلازم يبان حتى لو صغير
                    b.partial && b.amount > 0 && { minHeight: 6 },
                    // كل جزء 2 + فاصل 2، فالعمود القصير مبيقصّش الأجزاء
                    stacked && b.segments.length > 1 && { minHeight: b.segments.length * 4 - 2 + (b.partial ? 4 : 0) },
                  ]}>
                    {stacked && b.segments.map(s => (
                      <View key={s.id} testID={`reports_trend_${b.key}_${s.id}`} style={[styles.trendSegment, { flex: s.amount, backgroundColor: sliceColors.get(s.id) ?? colors.textSecondary }]} />
                    ))}
                  </View>
                </View>
                <Text style={styles.trendLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
                  accessibilityLabel={columnLabel(b)}>{b.label}</Text>
                {b.sublabel !== '' && (
                  <Text style={styles.trendSublabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
                    importantForAccessibility="no" accessibilityElementsHidden>{b.sublabel}</Text>
                )}
                {b.future && b.amount === 0
                  ? <Text style={styles.trendValue} accessibilityLabel="لسه ما جاش">—</Text>
                  : <Money value={roundColumns ? Math.round(b.amount) : b.amount} currency={false} fit style={styles.trendValue} />}
              </View>
            ))}
          </View>
          {/* المفتاح نسخة من أسامي الأعمدة الأفقية اللي فوقه، فالقارئ مش محتاج يسمعها تاني */}
          {stacked && (
            <View testID="reports_trend_legend" style={styles.legend} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {pieSlices.map(s => (
                <View key={s.id} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                  <Text numberOfLines={1} style={styles.legendText}>{s.name}</Text>
                </View>
              ))}
            </View>
          )}
          {timelineHasPartial && <Text style={styles.hintText}>العمود اللي بإطار فترته أقصر من الباقي أو لسه ما خلصتش</Text>}
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
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scrollArea: { flex: 1 },
    content: { padding: 16, paddingBottom: 40 },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginBottom: space.xl },
    dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
    // نفس زرار التاريخ في الأرشيف (visual-identity-reviewer: كان نفس الزرار بشكلين)
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateBtnText: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    heroCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxxl, marginTop: space.xl },
    // "بنحمّل…" مكان الرقم البطل بحجم هادي — بمقاس الرقم كانت جملة "لسه بنحمّل…" بتلف 3 سطور (visual-identity-reviewer)
    heroLoading: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', marginTop: space.sm },
    heroValue: { color: c.text, fontSize: typeScale.hero, fontWeight: '700', textAlign: 'right', marginTop: space.xxs },
    changeRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: space.sm, marginTop: space.sm },
    changeValue: { fontSize: typeScale.body, fontWeight: '700' },
    metricLabel: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right' },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: space.huge, marginBottom: space.xxs },
    hintText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.md },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    emptyState: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', paddingVertical: space.xxxl },
    bars: { marginTop: 8, gap: 14 },
    barRow: { gap: 6 },
    // بيلف مع تكبير الخط بدل ما يقص الاسم (a11y-architect)
    barHead: { flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
    barName: { flex: 1, minWidth: 120, color: c.text, fontSize: typeScale.body, textAlign: 'right' },
    barValue: { color: c.text, fontSize: typeScale.body },
    barPercent: { color: c.textSecondary, fontSize: typeScale.caption, minWidth: 36, textAlign: 'left' },
    // العمود بيبدأ من اليمين (RTL)
    barTrack: { height: 10, borderRadius: 5, backgroundColor: c.surface2, flexDirection: 'row-reverse', overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 5 },
    trendRow: { flexDirection: 'row-reverse', gap: 6, marginTop: 8, marginBottom: 6 },
    trendCol: { flex: 1, alignItems: 'center', gap: 4 },
    // العمود بيطلع من تحت
    trendTrack: { height: 110, width: '70%', justifyContent: 'flex-end', backgroundColor: c.surface2, borderRadius: 6, overflow: 'hidden' },
    // اللون على العمود نفسه: accentText مش accent — الدهبي الفاتح على surface2 في الثيم الفاتح 1.8:1، تحت 3:1 بتاع الرسوم (a11y-architect).
    // العمود الناقص إطار من غير ملو (مش شفافية — كانت بتخفّي الإطار معاها)، عشان قصره ميتقريش "صرفت أقل".
    // الأجزاء من تحت لفوق والأكبر تحت، و2 فاصل بلون المسار بين كل جزء والتاني
    trendFill: { width: '100%', borderRadius: 6, overflow: 'hidden', flexDirection: 'column-reverse', gap: 2 },
    trendSegment: { minHeight: 2 },
    // alignSelf: من غيره عرض النص بيتحسب على قده والتصغير مبيشتغلش
    trendLabel: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'center', alignSelf: 'stretch' },
    trendSublabel: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'center', alignSelf: 'stretch', marginTop: -space.xxs },
    trendValue: { color: c.text, fontSize: typeScale.caption, textAlign: 'center', alignSelf: 'stretch' },
    legend: { flexDirection: 'row-reverse', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs, marginTop: space.sm, marginBottom: space.sm },
    legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs, maxWidth: '100%' },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { color: c.textSecondary, fontSize: typeScale.caption },
    personCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.sm },
    personHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
    personName: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    personBadge: { fontSize: typeScale.caption, fontWeight: '700' },
    personRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: space.sm },
    personSub: { color: c.textSecondary, fontSize: typeScale.caption },
  });
}