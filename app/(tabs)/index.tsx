import { Money } from '@/components/Money';
import AttentionSheet from '@/components/AttentionSheet';
import { buildAttentionItems } from '@/lib/homeAttention';
import { VERIFY_SPAM_HINT, useEmailVerification } from '@/lib/useEmailVerification';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { IncomeAutoNotices } from '@/components/IncomeHomeCards';
import { ChargeAutoNotices } from '@/components/ChargeHomeCards';
import PendingSummary from '@/components/PendingSheet';
import PendingSyncMark from '@/components/PendingSyncMark';
import AutoRecordedMark from '@/components/AutoRecordedMark';
import TransferMark from '@/components/TransferMark';
import { LineIcon } from '@/components/LineIcon';
import { useData } from '@/context/DataContext';
import { transferTransactionIds } from '@/lib/spending';
import { monthSummary } from '@/lib/monthSummary';
import { requestReports } from '@/lib/reportsRequest';
import MonthSummaryCard, { type MonthCardState } from '@/components/MonthSummaryCard';
import { AmountsMaskScope, AmountsUnmaskedScope, usePrivacy } from '@/context/PrivacyContext';
import { useDailyReminderHour } from '@/context/NotificationsContext';
import DismissButton from '@/components/DismissButton';
import { DISMISSED_ANNOUNCEMENT, DISMISS_HINT, dismissLabel } from '@/lib/bannerDismiss';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { useCurrentHour } from '@/lib/useCurrentHour';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import { transactionsPhrase } from '@/lib/archiving';
import { TYPE_LABELS, transactionAmountColor, categoryLabelById, currentMonth, entryTime, formatTime, todayStr, transactionWalletLabel, walletBalance } from '@/lib/finance';
import { plainAmount } from '@/lib/money';
import { COLD_KIND_LABEL, coldFiguresText } from '@/lib/coldCache';
import { dayText } from '@/lib/dateText';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, useRef } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useNoWallets } from '@/lib/useNoWallets';
import { STALE_FIGURES_TEXT, useStaleFigures } from '@/lib/staleFigures';
import { BROKEN_TX_ACTION, BROKEN_WALLET_ACTION, brokenArchivedWalletBannerText, brokenTransactionsBannerText, brokenWalletBannerText } from '@/lib/brokenDocs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TOTAL_BUDGET_KEY = 'total_budget';

/**
 * العين بتخبّي المبالغ **في الرئيسية بس** (قرار 2026-09-27): النطاق ملفوف برّه
 * `HomeScreen` عشان `usePrivacy()` اللي في أولها يشوفه هي كمان. كل اللي جوّه
 * (كروت الدخل الثابت، البانرات) بيتخبّى؛ أي شاشة تانية بتعرض أرقامها.
 */
export default function HomeTab() {
  return (
    <AmountsMaskScope>
      <HomeScreen />
    </AmountsMaskScope>
  );
}

