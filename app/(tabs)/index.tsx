import { Money } from '@/components/Money';
import { BUDGET_NEAR_RATIO } from '@/lib/budgetForecast';
import { speakable } from '@/lib/money';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { IncomeAutoNotices } from '@/components/IncomeHomeCards';
import { ChargeAutoNotices } from '@/components/ChargeHomeCards';
import PendingSummary from '@/components/PendingSheet';
import PendingSyncMark from '@/components/PendingSyncMark';
import AutoRecordedMark from '@/components/AutoRecordedMark';
import TransferMark from '@/components/TransferMark';
import { LineIcon } from '@/components/LineIcon';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { monthSpendTotal, transferTransactionIds } from '@/lib/spending';
import { TransfersFailedNote } from '@/components/SpendStatus';
import { AmountsMaskScope, AmountsUnmaskedScope, usePrivacy } from '@/context/PrivacyContext';
import { useDailyReminderHour } from '@/context/NotificationsContext';
import DismissButton from '@/components/DismissButton';
import { DISMISSED_ANNOUNCEMENT, DISMISS_HINT, dismissLabel } from '@/lib/bannerDismiss';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { useCurrentHour } from '@/lib/useCurrentHour';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import { TYPE_LABELS, transactionAmountColor, categoryLabelById, currentMonth, daysUntil, entryTime, formatTime, monthSpend, todayStr, transactionWalletLabel, walletBalance } from '@/lib/finance';
import { plainAmount } from '@/lib/money';
import { COLD_KIND_LABEL, coldFiguresText } from '@/lib/coldCache';
import { useBusy } from '@/lib/useBusy';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { AccessibilityInfo, AppState, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
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
  const { wallets, categories, transactions, budgets, subscriptions, gamiyas, debts, pendingTxIds, serverReachable, figuresFromServer, coldSnapshot, deletionPending, transfersStatus, brokenTransactions } = useData();
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
  const lowWallets = activeWallets.filter(w => (balances.get(w.id) || 0) < (w.lowAlert || 0));
  // السلفة والجمعية مش مصروف (خطوة 8) — لا في الفئة ولا في الإجمالي
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);
  // بند 11: وهي بتحمّل السلفة بتتعدّ مصروف — بانر "قربت تخلص" مبيولّعش عليها. لو الديون فشلت، بانر "مقدرناش نجيب بياناتك" ظاهر
  const spendKnown = transfersStatus !== 'loading';
  const budgetAlerts = activeCategories
    .filter(c => spendKnown && budgets[c.id] > 0)
    .map(c => ({ cat: c, spend: monthSpend(transactions, c.id, nowMonth, transfers), limit: budgets[c.id] }))
    .filter(b => b.spend / b.limit >= BUDGET_NEAR_RATIO);

  const totalBudgetLimit = budgets[TOTAL_BUDGET_KEY] || 0;
  // من غير السلفة وقسط الجمعية (خطوة 8)، وبالدالة المختبَرة بدل reduce هنا
  const totalMonthSpend = monthSpendTotal(transactions, nowMonth, transfers);
  const totalBudgetAlert = spendKnown && totalBudgetLimit > 0 && totalMonthSpend / totalBudgetLimit >= BUDGET_NEAR_RATIO;

  // البانر للي **لسه جاي** بس: اللي معاده جه ليه كارت "اتخصم؟" تحت (أو اتسجل لوحده)
  const dueSubscriptions = subscriptions.filter(s => s.active !== false
    && daysUntil(s.nextDueDate) > 0 && daysUntil(s.nextDueDate) <= s.reminderDaysBefore);
  const dueGamiyaMonths = gamiyas.flatMap(g =>
    g.months
      .filter(m => m.status === 'pending' && daysUntil(m.dueDate) > 0 && daysUntil(m.dueDate) <= g.reminderDaysBefore)
      .map(m => ({ gamiya: g, month: m }))
  );

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
        {/* الترتيب (قرار مؤمن 2026-10-28، رجوع عن 2026-09-29): الرصيد ثابت فوق، وبعده
            **كل** التنبيهات، وبعدين آخر العمليات. السبب: مؤمن بطّل ياخد باله من البانرات
            وهي تحت القايمة. جوه التنبيهات: اللي بيقول إن رقم ممكن يكون غلط الأول (مفيش
            نت، "الأرقام ممكن تكون قديمة"، "ما سجلناش"، "مفيش ولا محفظة")، وبعده سطر
            "مستنيين ردك"، وبعده الباقي. "مقدرناش نجيب بياناتك" فوق الـStack كله. كل بانر
            ليه ✕ وبيرجع بعد المدة اللي المستخدم اختارها (lib/bannerDismiss.ts).
            متثبّت في homeBannerOrder.test.tsx */}
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
        {/* باقي التنبيهات (2026-10-28): فوق آخر العمليات كمان — مش تحتها */}
        <EmailVerificationBanner />
        {/* بعد الساعة اللي اختارها المستخدم بس (نفس ساعة التذكير اليومي) */}
        {!hasTodayTx && !offlineEmpty && !noWallets && !cold && dailyHour !== null && nowHour >= dailyHour && !hidden('noTxToday') && (
          <View testID="home_banner_no_tx_today" style={[styles.banner, styles.bannerRow]}>
            <Text style={[styles.bannerText, styles.bannerFlex]}>لسه ما سجلتش مصاريف النهاردة</Text>
            <DismissButton testID="home_banner_dismiss_no_tx_today" onPress={() => dismiss('noTxToday')} hint={DISMISS_HINT} label={dismissLabel('noTxToday')} announce={DISMISSED_ANNOUNCEMENT} />
          </View>
        )}
        {lowWallets.filter(w => !hidden('lowBalance', w.id)).map(w => (
          <View key={w.id} testID={`home_banner_low_${w.id}`} style={[styles.banner, styles.bannerRow, styles.bannerDanger]}>
            <Text style={[styles.bannerText, styles.bannerFlex, { color: colors.dangerText }]}
              accessibilityLabel={speakable(`رصيد ${w.name} قرب يخلص (${money(balances.get(w.id) || 0)} ج.م)`)}>
              رصيد {w.name} قرب يخلص ({money(balances.get(w.id) || 0)} ج.م)
            </Text>
            <DismissButton testID={`home_banner_dismiss_low_balance_${w.id}`} onPress={() => dismiss('lowBalance', w.id)} hint={DISMISS_HINT} label={dismissLabel('lowBalance', w.name)} announce={DISMISSED_ANNOUNCEMENT} />
          </View>
        ))}
        {/* المفتاح بالدرجة (silent-failure-hunter): ✕ على "قربت تخلص" ميخبّيش "خلصت" */}
        {totalBudgetAlert && !hidden('budget', `total:${totalMonthSpend >= totalBudgetLimit ? 'over' : 'near'}`) && (
          <View testID="home_banner_budget_total" style={[styles.banner, styles.bannerRow, styles.bannerWarn]}>
            <Text style={[styles.bannerText, styles.bannerFlex, { color: colors.accentText }]}
              accessibilityLabel={speakable(`الميزانية الإجمالية ${totalMonthSpend >= totalBudgetLimit ? 'خلصت' : 'قربت تخلص'} (${money(totalMonthSpend)} من ${money(totalBudgetLimit)})`)}>
              الميزانية الإجمالية {totalMonthSpend >= totalBudgetLimit ? 'خلصت' : 'قربت تخلص'} ({money(totalMonthSpend)}/{money(totalBudgetLimit)})
            </Text>
            <DismissButton testID="home_banner_dismiss_budget_total" onPress={() => dismiss('budget', `total:${totalMonthSpend >= totalBudgetLimit ? 'over' : 'near'}`)} hint={DISMISS_HINT} label={dismissLabel('budget', 'الإجمالية')} announce={DISMISSED_ANNOUNCEMENT} />
          </View>
        )}
        {budgetAlerts.filter(b => !hidden('budget', `${b.cat.id}:${b.spend >= b.limit ? 'over' : 'near'}`)).map(b => (
          <View key={b.cat.id} testID={`home_banner_budget_${b.cat.id}`} style={[styles.banner, styles.bannerRow, styles.bannerWarn]}>
            <Text style={[styles.bannerText, styles.bannerFlex, { color: colors.accentText }]}
              accessibilityLabel={speakable(`ميزانية ${b.cat.name} ${b.spend >= b.limit ? 'خلصت' : 'قربت تخلص'} (${money(b.spend)} من ${money(b.limit)})`)}>
              ميزانية {b.cat.name} {b.spend >= b.limit ? 'خلصت' : 'قربت تخلص'} ({money(b.spend)}/{money(b.limit)})
            </Text>
            <DismissButton testID={`home_banner_dismiss_budget_${b.cat.id}`} onPress={() => dismiss('budget', `${b.cat.id}:${b.spend >= b.limit ? 'over' : 'near'}`)} hint={DISMISS_HINT} label={dismissLabel('budget', b.cat.name)} announce={DISMISSED_ANNOUNCEMENT} />
          </View>
        ))}
        {/* الديون/الجمعية فشلوا: البانرات بتظهر (قرار مؤمن: الرقم بيظهر بتحذير) وتحتها إن الرقم ممكن يكون زيادة (money-reviewer + silent-failure-hunter) */}
        {/* بعد ✕: السطر بيمشي مع البانرات الظاهرة بس، مش يفضل لوحده (silent-failure-hunter جولة 2) */}
        {transfersStatus === 'failed' && ((totalBudgetAlert && !hidden('budget', `total:${totalMonthSpend >= totalBudgetLimit ? 'over' : 'near'}`))
          || budgetAlerts.some(b => !hidden('budget', `${b.cat.id}:${b.spend >= b.limit ? 'over' : 'near'}`))) && (
          <TransfersFailedNote testID="home_budget_transfers_failed" style={{ marginTop: 6 }} />
        )}
        {/* المفتاح بالمعاد: الدورة الجاية بانر جديد حتى لو اللي قبله اتقفل */}
        {dueSubscriptions.filter(s => !hidden('subscriptionDue', `${s.id}@${s.nextDueDate}`)).map(s => {
          const d = daysUntil(s.nextDueDate);
          return (
            // الـ✕ أخ للجزء اللي بيتداس مش جوّاه: زرار جوه زرار قارئ الشاشة مبيوصلوش (a11y-architect)
            <View key={s.id} testID={`home_banner_sub_${s.id}`} style={[styles.banner, styles.bannerRow, styles.bannerWarn]}>
              <TouchableOpacity style={styles.bannerFlex} onPress={() => router.push('/(tabs)/debts')} accessibilityRole="button">
              <Text style={[styles.bannerText, { color: colors.accentText }]}
                accessibilityLabel={speakable(`اشتراك ${s.name} ${d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} (${money(s.amount)} ج.م)`)}>
                اشتراك {s.name} {d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} ({money(s.amount)} ج.م)
              </Text>
              </TouchableOpacity>
              <DismissButton testID={`home_banner_dismiss_sub_${s.id}`} onPress={() => dismiss('subscriptionDue', `${s.id}@${s.nextDueDate}`)} hint={DISMISS_HINT} label={dismissLabel('subscriptionDue', s.name)} announce={DISMISSED_ANNOUNCEMENT} />
            </View>
          );
        })}
        {dueGamiyaMonths.filter(({ month }) => !hidden('gamiyaDue', month.id)).map(({ gamiya, month }) => {
          const d = daysUntil(month.dueDate);
          return (
            <View key={month.id} testID={`home_banner_gamiya_${month.id}`} style={[styles.banner, styles.bannerRow, styles.bannerWarn]}>
              <TouchableOpacity style={styles.bannerFlex} onPress={() => router.push('/(tabs)/debts')} accessibilityRole="button">
              <Text style={[styles.bannerText, { color: colors.accentText }]}
                accessibilityLabel={speakable(`جمعية ${gamiya.name} — ${month.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} ${d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} (${money(month.amount)} ج.م)`)}>
                جمعية {gamiya.name} — {month.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} {d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} ({money(month.amount)} ج.م)
              </Text>
              </TouchableOpacity>
              <DismissButton testID={`home_banner_dismiss_gamiya_${month.id}`} onPress={() => dismiss('gamiyaDue', month.id)} hint={DISMISS_HINT} label={dismissLabel('gamiyaDue', gamiya.name)} announce={DISMISSED_ANNOUNCEMENT} />
            </View>
          );
        })}
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
              accessibilityLabel={`قديم: ${title}${walletLabel ? '، ' + walletLabel : ''}، ${plainAmount(t.amount)} جنيه، ${t.date}`}>
              <View style={styles.txMid}>
                <Text style={styles.txTitle}>{title}</Text>
                {!!walletLabel && <Text style={styles.txSub}>{walletLabel}</Text>}
              </View>
              <View style={styles.txRight}>
                <AmountsUnmaskedScope>
                  <Money value={t.amount} sign={T.sign} currency={false} style={[styles.txAmount, { color: transactionAmountColor(t.type, colors) }]} />
                </AmountsUnmaskedScope>
                <Text style={styles.txDate}>{t.date}{entryTime(t.date, t.createdAt) ? ' · ' + entryTime(t.date, t.createdAt) : ''}</Text>
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
                <Text style={styles.txDate}>{t.date}{entryTime(t.date, t.createdAt) ? ' · ' + entryTime(t.date, t.createdAt) : ''}</Text>
                {pendingTxIds.has(t.id) && <PendingSyncMark />}
                {t.autoRecorded && <AutoRecordedMark />}
                {transfers.has(t.id) && <TransferMark />}
              </View>
            </TouchableOpacity>
          );
        })}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * بيظهر بس للمستخدم اللي داخل بإيميل وباسورد وإيميله لسه مش مأكّد. مستخدمين جوجل
 * إيميلهم مأكّد تلقائيًا فمبيشوفوش البانر خالص.
 * فايربيز بتخزّن حالة التأكيد في الكاش ومبتحدّثهاش لوحدها لما المستخدم يدوس اللينك
 * في إيميله، عشان كده بنعمل reload أول ما الشاشة تفتح وكل ما يرجع للتطبيق —
 * وده اللي بيخلي البانر يختفي بعد التأكيد من غير ما يخرج ويدخل تاني.
 */
