import { useNotice } from '@/components/NoticeProvider';
import { Money } from '@/components/Money';
import BackButton from '@/components/BackButton';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import PendingSyncMark from '@/components/PendingSyncMark';
import AutoRecordedMark from '@/components/AutoRecordedMark';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { TYPE_LABELS, transactionAmountColor, addDays, categoryLabelById, endOfMonth, formatTime, startOfMonth, todayStr, transactionWalletLabel, walletHistoryName } from '@/lib/finance';
import { buildFullExportSheets } from '@/lib/fullExport';
import { transactionsPhrase } from '@/lib/archiving';
import { periodPresets } from '@/lib/periodPresets';
import { TRANSFERS_NOTE, cashTotals, transferTransactionIds } from '@/lib/spending';
import { selectionStyle } from '@/lib/selection';
import { MIN_TOUCH } from '@/lib/tokens';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as XLSX from 'xlsx';

type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'all' | 'custom';

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const notice = useNotice();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { transactions, wallets, categories, debts, gamiyas, subscriptions, incomes, budgets, shakhbataIncome, shakhbataPercents, pendingTxIds, serverReachable, allSourcesReady, figuresFromServer } = useData();
  // السلفة والجمعية تحويل مش دخل ولا مصروف (خطوة 8) — في القايمة، مش في الإجماليات
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);

  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

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

  const { income: totalIn, expense: totalOut, transfers: transfersInPeriod } = cashTotals(filtered, transfers);

  async function handleExport() {
    if (filtered.length === 0) return;
    setExporting(true);
    try {
      const rows = filtered.map(t => {
        return {
          Date: t.date,
          Time: formatTime(t.createdAt) || '',
          Type: TYPE_LABELS[t.type]?.label || t.type,
          Wallet: walletHistoryName(wallets, t.walletId),
          ToWallet: t.type === 'withdraw' ? walletHistoryName(wallets, t.toWalletId) : '',
          // من غير أيقونة: عمود الإكسيل المفروض يتفرز ويتفلتر، والإيموجي بيلخبط ده
          Category: categoryLabelById(categories, t.categoryId, { icon: false }),
          Amount: t.amount,
          Note: t.note || '',
        };
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Transactions');
      await saveAndShare(wb, `nuqta-export-${range.from}-to-${range.to}.xlsx`, 'تصدير العمليات');
    } catch (e: any) {
      notice('حصل خطأ في التصدير', String(e?.message || e));
    } finally {
      setExporting(false);
    }
  }

  /** نفس الكتابة والمشاركة للتصديرين — الملف في مجلد التطبيق، والمشاركة لو متاحة */
  async function saveAndShare(wb: XLSX.WorkBook, filename: string, dialogTitle: string) {
    const wbout: string = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const baseDir = ((FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '') as string;
    const uri = `${baseDir}${filename}`;
    await FileSystem.writeAsStringAsync(uri, wbout, { encoding: 'base64' });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle });
    } else {
      notice('اتحفظ الملف', `الملف اتحفظ هنا:\n${uri}`);
    }
  }

  /**
   * التصدير الكامل (`lib/fullExport.ts`): كل اللي متخزّن، ورقة لكل نوع. **بس لما كل البيانات وصلت من السيرفر**
   * (`allSourcesReady` + `figuresFromServer`) — ملف ناقص بيتقري "دي كل بياناتي". من غير كده الزرار مقفول وسطر بيقول ليه.
   */
  const fullExportReady = allSourcesReady && figuresFromServer;
  async function handleFullExport() {
    if (!fullExportReady) return;
    setExportingAll(true);
    try {
      const wb = XLSX.utils.book_new();
      for (const sh of buildFullExportSheets({ wallets, categories, transactions, debts, subscriptions, gamiyas, incomes, budgets, shakhbataIncome, shakhbataPercents })) {
        // ورقة فاضية بعناوين بس مش من غير ولا خلية — عشان الملف يقول "مفيش" مش "ناقص"
        XLSX.utils.book_append_sheet(wb, sh.rows.length ? XLSX.utils.json_to_sheet(sh.rows) : XLSX.utils.aoa_to_sheet([['(فاضي)']]), sh.name);
      }
      await saveAndShare(wb, `nuqta-all-data-${todayStr()}.xlsx`, 'تصدير كل بياناتك');
    } catch (e: any) {
      notice('حصل خطأ في التصدير', String(e?.message || e));
    } finally {
      setExportingAll(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title}>أرشيف العمليات</Text>
      </View>

      <View style={styles.presetRow}>
        {periodPresets(['thisMonth', 'last7', 'lastMonth', 'all', 'custom']).map(p => (
          <TouchableOpacity key={p.key} testID={`archive_preset_${p.key}`} onPress={() => setPreset(p.key as Preset)}
            style={[styles.presetBtn, selectionStyle(colors, preset === p.key)]}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12.5 }}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === 'custom' && (
        <View style={styles.dateRow}>
          <TouchableOpacity testID="archive_date_from" style={styles.dateBtn} onPress={() => setPickerFor('from')}>
            <Text style={styles.dateBtnText}>من: {customFrom}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="archive_date_to" style={styles.dateBtn} onPress={() => setPickerFor('to')}>
            <Text style={styles.dateBtnText}>لحد: {customTo}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>إجمالي الإيرادات</Text>
          <Money value={totalIn} style={[styles.metricValue, { color: colors.incomeText }]} />
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>إجمالي المصروفات</Text>
          <Money value={totalOut} style={[styles.metricValue, { color: colors.expenseText }]} />
        </View>
      </View>
      {transfersInPeriod > 0 && (
        <Text testID="archive_transfers_note" style={styles.transfersNote}>{TRANSFERS_NOTE}</Text>
      )}

      <TouchableOpacity
        testID="archive_export_button"
        style={[styles.exportBtn, { opacity: filtered.length === 0 || exporting ? 0.5 : 1 }]}
        onPress={handleExport}
        disabled={filtered.length === 0 || exporting}>
        {exporting ? <ActivityIndicator color={colors.onAccent} /> : (
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13.5 }}>تصدير إكسيل ({transactionsPhrase(filtered.length)})</Text>
        )}
      </TouchableOpacity>

      {/* كل البيانات (مش الفترة بس): المحافظ والديون والاشتراكات والجمعية والدخل والميزانية والشخبطة */}
      <TouchableOpacity
        testID="archive_full_export_button"
        style={[styles.fullExportBtn, { opacity: !fullExportReady || exportingAll ? 0.5 : 1 }]}
        onPress={handleFullExport}
        disabled={!fullExportReady || exportingAll}
        accessibilityRole="button"
        accessibilityState={{ disabled: !fullExportReady || exportingAll, busy: exportingAll }}
        accessibilityHint="ملف إكسيل فيه كل حاجة متسجلة في حسابك، ورقة لكل نوع">
        {exportingAll ? <ActivityIndicator color={colors.accent} /> : (
          <Text style={styles.fullExportText}>صدّر كل بياناتك (إكسيل)</Text>
        )}
      </TouchableOpacity>
      {!fullExportReady && (
        <Text testID="archive_full_export_wait" style={styles.fullExportWait}>
          مستنيين كل بياناتك توصل من النت عشان الملف ميطلعش ناقص.
        </Text>
      )}

      <Text style={styles.sectionTitle}>العمليات ({filtered.length})</Text>
      {filtered.length === 0 && (
        <Text style={styles.emptyState}>
          {!serverReachable && transactions.length === 0
            ? 'مفيش نت دلوقتي — العمليات مش ضايعة، مستنيين النت عشان نجيبها'
            : 'مفيش عمليات في الفترة دي'}
        </Text>
      )}
      {filtered.map(t => {
        const T = TYPE_LABELS[t.type];
        const catLabel = categoryLabelById(categories, t.categoryId);
        const walletLabel = transactionWalletLabel(t, wallets);
        return (
          // نفس مودال الرئيسية — فيه التسوية والتأكيد والقيود، مفيش مسار تاني.
          // من غير ده العملية اللي نزلت تحت أحدث 10 مالهاش تصليح (بند 14)
          <TouchableOpacity
            key={t.id}
            testID={`archive_tx_${t.id}`}
            style={styles.txRow}
            accessibilityRole="button"
            accessibilityHint="بيفتح العملية عشان تعدّلها أو تمسحها"
            onPress={() => router.push({ pathname: '/modal', params: { id: t.id } })}>
            <View style={styles.txMid}>
              <Text style={styles.txTitle}>{t.type === 'expense' ? (catLabel || 'مصروف') : T.label}</Text>
              <Text style={styles.txSub}>{walletLabel}{t.note ? ' · ' + t.note : ''}</Text>
            </View>
            <View style={styles.txRight}>
              <Money value={t.amount} sign={T.sign} currency={false} style={[styles.txAmount, { color: transactionAmountColor(t.type, colors) }]} />
              <Text style={styles.txDate}>{t.date}{t.createdAt ? ' · ' + formatTime(t.createdAt) : ''}</Text>
              {pendingTxIds.has(t.id) && <PendingSyncMark />}
              {t.autoRecorded && <AutoRecordedMark />}
            </View>
          </TouchableOpacity>
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
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    presetRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
    transfersNote: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: -6, marginBottom: 10 },
    presetBtn: { backgroundColor: c.surface2, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    dateBtnText: { color: c.text, fontSize: 12.5, textAlign: 'center' },
    metricRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
    metricCard: { flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border },
    metricLabel: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right' },
    metricValue: { fontSize: 16, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    exportBtn: { backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 13, marginTop: 16 },
    // تانوي: إطار بلون التطبيق مش زرار مليان — التصدير الأساسي هنا هو الفترة اللي فوق
    fullExportBtn: { borderWidth: 1, borderColor: c.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH, paddingVertical: 11, marginTop: 10 },
    fullExportText: { color: c.accentText, fontWeight: '700', fontSize: 13.5 },
    fullExportWait: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 6 },
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