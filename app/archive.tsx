import { useNotice } from '@/components/NoticeProvider';
import { Money } from '@/components/Money';
import BackButton from '@/components/BackButton';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import PendingSyncMark from '@/components/PendingSyncMark';
import AutoRecordedMark from '@/components/AutoRecordedMark';
import TransferMark from '@/components/TransferMark';
import { BrokenTransactionsSection } from '@/components/BrokenTransactions';
import { PeriodChips } from '@/components/PeriodChips';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { TYPE_LABELS, transactionAmountColor, addDays, categoryLabelById, endOfMonth, entryTime, startOfMonth, todayStr, transactionWalletLabel, walletHistoryName } from '@/lib/finance';
import { buildFullExportSheets, localizeSheets } from '@/lib/fullExport';
import { transactionsPhrase } from '@/lib/archiving';
import { TRANSFERS_NOTE, cashTotals, transferTransactionIds } from '@/lib/spending';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as XLSX from 'xlsx';

type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'all' | 'custom';
const ARCHIVE_PRESETS: Preset[] = ['thisMonth', 'last7', 'lastMonth', 'all', 'custom'];

/** سطر "ليه الزرار مقفول" تحت زرار التصدير الكامل — وهو نفسه الـhint بتاعه لقارئ الشاشة */
export const FULL_EXPORT_WAIT = 'الزرار هيشتغل أول ما النت يرجع — الملف بيتعمل من السيرفر عشان ميطلعش ناقص.';
/** نتيجة التصدير الكامل لما ميكملش — جملة ثابتة مش نص الخطأ الخام */
export const FULL_EXPORT_FAIL: Record<'no-connection' | 'failed', [string, string]> = {
  'no-connection': ['الملف ما اتعملش', 'مفيش نت دلوقتي، والملف لازم يتعمل من السيرفر عشان ميطلعش ناقص. جرّب تاني أول ما النت يرجع.'],
  failed: ['الملف ما اتعملش', 'حصلت مشكلة وإحنا بنجهّز الملف. جرّب تاني.'],
};

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const notice = useNotice();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { transactions, wallets, categories, debts, gamiyas, pendingTxIds, serverReachable, readAllFromServer, transfersStatus } = useData();
  // بند 11: الإجماليات مبتظهرش لحد ما الديون والجمعية يوصلوا (السلفة كانت هتتعدّ مصروف والسداد دخل)
  const totalsLoading = transfersStatus === 'loading';
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
          Time: entryTime(t.date, t.createdAt),
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
    // الكاش الأول (silent-failure-hunter): الملف فيه بيانات مالية كاملة، والمشاركة بتاخد نسخة — مش لازم يفضل في
    // مجلد التطبيق الدائم (حتى بعد مسح الحساب). ومن غير مجلد خالص ← خطأ صريح مش مسار نسبي ساكت
    const baseDir = ((FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory) as string | undefined;
    if (!baseDir) throw new Error('no-directory');
    const uri = `${baseDir}${filename}`;
    await FileSystem.writeAsStringAsync(uri, wbout, { encoding: 'base64' });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle });
    } else {
      notice('اتحفظ الملف', `الملف اتحفظ هنا:\n${uri}`);
    }
  }

  /**
   * التصدير الكامل (`lib/fullExport.ts`): كل اللي متخزّن، ورقة لكل نوع، **مقري من السيرفر وقت الدوسة**
   * (`readAllFromServer`) مش من اللي على الشاشة — يا الملف كامل يا رسالة صريحة (silent-failure-hunter: حالة الـlisteners
   * ممكن تكون نص من الكاش). من غير نت الزرار مقفول وسطر بيقول ليه.
   */
  const fullExportReady = serverReachable;
  async function handleFullExport() {
    if (!fullExportReady || exportingAll) return;
    setExportingAll(true);
    AccessibilityInfo.announceForAccessibility('بنجهّز الملف');
    // الرسمة الأولى (اللفّافة) قبل الشغل المتزامن التقيل — في حساب كبير الشاشة كانت بتتجمّد من غير مؤشر
    await new Promise(r => setTimeout(r, 0));
    try {
      const read = await readAllFromServer();
      if (read.outcome !== 'done') {
        notice(...FULL_EXPORT_FAIL[read.outcome]);
        return;
      }
      const wb = XLSX.utils.book_new();
      // أسامي الأوراق والأعمدة بالعربي والقيم خام (قرار مؤمن + بحث 2026-11-03)
      for (const sh of localizeSheets(buildFullExportSheets(read.data))) {
        // ورقة فيها سطر واحد صريح مش ورقة من غير ولا خلية — عشان الملف يقول "مفيش" مش "ناقص"
        XLSX.utils.book_append_sheet(wb, sh.rows.length ? XLSX.utils.json_to_sheet(sh.rows) : XLSX.utils.aoa_to_sheet([['(مفيش بيانات)']]), sh.name);
      }
      // الأوراق من اليمين للشمال (اتجرّب: SheetJS بيكتب sheetView rightToLeft="1")
      wb.Workbook = { ...(wb.Workbook ?? {}), Views: [{ RTL: true }] };
      await saveAndShare(wb, `nuqta-all-data-${todayStr()}.xlsx`, 'تصدير كل بياناتك');
    } catch (e) {
      // نص الخطأ الخام إنجليزي وفيه مسارات — للّوج (اسمه بس)، والمستخدم جملة ثابتة (arabic-copy + silent-failure)
      console.warn('[export] full export failed', e instanceof Error ? e.name : 'unknown');
      notice(...FULL_EXPORT_FAIL.failed);
    } finally {
      setExportingAll(false);
    }
  }

  // بند C (مراجعة المشروع 2026-11-05): `FlatList` بدل `ScrollView` + `map` — "الكل" على 5000 عملية كان بيركّب كل
  // الصفوف مرة واحدة. الهيدر (الفترة والإجماليات والتصدير) هو `ListHeaderComponent`، والصف نفسه زي ما هو
  const header = (
    <>
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title}>أرشيف العمليات</Text>
      </View>
      {/* بند B: العمليات اللي مستندها بايظ — فوق الفلاتر عشان تبان مهما كانت الفترة */}
      <BrokenTransactionsSection />

      <PeriodChips keys={ARCHIVE_PRESETS} value={preset} onChange={setPreset} testIDPrefix="archive_preset" />

      {preset === 'custom' && (
        <View style={styles.dateRow}>
          <TouchableOpacity accessibilityRole="button" testID="archive_date_from" style={styles.dateBtn} onPress={() => setPickerFor('from')}>
            <Text style={styles.dateBtnText}>من: {customFrom}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="archive_date_to" style={styles.dateBtn} onPress={() => setPickerFor('to')}>
            <Text style={styles.dateBtnText}>لحد: {customTo}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>إجمالي الإيرادات</Text>
          {totalsLoading ? <SpendLoading testID="archive_income_loading" style={styles.metricLoading} /> : <Money value={totalIn} style={[styles.metricValue, { color: colors.incomeText }]} />}
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>إجمالي المصروفات</Text>
          {totalsLoading ? <SpendLoading style={styles.metricValue} /> : <Money value={totalOut} style={[styles.metricValue, { color: colors.expenseText }]} />}
        </View>
      </View>
      {transfersStatus === 'failed' && <TransfersFailedNote testID="archive_transfers_failed" />}
      {!totalsLoading && transfersInPeriod > 0 && (
        <Text testID="archive_transfers_note" style={styles.transfersNote}>{TRANSFERS_NOTE}</Text>
      )}

      <TouchableOpacity accessibilityRole="button"
        testID="archive_export_button"
        style={[styles.exportBtn, { opacity: filtered.length === 0 || exporting ? 0.5 : 1 }]}
        onPress={handleExport}
        disabled={filtered.length === 0 || exporting}>
        {exporting ? <ActivityIndicator color={colors.onAccent} /> : (
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: typeScale.body }}>تصدير إكسيل ({transactionsPhrase(filtered.length)})</Text>
        )}
      </TouchableOpacity>

      {/* كل البيانات (مش الفترة بس): المحافظ والديون والاشتراكات والجمعية والدخل والميزانية والشخبطة */}
      <TouchableOpacity
        testID="archive_full_export_button"
        style={[styles.fullExportBtn, { opacity: !fullExportReady || exportingAll ? 0.5 : 1 }]}
        onPress={handleFullExport}
        disabled={!fullExportReady || exportingAll}
        accessibilityRole="button"
        // اسم ثابت: وقت التحميل اللفّافة بتاخد مكان النص، والزرار كان من غير اسم لقارئ الشاشة (a11y-architect BLOCKER)
        accessibilityLabel={exportingAll ? 'بنجهّز ملف كل بياناتك' : 'صدّر كل بياناتك (إكسيل)'}
        accessibilityState={{ disabled: !fullExportReady || exportingAll, busy: exportingAll }}
        accessibilityHint={fullExportReady ? 'هيطلع ملف إكسيل فيه كل حاجة متسجلة في حسابك، في ورقة لكل نوع' : FULL_EXPORT_WAIT}>
        {exportingAll ? <ActivityIndicator color={colors.accent} /> : (
          <Text style={styles.fullExportText}>صدّر كل بياناتك (إكسيل)</Text>
        )}
      </TouchableOpacity>
      {!fullExportReady && (
        <Text testID="archive_full_export_wait" style={styles.fullExportWait} accessibilityLiveRegion="polite">
          {FULL_EXPORT_WAIT}
        </Text>
      )}

      <Text style={styles.sectionTitle}>العمليات ({filtered.length})</Text>
    </>
  );
  // الصف `React.memo` و`renderItem` ثابت (performance-optimizer): من غيرهم كل render للشاشة (تاريخ، علامة "بترفع"،
  // زرار التصدير) كان بيعيد رسم كل الصفوف المتركّبة. `extraData` عشان علامة "بترفع" والتحويلات يتحدّثوا
  const renderTx = useCallback(({ item: t }: { item: (typeof filtered)[number] }) => (
    <TxRow
      t={t}
      catLabel={categoryLabelById(categories, t.categoryId)}
      walletLabel={transactionWalletLabel(t, wallets)}
      pending={pendingTxIds.has(t.id)}
      transfer={transfers.has(t.id)}
      styles={styles}
      colors={colors}
    />
  ), [categories, wallets, pendingTxIds, transfers, styles, colors]);
  // الصفوف memo: أي تغيير في "بترفع" أو التحويلات (الديون وصلت) لازم يوصلها
  const rowsExtra = useMemo(() => ({ pendingTxIds, transfers }), [pendingTxIds, transfers]);

  return (
    <View style={styles.container}>
      <FlatList
        testID="archive_list"
        data={filtered}
        keyExtractor={t => t.id}
        renderItem={renderTx}
        extraData={rowsExtra}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={styles.emptyState}>
            {!serverReachable && transactions.length === 0
              ? 'مفيش نت دلوقتي — العمليات مش ضايعة، مستنيين النت عشان نجيبها'
              : 'مفيش عمليات في الفترة دي'}
          </Text>
        }
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={20}
        windowSize={7}
      />
      <CalendarPickerModal
        visible={pickerFor !== null}
        value={pickerFor === 'from' ? customFrom : customTo}
        onSelect={(d) => { if (pickerFor === 'from') setCustomFrom(d); else setCustomTo(d); }}
        onClose={() => setPickerFor(null)}
      />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;
