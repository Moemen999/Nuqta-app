import { useMemo, type ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { HeroAmount } from '@/components/HeroAmount';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { PIASTRE_EPS } from '@/lib/finance';
import { speakable } from '@/lib/money';
import type { MonthSummary } from '@/lib/monthSummary';
import { TRANSFERS_FAILED_NOTE } from '@/lib/spending';
import { radius, space, typeScale } from '@/lib/tokens';

export const MONTH_CARD_TITLE = 'صرفت الشهر ده';
export const MONTH_CARD_ERROR = 'مقدرناش نجيب عملياتك';
export const MONTH_CARD_HINT = 'بيفتح التقارير';
const ZERO_LAST = 'مصرفتش حاجة';

/**
 * حالة الكارت — القرار بتاع الشاشة (`index.tsx`)، والكومبوننت بيعرض بس:
 * - `loading`: الديون/الجمعية لسه ما وصلوش ← «بنحمّل…» مكان الرقم (نفس `SpendLoading` بتاع التقارير)
 * - `error`: listener العمليات اتحرم ← مفيش رقم
 * - `ready`: الرقم، ومعاه `transfersFailed` لو الديون/الجمعية فشلوا (السطر بتاع التقارير بالظبط)
 * `budgetsFailed`: الميزانية مجتش ← الرقم بس، من غير سطر ميزانية ولا مقارنة.
 */
export type MonthCardState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; summary: MonthSummary; transfersFailed: boolean; budgetsFailed: boolean };

/**
 * **مفيش كومبوننت `Money` جوه الكارت**: `Money` المخفي هو نفسه زرار «اكشف» — زرار جوه زرار. المبالغ هنا نص عادي
 * من `money()` بتاع `usePrivacy` (نفس القناع والنطاق بتوع باقي الرئيسية)، والدوسة على الكارت بتفتح التقارير حتى
 * والمبالغ مخفية.
 */
export default function MonthSummaryCard({ state, onPress, testID }: { state: MonthCardState; onPress: () => void; testID: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { money } = usePrivacy();
  const cur = (n: number) => `${money(n)} ج.م`;

  let label = '';
  let body: ReactNode = null;

  if (state.kind === 'loading') {
    label = `${MONTH_CARD_TITLE}: بنحمّل`;
    body = <SpendLoading testID="home_month_loading" style={styles.loading} />;
  } else if (state.kind === 'error') {
    label = `${MONTH_CARD_TITLE}: ${MONTH_CARD_ERROR}`;
    body = <Text testID="home_month_error" style={styles.error}>{MONTH_CARD_ERROR}</Text>;
  } else {
    const { summary, transfersFailed, budgetsFailed } = state;
    const { spent } = summary;
    const budget = budgetsFailed ? null : summary.budget;
    const previous = budgetsFailed ? null : summary.previous;
    const parts: string[] = [`${MONTH_CARD_TITLE} ${money(spent)} جنيه`];

    let budgetBlock: ReactNode = null;
    if (budget) {
      const pct = budget.level === 'at' || budget.level === 'over' ? 100 : Math.min(100, (spent / budget.limit) * 100);
      const barColor = budget.level === 'over' ? colors.dangerText : budget.level === 'under' ? colors.textSecondary : colors.accentText;
      const bar = (
        // زخرفي: الأرقام مكتوبة فوقه (نفس مسار BudgetView)
        <View style={styles.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: barColor }]} />
        </View>
      );
      if (budget.level === 'under') {
        parts.push(`من ${money(budget.limit)} جنيه`, `فاضل ${money(budget.remaining)} جنيه`);
        budgetBlock = (
          <>
            <View style={styles.splitRow}>
              <Text testID="home_month_of" style={styles.sub}>من {cur(budget.limit)}</Text>
              <Text testID="home_month_left" style={styles.sub}>فاضل {cur(budget.remaining)}</Text>
            </View>
            {bar}
          </>
        );
      } else {
        const text = budget.level === 'near' ? `فاضل ${cur(budget.remaining)} — قربت تخلص`
          : budget.level === 'at' ? 'الميزانية خلصت'
          : `عدّيت الميزانية بـ ${cur(Math.abs(budget.remaining))}`;
        parts.push(budget.level === 'near' ? `فاضل ${money(budget.remaining)} جنيه، قربت تخلص`
          : budget.level === 'at' ? 'الميزانية خلصت'
          : `عدّيت الميزانية بـ ${money(Math.abs(budget.remaining))} جنيه`);
        budgetBlock = (
          <>
            <Text testID="home_month_budget_line" style={[styles.sub, { color: budget.level === 'over' ? colors.dangerText : colors.accentText }]}>{text}</Text>
            {bar}
          </>
        );
      }
    } else if (previous) {
      const lead = previous.wholeMonth ? 'الشهر اللي فات كله' : `الشهر اللي فات لحد يوم ${Number(previous.to.slice(8))}`;
      const value = previous.total < PIASTRE_EPS ? ZERO_LAST : cur(previous.total);
      parts.push(`${lead}: ${previous.total < PIASTRE_EPS ? ZERO_LAST : `${money(previous.total)} جنيه`}`);
      budgetBlock = <Text testID="home_month_previous" style={styles.sub}>{lead}: {value}</Text>;
    }
    if (transfersFailed) parts.push(TRANSFERS_FAILED_NOTE);
    label = speakable(parts.join('، '));

    body = (
      <>
        <HeroAmount unitTestID="home_month_unit" style={styles.valueRow}>
          <Text testID="home_month_value" style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{money(spent)}</Text>
        </HeroAmount>
        {budgetBlock}
        {transfersFailed && <TransfersFailedNote testID="home_month_transfers_failed" />}
      </>
    );
  }

  return (
    <TouchableOpacity
      testID={testID}
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={MONTH_CARD_HINT}>
      <Text style={styles.title} accessible={false}>{MONTH_CARD_TITLE}</Text>
      {body}
    </TouchableOpacity>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxxl, marginTop: space.md },
    title: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right' },
    value: { color: c.text, fontSize: typeScale.hero, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
    valueRow: { marginTop: space.xxs },
    loading: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', marginTop: space.sm },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'right', marginTop: space.sm },
    sub: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', marginTop: space.xs },
    splitRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
    // نفس شريط BudgetView (4 ارتفاع، مسار borderStrong)
    track: { height: 4, backgroundColor: c.borderStrong, borderRadius: 2, marginTop: space.lg, overflow: 'hidden', flexDirection: 'row-reverse' },
    fill: { height: '100%', borderRadius: 2 },
  });
}
