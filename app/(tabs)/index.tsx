import { Money } from '@/components/Money';
import { speakable } from '@/lib/money';
import { MIN_TOUCH } from '@/lib/tokens';
import { IncomeAutoNotices } from '@/components/IncomeHomeCards';
import { ChargeAutoNotices } from '@/components/ChargeHomeCards';
import PendingSummary from '@/components/PendingSheet';
import PendingSyncMark from '@/components/PendingSyncMark';
import AutoRecordedMark from '@/components/AutoRecordedMark';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { AmountsMaskScope, usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import { TYPE_LABELS, categoryLabelById, currentMonth, daysUntil, formatTime, monthSpend, todayStr, transactionWalletLabel, walletBalance } from '@/lib/finance';
import { useBusy } from '@/lib/useBusy';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNoWallets } from '@/lib/useNoWallets';
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
  const { wallets, categories, transactions, budgets, subscriptions, gamiyas, pendingTxIds, serverReachable } = useData();
  const { walletColors } = useChartColors();
  const { amountsHidden, toggleAmounts, money } = usePrivacy();

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
  /**
   * حساب مسح (أو أرشف) كل محافظه: مفيش شاشة تجهيز تاني (عدّاها قبل كده)، ومن غير
   * محفظة مفيش ولا عملية تتسجل — فبنقول كده وبنودّيه يضيف واحدة. بس لما نكون
   * متأكدين من السيرفر: من غير نت ده بانر "مفيش نت" اللي فوق، ولو listener المحافظ
   * اترفض ده بانر "مقدرناش نجيب بياناتك" — مش "مفيش محافظ".
   */
  const noWalletsState = useNoWallets();
  const noWallets = loadWindowPassed && noWalletsState.none;
  const onlyArchived = loadWindowPassed && noWalletsState.onlyArchived;
  // الحالة بتظهر بعد 2.5 ثانية — قارئ الشاشة يكون عدّى المكان ده خلاص (a11y-architect)
  useEffect(() => {
    if (noWallets) AccessibilityInfo.announceForAccessibility('مفيش ولا محفظة. ضيف محفظة عشان تقدر تسجل مصاريفك ودخلك.');
  }, [noWallets]);

  const nowMonth = currentMonth();
  const hasTodayTx = transactions.some(t => t.date === todayStr());
  const lowWallets = activeWallets.filter(w => (balances.get(w.id) || 0) < (w.lowAlert || 0));
  const budgetAlerts = activeCategories
    .filter(c => budgets[c.id] > 0)
    .map(c => ({ cat: c, spend: monthSpend(transactions, c.id, nowMonth), limit: budgets[c.id] }))
    .filter(b => b.spend / b.limit >= 0.8);

  const totalBudgetLimit = budgets[TOTAL_BUDGET_KEY] || 0;
  const totalMonthSpend = transactions
    .filter(t => t.type === 'expense' && t.date.slice(0, 7) === nowMonth)
    .reduce((s, t) => s + t.amount, 0);
  const totalBudgetAlert = totalBudgetLimit > 0 && totalMonthSpend / totalBudgetLimit >= 0.8;

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
              accessibilityLabel="إخفاء المبالغ"
              accessibilityHint="بيخبّي أرقام الرئيسية بس"
              accessibilityState={{ checked: amountsHidden }}>
              <IconSymbol name={amountsHidden ? 'eye.slash' : 'eye'} size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.balanceLabel}>إجمالي رصيدك</Text>
          </View>
          {/* صف مش Text جوه Text: أندرويد بيفرد الـText المتداخل في عقدة واحدة
              وبيضيّع accessibilityLabel بتاع Money، فالمخفي كان بيتقري نقط */}
          <View style={styles.balanceValueRow}>
            <Money value={totalBalance} currency={false} style={styles.balanceValue} />
            <Text style={styles.currency}>ج.م</Text>
          </View>
          <View style={styles.walletsRow}>
            {activeWallets.map(w => (
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
        {/* الترتيب (2026-09-29): الرصيد ثابت فوق — وبعده في السكرول: اللي بيقول إن
            رقم ممكن يكون غلط أو ناقص (مفيش نت، مفيش محفظة، "ما سجلناش")، وسطر
            "مستنيين ردك"، وآخر العمليات، وبعدين باقي التنبيهات. تسجيل عملية هو
            الزرار "+" الظاهر دايمًا. بانر "مقدرناش نجيب بياناتك" فوق الـStack كله */}
        {offlineEmpty && (
          <View style={[styles.banner, { borderColor: colors.warnBorder }]}>
            <Text style={[styles.bannerText, { color: colors.accentText }]}>
              مفيش نت دلوقتي — بياناتك مش ضايعة، إحنا بس لسه ما وصلناش لها. أول ما النت يرجع هتظهر لوحدها.
            </Text>
          </View>
        )}
        {noWallets && (
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
        <Text style={styles.sectionTitle}>آخر العمليات</Text>
        {recent.length === 0 && (
          <Text style={styles.emptyState}>
            {offlineEmpty ? 'مستنيين النت عشان نجيب عملياتك' : 'لسه معملتش أي عملية'}
          </Text>
        )}
        {recent.map(t => {
          const T = TYPE_LABELS[t.type];
          // الفئة الممسوحة بتطلع باسمها الصريح، مش بتترجع لـ"مصروف" العامة —
          // "مصروف" بتقول إن العملية مالهاش فئة، والحقيقة إن فئتها اتمسحت
          const catLabel = categoryLabelById(categories, t.categoryId);
          const walletLabel = transactionWalletLabel(t, wallets);
          return (
            <TouchableOpacity
              key={t.id}
              testID={`home_tx_${t.id}`}
              style={styles.txRow}
              onPress={() => router.push({ pathname: '/modal', params: { id: t.id } })}>
              <View style={styles.txMid}>
                <Text style={styles.txTitle}>{t.type === 'expense' ? (catLabel || 'مصروف') : T.label}</Text>
                <Text style={styles.txSub}>{walletLabel}{t.note ? ' · ' + t.note : ''}</Text>
              </View>
              <View style={styles.txRight}>
                <Money value={t.amount} sign={T.sign} currency={false} style={[styles.txAmount, { color: t.type === 'withdraw' ? colors.accentText : T.color }]} />
                <Text style={styles.txDate}>{t.date}{t.createdAt ? ' · ' + formatTime(t.createdAt) : ''}</Text>
                {pendingTxIds.has(t.id) && <PendingSyncMark />}
                {t.autoRecorded && <AutoRecordedMark />}
              </View>
            </TouchableOpacity>
          );
        })}
        {/* تنبيهات مش مستنية رد: تحت آخر العمليات، ومش داخلة في عدّاد السطر */}
        <EmailVerificationBanner />
        {!hasTodayTx && !offlineEmpty && !noWallets && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>لسه ما سجلتش مصاريف النهاردة</Text>
          </View>
        )}
        {lowWallets.map(w => (
          <View key={w.id} style={[styles.banner, { borderColor: colors.dangerBorder }]}>
            <Text style={[styles.bannerText, { color: colors.danger }]}
              accessibilityLabel={speakable(`رصيد ${w.name} قرب يخلص (${money(balances.get(w.id) || 0)} ج.م)`)}>
              رصيد {w.name} قرب يخلص ({money(balances.get(w.id) || 0)} ج.م)
            </Text>
          </View>
        ))}
        {totalBudgetAlert && (
          <View style={[styles.banner, { borderColor: colors.warnBorder }]}>
            <Text style={[styles.bannerText, { color: colors.accentText }]}
              accessibilityLabel={speakable(`الميزانية الإجمالية ${totalMonthSpend >= totalBudgetLimit ? 'خلصت' : 'قربت تخلص'} (${money(totalMonthSpend)} من ${money(totalBudgetLimit)})`)}>
              الميزانية الإجمالية {totalMonthSpend >= totalBudgetLimit ? 'خلصت' : 'قربت تخلص'} ({money(totalMonthSpend)}/{money(totalBudgetLimit)})
            </Text>
          </View>
        )}
        {budgetAlerts.map(b => (
          <View key={b.cat.id} style={[styles.banner, { borderColor: colors.warnBorder }]}>
            <Text style={[styles.bannerText, { color: colors.accentText }]}
              accessibilityLabel={speakable(`ميزانية ${b.cat.name} ${b.spend >= b.limit ? 'خلصت' : 'قربت تخلص'} (${money(b.spend)} من ${money(b.limit)})`)}>
              ميزانية {b.cat.name} {b.spend >= b.limit ? 'خلصت' : 'قربت تخلص'} ({money(b.spend)}/{money(b.limit)})
            </Text>
          </View>
        ))}
        {dueSubscriptions.map(s => {
          const d = daysUntil(s.nextDueDate);
          return (
            <TouchableOpacity key={s.id} style={[styles.banner, { borderColor: colors.warnBorder }]} onPress={() => router.push('/(tabs)/debts')}>
              <Text style={[styles.bannerText, { color: colors.accentText }]}
                accessibilityLabel={speakable(`اشتراك ${s.name} ${d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} (${money(s.amount)} ج.م)`)}>
                اشتراك {s.name} {d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} ({money(s.amount)} ج.م)
              </Text>
            </TouchableOpacity>
          );
        })}
        {dueGamiyaMonths.map(({ gamiya, month }) => {
          const d = daysUntil(month.dueDate);
          return (
            <TouchableOpacity key={month.id} style={[styles.banner, { borderColor: colors.warnBorder }]} onPress={() => router.push('/(tabs)/debts')}>
              <Text style={[styles.bannerText, { color: colors.accentText }]}
                accessibilityLabel={speakable(`جمعية ${gamiya.name} — ${month.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} ${d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} (${money(month.amount)} ج.م)`)}>
                جمعية {gamiya.name} — {month.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} {d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} ({money(month.amount)} ج.م)
              </Text>
            </TouchableOpacity>
          );
        })}
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

  if (!user || !usesPassword || verified) return null;

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
    <View style={[styles.banner, { borderColor: colors.warnBorder }]}>
      <Text style={[styles.bannerText, { color: colors.accentText }]}>
        إيميلك ({user.email}) لسه مش مأكّد — أكّده عشان تأمّن حسابك
      </Text>
      {sent && !error ? (
        <Text style={styles.bannerText}>بعتنالك رسالة تأكيد جديدة، شوف إيميلك</Text>
      ) : (
        <TouchableOpacity onPress={handleResend} disabled={busy} style={styles.bannerAction}>
          <Text style={[styles.bannerActionText, busy && { opacity: 0.6 }]}>
            {busy ? '...' : 'أعد إرسال رسالة التأكيد'}
          </Text>
        </TouchableOpacity>
      )}
      {/* بعد "بعتنالك رسالة جديدة" مش قبلها — النصيحة على آخر رسالة اتقال إنها اتبعتت */}
      <Text testID="verify_spam_hint" style={styles.bannerText}>{VERIFY_SPAM_HINT}</Text>
      {!!error && <Text style={[styles.bannerText, { color: colors.danger }]}>{error}</Text>}
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
    balanceCard: { backgroundColor: c.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: c.border },
    balanceHeadRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
    eyeBtn: { padding: 4 },
    balanceLabel: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
    // gap بدل مسافة جوه النص: المسافة القديمة كانت بحجم الرقم (30) مش العملة (14)
    balanceValueRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 8, marginTop: 4 },
    balanceValue: { color: c.text, fontSize: 30, fontWeight: '700', textAlign: 'right' },
    currency: { fontSize: 14, color: c.textSecondary, fontWeight: '400' },
    walletsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    walletChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: c.surface2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    walletChipName: { color: c.text, fontSize: 12, fontWeight: '500' },
    walletChipVal: { color: c.textSecondary, fontSize: 12 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    banner: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, padding: 12, marginTop: 10 },
    bannerText: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
    bannerAction: { alignSelf: 'flex-end', marginTop: 6 },
    bannerActionText: { color: c.accentText, fontSize: 12.5, fontWeight: '700', textDecorationLine: 'underline' },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 14, marginBottom: 10 },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    // نفس شكل بانرات الرئيسية (borderStrong، 12) — مش selectedBorder: ده لون "مختار" (visual-identity-reviewer)
    noWallets: {
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12,
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
    txRow: { flexDirection: 'row-reverse', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 10 },
    txMid: { flex: 1 },
    txTitle: { color: c.text, fontSize: 13.5, fontWeight: '500', textAlign: 'right' },
    txSub: { color: c.textSecondary, fontSize: 11.5, marginTop: 2, textAlign: 'right' },
    txRight: { alignItems: 'flex-start' },
    txAmount: { fontSize: 14, fontWeight: '700' },
    txDate: { color: c.textMuted, fontSize: 10.5, marginTop: 2 },
  });
}