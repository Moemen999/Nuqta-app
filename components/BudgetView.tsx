import { Money } from '@/components/Money';
import FoldedSection from '@/components/FoldedSection';
import { categoriesPhrase } from '@/lib/archiving';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { usePrivacy } from '@/context/PrivacyContext';
import { useData } from '@/context/DataContext';
import { monthSpendTotal, spendingExpenses, transferTransactionIds } from '@/lib/spending';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { categoryLabel, monthSpend, planBudgetCommit, todayStr } from '@/lib/finance';
import { budgetForecastText, budgetRunOutDay } from '@/lib/budgetForecast';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { useAmountDrafts } from '@/lib/useAmountDrafts';
import { useMemo } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';

const TOTAL_KEY = 'total_budget';

export default function BudgetView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categories: allCategories, transactions, budgets, setBudget, debts, gamiyas, transfersStatus } = useData();
  // بند 11: رقم المصروف (والتوقع) مبيظهرش لحد ما الديون والجمعية يوصلوا
  const spendLoading = transfersStatus === 'loading';
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);
  const { money } = usePrivacy();
  // الفئة المؤرشفة مالهاش ميزانية أصلاً (بتتمسح وقت الأرشفة)، فوجودها هنا
  // كان هيبقى صف فاضي بيزوّد الزحمة ويدخل في حسبة "المتبقي للتوزيع" بصفر
  const categories = useMemo(() => allCategories.filter(c => !c.archived), [allCategories]);
  // نداء واحد: أول يوم في الشهر `nowMonth` و`today` ميطلعوش من شهرين مختلفين (silent-failure-hunter)
  const today = todayStr();
  const nowMonth = today.slice(0, 7);
  // مصاريف الشهر **لحد النهارده** من غير السلفة والجمعية — عملية بتاريخ قدام مبتنفخش التوقع (money-reviewer)
  const monthRowsToDate = useMemo(
    () => spendingExpenses(transactions, transfers).filter(t => t.date.slice(0, 7) === nowMonth && t.date <= today),
    [transactions, transfers, nowMonth, today]
  );
  // "لو كمّلت بنفس المعدل، الميزانية هتخلص يوم …" — سطر معلومة (مش لون خطر)، بيختفي أول 7 أيام ولما "قربت تخلص" يبان.
  // السقف المحفوظ مش المسوّدة: السطر ميظهرش ويختفي مع كل رقم بيتكتب
  const forecast = (id: string, rows: typeof monthRowsToDate, savedLimit: number, shownSpend: number) => {
    const day = budgetRunOutDay(rows, savedLimit, today, shownSpend);
    return day === null ? null : <Text testID={`budget_forecast_${id}`} style={styles.forecast}>{budgetForecastText(day, today)}</Text>;
  };

  // المسوّدة والحفظ التلقائي وflush الخروج كلهم في `useAmountDrafts` دلوقتي.
  // كانت النسخة المحلية هنا نسخة تالتة من نفس الكود (مع المحافظ وشخبطة)،
  // والفرق الوحيد الحقيقي إن السقف مبيقبلش سالب — وده بقى `planBudgetCommit`.
  const { valueFor, numberFor, onChange, onBlur } = useAmountDrafts(
    key => budgets[key] || 0,
    (key, value) => setBudget(key, value),
    { plan: planBudgetCommit, blankWhenZero: true },
  );

  const totalBudget = budgets[TOTAL_KEY] || 0;
  const allocated = categories.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  const remaining = totalBudget - allocated;
  const totalMonthSpend = useMemo(
    // من غير السلفة وقسط الجمعية (خطوة 8)، بنفس الدالة اللي الرئيسية بتستخدمها
    () => monthSpendTotal(transactions, nowMonth, transfers),
    [transactions, nowMonth, transfers]
  );
  const spendByCategory = useMemo(() => {
    const map = new Map<string, number>();
    categories.forEach(c => map.set(c.id, monthSpend(transactions, c.id, nowMonth, transfers)));
    return map;
  }, [categories, transactions, nowMonth, transfers]);

  const withLimit = categories.filter(c => (budgets[c.id] || 0) > 0);
  const withoutLimit = categories.filter(c => !((budgets[c.id] || 0) > 0));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>الميزانية الشهرية</Text>
        {transfersStatus === 'failed' && <TransfersFailedNote testID="budget_transfers_failed" style={{ marginTop: -8, marginBottom: 12 }} />}

        <View style={styles.totalCard}>
          <View style={styles.head}>
            <Text style={styles.totalLabel}>الميزانية الإجمالية الشهرية</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              value={valueFor(TOTAL_KEY, budgets[TOTAL_KEY] || 0)}
              onChangeText={v => onChange(TOTAL_KEY, v)}
              onBlur={() => onBlur(TOTAL_KEY)}
              textAlign="right"
            />
          </View>
          {totalBudget > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalSub}>موزّع على الفئات: <Money value={allocated} currency={false} /></Text>
                <Text style={[styles.totalSub, { color: remaining < 0 ? colors.dangerText : colors.incomeText }]}>
                  {remaining < 0 ? 'تجاوزت الإجمالي بـ ' + money(Math.abs(remaining)) : 'متبقي للتوزيع: ' + money(remaining)}
                </Text>
              </View>
              {spendLoading ? <SpendLoading testID="budget_total_loading" style={styles.totalSub} /> : (
                <>
                  {/* دراسة الشكل خطوة 4: رقم بطل واحد للشاشة — اتصرف كام من الإجمالي */}
                  <View testID="budget_hero" style={styles.heroRow}>
                    <Money value={totalMonthSpend} currency={false} fit style={[styles.hero, totalMonthSpend > totalBudget && { color: colors.dangerText }]} />
                    <Text style={styles.heroOf}>اتصرف من <Money value={totalBudget} /></Text>
                  </View>
                  {forecast('total', monthRowsToDate, totalBudget, totalMonthSpend)}
                </>
              )}
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>توزيع الميزانية على الفئات</Text>
        {/* الفئات من غير سقف مطوية في سطر (دراسة الشكل) — التقسيم على المتخزّن مش المسوّدة، عشان الكارت ميتنقلش وانت بتكتب */}
        {[withLimit, withoutLimit].map((group, gi) => {
          const cards = group.map(c => {
          const limit = numberFor(c.id, budgets[c.id] || 0);
          const spend = spendByCategory.get(c.id) || 0;
          const pct = limit > 0 ? Math.min(100, (spend / limit) * 100) : 0;
          // لون بس من 80% (دراسة الشكل: الأخضر على كل حاجة سليمة كان دوشة) — الشريط بتوكنز النص (≥ 4.5 على المسار)
          const color = pct >= 100 ? colors.dangerText : pct >= 80 ? colors.accentText : colors.textSecondary;
          const textColor = pct >= 100 ? colors.dangerText : pct >= 80 ? colors.accentText : colors.textSecondary;

          return (
            <View key={c.id} style={styles.card}>
              <View style={styles.head}>
                <Text numberOfLines={1} ellipsizeMode="middle" style={styles.name}>{categoryLabel(c)}</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="السقف"
                  placeholderTextColor={colors.textSecondary}
                  value={valueFor(c.id, budgets[c.id] || 0)}
                  onChangeText={v => onChange(c.id, v)}
                  onBlur={() => onBlur(c.id)}
                  textAlign="right"
                />
              </View>
              {limit > 0 && spendLoading && <SpendLoading testID={`budget_loading_${c.id}`} style={styles.sub} />}
              {limit > 0 && !spendLoading && (
                <>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
                  </View>
                  <Text style={[styles.sub, { color: textColor }]}><Money value={spend} currency={false} /> / <Money value={limit} /></Text>
                  {forecast(c.id, monthRowsToDate.filter(t => t.categoryId === c.id), budgets[c.id] || 0, spend)}
                </>
              )}
            </View>
          );
          });
          return gi === 0 ? cards : (
            <FoldedSection key="nolimit" testID="budget_no_limit" title="فئات من غير سقف" count={group.length}
              a11yLabel={`فئات من غير سقف، ${categoriesPhrase(group.length)}`}>
              {cards}
            </FoldedSection>
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
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginBottom: space.xxl },
    totalCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.xxxl },
    totalLabel: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    totalRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: space.md },
    totalSub: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    heroRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: space.sm, marginTop: space.lg },
    hero: { color: c.text, fontSize: typeScale.hero, fontWeight: '700', textAlign: 'right' },
    heroOf: { color: c.textSecondary, fontSize: typeScale.body },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginBottom: space.md },
    card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.md },
    head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    name: { color: c.text, fontSize: typeScale.body, fontWeight: '500', flexShrink: 1 },
    input: { width: 110, minHeight: MIN_TOUCH, backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.sm, color: c.text, paddingHorizontal: space.md, fontSize: typeScale.body },
    track: { height: 4, backgroundColor: c.surface2, borderRadius: 2, marginTop: space.lg, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 2 },
    sub: { fontSize: typeScale.caption, marginTop: space.xs, textAlign: 'right' },
    forecast: { color: c.textSecondary, fontSize: typeScale.caption, marginTop: space.xs, textAlign: 'right' },
  });
}