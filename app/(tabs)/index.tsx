import { HeroAmount } from '@/components/HeroAmount';
import { Money } from '@/components/Money';
import AttentionSheet from '@/components/AttentionSheet';
import { buildAttentionItems } from '@/lib/homeAttention';
import { VERIFY_SPAM_HINT, useEmailVerification } from '@/lib/useEmailVerification';
import { cardElevation, MIN_TOUCH, categoryIconSize, radius, space, typeScale, heroIconGap, heroIconSize } from '@/lib/tokens';
import { IncomeAutoNotices } from '@/components/IncomeHomeCards';
import { ChargeAutoNotices } from '@/components/ChargeHomeCards';
import PendingSummary from '@/components/PendingSheet';
import PendingSyncMark from '@/components/PendingSyncMark';
import AutoRecordedMark from '@/components/AutoRecordedMark';
import TransferMark from '@/components/TransferMark';
import { LineIcon } from '@/components/LineIcon';
import { HeroIcon } from '@/components/HeroIcon';
import { useData } from '@/context/DataContext';
import { isTransferTx, transferTransactionIds } from '@/lib/spending';
import { monthSummary } from '@/lib/monthSummary';
import { requestReports } from '@/lib/reportsRequest';
import MonthSummaryCard, { type MonthCardState } from '@/components/MonthSummaryCard';
import { AmountsMaskScope, AmountsUnmaskedScope, usePrivacy } from '@/context/PrivacyContext';
import { useDailyReminderMinute } from '@/context/NotificationsContext';
import DismissButton from '@/components/DismissButton';
import { DISMISSED_ANNOUNCEMENT, DISMISS_HINT, dismissLabel } from '@/lib/bannerDismiss';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { useCurrentMinute } from '@/lib/useCurrentMinute';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import { transactionsPhrase } from '@/lib/archiving';
import { TYPE_LABELS, transactionAmountColor, categoryLabelById, currentMonth, entryTime, formatTime, shownBalance, todayStr, transactionWalletLabel, walletBalance } from '@/lib/finance';
import { HERO_LOADING_TEXT, HERO_WAITING_TEXT, figuresSettled, figuresUnsure, heroFailedText, heroFigures, heroLabel, outboxLinePhrase, recentEmptyText } from '@/lib/homeFigures';
import { useAnnounceOnAppear } from '@/lib/useAnnounceOnAppear';
import { plainAmount } from '@/lib/money';
import { txRowLabel } from '@/lib/txRowLabel';
import { COLD_KIND_LABEL, coldFiguresText } from '@/lib/coldCache';
import { dayText } from '@/lib/dateText';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, useRef } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useLockAwareAnnounce } from '@/lib/useLockAwareAnnounce';
import { Text } from '@/components/AppText';
import CountedText from '@/components/CountedText';
import { CategoryIcon, CategoryIconSpacer } from '@/components/CategoryIcon';
import { useNoWallets } from '@/lib/useNoWallets';
import { STALE_FIGURES_TEXT, useStaleFigures } from '@/lib/staleFigures';
import { BROKEN_TX_ACTION, BROKEN_WALLET_ACTION, brokenArchivedWalletBannerText, brokenTransactionsBannerText, brokenWalletBannerText } from '@/lib/brokenDocs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFabScroll } from '@/context/FabScrollContext';

