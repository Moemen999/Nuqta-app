import { Money } from '@/components/Money';
import { ProgressRing } from '@/components/ProgressRing';
import FoldedSection from '@/components/FoldedSection';
import { categoriesPhrase } from '@/lib/archiving';
import { cardElevation, MIN_TOUCH, categoryIconSize, radius, space, typeScale } from '@/lib/tokens';
import { CategoryIcon, categoryInlineRow } from '@/components/CategoryIcon';
import { useChartColors } from '@/hooks/use-chart-colors';

import { usePrivacy } from '@/context/PrivacyContext';
import { useData } from '@/context/DataContext';
import { monthSpendTotal, spendingExpenses, transferTransactionIds } from '@/lib/spending';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { AMOUNT_CLEARED_BODY, AMOUNT_REJECT_TITLE, AUTOSAVE_HINT, amountClearedTitle, NO_CATEGORIES_TEXT, amountRejectBody, budgetFieldName, categoryLabel, monthSpend, planBudgetCommit, snapPiastre, todayStr } from '@/lib/finance';
import { moneyText, speakable } from '@/lib/money';
import { useNotice } from '@/components/NoticeProvider';
import { WRITE_ERROR_TITLE, writeErrorBody } from '@/lib/writeError';
import { budgetForecastText, budgetLevel, budgetLevelColor, budgetRunOutDay } from '@/lib/budgetForecast';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { useAmountDrafts } from '@/lib/useAmountDrafts';
import { useMemo, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { useFabScroll } from '@/context/FabScrollContext';

const TOTAL_KEY = 'total_budget';

const BUDGETS_LOAD_ERROR = 'السقوف المحفوظة ما وصلتش من السيرفر، فممكن تبان فاضية وهي مش فاضية. التعديل مقفول لحد ما توصل — دوس «جرّب تاني» فوق.';
const LEVEL_WORD = { under: '', near: 'قرّبت تخلص', at: 'خلصت', over: 'عدّيت' } as const;

export default function BudgetView() {
  const fabScroll = useFabScroll();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categoryColors } = useChartColors();
  const { categories: allCategories, transactions, budgets, setBudget, debts, gamiyas, transfersStatus, loadErrors = [], figuresPending = [], budgetsReady } = useData();
  const notice = useNotice();
  // بند 11: رقم المصروف (والتوقع) مبيظهرش لحد ما الديون والجمعية يوصلوا — **والعمليات نفسها** زي الرئيسية (الميزة 6):
  // قبلها «0 اتصرف» كان بيتعرض رقم حقيقي. لو مبتوصلش، `SpendLoading` بيقول بعد المهلة إن النت هو السبب
  const spendLoading = transfersStatus === 'loading' || figuresPending.includes('transactions');
  // الميزانيات اترفضت ← السقوف المعروضة فاضية مش حقيقية؛ الكتابة كانت هتكتب فوق سقف المستخدم مش شايفه
  const budgetsFailed = loadErrors.includes('budgets');
  // ولسه ما اتشافتش (snapshot فاضي من الكاش بس) — نفس الخطر من غير رفض (الجولة الأخيرة، بند 1)
  const budgetsEditable = budgetsReady === true && !budgetsFailed;
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);
  const { money, amountsHidden } = usePrivacy();
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
    return day === null ? null : <Text testID={`budget_forecast_${id}`} style={styles.forecast}>{budgetForecastText(day, today, id === 'total' ? 'total' : 'category')}</Text>;
  };

  // اسم الخانة في الرسايل: «سقف "أكل"» أو «السقف الإجمالي»
  const fieldName = (key: string) => (key === TOTAL_KEY ? budgetFieldName() : budgetFieldName(allCategories.find(c => c.id === key)?.name ?? ''));
  // رقم مرفوض (سالب، كلام) كان بيرجع للمحفوظ ساكت — دلوقتي بيتقال، حتى لو الشاشة اتشالت (الرسالة برّه الشاشة)
  const sayRejected = (key: string) => notice(AMOUNT_REJECT_TITLE, amountRejectBody(fieldName(key)));

  // المسوّدة والحفظ التلقائي وflush الخروج كلهم في `useAmountDrafts` دلوقتي.
  // كانت النسخة المحلية هنا نسخة تالتة من نفس الكود (مع المحافظ وشخبطة)،
  // والفرق الوحيد الحقيقي إن السقف مبيقبلش سالب — وده بقى `planBudgetCommit`.
  // الفاضي مبيتحفظش لوحده (`autosaveBlank: false`): مسح السقف عشان تكتب رقم جديد كان بيحفظ صفر بعد ثانية والكارت ينط
  // للمطوي — الصفر بيتحفظ لما تسيب الخانة بس
  const { valueFor, numberFor, onChange, onBlur } = useAmountDrafts(
    key => budgets[key] || 0,
    (key, value) => {
      void Promise.resolve(setBudget(key, value)).then(ok => {
        if (ok) AccessibilityInfo.announceForAccessibility(speakable(`اتحفظ ${fieldName(key)}`));
      }).catch(() => notice(WRITE_ERROR_TITLE, writeErrorBody(fieldName(key))));
    },
    {
      plan: planBudgetCommit, blankWhenZero: true, autosaveBlank: false, onReject: sayRejected, onDroppedReject: sayRejected,
      // سحبة بتقفل الكيبورد وخانة فاضية ← السقف بيتشال؛ بيتقال مش ساكت (الجولة الأخيرة، L2)
      onBlankCleared: key => notice(amountClearedTitle(fieldName(key)), AMOUNT_CLEARED_BODY),
    },
  );

  const totalBudget = budgets[TOTAL_KEY] || 0;
  const allocated = categories.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  // نص قرش زي أي رصيد: كسور الجمع (0.1+0.2) مكانتش تبقى «زوّدت بـ 0.00»
  const remaining = snapPiastre(totalBudget - allocated);
  const totalMonthSpend = useMemo(
    // من غير السلفة وقسط الجمعية (خطوة 8). الرئيسية بتعدّي من `monthSummary` (← `spendInRange`)، والاتنين نفس الرقم
    // على عمليات بتاريخ صالح (`spending.test.ts`)
    () => monthSpendTotal(transactions, nowMonth, transfers),
    [transactions, nowMonth, transfers]
  );
  // الرقم البطل والدايرة مع بعض، نفس `budgetLevel` بتاع الرئيسية (نص قرش): 'over' (عدّيت) خطر، و'at' (صرفت بالظبط) دهبي
  // زي الرئيسية — الأحمر للتعدّي بس (قرار مؤمن 2026-11-16)
  const totalLevel = budgetLevel(totalMonthSpend, totalBudget);
  const spendByCategory = useMemo(() => {
    const map = new Map<string, number>();
    categories.forEach(c => map.set(c.id, monthSpend(transactions, c.id, nowMonth, transfers)));
    return map;
  }, [categories, transactions, nowMonth, transfers]);

  // الكارت اللي اتكتب فيه وهو في المطوي **بيفضل فيه** لحد ما تسيب الشاشة (a11y-architect BLOCKER): الحفظ التلقائي بعد
  // ثانية كان بينقله للقايمة اللي فوق، فالخانة بتتشال والكيبورد بيقع في نص الرقم ("5000" تتحفظ "5")
  // والعكس كمان (الميزة 6): كارت فوق اتمسح سقفه وانت فيه مبينزلش المطوي. المجموعة بتتثبّت أول ما الخانة تاخد الفوكس
  const [pinned, setPinned] = useState<Record<string, 0 | 1>>({});
  const pinGroup = (id: string, group: 0 | 1) => setPinned(prev => (id in prev ? prev : { ...prev, [id]: group }));
  const groupOf = (id: string): 0 | 1 => pinned[id] ?? ((budgets[id] || 0) > 0 ? 0 : 1);
  const withLimit = categories.filter(c => groupOf(c.id) === 0);
  const withoutLimit = categories.filter(c => groupOf(c.id) === 1);
  const noCategories = categories.length === 0 && !loadErrors.includes('categories');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        {...fabScroll.scrollProps}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title} accessibilityRole="header">الميزانية الشهرية</Text>
        {transfersStatus === 'failed' && <TransfersFailedNote testID="budget_transfers_failed" style={{ marginTop: -8, marginBottom: 12 }} />}
        {budgetsFailed && <Text testID="budget_load_error" style={styles.loadError}>{BUDGETS_LOAD_ERROR}</Text>}

        <View style={styles.totalCard}>
          <View style={styles.head}>
            <Text style={styles.totalLabel}>الميزانية الإجمالية الشهرية</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="الميزانية الإجمالية الشهرية"
              accessibilityHint={AUTOSAVE_HINT}
              editable={budgetsEditable}
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
                <Text style={styles.totalSub} accessible accessibilityLabel={speakable(`موزّع على الفئات: ${moneyText(allocated, amountsHidden)}`)}>
                  موزّع على الفئات: <Money value={allocated} currency={false} />
                </Text>
                <Text style={[styles.totalSub, { color: remaining < 0 ? colors.dangerText : colors.incomeText }]}>
                  {remaining < 0 ? `الفئات زوّدت عن الإجمالي بـ ${money(Math.abs(remaining))} ج.م` : `متبقي للتوزيع: ${money(remaining)} ج.م`}
                </Text>
              </View>
              {spendLoading ? <SpendLoading testID="budget_total_loading" shape="line" style={styles.totalSub} /> : (
                <>
                  {/* دراسة الشكل خطوة 4: رقم بطل واحد للشاشة — اتصرف كام من الإجمالي */}
                  <View style={styles.heroWithRing} accessible
                    accessibilityLabel={speakable(`اتصرف ${moneyText(totalMonthSpend, amountsHidden)} من ${moneyText(totalBudget, amountsHidden)}`)}>
                    {/* دايرة التقدّم: نفس الأرقام والدرجة (`totalLevel` ← `budgetLevelColor`) اللي الرقم البطل جنبها، زينة بس */}
                    <ProgressRing testID="budget_ring" spent={totalMonthSpend} total={totalBudget} color={budgetLevelColor(totalLevel, colors, colors.accentText)} trackColor={colors.borderStrong} />
                    <View testID="budget_hero" style={styles.heroRow}>
                      <Money value={totalMonthSpend} currency={false} fit style={[styles.hero, totalLevel !== 'under' && { color: budgetLevelColor(totalLevel, colors, colors.text) }]} />
                      <Text style={styles.heroOf}>اتصرف من <Money value={totalBudget} /></Text>
                    </View>
                  </View>
                  {/* الدرجة بالكلام مش باللون بس — نفس نص كارت الشهر في الرئيسية */}
                  {totalLevel !== 'under' && (
                    <Text testID="budget_total_level" style={[styles.totalSub, { color: budgetLevelColor(totalLevel, colors, colors.accentText) }]}>
                      {totalLevel === 'at' ? 'الميزانية خلصت'
                        : totalLevel === 'near' ? `فاضل ${money(snapPiastre(totalBudget - totalMonthSpend))} ج.م — قربت تخلص`
                          : `عدّيت الميزانية بـ ${money(Math.abs(snapPiastre(totalBudget - totalMonthSpend)))} ج.م`}
                    </Text>
                  )}
                  {forecast('total', monthRowsToDate, totalBudget, totalMonthSpend)}
                </>
              )}
            </>
          )}
        </View>

        <Text style={styles.sectionTitle} accessibilityRole="header">توزيع الميزانية على الفئات</Text>
        {noCategories && <Text testID="budget_no_categories" style={styles.empty}>{NO_CATEGORIES_TEXT}</Text>}
        {/* الفئات من غير سقف مطوية في سطر (دراسة الشكل) — التقسيم على المتخزّن مش المسوّدة، عشان الكارت ميتنقلش وانت بتكتب */}
        {[withLimit, withoutLimit].map((group, gi) => {
          const cards = group.map(c => {
          const limit = numberFor(c.id, budgets[c.id] || 0);
          const spend = spendByCategory.get(c.id) || 0;
          const level = limit > 0 ? budgetLevel(spend, limit) : 'under';
          // at/over ← الشريط مليان (999.996 من 1000 كانت 99.9996%) — زي كارت الشهر في الرئيسية
          const pct = limit > 0 ? (level === 'at' || level === 'over' ? 100 : Math.min(100, (spend / limit) * 100)) : 0;
          // لون بس من 80% (دراسة الشكل: الأخضر على كل حاجة سليمة كان دوشة) — الشريط بتوكنز النص (≥ 4.5 على المسار)
          // الدرجة من `budgetLevel` (نص قرش) زي الإجمالي والرئيسية: 'over' خطر، 'at'/'near' دهبي — العرض (%) زي ما هو
          const color = budgetLevelColor(level, colors, colors.textSecondary);
          const textColor = color;
          const name = categoryLabel(c, { icon: false });
          // وصف واحد للحالة: «فئة أكل: صرفت 500 ج.م من 1,000 ج.م، قرّبت تخلص» (a11y-architect)
          const statusLabel = speakable(`فئة ${name}: صرفت ${moneyText(spend, amountsHidden)} من ${moneyText(limit, amountsHidden)}${level === 'under' ? '' : `، ${LEVEL_WORD[level]}`}`);

          return (
            <View key={c.id} testID={`budget_card_${c.id}`} style={styles.card}>
              <View style={styles.head}>
                <View style={[categoryInlineRow, { flex: 1, flexShrink: 1 }]}>
                  <CategoryIcon icon={c.icon} size={categoryIconSize.row} tint={categoryColors.get(c.id)} />
                  <Text numberOfLines={1} ellipsizeMode="middle" style={styles.name}>{categoryLabel(c, { icon: false })}</Text>
                </View>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="السقف"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={`سقف ${name}`}
                  accessibilityHint={AUTOSAVE_HINT}
                  editable={budgetsEditable}
                  onFocus={() => pinGroup(c.id, gi === 0 ? 0 : 1)}
                  value={valueFor(c.id, budgets[c.id] || 0)}
                  onChangeText={v => onChange(c.id, v)}
                  onBlur={() => onBlur(c.id)}
                  textAlign="right"
                />
              </View>
              {limit > 0 && spendLoading && <SpendLoading testID={`budget_loading_${c.id}`} shape="line" style={styles.sub} />}
              {limit > 0 && !spendLoading && (
                <>
                  <View testID={`budget_status_${c.id}`} accessible accessibilityLabel={statusLabel}>
                    {/* الشريط زينة — الحالة كلها في الوصف فوق */}
                    <View style={styles.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
                    </View>
                    {/* 80% و100% بالكلمة كمان — الفرق بين اللونين 1.07–1.34:1 بس (a11y-architect) */}
                    <Text style={[styles.sub, { color: textColor }]}>{level === 'under' ? '' : `${LEVEL_WORD[level]} — `}<Money value={spend} currency={false} /> من <Money value={limit} /></Text>
                  </View>
                  {forecast(c.id, monthRowsToDate.filter(t => t.categoryId === c.id), budgets[c.id] || 0, spend)}
                </>
              )}
            </View>
          );
          });
          if (noCategories) return null;
          return gi === 0 ? cards : (
            // مفتوح من الأول لو مفيش ولا فئة ليها سقف (مستخدم جديد) — غير كده الشاشة كلها سطر مقفول
            <FoldedSection key="nolimit" testID="budget_no_limit" title="فئات من غير سقف" count={group.length} defaultOpen={withLimit.length === 0}
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
    totalCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.xxxl, ...cardElevation(c) },
    totalLabel: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    totalRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: space.md },
    totalSub: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    heroWithRing: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xxl, marginTop: space.lg },
    heroRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: space.sm, flexShrink: 1 },
    hero: { color: c.text, fontSize: typeScale.hero, fontWeight: '700', textAlign: 'right' },
    heroOf: { color: c.textSecondary, fontSize: typeScale.body },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginBottom: space.md },
    card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.md, ...cardElevation(c) },
    head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    name: { color: c.text, fontSize: typeScale.body, fontWeight: '500', flexShrink: 1 },
    // عرض أدنى مش ثابت (a11y-architect): الخط الكبير كان بيقص الرقم في 110
    input: { minWidth: 110, maxWidth: '50%', flexShrink: 1, minHeight: MIN_TOUCH, backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.sm, color: c.text, paddingHorizontal: space.md, fontSize: typeScale.body },
    // المسار نفسه باين (surface2 على الكارت كان 1.1:1 — الشريط كان بيبان شرطة سايبة)
    track: { height: 4, backgroundColor: c.borderStrong, borderRadius: radius.track, marginTop: space.lg, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.track },
    sub: { fontSize: typeScale.caption, marginTop: space.xs, textAlign: 'right' },
    loadError: { color: c.dangerText, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.lg, lineHeight: 18 },
    empty: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', marginTop: space.sm, lineHeight: 22 },
    forecast: { color: c.textSecondary, fontSize: typeScale.caption, marginTop: space.xs, textAlign: 'right' },
  });
}