type Tx = ReturnType<typeof useData>['transactions'][number];

/** صف عملية في الأرشيف — نفس الشكل والمودال اللي قبل `FlatList` بالظبط */
const TxRow = memo(function TxRow({ t, catLabel, walletLabel, pending, transfer, styles, colors }: {
  t: Tx; catLabel: string; walletLabel: string; pending: boolean; transfer: boolean; styles: Styles; colors: ThemeColors;
}) {
  const T = TYPE_LABELS[t.type];
  return (
    // نفس مودال الرئيسية — فيه التسوية والتأكيد والقيود، مفيش مسار تاني.
    // من غير ده العملية اللي نزلت تحت أحدث 10 مالهاش تصليح (بند 14)
    <TouchableOpacity
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
        <Text style={styles.txDate}>{t.date}{entryTime(t.date, t.createdAt) ? ' · ' + entryTime(t.date, t.createdAt) : ''}</Text>
        {pending && <PendingSyncMark />}
        {t.autoRecorded && <AutoRecordedMark />}
        {transfer && <TransferMark />}
      </View>
    </TouchableOpacity>
  );
});

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxl, paddingBottom: space.huge * 2 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700' },
    transfersNote: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: -6, marginBottom: 10 },
    dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateBtnText: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    metricRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
    // دراسة الشكل خطوة 5: من غير إطارات، المقاسات من `typeScale`
    metricCard: { flex: 1, backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg },
    metricLabel: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right' },
    metricLoading: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    metricValue: { fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: 4 },
    exportBtn: { backgroundColor: c.accent, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH + space.xxs, marginTop: space.xxl },
    // تانوي: إطار بلون التطبيق مش زرار مليان — التصدير الأساسي هنا هو الفترة اللي فوق
    fullExportBtn: { borderWidth: 1.5, borderColor: c.accent, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH, marginTop: space.md },
    fullExportText: { color: c.accentText, fontWeight: '700', fontSize: typeScale.body },
    fullExportWait: { color: c.textSecondary, fontSize: typeScale.caption, lineHeight: 18, textAlign: 'right', marginTop: 6 },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: space.huge, marginBottom: space.xs },
    emptyState: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', paddingVertical: 20 },
    // من غير خطوط بين الصفوف زي الرئيسية (المسافة بتفصل) — كارت واحد مش مناسب لـFlatList متقطّعة
    txRow: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: space.md, minHeight: MIN_TOUCH },
    txMid: { flex: 1 },
    txTitle: { color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right' },
    txSub: { color: c.textSecondary, fontSize: typeScale.caption, marginTop: 2, textAlign: 'right' },
    txRight: { alignItems: 'flex-start' },
    txAmount: { fontSize: typeScale.body, fontWeight: '700' },
    txDate: { color: c.textMuted, fontSize: typeScale.caption, marginTop: 2 },
  });
}