const TOTAL_BUDGET_KEY = 'total_budget';
const DELETE_PENDING_TEXT = 'مسح حسابك ما خلصش — جزء من بياناتك ممكن يكون اتمسح، والتسجيل التلقائي واقف. كمّل المسح، أو اخرج من الحساب.';
const OFFLINE_TEXT = 'مفيش نت دلوقتي — بياناتك مش ضايعة، إحنا بس لسه ما وصلناش لها. أول ما النت يرجع هتظهر لوحدها.';

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
  const fabScroll = useFabScroll();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, transactions, budgets, subscriptions, gamiyas, debts, pendingTxIds, serverReachable, figuresFromServer, coldSnapshot, deletionPending, transfersStatus, brokenTransactions, loadErrors, figuresPending, outboxCount, outboxReplaying } = useData();
  const { walletColors, categoryColors } = useChartColors();
  const { amountsHidden, toggleAmounts, money } = usePrivacy();
  const { hidden, dismiss, clear } = useBannerDismiss();
  const dailyAt = useDailyReminderMinute();
  const nowAt = useCurrentMinute();

  // المؤرشفة بتختفي من الرئيسية بالكامل: الشرايح والإجمالي والتنبيهات.
  // شرط الأرشفة إن رصيدها صفر، فشيلها من الإجمالي مبيغيّرش رقم — والتنبيه
  // على محفظة المستخدم أرشفها خلاص هو بالظبط الإزعاج اللي أرشفها عشانه.
  const activeWallets = useMemo(() => wallets.filter(w => !w.archived), [wallets]);
  const activeCategories = useMemo(() => categories.filter(c => !c.archived), [categories]);

  // مقرّب للقرش (`shownBalance`، الميزة 7): الشريحة والإجمالي وحد التنبيه نفس الرقم اللي بيتعرض، ومفيش «-0»
  const balances = useMemo(() => {
    const map = new Map<string, number>();
    activeWallets.forEach(w => map.set(w.id, shownBalance(walletBalance(transactions, w.id, w.openingBalance))));
    return map;
  }, [activeWallets, transactions]);

  const totalBalance = useMemo(
    () => shownBalance(activeWallets.reduce((s, w) => s + (balances.get(w.id) || 0), 0)),
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
  // الكاش البارد معروض ← ده «قديم» مش «ممكن يكون قديم» (بانر تاني). والمحافظ أو العمليات وقعت ← السبب مش النت، والعلامة
  // «(ناقص)» وبانر «مقدرناش نجيب بياناتك» بيقولوه (M2، الجولة الأخيرة)
  const figuresListenerFailed = loadErrors.includes('wallets') || loadErrors.includes('transactions');
  const staleFigures = useStaleFigures(figuresFromServer, wallets.length > 0 && !coldSnapshot && !figuresListenerFailed);
  /**
   * كاش أول فتحة باردة (`lib/coldCache.ts`): آخر أرقام اتشافت، **للعرض بس** — طول ما مفيش ولا محفظة من
   * الـlisteners. الرصيد والشرايح وآخر العمليات بيتعرضوا منه، بعلامة "قديم" مبتتقفلش، والصفوف مبتفتحش
   * المودال (العملية مش موجودة في البيانات اللي التعديل بيقرا منها). أول snapshot حقيقي بيخفيه لوحده.
   */
  const cold = coldSnapshot;
  /**
   * الرقم البطل (الميزة 7 — HIGH): العمليات لسه بتوصل ← «بنحمّل…» مكان الرقم (الكاش بيفضل لحد ما توصل — DataContext)؛
   * المحافظ أو العمليات وقعت ← «(ناقص)» + «مقدرناش نجيب …» مكان الرقم والشرايح. علامة جنب الإجمالي **متتقفلش**
   * (`lib/homeFigures.ts`)؛ بانر «مقدرناش نجيب بياناتك» فوق بـ✕ زي ما هو
   */
  // «مستنيين النت» بعد مهلة التحميل بس (زي «مفيش نت»): قبلها إحنا لسه بنحمّل (H1-A، الجولة الأخيرة)
  const hero = heroFigures({ cold: !!cold, loadErrors, figuresPending, waitingNet: loadWindowPassed && !serverReachable });
  // الكاش بيتعرض (الإجمالي والشرايح والبانر والصفوف) بس لما هو الحالة — listener المحافظ أو العمليات واقع ← «(ناقص)» من
  // غير أرقام قديمة ولا «مفيش نت» (M1، الجولة الأخيرة). الإجمالي = مجموع الشرايح المقرّبة، نفس قاعدة الأرقام الحية (LOW)
  const coldShownFigures = hero.kind === 'cold' ? cold : null;
  const shownTotal = coldShownFigures
    ? shownBalance(coldShownFigures.wallets.reduce((s, w) => s + shownBalance(w.balance), 0))
    : totalBalance;
  const unsure = figuresUnsure(loadErrors, figuresPending);
  const txFailed = loadErrors.includes('transactions');
  const txPending = !!figuresPending?.includes('transactions');
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
  // الحالة بتظهر بعد 2.5 ثانية — قارئ الشاشة يكون عدّى المكان ده خلاص (a11y-architect). والتطبيق مقفول الإعلانات
  // بتستنى الفتح (security M1 — الشجرة متركّبة تحت القفل)
  const announce = useLockAwareAnnounce();
  useEffect(() => {
    if (noWallets) announce('مفيش ولا محفظة. ضيف محفظة عشان تقدر تسجل مصاريفك ودخلك.');
  }, [noWallets, announce]);
  // الكاش اختفى والأرقام الحقيقية وصلت ← بنقول كده (التبديل بيحصل في رسمة واحدة والفوكس ممكن يقع —
  // a11y-architect). مش في أول فتحة: بس لما الكاش **كان** معروض في الجلسة دي. **وبس لما الأرقام من السيرفر**
  // (silent-failure-hunter جولة 2): الكاش بيختفي كمان لما محفظة تيجي من كاش الذاكرة، و"اتحدّثت" ساعتها كدب.
  // ولو طلع مفيش ولا محفظة، إعلان "مفيش ولا محفظة" اللي فوق هو اللي بيتقال
  // بانر الكاش بيظهر بعد مهلة التحميل — قارئ الشاشة مبيقراش live region وقت ما العنصر يظهر، فبنقوله مرة (silent-failure-hunter)
  // نمط واحد (`useAnnounceOnAppear`): iOS بيتقال، أندرويد على liveRegion البانر — كان بيتقال مرتين على أندرويد (الميزة 7)
  const coldShown = !!coldShownFigures && loadWindowPassed;
  useAnnounceOnAppear(coldShown && coldShownFigures ? coldFiguresText(coldShownFigures.savedAt, formatTime) : null);
  // «اتحدّثت» بس لما الاتنين وصلوا من السيرفر ومفيش منهم واقع (الميزة 7): المحافظ لوحدها مع عمليات لسه جاية كانت بتتقال
  // «اتحدّثت» والرقم رصيد افتتاحي
  const settled = figuresSettled({ figuresFromServer, loadErrors, figuresPending });
  const wasCold = useRef(false);
  useEffect(() => {
    if (cold) { wasCold.current = true; return; }
    if (wasCold.current && settled) {
      wasCold.current = false;
      if (wallets.length > 0) announce('الأرقام اتحدّثت');
    }
  }, [cold, settled, wallets.length, announce]);

  // البانرات اللي بتظهر متأخر — نفس النمط (a11y-architect، الميزة 7)
  // M4 (الجولة الأخيرة): بيبان طول ما فيه مدخلات والإعادة مش شغالة — مش من غير نت بس (الإعادة ممكن تقف والنت شغال)
  const outboxText = loadWindowPassed && !outboxReplaying ? outboxLinePhrase(outboxCount ?? 0, { online: serverReachable }) : '';
  const brokenWallets = wallets.filter(w => w.openingInvalid);
  const brokenWalletText = brokenWallets.map(w => (w.archived ? brokenArchivedWalletBannerText(w.name) : brokenWalletBannerText(w.name))).join(' ');

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
   * **العمليات لسه ما وصلتش** (`figuresPending` فيها 'transactions') ← «بنحمّل…» برضه، **من غير مهلة** (M3، الجولة
   * الأخيرة): نفس إشارة الرقم البطل بالظبط — 'transactions' بيتشال بس على snapshot من السيرفر (`pendingFigureSources`)،
   * والمجموعة الفاضية بترمي snapshot من السيرفر (`figuresFromServer.emulator.test.tsx`)، فحساب جديد مبيفضلش «بنحمّل».
   * من غير نت (الرقم البطل «مستنيين النت») الكارت مستخبي. من غيره «0 ج.م» / «فاضل 8,000» كانت ادّعاء إن مفيش مصروف.
   */
  const monthCardHidden = !!cold || offlineEmpty || noWalletsState.none || wallets.length === 0 || hero.kind === 'waiting';
  const monthCardState: MonthCardState = loadErrors.includes('transactions') ? { kind: 'error' }
    : transfersStatus === 'loading' || !!figuresPending?.includes('transactions') ? { kind: 'loading' }
    : { kind: 'ready', summary, transfersFailed: transfersStatus === 'failed', budgetsFailed: loadErrors.includes('budgets') };

  // «حاجات محتاجة انتباهك» (2026-11-13): الإيميل، لسه ما سجلتش، رصيد قرب يخلص، ميزانية فئة، اشتراك وقسط جمعية جايين —
  // الشروط نفسها بتتحسب في `lib/homeAttention.ts` والسطر والشيت في `components/AttentionSheet.tsx`
  const emailVerification = useEmailVerification();
  const attentionItems = buildAttentionItems({
    activeWallets, balances, activeCategories, transactions, budgets, transfers, spendKnown, nowMonth,
    subscriptions, gamiyas, hasTodayTx, offlineEmpty, noWallets, cold: !!cold, dailyAt, nowAt,
    unverifiedEmail: emailVerification.unverifiedEmail, money, figuresUnsure: unsure,
  });
  useAnnounceOnAppear(deletionPending ? DELETE_PENDING_TEXT : null);
  useAnnounceOnAppear(offlineEmpty && !cold && !hidden('offline') ? OFFLINE_TEXT : null);
  useAnnounceOnAppear(staleFigures && !hidden('stale') ? STALE_FIGURES_TEXT : null);
  useAnnounceOnAppear(brokenTransactions.length > 0 ? brokenTransactionsBannerText(brokenTransactions.length) : null);
  useAnnounceOnAppear(brokenWalletText);
  useAnnounceOnAppear(outboxText);
  const emptyRecentText = recentEmptyText({ loadWindowPassed, txFailed, offlineEmpty, txPending });

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
            {/* العلامة جنب الإجمالي متتقفلش: قديم / ناقص / ممكن يكون قديم (`heroLabel`، الميزة 7) */}
            <Text style={styles.balanceLabel} accessibilityRole="header">{heroLabel(hero, staleFigures)}</Text>
          </View>
          {hero.kind === 'failed' ? (
            <Text testID="home_hero_failed" style={styles.heroStatus}>{heroFailedText(hero.missing)}</Text>
          ) : hero.kind === 'loading' ? (
            <Text testID="home_hero_loading" style={styles.heroStatus}>{HERO_LOADING_TEXT}</Text>
          ) : hero.kind === 'waiting' ? (
            <Text testID="home_hero_waiting" style={styles.heroStatus}>{HERO_WAITING_TEXT}</Text>
          ) : (
            // صف مش Text جوه Text: أندرويد بيفرد الـText المتداخل في عقدة واحدة وبيضيّع accessibilityLabel بتاع Money،
            // فالمخفي كان بيتقري نقط. ظاهر ← عقدة واحدة «950 جنيه»؛ مخفي ← من غير label (القناع زرار «اكشف» لوحده)
            <HeroAmount style={styles.balanceValueRow} label={amountsHidden ? undefined : `${plainAmount(shownTotal)} جنيه`}>
              <Money value={shownTotal} currency={false} fit style={styles.balanceValue} />
            </HeroAmount>
          )}
          <View style={styles.walletsRow}>
            {/* كل شريحة عقدة واحدة لقارئ الشاشة: الاسم جوه label بتاع المبلغ («كاش، 950 جنيه» / «كاش: مبلغ مخفي») */}
            {coldShownFigures
              ? coldShownFigures.wallets.map(w => (
                <View key={w.id} testID={`home_cold_wallet_${w.id}`} style={styles.walletChip}>
                  {/* حلقة فاضية مش لون: "مش حية" مش "ملقيناش لون" (visual-identity-reviewer) */}
                  <View style={[styles.dot, { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.textSecondary }]} />
                  <Text style={styles.walletChipName} accessible={false} importantForAccessibility="no" accessibilityElementsHidden>{w.name}</Text>
                  <Money value={shownBalance(w.balance)} currency={false} style={styles.walletChipVal} labelPrefix={`قديم: ${w.name}`} />
                </View>
              ))
              : hero.kind === 'live' ? activeWallets.map(w => (
              <View key={w.id} style={styles.walletChip}>
                <View style={[styles.dot, { backgroundColor: walletColors.get(w.id) }]} />
                <Text style={styles.walletChipName} accessible={false} importantForAccessibility="no" accessibilityElementsHidden>{w.name}</Text>
                <Money value={balances.get(w.id) || 0} currency={false} style={styles.walletChipVal} labelPrefix={w.name} />
              </View>
            )) : null}
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        {...fabScroll.scrollProps}
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
            <Text style={[styles.bannerText, { color: colors.dangerText }]}>{DELETE_PENDING_TEXT}</Text>
            <TouchableOpacity testID="home_delete_pending_go" onPress={() => router.push('/settings-screens/delete-account')}
              accessibilityRole="button" accessibilityHint="بيفتح شاشة مسح الحساب" style={styles.bannerAction}>
              <Text style={[styles.bannerActionText, { color: colors.dangerText }]}>كمّل المسح</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* الأرقام اللي فوق قديمة ← بانر خطر **من غير ✕**: عمرها ما تتعرض من غير ما يبان (قرار مؤمن) */}
        {/* بعد مهلة التحميل بس، زي «مفيش نت» (offlineEmpty): الكاش بيتعرض في أول ثانية من كل فتح والنت شغال، والجملة
            «مفيش نت دلوقتي» كانت بتلمع أحمر غلط (اتشاف على الشاومي 2026-11-07). «(قديم)» جنب الإجمالي بيبان من الأول */}
        {coldShownFigures && loadWindowPassed && (
          <View testID="home_banner_cold" style={[styles.banner, styles.bannerDanger, { minHeight: MIN_TOUCH }]}
            accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, { color: colors.dangerText }]}>{coldFiguresText(coldShownFigures.savedAt, formatTime)}</Text>
          </View>
        )}
        {/* عمليات في الطابور المتشفّر ولسه ما اترفعتش (الميزة 7): بعد فتحة باردة من غير نت مش بتبان في «آخر العمليات»
            (الإعادة بتستنى السيرفر)، فالسطر ده من غير ✕ هو اللي بيقول إنها موجودة. بيستخبى وهي شغالة بس (M4، الجولة الأخيرة):
            النت شغال والإعادة وقفت ← المدخلات لسه هنا، والجملة من غير «نت» */}
        {!!outboxText && (
          <View testID="home_outbox_line" style={[styles.banner, styles.bannerWarn]} accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, { color: colors.accentText }]}>{outboxText}</Text>
          </View>
        )}
        {offlineEmpty && !cold && !hidden('offline') && (
          <View testID="home_banner_offline" style={[styles.banner, styles.bannerRow, styles.bannerWarn]} accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, styles.bannerFlex, { color: colors.accentText }]}>{OFFLINE_TEXT}</Text>
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
        {brokenWallets.map(w => (
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
            <View style={{ marginBottom: heroIconGap - space.sm }}><HeroIcon name="wallet-outline" size={heroIconSize.empty} testID="home_no_wallets_icon" /></View>
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
        <Text testID="home_recent_title" style={styles.sectionTitle} accessibilityRole="header">آخر العمليات</Text>
        {/* قبل مهلة التحميل أو والعمليات لسه جاية ← ولا كلمة؛ وقعت ← ما وصلتش (مش «لسه ما سجلتش») — `recentEmptyText` */}
        {recent.length === 0 && !(coldShownFigures && coldShownFigures.recent.length > 0) && !!emptyRecentText && (
          <Text testID="home_recent_empty" style={styles.emptyState}>{emptyRecentText}</Text>
        )}
        {/* دراسة الشكل خطوة 2: القايمة كارت واحد من غير خطوط بين الصفوف — المسافة هي اللي بتفصل */}
        <View testID="home_recent_card" style={styles.txCard}>
        {/* صفوف الكاش: View مش زرار (مفيش عملية حقيقية يتفتح عليها المودال)، ومن غير نوت ولا اسم */}
        {coldShownFigures && recent.length === 0 && coldShownFigures.recent.map(t => {
          const cold = coldShownFigures;
          const T = TYPE_LABELS[t.type];
          const coldCat = !t.kind && t.type === 'expense' && t.categoryId ? cold.categories.find(c => c.id === t.categoryId) : undefined;
          const catLabel = categoryLabelById(cold.categories, t.categoryId, coldCat ? { icon: false } : {});
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
                <View style={styles.txTitleRow}>
                  {coldCat
                    ? <CategoryIcon icon={coldCat.icon} size={categoryIconSize.row} />
                    : <CategoryIconSpacer />}
                  <Text style={[styles.txTitle, { flexShrink: 1 }]}>{title}</Text>
                </View>
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
          const txCat = t.type === 'expense' && t.categoryId ? categories.find(c => c.id === t.categoryId) : undefined;
          const walletLabel = transactionWalletLabel(t, wallets);
          const title = txCat ? categoryLabelById(categories, t.categoryId, { icon: false }) : t.type === 'expense' ? (catLabel || 'مصروف') : T.label;
          const when = [dayText(t.date, todayStr()), entryTime(t.date, t.createdAt)].filter(Boolean).join(' ');
          // عقدة واحدة زي صف الكاش (الميزة 7 — a11y-architect): النوع، العنوان، المحفظة والنوت، المبلغ بـ«جنيه»، اليوم، والعلامات
          const rowLabel = txRowLabel({
            type: t.type, title, walletLabel, note: t.note, amount: t.amount, when,
            pending: pendingTxIds.has(t.id), autoRecorded: !!t.autoRecorded, transfer: isTransferTx(t, transfers),
          });
          return (
            <TouchableOpacity accessibilityRole="button"
              key={t.id}
              testID={`home_tx_${t.id}`}
              style={styles.txRow}
              accessibilityLabel={rowLabel}
              accessibilityHint="بيفتح تعديل العملية"
              onPress={() => router.push({ pathname: '/modal', params: { id: t.id } })}>
              <View style={styles.txMid}>
                {/* مكان الدايرة محجوز (View فاضي بنفس المقاس) في صفوف من غير فئة — العناوين على نفس الخط */}
                <View style={styles.txTitleRow}>
                  {txCat
                    ? <CategoryIcon icon={txCat.icon} size={categoryIconSize.row} tint={categoryColors.get(txCat.id)} />
                    : <CategoryIconSpacer />}
                  <Text style={[styles.txTitle, { flexShrink: 1 }]}>{title}</Text>
                </View>
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
                {isTransferTx(t, transfers) && <TransferMark />}
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
            <CountedText title="شوف كل العمليات" count={transactions.length} style={styles.seeAllText} />
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
    balanceCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxxl, ...cardElevation(c) },
    balanceHeadRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
    eyeBtn: { padding: 4 },
    balanceLabel: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right' },
    // gap بدل مسافة جوه النص: المسافة القديمة كانت بحجم الرقم (30) مش العملة (14)
    balanceValueRow: { marginTop: 4 },
    balanceValue: { flexShrink: 1, color: c.text, fontSize: typeScale.hero, fontWeight: '700', textAlign: 'right' },
    // مكان الرقم لما مش مضمون (بنحمّل / مقدرناش نجيب) — مش بحجم الرقم البطل: ده مش رقم
    heroStatus: { color: c.textSecondary, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    // المحافظ من غير خلفية لكل واحدة — النقطة الملوّنة والمسافة بيفصلوا
    walletsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', columnGap: space.xxl, rowGap: space.sm, marginTop: space.xxl },
    walletChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
    walletChipName: { color: c.text, fontSize: typeScale.caption, fontWeight: '500' },
    walletChipVal: { color: c.textSecondary, fontSize: typeScale.caption },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
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
    // هدف لمس 44 (a11y-architect): "كمّل المسح" هو المخرج الوحيد من بانر من غير ✕، و"ابعت رسالة التأكيد تاني" بيستفيد كمان
    bannerAction: { alignSelf: 'flex-end', marginTop: 6, minHeight: MIN_TOUCH, justifyContent: 'center' },
    bannerActionText: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700', textDecorationLine: 'underline' },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: space.xxl, marginBottom: space.sm },
    emptyState: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', paddingVertical: space.xxxl },
    // نفس شكل البانرات الجديدة (دراسة الشكل): من غير إطار، شريط بداية دهبي (دعوة تصرف)
    noWallets: {
      backgroundColor: c.surface, borderWidth: 0, borderRightWidth: 3, borderColor: c.accentText, borderRadius: radius.lg,
      padding: space.xxl, alignItems: 'center', gap: space.sm, marginTop: space.xs, marginBottom: space.lg,
    },
    noWalletsTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'center' },
    noWalletsBody: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', lineHeight: 22 },
    noWalletsBtn: {
      backgroundColor: c.accent, borderRadius: radius.lg, minHeight: MIN_TOUCH + 4, paddingHorizontal: 28,
      alignItems: 'center', justifyContent: 'center', marginTop: 6, alignSelf: 'stretch',
    },
    noWalletsBtnText: { color: c.onAccent, fontSize: typeScale.title, fontWeight: '700' },
    txCard: { backgroundColor: c.surface, borderRadius: radius.xl, paddingHorizontal: space.xxl, ...cardElevation(c) },
    seeAll: {
      flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH,
      paddingVertical: space.lg,
    },
    seeAllText: { color: c.accentText, fontSize: typeScale.body },
    seeAllChevron: { color: c.textSecondary, fontSize: typeScale.title },
    txRow: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: space.lg, minHeight: MIN_TOUCH },
    txMid: { flex: 1 },
    txTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
    txTitle: { color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right' },
    txSub: { color: c.textSecondary, fontSize: typeScale.caption, marginTop: 2, textAlign: 'right' },
    txRight: { alignItems: 'flex-start' },
    txAmount: { fontSize: typeScale.body, fontWeight: '700' },
    txDate: { color: c.textMuted, fontSize: typeScale.caption, marginTop: 2 },
  });
}