function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, transactions, budgets, subscriptions, gamiyas, debts, pendingTxIds, serverReachable, figuresFromServer, coldSnapshot, deletionPending, transfersStatus, brokenTransactions, loadErrors, figuresPending } = useData();
  const { walletColors } = useChartColors();
  const { amountsHidden, toggleAmounts, money } = usePrivacy();
  const { hidden, dismiss, clear } = useBannerDismiss();
  const dailyHour = useDailyReminderHour();
  const nowHour = useCurrentHour();

  // المؤرشفة بتختفي من الرئيسية بالكامل: الشرايح والإجمالي والتنبيهات.
  // شرط الأرشفة إن رصيدها صفر، فشيلها من الإجمالي مبيغيّرش رقم — والتنبيه
  // على محفظة المستخدم أرشفها خلاص هو بالظبط الإزعاج اللي أرشفها عشانه.
  const activeWallets = useMemo(() => wallets.filter(w => !w.archived), [wallets]);
  const activeCategories = useMemo(() => categories.filter(c => !c.archived), [categories]);

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    activeWallets.forEach(w => map.set(w.id, walletBalance(transactions, w.id, w.openingBalance)));
    return map;
  }, [activeWallets, transactions]);

  const totalBalance = useMemo(
    () => activeWallets.reduce((s, w) => s + (balances.get(w.id) || 0), 0),
    [activeWallets, balances]
  );

  // فايربيز في الموبايل بتشتغل بكاش في الذاكرة بس، فلو فتحت التطبيق من غير نت
  // مش هتلاقي ولا محفظة ولا عملية — والشاشة الفاضية دي بتترجم عند المستخدم
  // "التطبيق ضيّع فلوسي". لازم نقول السبب بصراحة.
  // بس مش في أول ثانيتين: ساعتها إحنا لسه بنحمّل، والبيانات في الغالب جاية —
  // ومن غير المهلة دي البانر بيلمع غلط في كل مرة التطبيق يفتح
  const [loadWindowPassed, setLoadWindowPassed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoadWindowPassed(true), 2500);
    return () => clearTimeout(t);
  }, []);
  const offlineEmpty = loadWindowPassed && !serverReachable && wallets.length === 0;
  // النت قطع والأرقام على الشاشة: بعد المهلة بس، ولحد ما الأرقام نفسها تتحدّث
  // (lib/staleFigures.ts). من غير أرقام ده "مفيش نت" اللي فوق، مش ده
  const staleFigures = useStaleFigures(figuresFromServer, wallets.length > 0);
  /**
   * كاش أول فتحة باردة (`lib/coldCache.ts`): آخر أرقام اتشافت، **للعرض بس** — طول ما مفيش ولا محفظة من
   * الـlisteners. الرصيد والشرايح وآخر العمليات بيتعرضوا منه، بعلامة "قديم" مبتتقفلش، والصفوف مبتفتحش
   * المودال (العملية مش موجودة في البيانات اللي التعديل بيقرا منها). أول snapshot حقيقي بيخفيه لوحده.
   */
  const cold = coldSnapshot;
  const shownTotal = cold ? cold.wallets.reduce((s, w) => s + w.balance, 0) : totalBalance;
  /**
   * حساب مسح (أو أرشف) كل محافظه: مفيش شاشة تجهيز تاني (عدّاها قبل كده)، ومن غير
   * محفظة مفيش ولا عملية تتسجل — فبنقول كده وبنودّيه يضيف واحدة. بس لما نكون
   * متأكدين من السيرفر: من غير نت ده بانر "مفيش نت" اللي فوق، ولو listener المحافظ
   * اترفض ده بانر "مقدرناش نجيب بياناتك" — مش "مفيش محافظ".
   */
  // تحذيرات الأرقام: الحالة خلصت ← القفل بيتشال، فانقطاع جديد بيظهر (silent-failure-hunter).
  // بس لما الحالة **كانت موجودة في الجلسة دي وخلصت** — الحالتين بيبدأوا false في كل فتحة،
  // والمسح ساعتها كان بيشيل ✕ الجلسة اللي فاتت (الجولة التانية)
  const wasOffline = useRef(false);
  const wasStale = useRef(false);
  useEffect(() => {
    if (offlineEmpty) wasOffline.current = true;
    else if (wasOffline.current) { wasOffline.current = false; clear('offline'); }
  }, [offlineEmpty, clear]);
  useEffect(() => {
    if (staleFigures) wasStale.current = true;
    else if (wasStale.current) { wasStale.current = false; clear('stale'); }
  }, [staleFigures, clear]);
  const noWalletsState = useNoWallets();
  const noWallets = loadWindowPassed && noWalletsState.none;
  const onlyArchived = loadWindowPassed && noWalletsState.onlyArchived;
  // الحالة بتظهر بعد 2.5 ثانية — قارئ الشاشة يكون عدّى المكان ده خلاص (a11y-architect)
  useEffect(() => {
    if (noWallets) AccessibilityInfo.announceForAccessibility('مفيش ولا محفظة. ضيف محفظة عشان تقدر تسجل مصاريفك ودخلك.');
  }, [noWallets]);
  // الكاش اختفى والأرقام الحقيقية وصلت ← بنقول كده (التبديل بيحصل في رسمة واحدة والفوكس ممكن يقع —
  // a11y-architect). مش في أول فتحة: بس لما الكاش **كان** معروض في الجلسة دي. **وبس لما الأرقام من السيرفر**
  // (silent-failure-hunter جولة 2): الكاش بيختفي كمان لما محفظة تيجي من كاش الذاكرة، و"اتحدّثت" ساعتها كدب.
  // ولو طلع مفيش ولا محفظة، إعلان "مفيش ولا محفظة" اللي فوق هو اللي بيتقال
  // بانر الكاش بيظهر بعد مهلة التحميل — قارئ الشاشة مبيقراش live region وقت ما العنصر يظهر، فبنقوله مرة (silent-failure-hunter)
  const coldShown = !!cold && loadWindowPassed;
  const coldSavedAt = cold?.savedAt;
  useEffect(() => {
    if (coldShown && coldSavedAt !== undefined) AccessibilityInfo.announceForAccessibility(coldFiguresText(coldSavedAt, formatTime));
  }, [coldShown, coldSavedAt]);
  const wasCold = useRef(false);
  useEffect(() => {
    if (cold) { wasCold.current = true; return; }
    if (wasCold.current && figuresFromServer) {
      wasCold.current = false;
      if (wallets.length > 0) AccessibilityInfo.announceForAccessibility('الأرقام اتحدّثت');
    }
  }, [cold, figuresFromServer, wallets.length]);

  const nowMonth = currentMonth();
  const hasTodayTx = transactions.some(t => t.date === todayStr());
  // السلفة والجمعية مش مصروف (خطوة 8) — لا في الفئة ولا في الإجمالي
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);
  // بند 11: وهي بتحمّل السلفة بتتعدّ مصروف — بانر "قربت تخلص" مبيولّعش عليها. لو الديون فشلت، بانر "مقدرناش نجيب بياناتك" ظاهر
  const spendKnown = transfersStatus !== 'loading';

  const totalBudgetLimit = budgets[TOTAL_BUDGET_KEY] || 0;
  // من غير السلفة وقسط الجمعية (خطوة 8). **نفس الدالة** اللي الرقم البطل في التقارير بيعدّي منها (`spendInRange` جوه
  // `monthSummary`) — الكارت والبانر والتقارير رقم واحد
  const today = todayStr();
  const summary = useMemo(
    () => monthSummary({ transactions, transfers, today, totalBudget: totalBudgetLimit }),
    [transactions, transfers, today, totalBudgetLimit],
  );
  /**
   * كارت «صرفت الشهر ده». **مخفي** (بيكسب على أي حاجة تانية) لما الأرقام اللي فوق نفسها مش بتتعرض أو مش متأكدين منها:
   * كاش بارد، مفيش نت وفاضي، مفيش محفظة. بعد كده: الخطأ ← مفيش رقم؛ لسه بنحمّل ← «بنحمّل…» (نفس شرط التقارير:
   * `transfersStatus === 'loading'`)؛ غير كده الرقم — ولو الديون فشلت معاه سطر التقارير.
   * **العمليات لسه ما وصلتش** (`figuresPending` فيها 'transactions') ← «بنحمّل…» برضه، **بس لحد مهلة التحميل**
   * (`loadWindowPassed`، نفس اللي بتحكم «مفيش نت»): `figuresPending` بيتشال بس لما listener العمليات يرمي snapshot،
   * ومجموعة فاضية ممكن متبعتش (DataContext ~785-790، CLAUDE.md «مشاكل معروفة») — من غير المهلة حساب جديد كان هيفضل
   * «بنحمّل» للأبد. من غيره «0 ج.م» / «فاضل 8,000» كانت ادّعاء مظبوط الشكل إن مفيش مصروف. المهلة بعد كده: الرقم زي ما هو.
   */
  const monthCardHidden = !!cold || offlineEmpty || noWalletsState.none || wallets.length === 0;
  const monthCardState: MonthCardState = loadErrors.includes('transactions') ? { kind: 'error' }
    : transfersStatus === 'loading' || (!loadWindowPassed && !!figuresPending?.includes('transactions')) ? { kind: 'loading' }
    : { kind: 'ready', summary, transfersFailed: transfersStatus === 'failed', budgetsFailed: loadErrors.includes('budgets') };

  // «حاجات محتاجة انتباهك» (2026-11-13): الإيميل، لسه ما سجلتش، رصيد قرب يخلص، ميزانية فئة، اشتراك وقسط جمعية جايين —
  // الشروط نفسها بتتحسب في `lib/homeAttention.ts` والسطر والشيت في `components/AttentionSheet.tsx`
  const emailVerification = useEmailVerification();
  const attentionItems = buildAttentionItems({
    activeWallets, balances, activeCategories, transactions, budgets, transfers, spendKnown, nowMonth,
    subscriptions, gamiyas, hasTodayTx, offlineEmpty, noWallets, cold: !!cold, dailyHour, nowHour,
    unverifiedEmail: emailVerification.unverifiedEmail, money,
  });

  const recent = [...transactions]
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    })
    .slice(0, 10);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* الهيدر الثابت = الرصيد بس (2026-09-29) */}
      <View style={styles.fixedTop}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeadRow}>
            <TouchableOpacity
              onPress={toggleAmounts}
              style={styles.eyeBtn}
              hitSlop={13}
              testID="home_hide_amounts_toggle"
              accessibilityRole="switch"
              accessibilityLabel="إخفاء الأرصدة والمبالغ"
              accessibilityHint="في الرئيسية بس — مبالغ آخر العمليات بتفضل ظاهرة"
              accessibilityState={{ checked: amountsHidden }}>
              <LineIcon name={amountsHidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            {/* كاش: "قديم" جنب الإجمالي نفسه — الرصيد فوق برّه التمرير، والبانر تحت ممكن يتمرر أو قارئ الشاشة يقرا
                الرقم قبله (a11y-architect) */}
            <Text style={styles.balanceLabel}>{cold ? 'إجمالي رصيدك (قديم)' : 'إجمالي رصيدك'}</Text>
          </View>
          {/* صف مش Text جوه Text: أندرويد بيفرد الـText المتداخل في عقدة واحدة
              وبيضيّع accessibilityLabel بتاع Money، فالمخفي كان بيتقري نقط */}
          <View style={styles.balanceValueRow}>
            <Money value={shownTotal} currency={false} fit style={styles.balanceValue} />
            <Text style={styles.currency}>ج.م</Text>
          </View>
          <View style={styles.walletsRow}>
            {cold
              ? cold.wallets.map(w => (
                <View key={w.id} testID={`home_cold_wallet_${w.id}`} style={styles.walletChip}>
                  {/* حلقة فاضية مش لون: "مش حية" مش "ملقيناش لون" (visual-identity-reviewer) */}
                  <View style={[styles.dot, { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.textSecondary }]} />
                  <Text style={styles.walletChipName}>{w.name}</Text>
                  <Money value={w.balance} currency={false} style={styles.walletChipVal} />
                </View>
              ))
              : activeWallets.map(w => (
              <View key={w.id} style={styles.walletChip}>
                <View style={[styles.dot, { backgroundColor: walletColors.get(w.id) }]} />
                <Text style={styles.walletChipName}>{w.name}</Text>
                <Money value={balances.get(w.id) || 0} currency={false} style={styles.walletChipVal} />
              </View>
            ))}
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {/* كارت الشهر: أول حاجة في التمرير تحت الرصيد الثابت. testID مش `home_banner_` (البانرات كلها ليها ✕ — homeBannerOrder). دوسة ← التقارير
            على «الشهر ده» من غير فلتر فئات: طلب لمرة واحدة (`lib/reportsRequest.ts`) + فتح التاب من غير باراميترز */}
        {!monthCardHidden && (
          <MonthSummaryCard
            testID="home_month_card"
            state={monthCardState}
            onPress={() => { requestReports({ preset: 'thisMonth', clearFilter: true }); router.push('/(tabs)/reports'); }}
          />
        )}
        {/* الترتيب (قرار مؤمن 2026-11-13، بيعدّل 2026-10-28): الرصيد ثابت فوق، وبعده كارت الشهر، وبعده نوعين بس بيبانوا
            كبانرات لوحدهم: (1) "الأرقام ممكن تكون غلط" بالترتيب (مسح الحساب ما خلصش، كاش قديم، مفيش نت، "الأرقام ممكن تكون
            قديمة"، عمليات/محافظ بايظة، "مفيش ولا محفظة"، "ما سجلناش") — بالـ✕ اللي كان لكل واحد (أو من غيره)، و"مقدرناش
            نجيب بياناتك" فوق الـStack كله؛ (2) سطر "مستنيين ردك". وبعدهم **سطر واحد** "عندك N حاجات محتاجة انتباهك" بيفتح شيت
            (`AttentionSheet`): الإيميل، لسه ما سجلتش، رصيد قرب يخلص، ميزانية فئة، اشتراك وقسط جمعية جايين — كل واحد بـ✕ بنفس مفتاحه
            القديم. بانر الميزانية الإجمالية اتشال (كارت الشهر بيقول قربت/خلصت/عدّت). وبعد كده آخر العمليات.
            متثبّت في homeBannerOrder.test.tsx و homeAttentionScreen.test.tsx */}
        {/* مسح الحساب بدأ ومخلصش ← بانر خطر **من غير ✕** (بحث rnd-researcher + قرار مؤمن 2026-11-03): حساب نص-ممسوح والتسجيل
            التلقائي واقف — لو اتقفل بـ✕ المستخدم كان هيعيش ببيانات ناقصة من غير ما يعرف. المخرج الوحيد: يكمّل المسح (أو يخرج) */}
        {deletionPending && (
          <View testID="home_banner_delete_pending" style={[styles.banner, styles.bannerDanger]}
            accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, { color: colors.dangerText }]}>
              مسح حسابك ما خلصش — جزء من بياناتك ممكن يكون اتمسح، والتسجيل التلقائي واقف. كمّل المسح، أو اخرج من الحساب.
            </Text>
            <TouchableOpacity testID="home_delete_pending_go" onPress={() => router.push('/settings-screens/delete-account')}
              accessibilityRole="button" accessibilityHint="بيفتح شاشة مسح الحساب" style={styles.bannerAction}>
              <Text style={[styles.bannerActionText, { color: colors.dangerText }]}>كمّل المسح</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* الأرقام اللي فوق قديمة ← بانر خطر **من غير ✕**: عمرها ما تتعرض من غير ما يبان (قرار مؤمن) */}
        {/* بعد مهلة التحميل بس، زي «مفيش نت» (offlineEmpty): الكاش بيتعرض في أول ثانية من كل فتح والنت شغال، والجملة
            «مفيش نت دلوقتي» كانت بتلمع أحمر غلط (اتشاف على الشاومي 2026-11-07). «(قديم)» جنب الإجمالي بيبان من الأول */}
        {cold && loadWindowPassed && (
          <View testID="home_banner_cold" style={[styles.banner, styles.bannerDanger, { minHeight: MIN_TOUCH }]}
            accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, { color: colors.dangerText }]}>{coldFiguresText(cold.savedAt, formatTime)}</Text>
          </View>
        )}
        {offlineEmpty && !cold && !hidden('offline') && (
          <View testID="home_banner_offline" style={[styles.banner, styles.bannerRow, styles.bannerWarn]}>
            <Text style={[styles.bannerText, styles.bannerFlex, { color: colors.accentText }]}>
              مفيش نت دلوقتي — بياناتك مش ضايعة، إحنا بس لسه ما وصلناش لها. أول ما النت يرجع هتظهر لوحدها.
            </Text>
            <DismissButton testID="home_banner_dismiss_offline" onPress={() => dismiss('offline')} hint={DISMISS_HINT} label={dismissLabel('offline')} announce={DISMISSED_ANNOUNCEMENT} />
          </View>
        )}
        {staleFigures && !hidden('stale') && (
          <View testID="home_banner_stale" style={[styles.banner, styles.bannerRow, styles.bannerDanger]}
            accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, styles.bannerFlex, { color: colors.dangerText }]}>{STALE_FIGURES_TEXT}</Text>
            <DismissButton testID="home_banner_dismiss_stale" onPress={() => dismiss('stale')} hint={DISMISS_HINT} label={dismissLabel('stale')} announce={DISMISSED_ANNOUNCEMENT} />
          </View>
        )}
        {/* بند B (قرار مؤمن 2026-11-06): عملية مستندها بايظ برّه كل حسبة ← الرصيد اللي فوق ناقصها، فلازم يبان. من غير ✕ */}
        {brokenTransactions.length > 0 && (
          <View testID="home_banner_broken_tx" style={[styles.banner, styles.bannerDanger]}
            accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, { color: colors.dangerText }]}>{brokenTransactionsBannerText(brokenTransactions.length)}</Text>
            <TouchableOpacity testID="home_broken_tx_go" onPress={() => router.push('/archive')}
              accessibilityRole="button" accessibilityHint="بيفتح الأرشيف" style={styles.bannerAction}>
              <Text style={[styles.bannerActionText, { color: colors.dangerText }]}>{BROKEN_TX_ACTION}</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* المؤرشفة كمان (silent-failure-hunter): الرقم الغلط مبيبطلش يبقى غلط لما المحفظة تتأرشف */}
        {wallets.filter(w => w.openingInvalid).map(w => (
          <View key={w.id} testID={`home_banner_broken_wallet_${w.id}`} style={[styles.banner, styles.bannerDanger]}
            accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, { color: colors.dangerText }]}>{w.archived ? brokenArchivedWalletBannerText(w.name) : brokenWalletBannerText(w.name)}</Text>
            <TouchableOpacity testID={`home_broken_wallet_go_${w.id}`} onPress={() => router.push('/settings-screens/wallets')}
              accessibilityRole="button" accessibilityLabel={`${BROKEN_WALLET_ACTION} — ${w.name}`} style={styles.bannerAction}>
              <Text style={[styles.bannerActionText, { color: colors.dangerText }]}>{BROKEN_WALLET_ACTION}</Text>
            </TouchableOpacity>
          </View>
        ))}
        {noWallets && !cold && (
          <View testID="home_no_wallets" style={styles.noWallets}>
            <Text style={styles.noWalletsEmoji} accessible={false}>👛</Text>
            <Text style={styles.noWalletsTitle} accessibilityRole="header">مفيش ولا محفظة</Text>
            <Text style={styles.noWalletsBody}>
              {onlyArchived
                ? 'كل محافظك متأرشفة. ضيف محفظة جديدة، أو رجّع واحدة من الإعدادات، عشان تقدر تسجل مصاريفك ودخلك.'
                : 'ضيف محفظة (كاش، حساب بنكي…) عشان تقدر تسجل مصاريفك ودخلك.'}
            </Text>
            <TouchableOpacity testID="home_add_wallet" style={styles.noWalletsBtn}
              onPress={() => router.push('/settings-screens/wallets')} accessibilityRole="button">
              <Text style={styles.noWalletsBtnText}>ضيف محفظة</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* رسايل التسجيل التلقائي في الرئيسية نفسها ("ما سجلناش" لازم تبان)، والكروت
            المستنية رد في شيت بيفتحه سطر واحد (2026-09-29) */}
        <IncomeAutoNotices />
        <ChargeAutoNotices />
        <PendingSummary />
        {/* باقي التنبيهات الروتينية (قرار مؤمن 2026-11-13، بدل 2026-10-28): سطر واحد بيفتح شيت — الإيميل، لسه ما سجلتش، رصيد قرب
            يخلص، ميزانية فئة، اشتراك وقسط جمعية جايين (`AttentionSheet`). فوق آخر العمليات زي ما كانوا */}
        <AttentionSheet items={attentionItems} email={emailVerification} loadWindowPassed={loadWindowPassed}
          transfersFailed={transfersStatus === 'failed'} />
        <Text testID="home_recent_title" style={styles.sectionTitle}>آخر العمليات</Text>
        {recent.length === 0 && !(cold && cold.recent.length > 0) && (
          <Text style={styles.emptyState}>
            {offlineEmpty ? 'مستنيين النت عشان نجيب عملياتك' : 'لسه معملتش أي عملية'}
          </Text>
        )}
        {/* دراسة الشكل خطوة 2: القايمة كارت واحد من غير خطوط بين الصفوف — المسافة هي اللي بتفصل */}
        <View testID="home_recent_card" style={styles.txCard}>
        {/* صفوف الكاش: View مش زرار (مفيش عملية حقيقية يتفتح عليها المودال)، ومن غير نوت ولا اسم */}
        {cold && recent.length === 0 && cold.recent.map(t => {
          const T = TYPE_LABELS[t.type];
          const catLabel = categoryLabelById(cold.categories, t.categoryId);
          const title = t.kind ? COLD_KIND_LABEL[t.kind] : t.type === 'expense' ? (catLabel || 'مصروف') : T.label;
          const name = (id?: string) => cold.wallets.find(w => w.id === id)?.name ?? '';
          // نفس شكل transactionWalletLabel ("من … إلى …")، بس من محافظ الكاش؛ محفظة مش فيه (مؤرشفة) ← من غير اسم
          const walletLabel = t.type === 'withdraw' && name(t.walletId) && name(t.toWalletId) ? `من ${name(t.walletId)} إلى ${name(t.toWalletId)}` : name(t.walletId);
          return (
            // عقدة واحدة لقارئ الشاشة زي الصف الحقيقي، وأولها "قديم"، ومن غير button (مبيتفتحش — a11y-architect).
            // المبلغ ظاهر زي الصف الحقيقي (العين للأرصدة بس)
            <View key={t.id} testID={`home_cold_tx_${t.id}`} style={styles.txRow} accessible
              accessibilityLabel={`قديم: ${title}${walletLabel ? '، ' + walletLabel : ''}، ${plainAmount(t.amount)} جنيه، ${dayText(t.date, todayStr())}`}>
              <View style={styles.txMid}>
                <Text style={styles.txTitle}>{title}</Text>
                {!!walletLabel && <Text style={styles.txSub}>{walletLabel}</Text>}
              </View>
              <View style={styles.txRight}>
                <AmountsUnmaskedScope>
                  <Money value={t.amount} sign={T.sign} currency={false} style={[styles.txAmount, { color: transactionAmountColor(t.type, colors) }]} />
                </AmountsUnmaskedScope>
                <Text style={styles.txDate}>{[dayText(t.date, todayStr()), entryTime(t.date, t.createdAt)].filter(Boolean).join(' · ')}</Text>
              </View>
            </View>
          );
        })}
        {recent.map(t => {
          const T = TYPE_LABELS[t.type];
          // الفئة الممسوحة بتطلع باسمها الصريح، مش بتترجع لـ"مصروف" العامة —
          // "مصروف" بتقول إن العملية مالهاش فئة، والحقيقة إن فئتها اتمسحت
          const catLabel = categoryLabelById(categories, t.categoryId);
          const walletLabel = transactionWalletLabel(t, wallets);
          return (
            <TouchableOpacity accessibilityRole="button"
              key={t.id}
              testID={`home_tx_${t.id}`}
              style={styles.txRow}
              onPress={() => router.push({ pathname: '/modal', params: { id: t.id } })}>
              <View style={styles.txMid}>
                <Text style={styles.txTitle}>{t.type === 'expense' ? (catLabel || 'مصروف') : T.label}</Text>
                <Text style={styles.txSub}>{walletLabel}{t.note ? ' · ' + t.note : ''}</Text>
              </View>
              <View style={styles.txRight}>
                {/* العين للأرصدة بس — مبلغ العملية ظاهر زي الأرشيف (قرار مؤمن 2026-10-28) */}
                <AmountsUnmaskedScope>
                  <Money value={t.amount} sign={T.sign} currency={false} style={[styles.txAmount, { color: transactionAmountColor(t.type, colors) }]} />
                </AmountsUnmaskedScope>
                <Text style={styles.txDate}>{[dayText(t.date, todayStr()), entryTime(t.date, t.createdAt)].filter(Boolean).join(' · ')}</Text>
                {pendingTxIds.has(t.id) && <PendingSyncMark />}
                {t.autoRecorded && <AutoRecordedMark />}
                {transfers.has(t.id) && <TransferMark />}
              </View>
            </TouchableOpacity>
          );
        })}
        {transactions.length > recent.length && (
          <TouchableOpacity
            testID="home_see_all"
            style={styles.seeAll}
            onPress={() => router.push({ pathname: '/archive', params: { preset: 'all' } })}
            accessibilityRole="button"
            accessibilityLabel={`شوف كل العمليات، ${transactionsPhrase(transactions.length)}`}
            accessibilityHint="بيفتح الأرشيف بكل عملياتك">
            <Text style={styles.seeAllText}>شوف كل العمليات ({transactions.length})</Text>
            <Text style={styles.seeAllChevron} accessible={false}>‹</Text>
          </TouchableOpacity>
        )}
        </View>
      </ScrollView>
    </View>
  );
}

