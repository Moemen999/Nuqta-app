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
import { dateText, dayText } from '@/lib/dateText';
import { TYPE_LABELS, transactionAmountColor, addDays, categoryLabelById, endOfMonth, entryTime, startOfMonth, todayStr, transactionWalletLabel } from '@/lib/finance';
import { buildFullExportSheets, localizeSheets } from '@/lib/fullExport';
import { transactionsPhrase } from '@/lib/archiving';
import { CATEGORY_NAMES_MISSING, TRANSFERS_NOTE, TX_LOAD_ERROR, cashTotals, isTransferTx, transferTransactionIds } from '@/lib/spending';
import { brokenInRange, buildPeriodExportRows, buildPeriodWorkbook, periodExportBlock, periodExportFileName } from '@/lib/periodExport';
import { useReleaseAfterReturn } from '@/lib/useReleaseAfterReturn';
import { EXPORT_FAIL, exportFailure, writeAndShare } from '@/lib/exportFiles';
import { txRowLabel } from '@/lib/txRowLabel';
import { rangeText } from '@/lib/spendTimeline';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { MIN_TOUCH, categoryIconSize, radius, space, typeScale } from '@/lib/tokens';
import { CategoryIcon, CategoryIconSpacer, categoryInlineRow } from '@/components/CategoryIcon';
import { useChartColors } from '@/hooks/use-chart-colors';
import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import CountedText from '@/components/CountedText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as XLSX from 'xlsx';

type Preset = 'thisMonth' | 'last7' | 'lastMonth' | 'all' | 'custom';
const ARCHIVE_PRESETS: Preset[] = ['thisMonth', 'last7', 'lastMonth', 'all', 'custom'];

