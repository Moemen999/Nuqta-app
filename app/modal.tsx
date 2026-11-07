import AmountPreview from '@/components/AmountPreview';
import { useArchivedSettlement } from '@/components/ArchivedSettlement';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { INSTALLMENTS_CHANGED_TITLE } from '@/components/DebtEntryModals';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { TX_EDIT_OUTCOME_ALERT, useData, type Settlement, type Transaction } from '@/context/DataContext';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import {
  debtLinkedEditPlan, debtRoleOf, storableAmount, storedEditChange, transactionLinkKind, type LinkKind, type LinkedEditNext,
} from '@/lib/linkedEdit';
import { plainAmount } from '@/lib/money';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectableOptions, type TxChange } from '@/lib/archiving';
import { transferTransactionIds } from '@/lib/spending';
import { categoryLabel, projectBalances, todayStr, walletHistoryName } from '@/lib/finance';
import { quietSelectionStyle, selectionA11y, selectionTextColor, type SelectionTone } from '@/lib/selection';
import { MIN_TOUCH, radius, space, stickyFooterStyle, typeScale } from '@/lib/tokens';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NOTE_MAX_LENGTH } from '@/lib/textLimits';
import { hapticSuccess } from '@/lib/haptics';

const TYPES: readonly { key: 'expense' | 'income' | 'withdraw'; label: string; tone: SelectionTone }[] = [
  { key: 'expense', label: 'مصروف', tone: 'danger' },
  { key: 'income', label: 'إيراد', tone: 'success' },
  { key: 'withdraw', label: 'سحب', tone: 'accent' },
];

