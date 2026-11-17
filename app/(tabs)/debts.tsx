import { SegmentedControl } from '@/components/SegmentedControl';
import { dayText } from '@/lib/dateText';
import { DUE_NOT_RESTORED, dueDateLabel } from '@/lib/reopenDue';
import FoldedSection from '@/components/FoldedSection';
import { debtHasPendingEntry, isDebtSettled, splitDone } from '@/lib/doneSections';
import { Money } from '@/components/Money';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { usePrivacy } from '@/context/PrivacyContext';
import { plainAmount, type AmountFormatter } from '@/lib/money';
import ContactPickerModal from '@/components/ContactPickerModal';
import { AddDebtModal, DebtIncreaseModal, DebtPaymentModal } from '@/components/DebtEntryModals';
import DebtReminderFields from '@/components/DebtReminderFields';
import { useDeviceContacts } from '@/components/useDeviceContacts';
import GamiyaView from '@/components/GamiyaView';
import SubscriptionsView from '@/components/SubscriptionsView';
import { LineIcon } from '@/components/LineIcon';
import { EmptyHint } from '@/components/EmptyHint';
import { DEBT_ENTRY_DELETE_ALERT, useData, type Debt, type DebtIncreaseDeleteOut } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { cascadeDeleteBlock, cascadeDeleteConfirm, debtsPhrase, debtTransactionIds, installmentsPhrase, linkedTransactions } from '@/lib/archiving';
import { phoneForDisplay } from '@/lib/contacts';
import {
  categoryLabelById, debtEntryArchivedWalletBlock, debtEntryDeleteMessage, debtEntryDeletePlan, debtGrandTotal, debtPaid, debtPaidLabel, groupDebtsByPerson,
  INSTALLMENT_COUNT_NOT_SAVED, installmentCountEditRefusal, storableCount, installmentProgressLabel, installmentValue,
  reverseDebtPrefill, walletHistoryName, todayStr, type DebtEntryKind } from '@/lib/finance';
import { cardElevation, MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle, typeScale } from '@/lib/tokens';
import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { BUSY_NOTICE, useBusy, useBusyKey } from '@/lib/useBusy';
import * as Contacts from 'expo-contacts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button } from '@/components/Button';
import { Text, TextInput } from '@/components/AppText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '@/lib/textLimits';

/**
 * "القسط 3 من 6 · 1,000 ج.م" — الرقم اللي المستخدم محتاجه على الكارت.
 *
 * قبل كده كان "أقساط (6)" وبس: عدد مجرّد مبيقولش القسط بكام ولا إحنا فين
 * منه. والعدد ده كان **مالوش أي أثر** أصلاً — الدين بستة أقساط كان بيتصرّف
 * زي اللي بأربعة وعشرين بالظبط.
 */
function installmentSummary(d: Debt, money: AmountFormatter) {
  const progress = installmentProgressLabel(d);
  const value = installmentValue(d);
  const valueText = value ? `${money(value)} ج.م` : null;
  if (progress && valueText) return `${progress} · ${valueText}`;
  if (progress) return progress;
  return d.installmentCount ? installmentsPhrase(d.installmentCount) : 'أقساط';
}

export const INSTALLMENT_COUNT_INVALID = 'عدد الأقساط لازم يكون رقم صحيح أكبر من صفر.';

/**
 * فوق وتحت ٢ بس: السطور بينها ٤ (paddingVertical ٢ لكل سطر)، فأي أكبر من كده
 * كان هيخلي دوسة بين سطرين تمسح دفعة السطر التاني. ٣٦ طول × ٤٤ عرض.
 */
const ENTRY_DELETE_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

function debtDate(d: Debt) {
  return d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '0000-00-00');
}

type Tab = 'debts' | 'subscriptions' | 'gamiya';
const isTab = (v: unknown): v is Tab => v === 'debts' || v === 'subscriptions' || v === 'gamiya';

export default function DebtsTabScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // `tab` جاي من الدوس على إشعار (lib/notificationRoute.ts)، و`at` عشان الدوسة التانية على نفس التاب تتنفّذ
  const params = useLocalSearchParams<{ tab?: string; at?: string }>();
  const [tab, setTab] = useState<Tab>(isTab(params.tab) ? params.tab : 'debts');
  useEffect(() => {
    if (isTab(params.tab)) setTab(params.tab);
  }, [params.tab, params.at]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {/* tablist + tab بحالة (بند E) جوّه المكوّن المشترك — نفس التخطيط (دراسة الشكل) */}
      <SegmentedControl style={styles.switcher} value={tab} onChange={setTab} segments={[
        { key: 'debts', label: 'الديون', testID: 'debts_tab_debts' },
        { key: 'subscriptions', label: 'الاشتراكات', testID: 'debts_tab_subscriptions' },
        { key: 'gamiya', label: 'الجمعية', testID: 'debts_tab_gamiya' },
      ]} />

      {tab === 'debts' && <DebtsContent />}
      {tab === 'subscriptions' && <SubscriptionsView />}
      {tab === 'gamiya' && <GamiyaView />}
    </View>
  );
}

