import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { fmt, monthSpend, todayStr, walletBalance } from '@/lib/finance';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PALETTE = ['#7FA98F', '#C9A961', '#7C93C9', '#C97C9B', '#9B7CC9', '#C98F5A', '#6FB3B8', '#B08FC9'];
function hashColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

const TYPE_LABELS: Record<string, { label: string; color: string; sign: string }> = {
  expense: { label: 'مصروف', color: '#D97878', sign: '-' },
  income: { label: 'إيراد', color: '#7FA98F', sign: '+' },
  withdraw: { label: 'سحب', color: '#C9A961', sign: '-' },
};

const TOTAL_BUDGET_KEY = 'total_budget';

export default function HomeScreen() {
  const { user } = useAuth();
  const { wallets, categories, transactions, budgets } = useData();

  const totalBalance = useMemo(
    () => wallets.reduce((s, w) => s + walletBalance(transactions, w.id, w.openingBalance), 0),
    [wallets, transactions]
  );

  const nowMonth = todayStr().slice(0, 7);
  const hasTodayTx = transactions.some(t => t.date === todayStr());
  const lowWallets = wallets.filter(w => walletBalance(transactions, w.id, w.openingBalance) < (w.lowAlert || 0));
  const budgetAlerts = categories
    .filter(c => budgets[c.id] > 0)
    .map(c => ({ cat: c, spend: monthSpend(transactions, c.id, nowMonth), limit: budgets[c.id] }))
    .filter(b => b.spend / b.limit >= 0.8);

  const totalBudgetLimit = budgets[TOTAL_BUDGET_KEY] || 0;
  const totalMonthSpend = transactions
    .filter(t => t.type === 'expense' && t.date.slice(0, 7) === nowMonth)
    .reduce((s, t) => s + t.amount, 0);
  const totalBudgetAlert = totalBudgetLimit > 0 && totalMonthSpend / totalBudgetLimit >= 0.8;

  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hello}>أهلًا {user?.displayName || ''}</Text>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>إجمالي رصيدك</Text>
        <Text style={styles.balanceValue}>{fmt(totalBalance)} <Text style={styles.currency}>ج.م</Text></Text>
        <View style={styles.walletsRow}>
          {wallets.map(w => (
            <View key={w.id} style={styles.walletChip}>
              <View style={[styles.dot, { backgroundColor: hashColor(w.name) }]} />
              <Text style={styles.walletChipName}>{w.name}</Text>
              <Text style={styles.walletChipVal}>{fmt(walletBalance(transactions, w.id, w.openingBalance))}</Text>
            </View>
          ))}
        </View>
      </View>

      {!hasTodayTx && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>لسه ما سجلتش مصاريف النهاردة</Text>
        </View>
      )}
      {lowWallets.map(w => (
        <View key={w.id} style={[styles.banner, { borderColor: '#5A3030' }]}>
          <Text style={[styles.bannerText, { color: '#D97878' }]}>
            رصيد {w.name} قرب يخلص ({fmt(walletBalance(transactions, w.id, w.openingBalance))} ج.م)
          </Text>
        </View>
      ))}
      {totalBudgetAlert && (
        <View style={[styles.banner, { borderColor: '#5A4A20' }]}>
          <Text style={[styles.bannerText, { color: '#C9A961' }]}>
            الميزانية الإجمالية {totalMonthSpend >= totalBudgetLimit ? 'خلصت' : 'قربت تخلص'} ({fmt(totalMonthSpend)}/{fmt(totalBudgetLimit)})
          </Text>
        </View>
      )}
      {budgetAlerts.map(b => (
        <View key={b.cat.id} style={[styles.banner, { borderColor: '#5A4A20' }]}>
          <Text style={[styles.bannerText, { color: '#C9A961' }]}>
            ميزانية {b.cat.name} {b.spend >= b.limit ? 'خلصت' : 'قربت تخلص'} ({fmt(b.spend)}/{fmt(b.limit)})
          </Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>آخر العمليات</Text>
      {recent.length === 0 && <Text style={styles.emptyState}>لسه معملتش أي عملية</Text>}
      {recent.map(t => {
        const T = TYPE_LABELS[t.type];
        const cat = categories.find(c => c.id === t.categoryId);
        const wallet = wallets.find(w => w.id === t.walletId);
        const toWallet = t.type === 'withdraw' ? wallets.find(w => w.id === t.toWalletId) : null;
        const walletLabel = t.type === 'withdraw'
          ? `${wallet?.name || ''} ← ${toWallet?.name || ''}`
          : (wallet?.name || '');
        return (
          <TouchableOpacity
            key={t.id}
            style={styles.txRow}
            onPress={() => router.push({ pathname: '/modal', params: { id: t.id } })}>
            <View style={styles.txMid}>
              <Text style={styles.txTitle}>{t.type === 'expense' ? (cat?.name || 'مصروف') : T.label}</Text>
              <Text style={styles.txSub}>{walletLabel}{t.note ? ' · ' + t.note : ''}</Text>
            </View>
            <View style={styles.txRight}>
              <Text style={[styles.txAmount, { color: T.color }]}>{T.sign}{fmt(t.amount)}</Text>
              <Text style={styles.txDate}>{t.date}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },
  content: { padding: 16, paddingBottom: 40 },
  hello: { color: '#EDEBE6', fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 12 },
  balanceCard: { backgroundColor: '#15181D', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#1C2027' },
  balanceLabel: { color: '#8B92A0', fontSize: 13, textAlign: 'right' },
  balanceValue: { color: '#EDEBE6', fontSize: 30, fontWeight: '700', textAlign: 'right', marginTop: 4 },
  currency: { fontSize: 14, color: '#8B92A0', fontWeight: '400' },
  walletsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  walletChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#1C2027', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  walletChipName: { color: '#EDEBE6', fontSize: 12, fontWeight: '500' },
  walletChipVal: { color: '#8B92A0', fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: { backgroundColor: '#15181D', borderWidth: 1, borderColor: '#262B33', borderRadius: 12, padding: 12, marginTop: 10 },
  bannerText: { color: '#8B92A0', fontSize: 13, textAlign: 'right' },
  sectionTitle: { color: '#EDEBE6', fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 22, marginBottom: 10 },
  emptyState: { color: '#8B92A0', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  txRow: { flexDirection: 'row-reverse', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1C2027', paddingVertical: 10 },
  txMid: { flex: 1 },
  txTitle: { color: '#EDEBE6', fontSize: 13.5, fontWeight: '500', textAlign: 'right' },
  txSub: { color: '#8B92A0', fontSize: 11.5, marginTop: 2, textAlign: 'right' },
  txRight: { alignItems: 'flex-start' },
  txAmount: { fontSize: 14, fontWeight: '700' },
  txDate: { color: '#5C6169', fontSize: 10.5, marginTop: 2 },
});