export default function AddTransactionModal() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const {
    wallets, categories, transactions, debts, subscriptions, gamiyas, incomes, linkSourcesReady, loadErrors, retryLoad,
    addTransaction, updateTransaction, updateDebtLinkedTransaction, deleteTransaction, transactionLinkWarning,
  } = useData();
  const notice = useNotice();
  const confirm = useConfirm();
  const existing = id ? transactions.find(t => t.id === id) : undefined;
  const isEdit = !!existing;
  // مربوطة بدين/اشتراك/جمعية/دخل ← النوع مقفول (`lib/linkedEdit.ts`)، والدين
  // بس بيتعدّل معاها في نفس الذرة
  const liveLinkKind = existing ? transactionLinkKind(existing.id, { debts, subscriptions, gamiyas, incomes }) : null;
  // الربط بيتثبّت وقت ما الفورم يتملى ومبيتغيّرش بعد كده: لو الدين اتفك من جهاز
  // تاني والفورم مفتوح، الحفظ كان هيروح للمسار العادي ويسيب الدين على القديم
  const [frozenLink, setFrozenLink] = useState<LinkKind | null | undefined>(undefined);
  const linkKind = frozenLink === undefined ? liveLinkKind : frozenLink;
  const linkChanged = frozenLink !== undefined && liveLinkKind !== frozenLink;
  const typeLocked = !!linkKind || !!existing?.isSettlement;
  // عملية تحويل (سلفة، استلاف، جمعية) مبتتعدّش في أي فئة — شريحة الفئة كانت هتتحفظ ومتتعدّش (money-reviewer 2026-11-05)
  const isTransfer = useMemo(() => !!existing && transferTransactionIds(debts, gamiyas).has(existing.id), [existing, debts, gamiyas]);
  // ضد الدوسة المزدوجة قبل ما `syncing` يترسم: كل لفة ذرية بتعمل تسوية بمعرّف جديد
  const inFlight = useRef(false);
  const opened = useRef<Pick<Transaction, 'amount' | 'walletId' | 'type'> | null>(null);
  // الزرار "+" ظاهر دايمًا حتى من غير محفظة (2026-09-29)، فالشاشة دي هي اللي
  // لازم توصّله لمحفظة — رسالة من غير طريق قدامها طريق مسدود
  const noActiveWallets = !wallets.some(w => !w.archived);

  const [type, setType] = useState<'expense' | 'income' | 'withdraw'>('expense');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState<string | undefined>(undefined);
  const [toWalletId, setToWalletId] = useState<string | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayStr());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // تعديل عملية دين مستني السيرفر — منفصل عن `busy` اللي بيتفك قبل ما الشيت ترد
  const [syncing, setSyncing] = useState(false);
  // رصيد المحفظة المؤرشفة لازم يفضل صفر. لو التعديل أو الحذف هيحرّكه، الشيت
  // بتسأل الفرق يروح فين — ولو مفيش محفظة مؤرشفة متأثرة بتعدّي من غير ما تبان
  const settle = useArchivedSettlement();

  useEffect(() => {
    if (existing && !loaded && linkSourcesReady) {
      setFrozenLink(liveLinkKind);
      opened.current = { amount: existing.amount, walletId: existing.walletId, type: existing.type };
      setType(existing.type);
      setAmount(String(existing.amount));
      setWalletId(existing.walletId);
      setToWalletId(existing.toWalletId);
      setCategoryId(existing.categoryId);
      setNote(existing.note || '');
      setDate(existing.date);
      setLoaded(true);
    } else if (!id && walletId === undefined && wallets.length > 0) {
      // عملية جديدة مبتبدأش على محفظة أو فئة مؤرشفة — دي اتأرشفت عشان
      // تختفي من الاختيارات، وتيجي مختارة افتراضيًا بيلغي معنى الأرشفة
      const active = wallets.filter(w => !w.archived);
      const activeCats = categories.filter(c => !c.archived);
      setWalletId(active[0]?.id);
      setToWalletId(active[1]?.id ?? active[0]?.id);
      setCategoryId(activeCats[0]?.id);
    }
  }, [existing, wallets, categories, linkSourcesReady]);

  // الرصيد رايح فين لو حفظنا. لازم نستثني العملية اللي بنعدّلها: رصيدها
  // القديم لسه محسوب، فمن غير الاستثناء التعديل بيتحسب مرتين.
  const projections = useMemo(() => projectBalances({
    transactions, wallets, type, amount: Number(amount), walletId,
    toWalletId: type === 'withdraw' ? toWalletId : undefined,
    excludeTransactionId: existing?.id,
  }), [transactions, wallets, type, amount, walletId, toWalletId, existing]);

  // اتفتح على عملية (`id`) ومش لاقيينها: اتمسحت من جهاز تاني، أو اتمسحت وانت
  // فاتح الفورم. ممنوع الفورم يتحول لـ"عملية جديدة" — الحفظ هيضيف نسخة تانية
  // من الفلوس وانت فاكر إنك عدّلت (silent-failure-hunter، بند 14)
  // واستنّي البيانات الأول: قبل أول snapshot "مش لاقيينها" ممكن تبقى "لسه ما وصلتش"
  // (الكاش في الذاكرة بس، money-reviewer)، و"مش مربوطة" ممكن تبقى "الديون لسه ما وصلتش"
  const waiting = !!id && !linkSourcesReady;
  const missing = !!id && linkSourcesReady && !existing;

  async function handleSave() {
    if (missing || waiting || linkChanged) return;
    const amt = Number(amount);
    // مفيش ولا محفظة خالص ≠ نسي يختار واحدة — الرسالة بتقول السبب الحقيقي (a11y-architect)
    // التعديل هنا معناه إن المحافظ كلها اتأرشفت أو اتمسحت — "لسه" و"سجّل" غلط ليه
    if (noActiveWallets) {
      setError(isEdit
        ? 'مفيش ولا محفظة شغالة دلوقتي، فمش هينفع نحفظ التعديل. رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة، وبعدين عدّل تاني.'
        : 'مفيش ولا محفظة لسه — ضيف محفظة الأول، وبعدين سجّل العملية.');
      return;
    }
    // الفحص على المبلغ **بعد** التقريب: "1e307" محدود بس بيبقى Infinity لما يتقرّب
    if (storableAmount(amt) === null || !walletId) { setError('من فضلك دخّل مبلغ صحيح ومحفظة'); return; }
    if (type === 'withdraw' && (!toWalletId || toWalletId === walletId)) {
      setError('اختار محفظة وجهة مختلفة'); return;
    }
    setBusy(true);
    try {
      const payload = {
        type, amount: amt, walletId,
        toWalletId: type === 'withdraw' ? toWalletId : undefined,
        categoryId: type === 'expense' ? categoryId : undefined,
        note: note.trim(),
        date,
        ...(isEdit ? {} : { createdAt: new Date().toISOString() }),
      };
      if (isEdit && existing) {
        const changes: TxChange[] = [{
          before: existing,
          after: { type, amount: amt, walletId, toWalletId: type === 'withdraw' ? toWalletId : undefined },
        }];
        if (linkKind === 'debt') {
          // الدين بيخزّن المبلغ مقرّب (`updateDebtLinkedTransaction`)، فالتسوية لازم
          // تتحسب من نفس المقرّب — وإلا رصيد المؤرشفة يفضل قرش مش صفر (R2)
          const change = storedEditChange(existing, changes[0].after!);
          if (!change) { setError('من فضلك دخّل مبلغ صحيح ومحفظة'); return; }
          const stored = change.after!.amount;
          const debt = debts.find(d => debtRoleOf(d, existing.id));
          const plan = debt && debtLinkedEditPlan(debt, existing.id, { amount: stored, walletId, date, categoryId: payload.categoryId });
          if (plan && plan.excessAfter > plan.excessBefore && !(await confirmDebtOverpay(debt!.personName, plan.excessAfter))) return;
          // اللي الفورم اتملى بيه، مش النسخة الحية: لو اتعدّلت من جهاز تاني بعد الفتح،
          // الفورم قدامه أرقام قديمة والذرة بترفض ('gone') بدل ما تحفظ فوقها
          const expected = opened.current ?? { amount: existing.amount, walletId: existing.walletId, type: existing.type };
          settle.request([change], settlements => {
            void saveDebtLinked(existing.id, { ...payload, amount: stored, walletId, date }, expected, settlements);
          });
          return;
        }
        settle.request(changes, settlements => {
          updateTransaction(existing.id, payload, settlements);
          hapticSuccess();
          router.back();
        });
      } else {
        await addTransaction(payload);
        hapticSuccess();
        router.back();
      }
    } catch {
      // مبيمسكش فشل الكتابة: الكتابة بتعدي من `track` اللي بيبلع الرفض
      // ويعرضه بنفسه مسمّى بالسجل (`lib/writeError.ts`) — والمودال بيكون
      // اتقفل خلاص قبل ما الرفض يوصل، فرسالة جوه الفورم مستحيلة أصلاً.
      // فاضل هنا للأخطاء المتزامنة جوه الـtry نفسه (تجهيز البيانات، التنقل).
      setError('حصل خطأ، جرب تاني');
    } finally {
      setBusy(false);
    }
  }

  // نفس سؤال مودال الدفعة: تحذير مش منع (`overpayCheck`)، بس هنا الزيادة جاية من التعديل
  function confirmDebtOverpay(personName: string, excess: number) {
    return new Promise<boolean>(resolve => {
      confirm('المبلغ أكبر من المتبقي', `بعد التعديل، اللي اتدفع على "${personName}" هيزيد عن الدين بـ ${plainAmount(excess)} ج.م — نحفظه كده؟`, [
        { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
        { text: 'أيوة، احفظ', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  }

  // ذرية: الزرار بيلف لحد النتيجة القاطعة، والمودال بيفضل مفتوح لو ما اتحفظش
  async function saveDebtLinked(
    txId: string, payload: Partial<Transaction> & LinkedEditNext,
    expected: Pick<Transaction, 'amount' | 'walletId' | 'type'>, settlements: Settlement[],
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    try {
      const result = await updateDebtLinkedTransaction(txId, payload, expected, settlements);
      if (result.outcome !== 'done') {
        const alert = TX_EDIT_OUTCOME_ALERT[result.outcome];
        notice(alert.title, alert.body);
        // "اتغيّرت من جهاز تاني" — الفورم قدامه أرقام قديمة، "جرب تاني" مش هتنفع
        if (result.outcome === 'gone') router.back();
        return;
      }
      if (result.note) notice(INSTALLMENTS_CHANGED_TITLE, result.note);
      router.back();
    } catch (e) {
      // الدالة بترجّع نتيجة مبترميش — لو رمت يبقى حاجة مش متوقعة، ولازم توصل
      // Sentry باسم العملية زي أي فشل ذري (مفيش مبالغ ولا أسامي)
      reportAtomicFailure('تعديل عملية الدين', e);
      setError('حصل خطأ ومفيش حاجة اتحفظت، جرب تاني');
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }

  function handleDelete() {
    if (!existing) return;
    // رسالة فشل من محاولة قبل كده متفضلش ظاهرة والمحاولة الجديدة شغالة (silent-failure-hunter)
    setError('');
    // لو العملية مرتبطة بدين أو اشتراك أو جمعية، المستخدم لازم يعرف هيحصل إيه للسجل ده
    const linkWarning = transactionLinkWarning(existing.id);
    const message = linkWarning ? `متأكد إنك عايز تمسحها؟\n\n${linkWarning}` : 'متأكد إنك عايز تمسحها؟';
    const changes = [{ before: existing }];
    // `deleteTransaction` async: التجهيز (stageReconcile/stageSettlements) بيرمي جوّاها فبيرفض
    // الـpromise — قبل كده المودال كان بيتقفل والمستخدم فاكر إنها اتمسحت ومفيش حاجة اتكتبت
    // (silent-failure-hunter). الكتابة نفسها مبتتستناش (`track`) — الـpromise بيخلص بعد التجهيز
    const run = (settlements: Settlement[]) =>
      Promise.resolve().then(() => deleteTransaction(existing.id, settlements))
        .then(() => router.back())
        // `.catch` مش التاني في `.then`: رمية من `router.back` نفسها كانت هتبقى unhandled
        .catch(e => { reportAtomicFailure('حذف العملية', e); setError('حصل خطأ، جرب تاني'); });
    // حوار واحد (D3، 2026-10-30، قرار مؤمن): لو محفظة مؤرشفة هتتأثر، شيت التسوية هي
    // السؤال نفسه (فيها "متأكد؟" والتحذير وزرار "حذف") — مش Alert وبعده شيت فوق بعض
    if (settle.needsSettlement(changes)) {
      settle.request(changes, run, { intro: message, confirmLabel: 'حذف' });
      return;
    }
    confirm('حذف العملية', message, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: async () => {
          if (busy) return;
          setBusy(true);
          try {
            settle.request(changes, run);
          } catch {
            // فشل التجهيز (stageReconcile) بيتمسك جوه `run` نفسها (الـpromise بتاع
            // `deleteTransaction`)؛ فشل الكتابة بيعدي من `track` وبيتعرض مسمّى بالسجل.
            // فاضل هنا للأخطاء المتزامنة في `settle.request` نفسها.
            setError('حصل خطأ، جرب تاني');
          } finally {
            setBusy(false);
          }
        }
      },
    ]);
  }

  if (waiting) {
    return (
      <View testID="tx_waiting" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>تعديل عملية</Text>
        <View style={styles.noWallets}>
          {/* قراية اترفضت (مش نت بطيء): "اتأكد من النت" كانت هتبقى كدب، والاستنى مش هيخلص لوحده */}
          {loadErrors.length > 0 ? (
            <>
              <Text style={styles.noWalletsText}>في بيانات ما قدرناش نجيبها، فمش هنعرف العملية دي مربوطة بإيه. جرّب تاني، ولو فضلت كده شوف البانر في الرئيسية.</Text>
              <TouchableOpacity testID="tx_waiting_retry" style={styles.noWalletsBtn}
                onPress={retryLoad} accessibilityRole="button">
                <Text style={styles.noWalletsBtnText}>جرّب تاني</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.noWalletsText}>لسه بنجيب بياناتك عشان نعرف العملية دي مربوطة بإيه. لو الموضوع طوّل، اتأكد إن النت شغال.</Text>
            </>
          )}
          <TouchableOpacity testID="tx_waiting_back" style={styles.noWalletsBtn}
            onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.noWalletsBtnText}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (linkChanged) {
    return (
      <View testID="tx_link_changed" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>{TX_EDIT_OUTCOME_ALERT.gone.title}</Text>
        <View style={styles.noWallets}>
          <Text style={styles.noWalletsText}>{TX_EDIT_OUTCOME_ALERT.gone.body}</Text>
          <TouchableOpacity testID="tx_link_changed_back" style={styles.noWalletsBtn}
            onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.noWalletsBtnText}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (missing) {
    return (
      <View testID="tx_missing" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>تعديل عملية</Text>
        <View style={styles.noWallets}>
          <Text style={styles.noWalletsText}>العملية دي مبقتش موجودة، غالبًا اتمسحت. ومفيش تعديل اتحفظ.</Text>
          <TouchableOpacity testID="tx_missing_back" style={styles.noWalletsBtn}
            onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.noWalletsBtnText}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // التسوية بترجّع رصيد مؤرشفة لصفر — تعديلها أو مسحها كان هيطلب تسوية للتسوية.
  // نفس قفل YNAB على عمليات التسوية: بتبان، ومبتتعدّلش
  if (existing?.isSettlement) {
    return (
      <View testID="tx_settlement_locked" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>تسوية محفظة مؤرشفة</Text>
        <View style={styles.noWallets}>
          <Text style={styles.noWalletsText}>دي اتعملت لوحدها عشان رصيد المحفظة المؤرشفة يرجع صفر، فمبتتعدّلش ولا تتمسح. لو عايز تصلّح حاجة، عدّل العملية الأصلية اللي على المحفظة دي.</Text>
          <TouchableOpacity testID="tx_settlement_back" style={styles.noWalletsBtn}
            onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.noWalletsBtnText}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={styles.title}>{isEdit ? 'تعديل عملية' : 'عملية جديدة'}</Text>

      {!isEdit && noActiveWallets && (
        <View testID="tx_no_wallets" style={styles.noWallets}>
          <Text style={styles.noWalletsText}>مفيش ولا محفظة لسه — ضيف محفظة الأول، وبعدين سجّل العملية.</Text>
          {/* replace مش push: المودال بيتقفل والرجوع من المحافظ بيودّي الرئيسية مش لفورم فاضي */}
          <TouchableOpacity testID="tx_no_wallets_add" style={styles.noWalletsBtn}
            onPress={() => router.replace('/settings-screens/wallets')} accessibilityRole="button">
            <Text style={styles.noWalletsBtnText}>ضيف محفظة</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.row}>
        {TYPES.map(t => (
          <TouchableOpacity accessibilityRole="button" key={t.key} testID={`tx_type_${t.key}`} onPress={() => setType(t.key)}
            disabled={typeLocked && type !== t.key}
            accessibilityState={{ selected: type === t.key, disabled: typeLocked && type !== t.key }}
            style={[styles.typeBtn, quietSelectionStyle(colors, type === t.key, t.tone), typeLocked && type !== t.key && styles.btnBusy]}>
            <Text style={{ color: selectionTextColor(colors, type === t.key), fontSize: typeScale.body }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {typeLocked && (
        <Text testID="tx_type_locked" style={styles.lockedHint}>
          {linkKind === 'debt'
            ? 'النوع ثابت عشان العملية مربوطة بدين. المبلغ والمحفظة والتاريخ لو عدّلتهم بيتعدّلوا في الدين كمان.'
            : 'النوع ثابت عشان العملية مربوطة باشتراك أو جمعية أو دخل ثابت. التعديل على العملية دي بس، والمبلغ المعتاد زي ما هو.'}
        </Text>
      )}

      <Text style={styles.label}>المبلغ</Text>
      {/* "+" بيودّي على كتابة الرقم على طول (2026-09-29): الكيبورد بيفتح لوحده في عملية
          جديدة. مش في التعديل (جه يبص الأول)، ولا من غير محفظة (الكيبورد كان هيغطي
          "ضيف محفظة" عشان رقم مش هيتحفظ). زرار الحفظ في فوتر لاصق فوق الكيبورد */}
      <TextInput testID="tx_amount_input" style={styles.bigInput} value={amount} onChangeText={setAmount}
        autoFocus={!id && !noActiveWallets}
        placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />
      <AmountPreview amount={amount} projections={projections} />

      <Text style={styles.label}>{type === 'withdraw' ? 'من محفظة' : 'المحفظة'}</Text>
      <View style={styles.chipRow}>
        {selectableOptions(wallets, walletId).map(w => (
          <TouchableOpacity {...selectionA11y(walletId === w.id)} key={w.id} onPress={() => setWalletId(w.id)}
            style={[styles.chip, quietSelectionStyle(colors, walletId === w.id)]}>
            <Text style={{ color: colors.text, fontSize: typeScale.body }}>{walletHistoryName(wallets, w.id)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {type === 'withdraw' && (
        <>
          <Text style={styles.label}>إلى محفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, toWalletId).filter(w => w.id !== walletId).map(w => (
              <TouchableOpacity {...selectionA11y(toWalletId === w.id)} key={w.id} onPress={() => setToWalletId(w.id)}
                style={[styles.chip, quietSelectionStyle(colors, toWalletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: typeScale.body }}>{walletHistoryName(wallets, w.id)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {type === 'expense' && !isTransfer && (
        <>
          <Text style={styles.label}>الفئة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(categories, categoryId).map(c => (
              <TouchableOpacity {...selectionA11y(categoryId === c.id)} key={c.id} onPress={() => setCategoryId(c.id)}
                style={[styles.chip, quietSelectionStyle(colors, categoryId === c.id)]}>
                <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: typeScale.body }}>{categoryLabel(c)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>التاريخ</Text>
      <TouchableOpacity accessibilityRole="button" style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
        <Text style={styles.dateBtnText}>{date}</Text>
      </TouchableOpacity>

      <Text style={styles.label}>ملاحظة</Text>
      <TextInput maxLength={NOTE_MAX_LENGTH} style={styles.input} value={note} onChangeText={setNote}
        placeholder="اختياري" placeholderTextColor={colors.textSecondary} textAlign="right" />

      <CalendarPickerModal
        visible={showDatePicker}
        value={date}
        onSelect={setDate}
        onClose={() => setShowDatePicker(false)}
      />
    </ScrollView>

    {/* برّه الـScrollView، فوق الأزرار اللاصقة: على فورم طويل كانت بتتعرض تحت آخر حقل
        والمستخدم يدوس "حذف" والشيت تتقفل ومفيش حاجة باينة (silent-failure-hunter، الجولة 2 على D3) */}
    {!!error && <Text testID="tx_error" style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}

    <View style={styles.footer}>
      {isEdit && (
        <TouchableOpacity accessibilityRole="button" style={[styles.deleteBtn, (busy || syncing) && styles.btnBusy]} onPress={handleDelete} disabled={busy || syncing}>
          <Text style={{ color: colors.dangerText }}>{busy ? '...' : 'حذف'}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={() => router.back()} disabled={busy || syncing}>
        <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" testID="tx_save_button" style={[styles.saveBtn, (busy || syncing) && styles.btnBusy]} onPress={handleSave} disabled={busy || syncing}>
        {syncing ? <ActivityIndicator color={colors.onAccent} /> : (
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
        )}
      </TouchableOpacity>
    </View>

    {settle.sheet}
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors, insetBottom: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, paddingBottom: 24 },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginBottom: 16 },
    row: { flexDirection: 'row-reverse', gap: 8, marginBottom: 8 },
    // دراسة الشكل خطوة 2: الشرايح من غير إطار لحد ما تتختار (`quietSelectionStyle`)، 44 للمس، والمبلغ هو البطل
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, minHeight: MIN_TOUCH, justifyContent: 'center', alignItems: 'center' },
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxl, marginBottom: space.xs },
    // حافة ≥ 3:1 (a11y-architect: من غيرها الخانة الفاضية 1.06:1 في الفاتح ومالهاش حدود)
    bigInput: { backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.lg, color: c.text, fontSize: typeScale.hero, fontWeight: '700', paddingHorizontal: space.xxl, paddingVertical: space.md },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.dangerText, fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
    lockedHint: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 8, lineHeight: 18 },
    noWallets: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.warnBorder, borderRadius: 12, padding: 14, gap: 10, marginBottom: 8 },
    noWalletsText: { color: c.text, fontSize: 14, textAlign: 'right', lineHeight: 21 },
    noWalletsBtn: { backgroundColor: c.accent, borderRadius: 10, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    noWalletsBtnText: { color: c.onAccent, fontSize: 15, fontWeight: '700' },
    footer: stickyFooterStyle(c, c.bg, insetBottom),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    deleteBtn: { flex: 1, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.6 },
  });
}