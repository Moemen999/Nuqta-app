import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { categoryLabel, fmt, formatTime, todayStr } from '@/lib/finance';
import * as FileSystem from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as XLSX from 'xlsx';

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}
function startOfMonth(dateStr: string) { return dateStr.slice(0, 7) + '-01'; }
function endOfMonth(dateStr: string) {
  const d = new Date(dateStr); const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return end.toISOString().slice(0, 10);
}

type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'all' | 'custom';

const TYPE_LABELS: Record<string, { label: string; color: string; sign: string }> = {
  expense: { label: 'مصروف', color: '#D97878', sign: '-' },
  income: { label: 'إيراد', color: '#7FA98F', sign: '+' },
  withdraw: { label: 'سحب', color: '#C9A961', sign: '-' },
};

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { transactions, wallets, categories } = useData();

  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => {
    const today = todayStr();
    if (preset === 'last7') return { from: addDays(today, -6), to: today };
    if (preset === 'lastMonth') {
      const prevMonthDay = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prevMonthDay), to: endOfMonth(prevMonthDay) };
    }
    if (preset === 'all') return { from: '0000-01-01', to: '9999-12-31' };
    if (preset === 'custom') {
      const from = customFrom <= customTo ? customFrom : customTo;
      const to = customFrom <= customTo ? customTo : customFrom;
      return { from, to };
    }
    return { from: startOfMonth(today), to: endOfMonth(today) };
  }, [preset, customFrom, customTo]);

  const filtered = useMemo(() => {
    return transactions
      .filter(t => t.date >= range.from && t.date <= range.to)
      .sort((a, b) => {
        const byDate = b.date.localeCompare(a.date);
        if (byDate !== 0) return byDate;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
  }, [transactions, range]);

  const totalIn = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  async function handleExport() {
    if (filtered.length === 0) return;
    setExporting(true);
    try {
      const rows = filtered.map(t => {
        const wallet = wallets.find(w => w.id === t.walletId);
        const toWallet = t.type === 'withdraw' ? wallets.find(w => w.id === t.toWalletId) : undefined;
        const cat = t.categoryId ? categories.find(c => c.id === t.categoryId) : undefined;
        return {
          Date: t.date,
          Time: formatTime(t.createdAt) || '',
          Type: TYPE_LABELS[t.type]?.label || t.type,
          Wallet: wallet?.name || '',
          ToWallet: toWallet?.name || '',
          Category: cat ? categoryLabel(cat) : '',
          Amount: t.amount,
          Note: t.note || '',
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
      const wbout: string = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      const filename = `nuqta-export-${range.from}-to-${range.to}.xlsx`;
      const baseDir = ((FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '') as string;
      const uri = `${baseDir}${filename}`;
      await FileSystem.writeAsStringAsync(uri, wbout, { encoding: 'base64' });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'تصدير العمليات',
        });
      } else {
        Alert.alert('اتحفظ الملف', `الملف اتحفظ هنا:\n${uri}`);
      }
    } catch (e: any) {
      Alert.alert('حصل خطأ في التصدير', String(e?.message || e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ رجوع</Text>
        </TouchableOpacity>
        <Text style={styles.title}>أرشيف العمليات</Text>
      </View>

      <View style={styles.presetRow}>
        {[
          { key: 'thisMonth', label: 'هذا الشهر' },
          { key: 'last7', label: 'آخر 7 أيام' },
          { key: 'lastMonth', label: 'الشهر الماضي' },
          { key: 'all', label: 'كل الوقت' },
          { key: 'custom', label: 'مخصص' },
        ].map(p => (
          <TouchableOpacity key={p.key} onPress={() => setPreset(p.key as Preset)}
            style={[styles.presetBtn, { backgroundColor: preset === p.key ? colors.accent : colors.surface2 }]}>
            <Text style={{ color: preset === p.key ? colors.onAccent : colors.text, fontSize: 12.5 }}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === 'custom' && (
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor('from')}>
            <Text style={styles.dateBtnText}>من: {customFrom}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textSecondary }}>إلى</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPickerFor('to')}>
            <Text style={styles.dateBtnText}>إلى: {customTo}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>إجمالي الإيرادات</Text>
          <Text style={[styles.metricValue, { color: colors.success }]}>{fmt(totalIn)} ج.م</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>إجمالي المصروفات</Text>
          <Text style={[styles.metricValue, { color: colors.danger }]}>{fmt(totalOut)} ج.م</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.exportBtn, { opacity: filtered.length === 0 || exporting ? 0.5 : 1 }]}
        onPress={handleExport}
        disabled={filtered.length === 0 || exporting}>
        {exporting ? <ActivityIndicator color={colors.onAccent} /> : (
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13.5 }}>تصدير إكسيل ({filtered.length} عملية)</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>العمليات ({filtered.length})</Text>
      {filtered.length === 0 && <Text style={styles.emptyState}>مفيش عمليات في الفترة دي</Text>}
      {filtered.map(t => {
        const T = TYPE_LABELS[t.type];
        const wallet = wallets.find(w => w.id === t.walletId);
        const toWallet = t.type === 'withdraw' ? wallets.find(w => w.id === t.toWalletId) : undefined;
        const cat = t.categoryId ? categories.find(c => c.id === t.categoryId) : undefined;
        const walletLabel = t.type === 'withdraw' ? `${wallet?.name || ''} ← ${toWallet?.name || ''}` : (wallet?.name || '');
        return (
          <View key={t.id} style={styles.txRow}>
            <View style={styles.txMid}>
              <Text style={styles.txTitle}>{t.type === 'expense' ? (cat ? categoryLabel(cat) : 'مصروف') : T.label}</Text>
              <Text style={styles.txSub}>{walletLabel}{t.note ? ' · ' + t.note : ''}</Text>
            </View>
            <View style={styles.txRight}>
              <Text style={[styles.txAmount, { color: T.color }]}>{T.sign}{fmt(t.amount)}</Text>
              <Text style={styles.txDate}>{t.date}{t.createdAt ? ' · ' + formatTime(t.createdAt) : ''}</Text>
            </View>
          </View>
        );
      })}

      <CalendarPickerModal
        visible={pickerFor !== null}
        value={pickerFor === 'from' ? customFrom : customTo}
        onSelect={(d) => { if (pickerFor === 'from') setCustomFrom(d); else setCustomTo(d); }}
        onClose={() => setPickerFor(null)}
      />
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    backText: { color: c.accent, fontSize: 14 },
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    presetRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
    presetBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
    dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    dateBtnText: { color: c.text, fontSize: 12.5, textAlign: 'center' },
    metricRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
    metricCard: { flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border },
    metricLabel: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right' },
    metricValue: { fontSize: 16, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    exportBtn: { backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 13, marginTop: 16 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 22, marginBottom: 6 },
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