/**
 * رسالة التأكيد **بتوصل** — بس بتقع في الـSpam (اتأكد 2026-09-28 بحساب جديد).
 * المستخدم اللي مش لاقيها في الوارد هيفتكر التطبيق بايظ، فالسطر ده ظاهر على طول
 * مع البانر. نفس صياغة رابط "نسيت الباسورد؟" (`resetSentBody`).
 */
export const VERIFY_SPAM_HINT = 'رسالة التأكيد لو ملقتهاش في الوارد، بصّ في الـSpam.';

function EmailVerificationBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, resendVerificationEmail } = useAuth();
  const { busy, run: runResend } = useBusy();
  const [verified, setVerified] = useState(true);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { hidden, dismiss } = useBannerDismiss();

  const usesPassword = !!user?.providerData?.some(p => p.providerId === 'password');

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      await user.reload();
    } catch {
      // لو مفيش نت، بنسيب الحالة اللي عندنا زي ما هي
    }
    setVerified(!!user.emailVerified);
  }, [user]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (!user || !usesPassword || verified || hidden('verifyEmail')) return null;

  function handleResend() {
    setError('');
    runResend(async () => {
      try {
        await resendVerificationEmail();
        setSent(true);
      } catch (err) {
        // رسالة المستخدم فاضلة زي ما هي — التسجيل ده للتشخيص بس
        console.error('[auth] resendVerificationEmail failed:', err);
        setError('مقدرناش نبعت الرسالة دلوقتي، جرب كمان شوية');
      }
    });
  }

  return (
    <View testID="home_banner_verify_email" style={[styles.banner, styles.bannerWarn]}>
      <View style={styles.bannerRow}>
        <Text style={[styles.bannerText, styles.bannerFlex, { color: colors.accentText }]}>
          إيميلك ({user.email}) لسه مش مأكّد — أكّده عشان تأمّن حسابك
        </Text>
        <DismissButton testID="home_banner_dismiss_verify_email" onPress={() => dismiss('verifyEmail')} hint={DISMISS_HINT} label={dismissLabel('verifyEmail')} announce={DISMISSED_ANNOUNCEMENT} />
      </View>
      {sent && !error ? (
        <Text style={styles.bannerText}>بعتنالك رسالة تأكيد جديدة، شوف إيميلك</Text>
      ) : (
        <TouchableOpacity accessibilityRole="button" onPress={handleResend} disabled={busy} style={styles.bannerAction}>
          <Text style={[styles.bannerActionText, busy && { opacity: 0.6 }]}>
            {busy ? '...' : 'أعد إرسال رسالة التأكيد'}
          </Text>
        </TouchableOpacity>
      )}
      {/* بعد "بعتنالك رسالة جديدة" مش قبلها — النصيحة على آخر رسالة اتقال إنها اتبعتت */}
      <Text testID="verify_spam_hint" style={styles.bannerText}>{VERIFY_SPAM_HINT}</Text>
      {!!error && <Text style={[styles.bannerText, { color: colors.dangerText }]}>{error}</Text>}
    </View>
  );
}

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
    txRow: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: space.lg, minHeight: MIN_TOUCH },
    txMid: { flex: 1 },
    txTitle: { color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right' },
    txSub: { color: c.textSecondary, fontSize: typeScale.caption, marginTop: 2, textAlign: 'right' },
    txRight: { alignItems: 'flex-start' },
    txAmount: { fontSize: typeScale.body, fontWeight: '700' },
    txDate: { color: c.textMuted, fontSize: typeScale.caption, marginTop: 2 },
  });
}