function DebtsContent() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { debts, wallets, categories, transactions, loadErrors, figuresPending, pendingTxIds, deleteDebt, deleteDebtPayment, deleteDebtIncrease } = useData();
  const notice = useNotice();
  // دوسة اتسقطت عشان عملية تانية شغالة ← بتتقال (مش بتختفي)
  const onBusy = () => notice(BUSY_NOTICE.title, BUSY_NOTICE.body);
  const confirm = useConfirm();
  const { money, amountsHidden } = usePrivacy();
  // مفتاح الشخص لكل دين — كشف الحساب بيتفتح بيه مش بالاسم
  const personKeyByDebt = useMemo(() => {
    const map = new Map<string, string>();
    groupDebtsByPerson(debts).forEach(g => g.debts.forEach(d => map.set(d.id, g.key)));
    return map;
  }, [debts]);
  const { busyKey, run: runBusy } = useBusyKey(onBusy);

  const [showAddDebt, setShowAddDebt] = useState(false);
  const [paymentForDebt, setPaymentForDebt] = useState<Debt | null>(null);
  const [increaseForDebt, setIncreaseForDebt] = useState<Debt | null>(null);
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [reverseForDebt, setReverseForDebt] = useState<Debt | null>(null);
  // المعرّف بس — الدين نفسه بيتقري حي من `debts` (react-reviewer: نسخة متخزّنة كانت بتبقى قديمة لو اتعدّل/اتمسح والقايمة مفتوحة)
  const [menuDebtId, setMenuDebtId] = useState<string | null>(null);
  const moreRefs = useRef(new Map<string, View | null>());
  const menuReturnFocus = useRef<View | null>(null);
  const [expandedDebt, setExpandedDebt] = useState<string | null>(null);

  const owedToMe = debts.filter(d => d.direction === 'owed_to_me');
  const iOwe = debts.filter(d => d.direction === 'i_owe');
  // أقسام "اتسددت" المطوية (2026-11-02): محسوبة، والإجماليات تحت من القوايم الكاملة زي ما هي
  // دفعة أو زيادة لسه بترفع ← الدين يفضل باين (silent-failure-hunter): لو اترفضت، كان هيبان
  // "متسدد" ومطوي والمستخدم مش شايفه
  const isFolded = (d: Debt) => isDebtSettled(d) && !debtHasPendingEntry(d, pendingTxIds);
  const owedSplit = splitDone(owedToMe, isFolded);
  const iOweSplit = splitDone(iOwe, isFolded);

  function remainingOf(d: Debt) {
    return debtGrandTotal(d) - debtPaid(d);
  }

  // المتسدد (بنفس تعريف الكارت) صفر في الإجمالي، مش باقي الكسور
  const openRemaining = (d: Debt) => (isDebtSettled(d) ? 0 : Math.max(0, remainingOf(d)));
  const totalOwedToMe = owedToMe.reduce((s, d) => s + openRemaining(d), 0);
  const totalIOwe = iOwe.reduce((s, d) => s + openRemaining(d), 0);

  /**
   * المسح بيشيل كل عمليات الدين ومبيعملش تسوية، فلو واحدة منهم على محفظة
   * مؤرشفة بنقول قبل التأكيد (`cascadeDeleteBlock`). `deleteDebt` بيفحص تاني
   * لحظة الدوسة، ورسالته بتظهر لو اتمنع هناك.
   */
  function confirmDeleteDebt(d: Debt) {
    const txIds = debtTransactionIds(d);
    const blocked = cascadeDeleteBlock({ kind: 'debt', name: d.personName, txIds, transactions, wallets, loadErrors, loading: figuresPending });
    if (blocked) { notice(blocked.title, blocked.body); return; }
    const { title, body } = cascadeDeleteConfirm('debt', d.personName, linkedTransactions(txIds, transactions).length);
    confirm(title, body, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'امسحه', style: 'destructive', onPress: () => runBusy(d.id, async () => {
          const result = await deleteDebt(d.id);
          if (result.outcome === 'blocked') notice(result.title, result.body);
        }),
      },
    ]);
  }

  /**
   * التأكيد بيقول قبل الدوسة: المبلغ، الشخص، العدد لو هيتحرك، والفلوس رايحة
   * فين (`debtEntryDeletePlan`). الرقم حقيقي حتى لو المبالغ مخفية — ده تأكيد
   * قبل كتابة. المسح ذري بيقرا من السيرفر، فالزرار بيلف لحد النتيجة القاطعة.
   */
  function confirmDeleteEntry(d: Debt, kind: DebtEntryKind, entryId: string) {
    const plan = debtEntryDeletePlan(d, kind, entryId);
    if (!plan) return;
    const blocked = debtEntryArchivedWalletBlock(kind, plan, wallets);
    if (blocked) { notice(blocked.title, blocked.body); return; }
    const walletName = plan.walletId ? walletHistoryName(wallets, plan.walletId) : '';
    const { title, body } = debtEntryDeleteMessage(d, kind, plan, walletName, plainAmount);
    confirm(title, body, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'امسح',
        style: 'destructive',
        onPress: () => runBusy(entryId, async () => {
          const out: DebtIncreaseDeleteOut = {};
          const outcome = kind === 'payment' ? await deleteDebtPayment(d.id, entryId) : await deleteDebtIncrease(d.id, entryId, out);
          if (outcome !== 'done') {
            notice(DEBT_ENTRY_DELETE_ALERT[outcome].title, DEBT_ENTRY_DELETE_ALERT[outcome].body);
            return;
          }
          // التأكيد وعد إن المعاد هيرجع والذرة (من السيرفر) ما رجّعتوش ← بنقول، مش بنسيب الوعد ساكت (بند 12)
          if (kind === 'increase' && plan.dueRestore && !out.entryGone && out.dueRestored !== plan.dueRestore) {
            notice(DUE_NOT_RESTORED.title, DUE_NOT_RESTORED.body);
          }
          // السطر بيختفي من غير أي صوت — قارئ الشاشة مش بيعلن عن عنصر اتشال
          AccessibilityInfo.announceForAccessibility(kind === 'payment' ? 'اتمسحت الدفعة' : 'اتمسحت الزيادة');
        }),
      },
    ]);
  }

  /**
   * بيفتح كارت جهة الاتصال للعرض (مش للتعديل).
   *
   * كنا بننادي presentFormAsync لوحدها، ودي بتفتح شاشة "تعديل جهة الاتصال"
   * — المستخدم بيلاقي نفسه في فورم تعديل وهو بس عايز يشوف الرقم:
   * - على iOS: الدالة بتفتح CNContactViewController، وهو افتراضيًا بيسمح
   *   بالتعديل. بنقفل allowsEditing فبيبقى كارت عرض عادي.
   * - على أندرويد: الدالة بتبعت Intent ACTION_EDIT وبتتجاهل formOptions
   *   خالص، فمفيش طريقة تخليها تعرض بس. بنفتح شاشة العرض بنفسنا بـ
   *   ACTION_VIEW على لينك جهة الاتصال (الـ id اللي محفوظ عندنا هو نفسه
   *   Contacts._ID بتاع النظام).
   */
  async function openContactCard(d: Debt) {
    if (d.personContactId) {
      try {
        if (Platform.OS === 'android') {
          await Linking.openURL(`content://com.android.contacts/contacts/${d.personContactId}`);
        } else {
          await Contacts.presentFormAsync(d.personContactId, null, {
            allowsEditing: false,
            allowsActions: true,
          });
        }
        return;
      } catch (e) {
        // الكارت مفتحش (جهة اتصال اتمسحت مثلاً). كود الخطأ بس في اللوج — مفيش اسم ولا رقم (sentryScrub)
        console.warn('[contacts] contact card failed', (e as { code?: string })?.code ?? 'unknown');
        // قبل ما نروح للرقم بنقول ليه — من غيرها المستخدم بيلاقي شاشة الاتصال قدامه من غير سبب
        if (d.personPhone) {
          const phone = d.personPhone;
          notice('مقدرناش نفتح الكارت', 'جهة الاتصال دي مش بتتفتح من هنا، يمكن اتمسحت من الموبايل.', () => {
            Linking.openURL(`tel:${phone}`).catch(() => notice('مقدرتش أفتح', 'مقدرتش أفتح جهة الاتصال دي.'));
          });
          return;
        }
        notice('مقدرناش نفتح الكارت', 'جهة الاتصال دي مش بتتفتح من هنا، يمكن اتمسحت من الموبايل.');
        return;
      }
    }
    if (d.personPhone) {
      Linking.openURL(`tel:${d.personPhone}`).catch(() => {
        notice('مقدرتش أفتح', 'مقدرتش أفتح جهة الاتصال دي.');
      });
      return;
    }
    notice('مقدرتش أفتح', 'مقدرتش أفتح جهة الاتصال دي.');
  }

  // مرة واحدة للشاشة (react-reviewer): كل الكروت بنفس "النهارده"
  const today = todayStr();

  function renderDebt(d: Debt) {
    const grandTotal = debtGrandTotal(d);
    const paid = debtPaid(d);
    const remaining = grandTotal - paid;
    const pct = grandTotal > 0 ? Math.min(100, (paid / grandTotal) * 100) : 0;
    const settled = isDebtSettled(d);
    // دراسة الشكل خطوة 3 (ب): **الأحمر = متأخر بس، والأخضر = اتسدد بس** — قبل كده الأحمر كان على "عليا" حتى لو مش متأخر.
    // الاتجاه بيقوله القسم اللي الكارت فيه. الشريط عنصر (3:1)، والنص بتوكنز النص (4.5)
    const overdue = !settled && !!d.dueDate && d.dueDate < today;
    // الشريط بتوكنز النص (≥ 4.5 على المسار في الثيمين) — `accent`/`success` كانوا 1.8 و2.65 على المسار في الفاتح
    const color = settled ? colors.incomeText : overdue ? colors.dangerText : colors.accentText;
    const textColor = settled ? colors.incomeText : overdue ? colors.dangerText : colors.text;
    const expanded = expandedDebt === d.id;
    // جملة واحدة للكارت المقفول: القارئ بيجمع اللي جواه، فالنسبة والمتأخر والتذكير لازم يتقالوا بالكلام (مش بشريط ولا 🔔)
    const cardLabel = [
      d.personName,
      settled ? 'اتسدد بالكامل' : amountsHidden ? 'المتبقي مخفي' : `المتبقي ${money(remaining)} ج.م`,
      `اتسدد ${Math.round(pct)}% من الدين`,
      overdue ? 'متأخر' : '',
      !!d.dueDate && !settled ? `معاده ${dueDateLabel(d.dueDate, today)}` : '',
      !!d.dueDate && !settled && d.reminderDaysBefore !== undefined ? 'فيه تذكير' : '',
    ].filter(Boolean).join('، ');

    const timeline = [
      { kind: 'initial' as const, date: debtDate(d), amount: d.totalAmount, walletId: d.initialWalletId },
      ...(d.increases || []).map(e => ({ kind: 'increase' as const, ...e })),
      ...d.payments.map(p => ({ kind: 'payment' as const, ...p })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    return (
      <View key={d.id} style={styles.debtCard}>
        {/* الكارت بيتفتح ويتقفل: القارئ بيقول الحالة. وزرار جهة الاتصال جوّاه مبيوصلوش TalkBack (الأب بيجمع اللي جواه)، فهو
            "إجراء" على الكارت نفسه (a11y-architect جولة 2) */}
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }}
          accessibilityLabel={cardLabel}
          accessibilityActions={(d.personContactId || d.personPhone) ? [{ name: 'openContact', label: `افتح كارت ${d.personName}` }] : undefined}
          onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'openContact') openContactCard(d); }}
          onPress={() => setExpandedDebt(expanded ? null : d.id)}>
          <View style={styles.debtHead}>
            <View style={styles.personBlock}>
              {(d.personContactId || d.personPhone) ? (
                <TouchableOpacity hitSlop={{ top: 12, bottom: 12 }} accessibilityRole="link" accessibilityLabel={`افتح كارت ${d.personName}`} accessibilityHint="افتح كارت جهة الاتصال" onPress={() => openContactCard(d)}>
                  <View style={styles.personLinkRow}>
                    <Text style={[styles.personName, styles.personNameLink, { flexShrink: 1 }]}>{d.personName}</Text>
                    <LineIcon name="person-circle-outline" size={16} color={colors.accentText} />
                  </View>
                </TouchableOpacity>
              ) : (
                <Text style={styles.personName}>{d.personName}</Text>
              )}
            </View>
            <Text style={[styles.remainingText, { color: textColor }]}>
              {settled ? 'اتسدد بالكامل' : <Money value={remaining} />}
            </Text>
          </View>
          {/* الكارت المقفول: الاسم والمبلغ وشريط رفيع وسطر واحد (دراسة الشكل). الرقم والملاحظة جوّه المفتوح */}
          <View style={styles.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
          </View>
          <Text style={[styles.progressText, overdue && { color: colors.dangerText }]} numberOfLines={2}>
            {/* «متأخر» أول السطر: هو الإشارة الوحيدة غير اللون، ومينفعش يتقص في الآخر (visual-identity-reviewer) */}
            {overdue ? 'متأخر — ' : ''}{debtPaidLabel(d, money)}
            {!!d.dueDate && !settled ? ` · معاده ${dueDateLabel(d.dueDate, today)}${d.reminderDaysBefore !== undefined ? ' · فيه تذكير' : ''}` : ''}
          </Text>
        </TouchableOpacity>

        {expanded && (
          <View style={styles.expandedArea}>
            {/* الرقم كان بيبان في شاشة الاختيار وبس — هنا في المفتوح */}
            {!!d.personPhone && <Text style={styles.personPhone} numberOfLines={1}>{phoneForDisplay(d.personPhone)}</Text>}
            {d.note ? <Text style={styles.noteText}>{d.note}</Text> : null}
            <Text style={styles.dueText}>{d.isInstallment ? installmentSummary(d, money) : 'مبلغ واحد'}</Text>
            <View style={styles.paymentsList}>
              {timeline.map(t => {
                // المحفظة/الفئة الممسوحة بتطلع باسم صريح بدل ما الشريحة تختفي
                // خالص — الدفعة خرجت من مكان ما، وإخفاء المكان بيخلي السطر ناقص
                const wLabel = 'walletId' in t && t.walletId ? walletHistoryName(wallets, t.walletId) : '';
                const cLabel = 'categoryId' in t && t.categoryId ? categoryLabelById(categories, t.categoryId) : '';
                const label = t.kind === 'initial' ? 'المبلغ الأساسي' : t.kind === 'increase' ? 'زيادة' : 'دفعة';
                const sign = t.kind === 'payment' ? '−' : '+';
                const lineColor = t.kind === 'payment' ? colors.incomeText : colors.textSecondary;
                const entryBusy = t.kind !== 'initial' && busyKey === t.id;
                return (
                  <View key={t.kind === 'initial' ? 'initial' : `${t.kind}-${t.id}`} style={styles.paymentRow}>
                    <Text style={[styles.paymentText, { color: lineColor }]}>
                      {label} <Money value={t.amount} sign={sign} />{wLabel ? ' · ' + wLabel : ''}{cLabel ? ' · ' + cLabel : ''}
                    </Text>
                    <View style={styles.paymentMeta}>
                      <Text style={styles.paymentDate}>{dayText(t.date, today)}</Text>
                      {t.kind !== 'initial' && (
                        <TouchableOpacity
                          testID={`debt_entry_delete_${t.id}`}
                          style={styles.entryDeleteBtn}
                          hitSlop={ENTRY_DELETE_SLOP}
                          disabled={busyKey !== null}
                          onPress={() => confirmDeleteEntry(d, t.kind, t.id)}
                          accessibilityRole="button"
                          // بالتاريخ عشان السطور متتشابهش في الودن، والمبلغ بس لو مش مخفي
                          accessibilityLabel={`امسح ${t.kind === 'payment' ? 'الدفعة' : 'الزيادة'} بتاعة ${dayText(t.date, today)}${amountsHidden ? '' : `، ${money(t.amount)} ج.م`}`}
                          accessibilityState={{ busy: entryBusy, disabled: busyKey !== null }}>
                          {entryBusy
                            ? <ActivityIndicator size="small" color={colors.danger} />
                            : <LineIcon name="trash-outline" size={18} color={colors.textMuted} />}
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
            {/* دراسة الشكل خطوة 3 (قرار مؤمن 2026-11-06): زرار أساسي واحد، والباقي في "⋯" — كانوا 6 بنفس الشكل و"حذف" جنبهم.
                كشف الحساب كان مدفون في التقارير — مكانه هنا (جوه "⋯")؛ "سجّل فلوس ليه/ليا" بيعبّي مودال الدين الجديد باسمه
                (reverseDebtPrefill) عشان يقع في نفس مجموعته في كشف الحساب */}
            <View style={styles.actionsRow}>
              {!settled && (
                <TouchableOpacity accessibilityRole="button" testID={`debt_pay_${d.id}`} style={styles.payBtn} onPress={() => setPaymentForDebt(d)}>
                  <Text style={styles.payBtnText}>تسجيل دفعة</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity accessibilityRole="button" testID={`debt_more_${d.id}`} accessibilityLabel={`باقي الاختيارات لدين ${d.personName}`}
                disabled={busyKey === d.id} accessibilityState={{ disabled: busyKey === d.id, busy: busyKey === d.id }}
                accessibilityHint="بيفتح قايمة" ref={el => { moreRefs.current.set(d.id, el); }}
                style={[styles.moreBtn, busyKey === d.id && styles.btnBusy]} onPress={() => { menuReturnFocus.current = moreRefs.current.get(d.id) ?? null; setMenuDebtId(d.id); }}>
                <Text style={styles.moreBtnText} importantForAccessibility="no">{busyKey === d.id ? '...' : '⋯'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scrollArea}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <View style={styles.titleRow}>
        <Button testID="debt_add_button" size="sm" label="+ دين جديد" onPress={() => setShowAddDebt(true)} />
        <ScreenTitle>الديون والأقساط</ScreenTitle>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>ليا (متبقي)</Text>
          <Money value={totalOwedToMe} style={[styles.summaryValue, { color: colors.incomeText }]} />
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>عليا (متبقي)</Text>
          <Money value={totalIOwe} style={[styles.summaryValue, { color: colors.dangerText }]} />
        </View>
      </View>

      <Text style={styles.sectionTitle}>فلوس ليا</Text>
      {owedSplit.active.length === 0 && <EmptyHint testID="debts_owed_empty" icon="arrow-down-circle-outline" message="مفيش حد مديون ليك دلوقتي" />}
      {owedSplit.active.map(renderDebt)}
      <FoldedSection testID="debts_settled_owed" title="ديون اتسددت" a11yLabel={`ديون اتسددت من فلوس ليا، ${debtsPhrase(owedSplit.done.length)}`} count={owedSplit.done.length}>
        {owedSplit.done.map(renderDebt)}
      </FoldedSection>

      <Text style={styles.sectionTitle}>فلوس عليا</Text>
      {iOweSplit.active.length === 0 && <EmptyHint testID="debts_iowe_empty" icon="arrow-up-circle-outline" message="مفيش عليك ديون دلوقتي" />}
      {iOweSplit.active.map(renderDebt)}
      <FoldedSection testID="debts_settled_iowe" title="ديون اتسددت" a11yLabel={`ديون اتسددت من فلوس عليا، ${debtsPhrase(iOweSplit.done.length)}`} count={iOweSplit.done.length}>
        {iOweSplit.done.map(renderDebt)}
      </FoldedSection>

      {showAddDebt && <AddDebtModal onClose={() => setShowAddDebt(false)} />}
      {paymentForDebt && <DebtPaymentModal debtId={paymentForDebt.id} onClose={() => setPaymentForDebt(null)} />}
      {increaseForDebt && <DebtIncreaseModal debtId={increaseForDebt.id} onClose={() => setIncreaseForDebt(null)} />}
      {editDebt && <EditDebtModal debt={editDebt} onClose={() => setEditDebt(null)} />}
      {reverseForDebt && (
        <AddDebtModal onClose={() => setReverseForDebt(null)} prefill={reverseDebtPrefill(reverseForDebt)} />
      )}
      <DebtMenu debt={debts.find(x => x.id === menuDebtId) ?? null} busy={busyKey !== null} returnFocusTo={menuReturnFocus}
        ledgerKey={menuDebtId ? personKeyByDebt.get(menuDebtId) : undefined}
        onClose={() => setMenuDebtId(null)} onIncrease={setIncreaseForDebt} onEdit={setEditDebt} onReverse={setReverseForDebt}
        onDelete={confirmDeleteDebt} />
    </ScrollView>
  );
}

/**
 * تعديل بيانات الدين — اسم الشخص ورقمه والملاحظة بس.
 *
 * المبلغ مش هنا عن قصد: المبلغ الأساسي ولّد عملية حقيقية وعدّل رصيد محفظة،
 * فتعديله من غير العملية معناه رصيد مش مطابق للعمليات. الشاشة بتقول ده
 * للمستخدم صريح بدل ما يفضل يدوّر على حقل المبلغ.
 */
function EditDebtModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { updateDebt, setInstallmentCount } = useData();
  const { busy, run: runBusy } = useBusy();
  const picker = useDeviceContacts();

  const [personName, setPersonName] = useState(debt.personName);
  const [personPhone, setPersonPhone] = useState(debt.personPhone || '');
  const [personContactId, setPersonContactId] = useState(debt.personContactId || '');
  const [note, setNote] = useState(debt.note || '');
  const [dueDate, setDueDate] = useState(debt.dueDate || '');
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number | null>(
    debt.reminderDaysBefore ?? null
  );
  const [installmentCount, setInstallmentCountDraft] = useState(
    debt.isInstallment && debt.installmentCount ? String(debt.installmentCount) : ''
  );
  const [error, setError] = useState('');

  async function handleSave() {
    if (!personName.trim()) { setError('لازم تكتب اسم الشخص'); return; }

    // آمن مش صحيح بس: 1e20 "صحيح" بس مبيتخزّنش كعدد بدقته (`storableCount`) — الفحص قبل الزرار ما يلف
    const nextCount = debt.isInstallment && installmentCount.trim() ? Number(installmentCount) : null;
    if (nextCount !== null && !storableCount(nextCount)) { setError(INSTALLMENT_COUNT_INVALID); return; }
    await runBusy(async () => {
      // عدد الأقساط ليه مسار كتابة لوحده لأنه بيعيد حساب قيمة القسط معاه — **جوه** `runBusy` (بند 10): دوستين
      // ورا بعض كانوا بيكتبوا العدد مرتين قبل ما الزرار يتقفل
      if (nextCount !== null && nextCount !== debt.installmentCount) {
        const done = await setInstallmentCount(debt.id, nextCount);
        // السبب من نفس الحسبة (عدد أقل من الدفعات، دين متسدد، قسط أقل من قرش).
        // ولو الحسبة هنا قابلاه والكتابة اترفضت (الدين اتمسح أو اتغيّر من جهاز
        // تاني) ← "مقدرناش نحفظ"، مش سبب مش حقيقي
        if (!done) { setError(installmentCountEditRefusal(debt, nextCount) ?? INSTALLMENT_COUNT_NOT_SAVED); return; }
      }
      try {
        await updateDebt(debt.id, {
          personName,
          personPhone,
          personContactId,
          note,
          dueDate,
          // من غير معاد مفيش تذكير — مش منطقي نفكّر بحاجة مالهاش تاريخ
          reminderDaysBefore: dueDate ? reminderDaysBefore : null,
        });
      } catch {
        // مبيمسكش فشل الكتابة: الكتابة بتعدي من `track` اللي بيبلع الرفض
        // ويعرضه بنفسه مسمّى بالسجل (`lib/writeError.ts`) — والمودال بيكون
        // اتقفل خلاص قبل ما الرفض يوصل، فرسالة جوه الفورم مستحيلة أصلاً.
        // فاضل هنا للأخطاء المتزامنة جوه الـtry نفسه (تجهيز البيانات، التنقل).
        setError('حصل خطأ، جرب تاني');
        return;
      }
      onClose();
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle} accessibilityRole="header">تعديل بيانات الدين</Text>
          <Text style={styles.hintText}>
            المبلغ مش بيتعدّل من هنا. لو عايز تزوّد الدين استخدم &quot;زيادة على الدين&quot;، ولو المبلغ الأساسي غلط امسح الدين وسجّله تاني.
          </Text>

          <View style={styles.labelRow}>
            <Text style={styles.labelInRow}>اسم الشخص</Text>
            <TouchableOpacity
              onPress={picker.open}
              style={styles.contactBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="اختار من جهات الاتصال">
              <LineIcon name="person-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.contactBtnText}>من جهات الاتصال</Text>
            </TouchableOpacity>
          </View>
          <TextInput accessibilityLabel="اسم الشخص" maxLength={NAME_MAX_LENGTH} style={styles.input} value={personName} onChangeText={setPersonName}
            placeholder="مثلاً: أحمد" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>رقم التليفون</Text>
          <TextInput accessibilityLabel="رقم التليفون" style={styles.input} value={personPhone} onChangeText={setPersonPhone}
            placeholder="اختياري" placeholderTextColor={colors.textSecondary} keyboardType="phone-pad" textAlign="right" />

          {!!personContactId && (
            <View style={styles.linkedRow}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="إلغاء ربط جهة الاتصال" onPress={() => setPersonContactId('')} hitSlop={8} style={styles.unlinkBtn}>
                <Text style={styles.unlinkText}>إلغاء الربط</Text>
              </TouchableOpacity>
              <Text style={styles.linkedText}>مربوط بجهة اتصال على الموبايل</Text>
            </View>
          )}

          <DebtReminderFields
            dueDate={dueDate}
            reminderDaysBefore={reminderDaysBefore}
            onChangeDueDate={setDueDate}
            onChangeReminder={setReminderDaysBefore}
          />

          {debt.isInstallment && (
            <>
              <Text style={styles.label}>عدد الأقساط</Text>
              <Text style={styles.installmentHint}>
                العدد ده هو الإجمالي زي ما هو معروض. لما تغيّره، المتبقي
                بيتقسّم من جديد على الأقساط الفاضلة.
              </Text>
              <TextInput
                testID="debt_edit_installment_count"
                accessibilityLabel="عدد الأقساط"
                style={styles.input}
                value={installmentCount}
                onChangeText={setInstallmentCountDraft}
                keyboardType="numeric"
                placeholderTextColor={colors.textSecondary}
                textAlign="right"
              />
            </>
          )}

          <Text style={styles.label}>ملاحظة</Text>
          <TextInput accessibilityLabel="ملاحظة" maxLength={NOTE_MAX_LENGTH} style={styles.input} value={note} onChangeText={setNote}
            placeholder="اختياري" placeholderTextColor={colors.textSecondary} textAlign="right" />

        </ScrollView>

        {!!error && <Text style={[styles.error, styles.errorBar]} accessibilityLiveRegion="polite">{error}</Text>}

        <View style={styles.footer}>
          <Button variant="secondary" testID="debt_edit_cancel" label="إلغاء" style={styles.cancelBtn} onPress={onClose} />
          <Button testID="debt_edit_save" label="حفظ" style={styles.saveBtn} onPress={handleSave} busy={busy} />
        </View>
        </View>

        <ContactPickerModal
          visible={picker.visible}
          contacts={picker.contacts}
          onClose={picker.close}
          onPick={ct => {
            setPersonName(ct.name);
            setPersonPhone(ct.phone);
            setPersonContactId(ct.contactId ?? '');
            picker.close();
          }}
          onCreateContact={picker.createContact}
        />
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * قايمة "⋯" لكارت الدين (دراسة الشكل خطوة 3). متركّبة دايمًا عشان أنيميشن الخروج؛ الدين اتمسح والقايمة مفتوحة ← بتتقفل.
 * أي كتابة شغالة (`busy`) ← كل الأفعال مقفولة (react-reviewer). "كشف الحساب" مبيظهرش من غير مفتاح الشخص (كان بيبلع الدوسة).
 */
function DebtMenu({ debt, busy, ledgerKey, returnFocusTo, onClose, onIncrease, onEdit, onReverse, onDelete }: {
  debt: Debt | null; busy: boolean; ledgerKey?: string; returnFocusTo: RefObject<View | null>; onClose: () => void;
  onIncrease: (d: Debt) => void; onEdit: (d: Debt) => void; onReverse: (d: Debt) => void; onDelete: (d: Debt) => void;
}) {
  // آخر دين اتفتح عليه — عشان العنوان والأفعال ميفضوش وهي بتنزل. في state مش ref (مفيش كتابة وقت الرسم)
  const [last, setLast] = useState<Debt | null>(debt);
  useEffect(() => { if (debt) setLast(debt); }, [debt]);
  const d = debt ?? last;
  const actions: SheetAction[] = d ? [
    { key: 'increase', label: 'زيادة على الدين', testID: 'debt_menu_increase', disabled: busy, onPress: () => onIncrease(d) },
    { key: 'edit', label: 'تعديل البيانات', testID: 'debt_menu_edit', disabled: busy, onPress: () => onEdit(d) },
    ...(ledgerKey ? [{ key: 'ledger', label: 'كشف الحساب', testID: 'debt_menu_ledger', onPress: () => router.push({ pathname: '/person-ledger', params: { personKey: ledgerKey } }) }] : []),
    { key: 'reverse', label: d.direction === 'owed_to_me' ? 'سجّل فلوس ليه عندي' : 'سجّل فلوس ليا عنده', testID: 'debt_menu_reverse', disabled: busy, onPress: () => onReverse(d) },
    { key: 'delete', label: 'امسح الدين', danger: true, testID: 'debt_menu_delete', disabled: busy, onPress: () => onDelete(d) },
  ] : [];
  return <ActionSheet visible={!!debt} testID="debt_menu" title={d?.personName ?? ''} actions={actions} onClose={onClose} returnFocusTo={returnFocusTo} />;
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    switcher: { marginHorizontal: space.xxl, marginBottom: space.sm },
    scrollArea: { flex: 1 },
    content: { padding: space.xxl, paddingBottom: 40 },
    titleRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xxl },
    summaryRow: { flexDirection: 'row-reverse', gap: space.md, marginBottom: space.md },
    summaryCard: { flex: 1, backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg, ...cardElevation(c) },
    summaryLabel: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right' },
    summaryValue: { fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: space.xxs },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: space.xxxl, marginBottom: space.sm },
    debtCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.md, ...cardElevation(c) },
    debtHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
    personBlock: { flexShrink: 1, alignItems: 'flex-end' },
    personName: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    personPhone: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.xxs },
    personLinkRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs, flexShrink: 1, minHeight: MIN_TOUCH },
    personNameLink: { color: c.accentText, textDecorationLine: 'underline' },
    remainingText: { fontSize: typeScale.title, fontWeight: '700' },
    noteText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.xxs },
    dueText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.sm },
    track: { height: 4, backgroundColor: c.border, borderRadius: radius.track, marginTop: space.md, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.track },
    progressText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs },
    expandedArea: { marginTop: space.lg, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.md },
    paymentsList: { marginBottom: space.md },
    paymentRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.xxs, gap: space.sm },
    paymentText: { fontSize: typeScale.caption, flexShrink: 1 },
    paymentMeta: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xxs },
    // ٣٢ مرئي؛ الـhitSlop مقصوص فوق وتحت عشان ميدخلش على السطر اللي جنبه
    entryDeleteBtn: { width: 32, height: 32, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center' },
    paymentDate: { color: c.textMuted, fontSize: typeScale.caption },
    actionsRow: { flexDirection: 'row-reverse', gap: space.sm, flexWrap: 'wrap' },
    payBtn: { flex: 1, backgroundColor: c.accent, borderRadius: radius.md, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    payBtnText: { color: c.onAccent, fontWeight: '700', fontSize: typeScale.body },
    moreBtn: { minWidth: MIN_TOUCH + space.lg, minHeight: MIN_TOUCH, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.controlEdge, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    moreBtnText: { color: c.text, fontSize: typeScale.title, fontWeight: '700' },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { padding: space.xxxl },
    sheetTitle: sheetTitleStyle(c, 4),
    hintText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs, lineHeight: 17 },
    labelRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xl, marginBottom: space.xs },
    labelInRow: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right' },
    contactBtn: {
      flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs, minHeight: 44,
      paddingHorizontal: space.lg, paddingVertical: space.sm,
      borderWidth: 1.5, borderColor: c.accent, borderRadius: radius.md, backgroundColor: c.surface2,
    },
    contactBtnText: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700' },
    linkedRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
    linkedText: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right' },
    unlinkBtn: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: space.xxs },
    unlinkText: { color: c.dangerText, fontSize: typeScale.caption, fontWeight: '700' },
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xl, marginBottom: space.xs },
    installmentHint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.xs, lineHeight: 16 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, fontSize: typeScale.body, paddingHorizontal: space.xl, paddingVertical: space.md },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', marginTop: space.lg },
    errorBar: { paddingHorizontal: space.xxxl, paddingBottom: space.sm },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
    btnBusy: { opacity: 0.6 },
  });
}