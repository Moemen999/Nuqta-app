import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { TYPE_LABELS, categoryLabel, currentMonth, daysUntil, fmt, formatTime, hashColor, monthSpend, todayStr, transactionWalletLabel, walletBalance } from '@/lib/finance';
import { useBusy } from '@/lib/useBusy';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TOTAL_BUDGET_KEY = 'total_budget';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { wallets, categories, transactions, budgets, subscriptions, gamiyas } = useData();
  const [showBalance, setShowBalance] = useState(true);

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    wallets.forEach(w => map.set(w.id, walletBalance(transactions, w.id, w.openingBalance)));
    return map;
  }, [wallets, transactions]);

  const totalBalance = useMemo(
    () => wallets.reduce((s, w) => s + (balances.get(w.id) || 0), 0),
    [wallets, balances]
  );

  const nowMonth = currentMonth();
  const hasTodayTx = transactions.some(t => t.date === todayStr());
  const lowWallets = wallets.filter(w => (balances.get(w.id) || 0) < (w.lowAlert || 0));
  const budgetAlerts = categories
    .filter(c => budgets[c.id] > 0)
    .map(c => ({ cat: c, spend: monthSpend(transactions, c.id, nowMonth), limit: budgets[c.id] }))
    .filter(b => b.spend / b.limit >= 0.8);

  const totalBudgetLimit = budgets[TOTAL_BUDGET_KEY] || 0;
  const totalMonthSpend = transactions
    .filter(t => t.type === 'expense' && t.date.slice(0, 7) === nowMonth)
    .reduce((s, t) => s + t.amount, 0);
  const totalBudgetAlert = totalBudgetLimit > 0 && totalMonthSpend / totalBudgetLimit >= 0.8;

  const dueSubscriptions = subscriptions.filter(s => daysUntil(s.nextDueDate) <= s.reminderDaysBefore);
  const dueGamiyaMonths = gamiyas.flatMap(g =>
    g.months
      .filter(m => m.status === 'pending' && daysUntil(m.dueDate) <= g.reminderDaysBefore)
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
      <View style={styles.fixedTop}>
        <Text style={styles.hello}>أهلًا {user?.displayName || ''}</Text>

        <View style={styles.balanceCard}>
          <View style={styles.balanceHeadRow}>
            <TouchableOpacity onPress={() => setShowBalance(s => !s)} style={styles.eyeBtn}>
              <IconSymbol name={showBalance ? 'eye' : 'eye.slash'} size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.balanceLabel}>إجمالي رصيدك</Text>
          </View>
          <Text style={styles.balanceValue}>
            {showBalance ? fmt(totalBalance) : '••••'} <Text style={styles.currency}>ج.م</Text>
          </Text>
          <View style={styles.walletsRow}>
            {wallets.map(w => (
              <View key={w.id} style={styles.walletChip}>
                <View style={[styles.dot, { backgroundColor: hashColor(w.name) }]} />
                <Text style={styles.walletChipName}>{w.name}</Text>
                <Text style={styles.walletChipVal}>
                  {showBalance ? fmt(balances.get(w.id) || 0) : '••••'}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <EmailVerificationBanner />

        {!hasTodayTx && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>لسه ما سجلتش مصاريف النهاردة</Text>
          </View>
        )}
        {lowWallets.map(w => (
          <View key={w.id} style={[styles.banner, { borderColor: colors.dangerBorder }]}>
            <Text style={[styles.bannerText, { color: colors.danger }]}>
              رصيد {w.name} قرب يخلص ({fmt(balances.get(w.id) || 0)} ج.م)
            </Text>
          </View>
        ))}
        {totalBudgetAlert && (
          <View style={[styles.banner, { borderColor: colors.warnBorder }]}>
            <Text style={[styles.bannerText, { color: colors.accent }]}>
              الميزانية الإجمالية {totalMonthSpend >= totalBudgetLimit ? 'خلصت' : 'قربت تخلص'} ({fmt(totalMonthSpend)}/{fmt(totalBudgetLimit)})
            </Text>
          </View>
        )}
        {budgetAlerts.map(b => (
          <View key={b.cat.id} style={[styles.banner, { borderColor: colors.warnBorder }]}>
            <Text style={[styles.bannerText, { color: colors.accent }]}>
              ميزانية {b.cat.name} {b.spend >= b.limit ? 'خلصت' : 'قربت تخلص'} ({fmt(b.spend)}/{fmt(b.limit)})
            </Text>
          </View>
        ))}
        {dueSubscriptions.map(s => {
          const d = daysUntil(s.nextDueDate);
          return (
            <TouchableOpacity key={s.id} style={[styles.banner, { borderColor: colors.warnBorder }]} onPress={() => router.push('/(tabs)/debts')}>
              <Text style={[styles.bannerText, { color: colors.accent }]}>
                اشتراك {s.name} {d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} ({fmt(s.amount)} ج.م)
              </Text>
            </TouchableOpacity>
          );
        })}
        {dueGamiyaMonths.map(({ gamiya, month }) => {
          const d = daysUntil(month.dueDate);
          return (
            <TouchableOpacity key={month.id} style={[styles.banner, { borderColor: colors.warnBorder }]} onPress={() => router.push('/(tabs)/debts')}>
              <Text style={[styles.bannerText, { color: colors.accent }]}>
                جمعية {gamiya.name} — {month.isPayoutMonth ? 'شهر الاستلام' : 'القسط'} {d <= 0 ? 'مستحق دلوقتي' : `بعد ${d} يوم`} ({fmt(month.amount)} ج.م)
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <Text style={styles.sectionTitle}>آخر العمليات</Text>
        {recent.length === 0 && <Text style={styles.emptyState}>لسه معملتش أي عملية</Text>}
        {recent.map(t => {
          const T = TYPE_LABELS[t.type];
          const cat = categories.find(c => c.id === t.categoryId);
          const walletLabel = transactionWalletLabel(t, wallets);
          return (
            <TouchableOpacity
              key={t.id}
              style={styles.txRow}
              onPress={() => router.push({ pathname: '/modal', params: { id: t.id } })}>
              <View style={styles.txMid}>
                <Text style={styles.txTitle}>{t.type === 'expense' ? (cat ? categoryLabel(cat) : 'مصروف') : T.label}</Text>
                <Text style={styles.txSub}>{walletLabel}{t.note ? ' · ' + t.note : ''}</Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: T.color }]}>{T.sign}{fmt(t.amount)}</Text>
                <Text style={styles.txDate}>{t.date}{t.createdAt ? ' · ' + formatTime(t.createdAt) : ''}</Text>
              </View>
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
      } catch {
        setError('مقدرناش نبعت الرسالة دلوقتي، جرب كمان شوية');
      }
    });
  }

  return (
    <View style={[styles.banner, { borderColor: colors.warnBorder }]}>
      <Text style={[styles.bannerText, { color: colors.accent }]}>
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
      {!!error && <Text style={[styles.bannerText, { color: colors.danger }]}>{error}</Text>}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    fixedTop: { paddingHorizontal: 16, paddingTop: 16 },
    scrollArea: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
    hello: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 12 },
    balanceCard: { backgroundColor: c.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: c.border },
    balanceHeadRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
    eyeBtn: { padding: 4 },
    balanceLabel: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
    balanceValue: { color: c.text, fontSize: 30, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    currency: { fontSize: 14, color: c.textSecondary, fontWeight: '400' },
    walletsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    walletChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: c.surface2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    walletChipName: { color: c.text, fontSize: 12, fontWeight: '500' },
    walletChipVal: { color: c.textSecondary, fontSize: 12 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    banner: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, padding: 12, marginTop: 10 },
    bannerText: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
    bannerAction: { alignSelf: 'flex-end', marginTop: 6 },
    bannerActionText: { color: c.accent, fontSize: 12.5, fontWeight: '700', textDecorationLine: 'underline' },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 6, marginBottom: 10 },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    txRow: { flexDirection: 'row-reverse', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 10 },
    txMid: { flex: 1 },
    txTitle: { color: c.text, fontSize: 13.5, fontWeight: '500', textAlign: 'right' },
    txSub: { color: c.textSecondary, fontSize: 11.5, marginTop: 2, textAlign: 'right' },
    txRight: { alignItems: 'flex-start' },
    txAmount: { fontSize: 14, fontWeight: '700' },
    txDate: { color: c.textMuted, fontSize: 10.5, marginTop: 2 },
  });
}