/** سطر "ليه الزرار مقفول" تحت زرار التصدير الكامل — وهو نفسه الـhint بتاعه لقارئ الشاشة */
export const FULL_EXPORT_WAIT = 'الزرار هيشتغل أول ما النت يرجع — الملف بيتعمل من السيرفر عشان ميطلعش ناقص.';
/** نتيجة التصدير الكامل لما ميكملش — جملة ثابتة مش نص الخطأ الخام */
export const FULL_EXPORT_FAIL: Record<'no-connection' | 'failed', [string, string]> = {
  'no-connection': ['الملف ما اتعملش', 'مفيش نت دلوقتي، والملف لازم يتعمل من السيرفر عشان ميطلعش ناقص. جرّب تاني أول ما النت يرجع.'],
  failed: EXPORT_FAIL.failed,
};
/** زرار تصدير الفترة — الاسم الظاهر ولقارئ الشاشة (بالعدد) */
export const PERIOD_EXPORT_TITLE = 'صدّر عمليات الفترة (إكسيل)';

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const notice = useNotice();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    transactions, wallets, categories, debts, gamiyas, pendingTxIds, serverReachable, readAllFromServer, transfersStatus,
    brokenTransactions = [], figuresPending = [], loadErrors = [], categoriesReady = true,
  } = useData();
  const { categoryColors } = useChartColors();
  // بند 11: الإجماليات مبتظهرش لحد ما الديون والجمعية يوصلوا (السلفة كانت هتتعدّ مصروف والسداد دخل) — **ولا لحد ما
  // العمليات نفسها توصل** (Feature 9 بند 1: نفس شرط الرئيسية؛ قبل كده «0 ج.م» لحد أول snapshot)
  const txPending = figuresPending.includes('transactions');
  const totalsLoading = transfersStatus === 'loading' || txPending;
  // listener العمليات اترفض (بند 2): رسالة مكان الإجماليات و«مفيش عمليات»
  const txError = loadErrors.includes('transactions');
  // تصدير الفترة من اللي على الشاشة ← مقفول لحد ما يوصل كله، وسطر السبب (بند 3)
  const exportBlock = periodExportBlock({ figuresPending, loadErrors, transfersStatus, categoriesReady, serverReachable });
  // اسم الفئة في الصف (الجولة الأخيرة): اترفضت ← «أسامي الفئات ما وصلتش»؛ لسه ← فاضي (العنوان «مصروف») — مش «فئة ممسوحة»
  const categoriesFailed = loadErrors.includes('categories');
  // السلفة والجمعية تحويل مش دخل ولا مصروف (خطوة 8) — في القايمة، مش في الإجماليات
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);

  // «شوف كل العمليات» من الرئيسية بتفتح على "الكل"؛ أي قيمة تانية أو من غير باراميتر ← الشهر ده زي الأول
  const params = useLocalSearchParams<{ preset?: string }>();
  const [preset, setPreset] = useState<Preset>(params.preset === 'all' ? 'all' : 'thisMonth');
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  // المشاركة ممكن ما ترجعش خالص — رجع للتطبيق والزرار لسه بيلف ← بيتفك بعد شوية (الجولة الأخيرة)
  useReleaseAfterReturn(exporting, () => setExporting(false));
  useReleaseAfterReturn(exportingAll, () => setExportingAll(false));

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

  const exportDisabled = filtered.length === 0 || exporting || exportBlock !== null;
  async function handleExport() {
    if (exportDisabled) return;
    setExporting(true);
    AccessibilityInfo.announceForAccessibility('بنجهّز الملف');
    try {
      // الأعمدة بالعربي ومن اليمين للشمال زي التصدير الكامل، ومعاها المعرّف وعلامة التحويل والإشارة و«لسه بترفع» (بند 5)
      const rows = buildPeriodExportRows(filtered, {
        wallets, categories, transfers, transfersFailed: transfersStatus === 'failed', pendingTxIds,
      });
      const wb = buildPeriodWorkbook(rows, brokenInRange(brokenTransactions, range));
      await saveAndShare(wb, periodExportFileName(preset, range, todayStr()), 'تصدير العمليات');
    } catch (e) {
      // نص الخطأ الخام إنجليزي وفيه مسارات — للّوج اسمه بس، والمستخدم جملة ثابتة (بند 3)
      notice(...exportFailure(e, 'period export'));
    } finally {
      setExporting(false);
    }
  }

  /** نفس الكتابة والمشاركة للتصديرين (`lib/exportFiles.ts`): الكاش، والملف بيتمسح بعد المشاركة */
  async function saveAndShare(wb: XLSX.WorkBook, filename: string, dialogTitle: string) {
    const wbout: string = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    await writeAndShare(wbout, filename, dialogTitle);
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
      notice(...exportFailure(e, 'full export'));
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
        <ScreenTitle>أرشيف العمليات</ScreenTitle>
      </View>
      {/* بند B: العمليات اللي مستندها بايظ — فوق الفلاتر عشان تبان مهما كانت الفترة */}
      <BrokenTransactionsSection />

      <PeriodChips keys={ARCHIVE_PRESETS} value={preset} onChange={setPreset} testIDPrefix="archive_preset" bleed={space.xxl} />

      {preset === 'custom' && (
        <View style={styles.dateRow}>
          <TouchableOpacity accessibilityRole="button" testID="archive_date_from" style={styles.dateBtn} onPress={() => setPickerFor('from')}>
            <Text style={styles.dateBtnText}>من: {dateText(customFrom, todayStr())}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="archive_date_to" style={styles.dateBtn} onPress={() => setPickerFor('to')}>
            <Text style={styles.dateBtnText}>لحد: {dateText(customTo, todayStr())}</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* لو «من» بعد «لحد» الفترة بتتقلب لوحدها — السطر ده بيقول الفترة اللي اتطبّقت فعلاً (زي التقارير) */}
      {preset === 'custom' && (
        <Text testID="archive_range" style={styles.rangeText}>{rangeText(range.from, range.to, todayStr())}</Text>
      )}

      {txError ? (
        // العمليات اترفضت: مفيش إجماليات خالص — «0 ج.م» كانت ادّعاء إن مفيش حركة
        <Text testID="archive_tx_error" style={styles.errorText} accessibilityLiveRegion="polite">{TX_LOAD_ERROR}</Text>
      ) : (
        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>إجمالي الإيرادات</Text>
            {totalsLoading ? <SpendLoading testID="archive_income_loading" style={styles.metricLoading} /> : <Money value={totalIn} style={[styles.metricValue, { color: colors.incomeText }]} />}
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>إجمالي المصروفات</Text>
            {totalsLoading ? <SpendLoading announce={false} style={styles.metricValue} /> : <Money value={totalOut} style={[styles.metricValue, { color: colors.expenseText }]} />}
          </View>
        </View>
      )}
      {transfersStatus === 'failed' && !txError && <TransfersFailedNote testID="archive_transfers_failed" />}
      {!totalsLoading && !txError && transfersInPeriod > 0 && (
        <Text testID="archive_transfers_note" style={styles.transfersNote}>{TRANSFERS_NOTE}</Text>
      )}

      <TouchableOpacity accessibilityRole="button"
        testID="archive_export_button"
        style={[styles.exportBtn, { opacity: exportDisabled ? 0.5 : 1 }]}
        onPress={handleExport}
        disabled={exportDisabled}
        // اسم ثابت فيه العدد: وقت التجهيز اللفّافة بتاخد مكان النص (نفس زرار التصدير الكامل — a11y-architect)
        accessibilityLabel={exporting ? 'بنجهّز ملف عمليات الفترة' : `${PERIOD_EXPORT_TITLE}، ${transactionsPhrase(filtered.length)}`}
        accessibilityState={{ disabled: exportDisabled, busy: exporting }}
        accessibilityHint={exportBlock ?? undefined}>
        {exporting ? <ActivityIndicator color={colors.onAccent} /> : (
          <CountedText title={PERIOD_EXPORT_TITLE} count={transactionsPhrase(filtered.length)} style={{ color: colors.onAccent, fontWeight: '700', fontSize: typeScale.body }} />
        )}
      </TouchableOpacity>
      {exportBlock && (
        <Text testID="archive_export_block" style={styles.fullExportWait} accessibilityLiveRegion="polite">{exportBlock}</Text>
      )}

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

      <CountedText title="العمليات" count={filtered.length} style={styles.sectionTitle} boxStyle={styles.sectionTitleBox} accessibilityRole="header" />
    </>
  );
  // الصف `React.memo` و`renderItem` ثابت (performance-optimizer): من غيرهم كل render للشاشة (تاريخ، علامة "بترفع"،
  // زرار التصدير) كان بيعيد رسم كل الصفوف المتركّبة. `extraData` عشان علامة "بترفع" والتحويلات يتحدّثوا
  // `today` من الشاشة (مش جوّه الصف المتمَمّو): لو اليوم اتغيّر والشاشة اتعمللها render، «النهاردة/امبارح» بتتحدّث
  const today = todayStr();
  const renderTx = useCallback(({ item: t }: { item: (typeof filtered)[number] }) => (
    <TxRow
      t={t}
      catLabel={!t.categoryId ? '' : categoriesFailed ? CATEGORY_NAMES_MISSING : !categoriesReady ? '' : categoryLabelById(categories, t.categoryId, { icon: false })}
      catIcon={t.type === 'expense' && t.categoryId ? categories.find(c => c.id === t.categoryId)?.icon : undefined}
      catFound={t.type === 'expense' && !!t.categoryId && categories.some(c => c.id === t.categoryId)}
      catTint={t.categoryId ? categoryColors.get(t.categoryId) : undefined}
      walletLabel={transactionWalletLabel(t, wallets)}
      pending={pendingTxIds.has(t.id)}
      transfer={isTransferTx(t, transfers)}
      today={today}
      styles={styles}
      colors={colors}
    />
  ), [categories, categoriesFailed, categoriesReady, categoryColors, wallets, pendingTxIds, transfers, today, styles, colors]);
  // الصفوف memo: أي تغيير في "بترفع" أو التحويلات (الديون وصلت) لازم يوصلها
  const rowsExtra = useMemo(() => ({ pendingTxIds, transfers, today }), [pendingTxIds, transfers, today]);

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
          txPending && serverReachable ? (
            <SpendLoading announce={false} testID="archive_list_loading" shape="bars" style={styles.emptyState} />
          ) : (
            <Text testID="archive_empty" style={styles.emptyState} accessibilityLiveRegion="polite">
              {txError ? TX_LOAD_ERROR
                : !serverReachable && transactions.length === 0
                ? 'مفيش نت دلوقتي — العمليات مش ضايعة، مستنيين النت عشان نجيبها'
                : preset === 'all' ? 'مفيش عمليات لسه' : 'مفيش عمليات في الفترة دي'}
            </Text>
          )
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
const TxRow = memo(function TxRow({ t, catLabel, catIcon, catFound, catTint, walletLabel, pending, transfer, today, styles, colors }: {
  t: Tx; catLabel: string; catIcon?: string; catFound: boolean; catTint?: string; walletLabel: string; pending: boolean; transfer: boolean; today: string; styles: Styles; colors: ThemeColors;
}) {
  const T = TYPE_LABELS[t.type];
  const title = t.type === 'expense' ? (catLabel || 'مصروف') : T.label;
  const when = [dayText(t.date, today), entryTime(t.date, t.createdAt)].filter(Boolean).join(' ');
  return (
    // نفس مودال الرئيسية — فيه التسوية والتأكيد والقيود، مفيش مسار تاني.
    // من غير ده العملية اللي نزلت تحت أحدث 10 مالهاش تصليح (بند 14)
    <TouchableOpacity
      testID={`archive_tx_${t.id}`}
      style={styles.txRow}
      accessibilityRole="button"
      // عقدة واحدة زي صف الرئيسية (`lib/txRowLabel.ts`) — كان القارئ بيقف على كل نص لوحده
      accessibilityLabel={txRowLabel({ type: t.type, title, walletLabel, note: t.note, amount: t.amount, when, pending, autoRecorded: !!t.autoRecorded, transfer })}
      accessibilityHint="بيفتح العملية عشان تعدّلها أو تمسحها"
      onPress={() => router.push({ pathname: '/modal', params: { id: t.id } })}>
      <View style={styles.txMid}>
        {/* مكان الدايرة محجوز في كل الصفوف — العناوين على نفس الخط (زي الرئيسية) */}
        <View style={categoryInlineRow}>
          {catFound
            ? <CategoryIcon icon={catIcon} size={categoryIconSize.row} tint={catTint} />
            : <CategoryIconSpacer />}
          <Text style={[styles.txTitle, { flexShrink: 1 }]}>{title}</Text>
        </View>
        <Text style={styles.txSub}>{walletLabel}{t.note ? ' · ' + t.note : ''}</Text>
      </View>
      <View style={styles.txRight}>
        <Money value={t.amount} sign={T.sign} currency={false} style={[styles.txAmount, { color: transactionAmountColor(t.type, colors) }]} />
        <Text style={styles.txDate}>{[dayText(t.date, today), entryTime(t.date, t.createdAt)].filter(Boolean).join(' · ')}</Text>
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
    transfersNote: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: -6, marginBottom: 10 },
    dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateBtnText: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    rangeText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.sm },
    errorText: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'right', marginTop: 14 },
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
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right' },
    sectionTitleBox: { marginTop: space.huge, marginBottom: space.xs },
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