export { VERIFY_SPAM_HINT };

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    fixedTop: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
    scrollArea: { flex: 1 },
    // 120 مش 40: الزرار العايم (54 على bottom 90) بيغطي ~85–95 من آخر السكرول،
    // فآخر عملية مكانتش بتقدر تطلع من تحته (a11y-architect). والزرار ظاهر دايمًا
    // (2026-09-29)، فالمسافة دي هي اللي بتضمن إن أي حاجة تحته تتسكرول من تحته:
    // لو المحتوى أقصر من الشاشة، آخره بيقف فوق الزرار
    scrollContent: { paddingHorizontal: 16, paddingBottom: 120 },
    // دراسة الشكل خطوة 2 (قرار مؤمن 2026-11-06): الرصيد رقم بطل واحد، حدود أقل، والمقاسات من `typeScale` بس
    balanceCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxxl },
    balanceHeadRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
    eyeBtn: { padding: 4 },
    balanceLabel: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right' },
    // gap بدل مسافة جوه النص: المسافة القديمة كانت بحجم الرقم (30) مش العملة (14)
    balanceValueRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 8, marginTop: 4 },
    balanceValue: { color: c.text, fontSize: typeScale.hero, fontWeight: '700', textAlign: 'right' },
    currency: { fontSize: typeScale.body, color: c.textSecondary, fontWeight: '400' },
    // المحافظ من غير خلفية لكل واحدة — النقطة الملوّنة والمسافة بيفصلوا
    walletsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', columnGap: space.xxl, rowGap: space.sm, marginTop: space.xxl },
    walletChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
    walletChipName: { color: c.text, fontSize: typeScale.caption, fontWeight: '500' },
    walletChipVal: { color: c.textSecondary, fontSize: typeScale.caption },
    dot: { width: 8, height: 8, borderRadius: 4 },
    // البانر من غير إطار حواليه (دراسة الشكل): شريط على البداية بس بلون نوعه — البانرات اللي بتحط `borderColor` (خطر/تحذير)
    // بيبان عليها الشريط، والعادي من غير. قرار مؤمن 2026-10-28 (كل البانرات ظاهرة فوق، كل واحد بـ✕) زي ما هو
    banner: { backgroundColor: c.surface, borderWidth: 0, borderRightWidth: 3, borderColor: 'transparent', borderRadius: radius.lg, padding: space.lg, marginTop: space.md },
    // شريط البداية بلون واضح ≥ 3:1 (visual-identity-reviewer: `dangerBorder`/`warnBorder` كانوا 1.4–1.6 فالشريط مكانش باين)
    bannerDanger: { borderColor: c.danger },
    bannerWarn: { borderColor: c.accentText },
    // بانر فيه ✕: النص يمين والـ✕ شمال (RTL)
    bannerRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8 },
    bannerFlex: { flex: 1 },
    bannerText: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', lineHeight: 21 },
    // هدف لمس 44 (a11y-architect): "كمّل المسح" هو المخرج الوحيد من بانر من غير ✕، و"أعد إرسال التأكيد" بيستفيد كمان
    bannerAction: { alignSelf: 'flex-end', marginTop: 6, minHeight: MIN_TOUCH, justifyContent: 'center' },
    bannerActionText: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700', textDecorationLine: 'underline' },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: space.xxl, marginBottom: space.sm },
    emptyState: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', paddingVertical: space.xxxl },
    // نفس شكل البانرات الجديدة (دراسة الشكل): من غير إطار، شريط بداية دهبي (دعوة تصرف)
    noWallets: {
      backgroundColor: c.surface, borderWidth: 0, borderRightWidth: 3, borderColor: c.accentText, borderRadius: radius.lg,
      padding: 16, alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 12,
    },
    noWalletsEmoji: { fontSize: 40 },
    noWalletsTitle: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    noWalletsBody: { color: c.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
    noWalletsBtn: {
      backgroundColor: c.accent, borderRadius: 12, minHeight: MIN_TOUCH + 4, paddingHorizontal: 28,
      alignItems: 'center', justifyContent: 'center', marginTop: 6, alignSelf: 'stretch',
    },
    noWalletsBtnText: { color: c.onAccent, fontSize: 16, fontWeight: '700' },
    txCard: { backgroundColor: c.surface, borderRadius: radius.xl, paddingHorizontal: space.xxl },
    seeAll: {
      flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH,
      paddingVertical: space.lg,
    },
    seeAllText: { color: c.accentText, fontSize: typeScale.body },
    seeAllChevron: { color: c.textSecondary, fontSize: typeScale.title },
    txRow: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: space.lg, minHeight: MIN_TOUCH },
    txMid: { flex: 1 },
    txTitle: { color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right' },
    txSub: { color: c.textSecondary, fontSize: typeScale.caption, marginTop: 2, textAlign: 'right' },
    txRight: { alignItems: 'flex-start' },
    txAmount: { fontSize: typeScale.body, fontWeight: '700' },
    txDate: { color: c.textMuted, fontSize: typeScale.caption, marginTop: 2 },
  });
}