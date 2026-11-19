import AmountPreview from '@/components/AmountPreview';
import { useArchivedSettlement } from '@/components/ArchivedSettlement';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { INSTALLMENTS_CHANGED_TITLE } from '@/components/DebtEntryModals';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { txDeleteOutcomeAlert, TX_EDIT_OUTCOME_ALERT, useData, type Settlement, type Transaction, type TxClearableField } from '@/context/DataContext';
import { dueNotRestoredNotice } from '@/lib/reopenDue';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import {
  debtLinkedEditPlan, debtRoleOf, parseTxAmountInput, storedEditChange, transactionLinkKind, TX_AMOUNT_ERROR, type LinkKind, type LinkedEditNext,
} from '@/lib/linkedEdit';
import { namedLabel } from '@/lib/writeError';
import { plainAmount } from '@/lib/money';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { gamiyaPairedTxIds, selectableOptions, type TxChange } from '@/lib/archiving';
import { transferTransactionIds } from '@/lib/spending';
import { dateText } from '@/lib/dateText';
import { categoryLabel, projectBalances, todayStr, walletHistoryName } from '@/lib/finance';
import { activeWalletIds, defaultWalletId, lastTransferToWalletId } from '@/lib/defaultWallet';
import { useWalletDefault } from '@/lib/useWalletDefault';
import { quietSelectionStyle, selectionA11y, selectionTextColor, type SelectionTone } from '@/lib/selection';
import { MIN_TOUCH, categoryIconSize, radius, space, stickyFooterStyle, typeScale, bigAmountInputStyle } from '@/lib/tokens';
import { CategoryIcon, categoryInlineRow } from '@/components/CategoryIcon';
import { useChartColors } from '@/hooks/use-chart-colors';
import { router, useLocalSearchParams } from 'expo-router';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavigationContext, usePreventRemove } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button } from '@/components/Button';
import { Text, TextInput } from '@/components/AppText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NOTE_MAX_LENGTH } from '@/lib/textLimits';
import { hapticSuccess } from '@/lib/haptics';
import { useBusy } from '@/lib/useBusy';
import { useFormError } from '@/lib/useFormError';
import { announceAfterLeave } from '@/lib/announceLater';

/** حقول النوع الجديد مبيستخدمهاش — تغيير النوع في التعديل بيشيلها (الميزة 8، L) */
const UNUSED_FIELDS: Record<'expense' | 'income' | 'withdraw', TxClearableField[]> = {
  expense: ['toWalletId'],
  income: ['toWalletId', 'categoryId'],
  withdraw: ['categoryId'],
};

/** بيتقال لقارئ الشاشة قبل ما الشاشة تتشال — من غيره الحفظ بيبان بس بالرجوع (الميزة 8) */
const DONE_ANNOUNCE = { add: 'اتسجلت', edit: 'اتعدّلت', delete: 'اتمسحت' } as const;

/**
 * المحفظة دي شغالة دلوقتي (وقت الحفظ، مش وقت الفتح)؟ جديدة ← لازم شغالة. تعديل ← لازم موجودة، والمؤرشفة مسموحة بس لو
 * هي نفسها اللي على العملية (التسوية بتغطيها). `null` = تمام، غير كده الرسالة باسمها (الميزة 8، M)
 */
function walletNotUsable(wallets: { id: string; name: string; archived?: boolean }[], id: string | undefined, keep: string | undefined): string | null {
  if (!id) return TX_AMOUNT_ERROR.wallet;
  const w = wallets.find(x => x.id === id);
  if (w && (!w.archived || id === keep)) return null;
  return `${w ? namedLabel('محفظة', w.name) : 'المحفظة اللي اخترتها'} مبقتش شغالة (اتأرشفت أو اتمسحت)، فاختار محفظة تانية.`;
}

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
    wallets, categories, transactions, brokenTransactions, debts, subscriptions, gamiyas, incomes, linkSourcesReady, loadErrors, retryLoad,
    addTransaction, updateTransaction, updateDebtLinkedTransaction, deleteTransaction, transactionLinkWarning,
  } = useData();
  const { categoryColors } = useChartColors();
  const notice = useNotice();
  const confirm = useConfirm();
  const existing = id ? transactions.find(t => t.id === id) : undefined;
  const isEdit = !!existing;
  // مربوطة بدين/اشتراك/جمعية/دخل ← النوع مقفول (`lib/linkedEdit.ts`)، والدين
  // بس بيتعدّل معاها في نفس الذرة
  const liveLinkKind = existing ? transactionLinkKind(existing.id, { debts, subscriptions, gamiyas, incomes }, existing) : null;
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
  const deleting = useRef(false);
  const opened = useRef<Pick<Transaction, 'amount' | 'walletId' | 'type'> | null>(null);
  // الزرار "+" ظاهر دايمًا حتى من غير محفظة (2026-09-29)، فالشاشة دي هي اللي
  // لازم توصّله لمحفظة — رسالة من غير طريق قدامها طريق مسدود
  const noActiveWallets = !wallets.some(w => !w.archived);

  const [type, setType] = useState<'expense' | 'income' | 'withdraw'>('expense');
  const [amount, setAmount] = useState('');
  // عملية جديدة: "من" بيبدأ على آخر محفظة اتسجل عليها، و"إلى" على وجهة آخر تحويل (عمرها
  // ما تساوي "من"). بيتبعوا البيانات لحد أول إدخال، وبعدها بيتثبتوا (`lib/useWalletDefault.ts`)،
  // فمحفظة وصلت متأخرة مبتغيّرش اللي المستخدم شافه. التعديل: محفظة السجل نفسه
  const fromDefault = useMemo(() => defaultWalletId({ wallets, transactions, nowMs: Date.now() }), [wallets, transactions]);
  const fromW = useWalletDefault(fromDefault, !id);
  const walletId = fromW.walletId;
  const toDefault = useMemo(
    () => lastTransferToWalletId(transactions, activeWalletIds(wallets), walletId, Date.now()),
    [wallets, transactions, walletId],
  );
  const toW = useWalletDefault(toDefault, !id);
  const toWalletId = toW.walletId;
  // أي إدخال بيثبّت المحفظتين على اللي كانوا ظاهرين
  const touch = () => { fromW.freeze(); toW.freeze(); };
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayStr());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const { error, setError, errorA11y } = useFormError();
  const [busy, setBusy] = useState(false);
  // المسح لوحده (الميزة 8): قبل كده `busy` واحد، فـ«حذف» كان بيلف وقت الحفظ ويتقري «جاري التنفيذ»
  const [deletingBusy, setDeletingBusy] = useState(false);
  // ref متزامن بيغطي: (أ) ضغطتين في نفس الفريم قبل الـre-render (`useBusy`)، (ب) أي دوسة بعد حفظ ناجح
  // وقبل ما الشاشة تتشال بالأنيميشن (`saved`: بيتعلّم قبل `router.back()` وعمره ما بيتفك)
  const { busy: saveGuard, run: runSave, release: releaseSave } = useBusy();
  const saved = useRef(false);
  const [loaded, setLoaded] = useState(false);
  // تعديل عملية دين مستني السيرفر — منفصل عن `busy` اللي بيتفك قبل ما الشيت ترد
  const [syncing, setSyncing] = useState(false);
  // رصيد المحفظة المؤرشفة لازم يفضل صفر. لو التعديل أو الحذف هيحرّكه، الشيت
  // بتسأل الفرق يروح فين — ولو مفيش محفظة مؤرشفة متأثرة بتعدّي من غير ما تبان
  const settle = useArchivedSettlement();

  // المبلغ زي ما اتقرا من العملية وقت الفتح (الجولة 2، بند 1): لو الخانة لسه عليه بالظبط، المبلغ مبيتكتبش ولا بيتقرّب —
  // مبلغ قديم مش مقرّب (10.005) كان بيتكتب 10.01 لما بس الملاحظة اتعدّلت، والتسوية بتقرّب الفرق (−0.005) لصفر فالمؤرشفة
  // تبعد. وأقل من نص قرش (0.004) مكانش بيسيب يعدّل أي حقل تاني
  const [loadedAmount, setLoadedAmount] = useState<number | null>(null);
  const categoryInit = useRef(false);
  useEffect(() => {
    if (existing && !loaded && linkSourcesReady) {
      setFrozenLink(liveLinkKind);
      opened.current = { amount: existing.amount, walletId: existing.walletId, type: existing.type };
      setType(existing.type);
      setAmount(String(existing.amount));
      setLoadedAmount(existing.amount);
      fromW.pickWallet(existing.walletId);
      toW.pickWallet(existing.toWalletId);
      setCategoryId(existing.categoryId);
      setNote(existing.note || '');
      setDate(existing.date);
      setLoaded(true);
    } else if (!id && !categoryInit.current && wallets.length > 0) {
      // عملية جديدة مبتبدأش على فئة مؤرشفة — دي اتأرشفت عشان تختفي من الاختيارات،
      // وتيجي مختارة افتراضيًا بيلغي معنى الأرشفة (والمحفظة بتتحدد فوق من `useWalletDefault`)
      categoryInit.current = true;
      setCategoryId(categories.filter(c => !c.archived)[0]?.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- التعبئة من العملية القديمة مرة واحدة (`loaded`)؛ إضافة fromW/toW/liveLinkKind كانت هتعيدها فوق اللي المستخدم كتبه
  }, [existing, wallets, categories, linkSourcesReady]);

  // الرصيد رايح فين لو حفظنا. لازم نستثني العملية اللي بنعدّلها: رصيدها
  // القديم لسه محسوب، فمن غير الاستثناء التعديل بيتحسب مرتين.
  // قارئ واحد (الميزة 8، M): الحفظ والتسوية والمعاينة كلهم من الرقم ده — المعروض = المتخزّن
  const parsed = useMemo(() => parseTxAmountInput(amount), [amount]);
  const amountKept = loadedAmount !== null && amount === String(loadedAmount);
  const amountValue = amountKept ? loadedAmount : parsed.ok ? parsed.value : null;
  const projections = useMemo(() => projectBalances({
    transactions, wallets, type, amount: amountValue ?? NaN, walletId,
    toWalletId: type === 'withdraw' ? toWalletId : undefined,
    excludeTransactionId: existing?.id,
  }), [transactions, wallets, type, amountValue, walletId, toWalletId, existing]);

  // اتفتح على عملية (`id`) ومش لاقيينها: اتمسحت من جهاز تاني، أو اتمسحت وانت
  // فاتح الفورم. ممنوع الفورم يتحول لـ"عملية جديدة" — الحفظ هيضيف نسخة تانية
  // من الفلوس وانت فاكر إنك عدّلت (silent-failure-hunter، بند 14)
  // واستنّي البيانات الأول: قبل أول snapshot "مش لاقيينها" ممكن تبقى "لسه ما وصلتش"
  // (الكاش في الذاكرة بس، money-reviewer)، و"مش مربوطة" ممكن تبقى "الديون لسه ما وصلتش"
  const waiting = !!id && !linkSourcesReady;
  const missing = !!id && linkSourcesReady && !existing;

  // الضمان: بعد حفظ ناجح مفيش تغيير في شكل شجرة الـviews وقت الإقفال (المؤشر متركّب دايمًا، والـbusy
  // بيفضل true لحد ما الشاشة تتشال) — mount/unmount للزرار وقتها كان بيكرّش Fabric (NUQTA-3)
  // اتحفظت والرجوع بعدها فشل (`leaveFailed`) ← "حفظ" تاني بيحاول الرجوع بس، مش حفظ تاني
  function handleSave() {
    if (saved.current) { if (leaveFailed.current) { leaveFailed.current = false; leave(); } return; }
    return runSave(saveTransaction, () => saved.current);
  }

  /**
   * بعد حفظ **نجح** (`saved` اتعلّم قبلها). الهابتك والرجوع برّه أي `catch` بيقول «ما اتحفظش»:
   * لو واحد منهم رمى، العملية اتحفظت فعلاً — الهابتك زينة بتتبلع، والرجوع بيتبلّغ بس
   */
  function afterSave(kind: keyof typeof DONE_ANNOUNCE = isEdit ? 'edit' : 'add') {
    try { hapticSuccess(); } catch { /* زينة */ }
    announceDone(kind);
    leave();
  }
  // بعد الرجوع بشوية (الجولة 2، بند 8): وقت الرجوع نفسه التركيز بيتنقل للشاشة اللي ورا والإعلان بيتقطع
  function announceDone(kind: keyof typeof DONE_ANNOUNCE) {
    announceAfterLeave(DONE_ANNOUNCE[kind]);
  }

  // إعلان الخطأ (iOS) وأندرويد (المنطقة الحية) في `useFormError` — نفس الرسالة مرتين بتتقال تاني
  // أي إدخال بيمسح رسالة قديمة — كانت بتفضل ظاهرة والمشكلة اتحلت (الميزة 8)
  const edited = () => { touch(); if (error) setError(''); };

  // الرجوع (زرار أندرويد / سحب المودال) ممنوع طول ما الحفظ شغال — قبل كده المودال كان بيتقفل والحفظ
  // مكمّل (لحد ~800ms مستنيين نسخة الـoutbox)، وبعدين `router.back()` بتاع الحفظ يشيل الشاشة اللي ورا
  // (money-reviewer). الرجوع بتاعنا بعد الحفظ بيعدّي من `leaving`: بيتعلّم الأول، والرجوع بيحصل في
  // effect بعد ما المنع يتشال — وبس لو الشاشة لسه متركّبة ومركّزة
  const nav = useContext(NavigationContext);
  const [leaving, setLeaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // الرجوع بعد النجاح رمى ← المنع اتشال والزرار بيرجع، و"حفظ" تاني بيحاول الرجوع بس (`saved` لسه متعلّم)
  const leaveFailed = useRef(false);
  function leave() { if (mounted.current) setLeaving(true); }
  useEffect(() => {
    if (!leaving || !mounted.current) return;
    let done = false;
    const goBack = () => {
      if (done || !mounted.current) return;
      done = true;
      try { router.back(); } catch (e) {
        console.warn('[tx] الرجوع بعد الحفظ فشل');
        reportAtomicFailure('حفظ العملية', e);
        // العملية اتحفظت (أو اتمسحت) — المنع يتشال عشان رجوع أندرويد/السحب/"إلغاء" يشتغلوا، من غير ما يفتح حفظ تاني
        leaveFailed.current = true;
        setLeaving(false);
        setBusy(false);
        setDeletingBusy(false);
        setSyncing(false);
        releaseSave();
      }
    };
    if (nav && !nav.isFocused()) {
      // شاشة تانية فوقها (شيت، رابط) — الرجوع دلوقتي كان هيشيل اللي فوق. أول ما ترجع قدام بنرجع مرة واحدة
      console.warn('[tx] الرجوع بعد الحفظ مستني الشاشة ترجع قدام');
      return nav.addListener('focus', goBack);
    }
    goBack();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- الرجوع مرة واحدة لما `leaving` يبقى true؛ nav/releaseSave مش لازم يعيدوه
  }, [leaving]);
  const blockLeave = (saveGuard || busy || deletingBusy || syncing) && !leaving;

  /**
   * فشل بعد ما الشاشة ممكن تكون اتشالت (رد شيت التسوية، الحذف): على الشاشة لو لسه موجودة، وإلا رسالة التطبيق.
   * النص على الشاشة بيقول إيه اللي حصل بالظبط (الميزة 8) — كان «حصل خطأ، جرب تاني» للتعديل والمسح الاتنين
   */
  function showFailure(title: string, body: string, onScreen: string) {
    if (mounted.current) setError(onScreen);
    else notice(title, body);
  }

  async function saveTransaction() {
    if (saved.current) return;
    if (missing || waiting || linkChanged) return;
    setError('');
    // مفيش ولا محفظة خالص ≠ نسي يختار واحدة — الرسالة بتقول السبب الحقيقي (a11y-architect)
    // التعديل هنا معناه إن المحافظ كلها اتأرشفت أو اتمسحت — "لسه" و"سجّل" غلط ليه
    if (noActiveWallets) {
      setError(isEdit
        ? 'مفيش ولا محفظة شغالة دلوقتي، فمش هينفع نحفظ التعديل. رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة، وبعدين عدّل تاني.'
        : 'مفيش ولا محفظة لسه — ضيف محفظة الأول، وبعدين سجّل العملية.');
      return;
    }
    // الفحص على المبلغ **بعد** التقريب (`parseTxAmountInput` ← `storableAmount`): "1e307" محدود بس بيبقى Infinity لما يتقرّب.
    // والرقم ده نفسه هو اللي بيتحفظ وبتتحسب منه التسوية والمعاينة (الميزة 8، M)
    // المبلغ ما اتلمسش في التعديل ← زي ما هو على العملية (مش مقرّب) ومبيتكتبش (الجولة 2، بند 1). التسوية بالمبلغ اللي على
    // العملية **دلوقتي** (`existing`، مش وقت الفتح): مبلغ اتغيّر من جهاز تاني ومش هنكتب فوقه ← الفرق صفر مش تسوية على رقم قديم
    const keepAmount = isEdit && amountKept && !!existing;
    let amt: number;
    if (keepAmount && existing) amt = existing.amount;
    else if (parsed.ok) amt = parsed.value;
    else { setError(TX_AMOUNT_ERROR[parsed.reason]); return; }
    if (!walletId) { setError(TX_AMOUNT_ERROR.wallet); return; }
    if (type === 'withdraw' && (!toWalletId || toWalletId === walletId)) {
      setError('اختار محفظة وجهة مختلفة'); return;
    }
    // المحفظة (والوجهة) اتأرشفت أو اتمسحت من جهاز تاني والفورم مفتوح ← العملية كانت هتتكتب على محفظة مقفولة (الميزة 8، M)
    const walletProblem = walletNotUsable(wallets, walletId, existing?.walletId)
      ?? (type === 'withdraw' ? walletNotUsable(wallets, toWalletId, existing?.toWalletId) : null);
    if (walletProblem) { setError(walletProblem); return; }
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
      // المبلغ ما اتلمسش ← مبيتبعتش خالص (مفيش كتابة للمبلغ، فلا تقريب ولا فرق على مؤرشفة)
      const { amount: _keptAmount, ...withoutAmount } = payload;
      const editPayload = keepAmount ? withoutAmount : payload;
      if (isEdit && existing) {
        const changes: TxChange[] = [{
          before: existing,
          after: { type, amount: amt, walletId, toWalletId: type === 'withdraw' ? toWalletId : undefined },
        }];
        if (linkKind === 'debt') {
          // الدين بيخزّن المبلغ مقرّب (`updateDebtLinkedTransaction`)، فالتسوية لازم
          // تتحسب من نفس المقرّب — وإلا رصيد المؤرشفة يفضل قرش مش صفر (R2)
          const change = storedEditChange(existing, changes[0].after!);
          if (!change) { setError(TX_AMOUNT_ERROR.invalid); return; }
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
        settle.request(changes, async settlements => {
          if (saved.current) return;
          saved.current = true;
          // الشيت ممكن ترد بعد ما `busy` والحارس اتفكوا — من غير ده الرجوع كان مفتوح طول الانتظار
          setBusy(true);
          try {
            // بترجع بعد الكتابة المحلية (`track`) مش بعد السيرفر — قاعدة 7
            // النوع اتغيّر ← الحقول اللي النوع الجديد مبيستخدمهاش بتتشال (الميزة 8، L)
            if (existing.type !== type) await updateTransaction(existing.id, editPayload, settlements, { clear: UNUSED_FIELDS[type] });
            else await updateTransaction(existing.id, editPayload, settlements);
          } catch (e) {
            // فشل التجهيز: مفيش حاجة اتحفظت، فالحارس يتفك والشاشة متترجعش
            saved.current = false;
            releaseSave(); // `keepOnSuccess` كان سايب القفل مقفول — من غير ده الزرار يفضل بيلف للأبد
            setBusy(false);
            console.warn('[tx] تعديل العملية فشل');
            reportAtomicFailure('حفظ العملية', e);
            showFailure('التعديل ما اتحفظش', 'العملية زي ما كانت. افتحها تاني وعدّل.', 'التعديل ما اتحفظش والعملية زي ما كانت، جرب تاني');
            return;
          }
          afterSave();
        });
      } else {
        // `durable`: نسخة متشفّرة على الموبايل لحد ما السيرفر يأكد — لو التطبيق اتقفل أوفلاين متضيعش (lib/outbox.ts)
        await addTransaction(payload, { durable: true });
        saved.current = true;
        afterSave();
      }
    } catch (e) {
      console.warn('[tx] حفظ العملية فشل');
      reportAtomicFailure('حفظ العملية', e);
      // مبيمسكش فشل الكتابة: الكتابة بتعدي من `track` اللي بيبلع الرفض
      // ويعرضه بنفسه مسمّى بالسجل (`lib/writeError.ts`) — والمودال بيكون
      // اتقفل خلاص قبل ما الرفض يوصل، فرسالة جوه الفورم مستحيلة أصلاً.
      // فاضل هنا للأخطاء المتزامنة جوه الـtry نفسه (تجهيز البيانات، التنقل).
      setError('حصل خطأ ومفيش حاجة اتحفظت، جرب تاني');
    } finally {
      // بعد النجاح الـbusy بيفضل true لحد ما الشاشة تتشال (NUQTA-3)
      if (!saved.current) setBusy(false);
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
    if (inFlight.current || saved.current) return;
    inFlight.current = true;
    setSyncing(true);
    try {
      const result = await updateDebtLinkedTransaction(txId, payload, expected, settlements);
      if (result.outcome !== 'done') {
        const alert = TX_EDIT_OUTCOME_ALERT[result.outcome];
        notice(alert.title, alert.body);
        // "اتغيّرت من جهاز تاني" — الفورم قدامه أرقام قديمة، "جرب تاني" مش هتنفع
        if (result.outcome === 'gone') leave(); // `router.back()` هنا كان هيتمنع: `syncing` لسه true
        return;
      }
      saved.current = true;
      if (result.note) notice(INSTALLMENTS_CHANGED_TITLE, result.note);
      afterSave();
    } catch (e) {
      // الدالة بترجّع نتيجة مبترميش — لو رمت يبقى حاجة مش متوقعة، ولازم توصل
      // Sentry باسم العملية زي أي فشل ذري (مفيش مبالغ ولا أسامي)
      reportAtomicFailure('تعديل عملية الدين', e);
      setError('حصل خطأ ومفيش حاجة اتحفظت، جرب تاني');
    } finally {
      inFlight.current = false;
      // بعد النجاح الزرار مبيتغيّرش لحد ما الشاشة تتشال (NUQTA-3)
      if (!saved.current) setSyncing(false);
    }
  }

  function handleDelete() {
    if (!existing) return;
    // رسالة فشل من محاولة قبل كده متفضلش ظاهرة والمحاولة الجديدة شغالة (silent-failure-hunter)
    setError('');
    // لو العملية مرتبطة بدين أو اشتراك أو جمعية، المستخدم لازم يعرف هيحصل إيه للسجل ده
    const linkWarning = transactionLinkWarning(existing.id);
    const message = linkWarning ? `متأكد إنك عايز تمسحها؟\n\n${linkWarning}` : 'متأكد إنك عايز تمسحها؟';
    // شهر استلام الجمعية: مسح واحدة بيمسح التانية (الاستلام ↔ قسطك، اختيار أ) — التسوية على الاتنين
    const paired = gamiyaPairedTxIds(gamiyas, existing.id);
    const pairedTxs = transactions.filter(t => paired.includes(t.id));
    const changes = [{ before: existing }, ...pairedTxs.map(t => ({ before: t }))];
    // العمليات اللي التسوية اتحسبت عليها بأرقامها — لو السيرفر عليه غيرهم (جهاز تاني: معرّف أو مبلغ/محفظة) الذرة بترفض
    // (`changed`) بدل تسوية على مسح مختلف. التانية لو بايظة (برّه `transactions`) بالمعرّف بس: هتتمسح ومش في أي رصيد،
    // ومن غيرها الذرة كانت هتقول "اتغيّرت" للأبد (الجولة 2، بندين 2 و4)
    const brokenPaired = brokenTransactions.filter(t => paired.includes(t.id)).map(t => ({ id: t.id }));
    const expectedTxs = [
      ...[existing, ...pairedTxs].map(t => ({ id: t.id, amount: t.amount, walletId: t.walletId, type: t.type })),
      ...brokenPaired,
    ];
    // `deleteTransaction` async: التجهيز (stageReconcile/stageSettlements) بيرمي جوّاها فبيرفض
    // الـpromise — قبل كده المودال كان بيتقفل والمستخدم فاكر إنها اتمسحت ومفيش حاجة اتكتبت
    // (silent-failure-hunter). الكتابة نفسها مبتتستناش (`track`) — الـpromise بيخلص بعد التجهيز
    // الرجوع مقفول (`busy`) لحد ما `deleteTransaction` ترجع، والخروج بعدها من `leave()` (مرة واحدة، والشاشة قدام) —
    // `router.back()` مباشرة كانت هتشيل الشاشة اللي ورا لو المستخدم رجع وهي شغالة
    const run = (settlements: Settlement[]) => {
      if (deleting.current) return Promise.resolve();
      deleting.current = true;
      setDeletingBusy(true);
      return Promise.resolve().then(() => deleteTransaction(existing.id, settlements, { expectedTxs }))
        .then(result => {
          // عملية دفعة/زيادة دين ذرة من السيرفر (الجولة 2، بند 1): مفيش نت / ما اتمسحتش / مش متأكدين ← المودال
          // بيفضل مفتوح والرسالة بتقول الحالة. الإعادة آمنة: لو المسح كان وصل، الذرة بتلاقي العملية مش موجودة ومبتكتبش تاني
          if (result.outcome !== 'done') {
            deleting.current = false;
            setDeletingBusy(false);
            const alert = txDeleteOutcomeAlert(result.outcome, result.subject);
            notice(alert.title, alert.body);
            // الأرقام اللي قدامه (والتسوية) قديمة — الشاشة بتتقفل، والرسالة بتقول يفتحها تاني (الجولة 1 على 3a72d99)
            if (result.outcome === 'changed') leave();
            return;
          }
          // التأكيد وعد إن المعاد هيرجع والسيرفر ما رجّعوش ← بنقول، مش بنسيب الوعد ساكت (زي شاشة الدين)
          if (result.dueNotRestored) {
            const n = dueNotRestoredNotice(result.dueNotRestored);
            notice(n.title, n.body);
          }
          saved.current = true;
          announceDone('delete');
          leave();
        })
        .catch(e => {
          deleting.current = false;
          setDeletingBusy(false);
          reportAtomicFailure('حذف العملية', e);
          showFailure('العملية ما اتمسحتش', 'هي لسه موجودة زي ما هي. افتحها تاني وامسحها.', 'العملية ما اتمسحتش وهي لسه موجودة، جرب تاني');
        });
    };
    // حوار واحد (D3، 2026-10-30، قرار مؤمن): لو محفظة مؤرشفة هتتأثر، شيت التسوية هي
    // السؤال نفسه (فيها "متأكد؟" والتحذير وزرار "حذف") — مش Alert وبعده شيت فوق بعض
    if (settle.needsSettlement(changes)) {
      settle.request(changes, run, { intro: message, confirmLabel: 'حذف' });
      return;
    }
    confirm('حذف العملية', message, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: () => {
          if (deleting.current) return;
          try {
            // `run` بتمسك الرجوع (`deletingBusy`) لحد ما الحذف يرجع — مفيش `setBusy(false)` هنا (كان بيفك المنع والحذف شغال)
            settle.request(changes, run);
          } catch {
            // فشل التجهيز (stageReconcile) بيتمسك جوه `run` نفسها (الـpromise بتاع
            // `deleteTransaction`)؛ فشل الكتابة بيعدي من `track` وبيتعرض مسمّى بالسجل.
            // فاضل هنا للأخطاء المتزامنة في `settle.request` نفسها.
            setError('حصل خطأ والعملية لسه موجودة، جرب تاني');
          }
        }
      },
    ]);
  }

  if (waiting) {
    return (
      <View testID="tx_waiting" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        {nav && <BlockLeave when={blockLeave} />}
        <ScreenTitle style={styles.screenTitle}>تعديل عملية</ScreenTitle>
        <View style={styles.noWallets}>
          {/* قراية اترفضت (مش نت بطيء): "اتأكد من النت" كانت هتبقى كدب، والاستنى مش هيخلص لوحده */}
          {loadErrors.length > 0 ? (
            <>
              <Text style={styles.noWalletsText}>فيه بيانات ما قدرناش نجيبها، فمش هنعرف العملية دي مربوطة بإيه. جرب تاني، ولو فضلت كده شوف البانر في الرئيسية.</Text>
              <Button testID="tx_waiting_retry" label="جرب تاني" onPress={retryLoad} />
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.accent} accessibilityLabel="بنجيب بياناتك" />
              <Text style={styles.noWalletsText}>لسه بنجيب بياناتك عشان نعرف العملية دي مربوطة بإيه. لو الموضوع طوّل، اتأكد إن النت شغال.</Text>
            </>
          )}
          <Button testID="tx_waiting_back" label="رجوع" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  if (linkChanged) {
    return (
      <View testID="tx_link_changed" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        {nav && <BlockLeave when={blockLeave} />}
        <ScreenTitle style={styles.screenTitle}>{TX_EDIT_OUTCOME_ALERT.gone.title}</ScreenTitle>
        <View style={styles.noWallets}>
          <Text style={styles.noWalletsText}>{TX_EDIT_OUTCOME_ALERT.gone.body}</Text>
          <Button testID="tx_link_changed_back" label="رجوع" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  if (missing) {
    return (
      <View testID="tx_missing" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        {nav && <BlockLeave when={blockLeave} />}
        <ScreenTitle style={styles.screenTitle}>تعديل عملية</ScreenTitle>
        <View style={styles.noWallets}>
          <Text style={styles.noWalletsText}>العملية دي مبقتش موجودة، غالبًا اتمسحت. ومفيش تعديل اتحفظ.</Text>
          <Button testID="tx_missing_back" label="رجوع" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  // التسوية بترجّع رصيد مؤرشفة لصفر — تعديلها أو مسحها كان هيطلب تسوية للتسوية.
  // نفس قفل YNAB على عمليات التسوية: بتبان، ومبتتعدّلش
  if (existing?.isSettlement) {
    return (
      <View testID="tx_settlement_locked" style={[styles.container, styles.content, { paddingTop: insets.top + 16 }]}>
        {nav && <BlockLeave when={blockLeave} />}
        <ScreenTitle style={styles.screenTitle}>تسوية محفظة مؤرشفة</ScreenTitle>
        <View style={styles.noWallets}>
          <Text style={styles.noWalletsText}>دي اتعملت لوحدها عشان رصيد المحفظة المؤرشفة يرجع صفر، فمبتتعدّلش ولا تتمسح. لو عايز تصلّح حاجة، عدّل العملية الأصلية اللي على المحفظة دي.</Text>
          <Button testID="tx_settlement_back" label="رجوع" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    {nav && <BlockLeave when={blockLeave} />}
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <ScreenTitle style={styles.screenTitle}>{isEdit ? 'تعديل عملية' : 'عملية جديدة'}</ScreenTitle>

      {!isEdit && noActiveWallets && (
        <View testID="tx_no_wallets" style={styles.noWallets}>
          <Text style={styles.noWalletsText}>مفيش ولا محفظة لسه — ضيف محفظة الأول، وبعدين سجّل العملية.</Text>
          {/* replace مش push: المودال بيتقفل والرجوع من المحافظ بيودّي الرئيسية مش لفورم فاضي */}
          <Button testID="tx_no_wallets_add" label="ضيف محفظة" onPress={() => router.replace('/settings-screens/wallets')} />
        </View>
      )}

      <View style={styles.row}>
        {TYPES.map(t => (
          <TouchableOpacity accessibilityRole="radio" key={t.key} testID={`tx_type_${t.key}`} onPress={() => { edited(); setType(t.key); }}
            disabled={typeLocked && type !== t.key}
            accessibilityState={{ checked: type === t.key, disabled: typeLocked && type !== t.key }}
            accessibilityHint={typeLocked ? 'النوع ثابت للعملية دي — السبب مكتوب تحت' : undefined}
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

      {/* الاسم على الخانة نفسها (accessibilityLabel) — السطر الظاهر كان بيتقري لوحده محطة زيادة */}
      <Text style={styles.label} accessible={false} importantForAccessibility="no">المبلغ</Text>
      {/* "+" بيودّي على كتابة الرقم على طول (2026-09-29): الكيبورد بيفتح لوحده في عملية
          جديدة. مش في التعديل (جه يبص الأول)، ولا من غير محفظة (الكيبورد كان هيغطي
          "ضيف محفظة" عشان رقم مش هيتحفظ). زرار الحفظ في فوتر لاصق فوق الكيبورد */}
      <TextInput testID="tx_amount_input" style={styles.bigInput} value={amount} onChangeText={v => { edited(); setAmount(v); }}
        autoFocus={!id && !noActiveWallets} accessibilityLabel="المبلغ" accessibilityHint="رقم بالجنيه"
        placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />
      <AmountPreview amount={amount} value={amountValue} projections={projections} />

      <Text style={styles.label}>{type === 'withdraw' ? 'من محفظة' : 'المحفظة'}</Text>
      <View style={styles.chipRow}>
        {selectableOptions(wallets, walletId).map(w => (
          <TouchableOpacity {...selectionA11y(walletId === w.id, 'radio')} key={w.id} onPress={() => { if (error) setError(''); fromW.pickWallet(w.id); }}
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
              <TouchableOpacity {...selectionA11y(toWalletId === w.id, 'radio')} key={w.id} onPress={() => { if (error) setError(''); fromW.freeze(); toW.pickWallet(w.id); }}
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
              <TouchableOpacity {...selectionA11y(categoryId === c.id, 'radio')} key={c.id} onPress={() => { edited(); setCategoryId(c.id); }}
                style={[styles.chip, quietSelectionStyle(colors, categoryId === c.id)]}>
                <View style={categoryInlineRow}>
                  <CategoryIcon icon={c.icon} size={categoryIconSize.chip} tint={categoryColors.get(c.id)} onSelected={categoryId === c.id} />
                  <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: typeScale.body, flexShrink: 1 }}>{categoryLabel(c, { icon: false })}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label} accessible={false} importantForAccessibility="no">التاريخ</Text>
      <TouchableOpacity testID="tx_date_button" accessibilityRole="button" style={styles.dateBtn} onPress={() => setShowDatePicker(true)}
        accessibilityLabel={`التاريخ، ${dateText(date, todayStr())}`} accessibilityHint="يفتح التقويم">
        <Text style={styles.dateBtnText}>{dateText(date, todayStr())}</Text>
      </TouchableOpacity>

      <Text style={styles.label} accessible={false} importantForAccessibility="no">ملاحظة</Text>
      <TextInput maxLength={NOTE_MAX_LENGTH} style={styles.input} value={note} onChangeText={v => { edited(); setNote(v); }} accessibilityLabel="ملاحظة"
        placeholder="اختياري" placeholderTextColor={colors.textSecondary} textAlign="right" />

      <CalendarPickerModal
        visible={showDatePicker}
        value={date}
        onSelect={d => { edited(); setDate(d); }}
        onClose={() => setShowDatePicker(false)}
      />
    </ScrollView>

    {/* برّه الـScrollView، فوق الأزرار اللاصقة: على فورم طويل كانت بتتعرض تحت آخر حقل
        والمستخدم يدوس "حذف" والشيت تتقفل ومفيش حاجة باينة (silent-failure-hunter، الجولة 2 على D3) */}
    {/* متركّب دايمًا وفاضي من غير خطأ — المنطقة الحية على أندرويد بتتقري (الجولة 2، بند 3) */}
    <Text testID="tx_error" style={error ? styles.error : styles.errorEmpty} {...errorA11y}>{error}</Text>

    <View style={styles.footer}>
      {isEdit && (
        <Button testID="tx_delete_button" variant="danger" label="حذف" style={styles.deleteBtn} onPress={handleDelete}
          disabled={busy || saveGuard || syncing} busy={deletingBusy} />
      )}
      <Button variant="secondary" label="إلغاء" style={styles.cancelBtn} onPress={() => router.back()} disabled={busy || deletingBusy || syncing} />
      <Button testID="tx_save_button" label="حفظ" style={styles.saveBtn} onPress={handleSave} busy={busy || saveGuard || syncing} disabled={deletingBusy} />
    </View>

    {settle.sheet}
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors, insetBottom: number) {
  return StyleSheet.create({
    screenTitle: { marginBottom: space.xxl },
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxxl, paddingBottom: 24 },
    row: { flexDirection: 'row-reverse', gap: space.sm, marginBottom: space.sm },
    // دراسة الشكل خطوة 2: الشرايح من غير إطار لحد ما تتختار (`quietSelectionStyle`)، 44 للمس، والمبلغ هو البطل
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, minHeight: MIN_TOUCH, justifyContent: 'center', alignItems: 'center' },
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxl, marginBottom: space.xs },
    // حافة ≥ 3:1 (a11y-architect: من غيرها الخانة الفاضية 1.06:1 في الفاتح ومالهاش حدود)
    bigInput: bigAmountInputStyle(c),
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, fontSize: typeScale.body, paddingHorizontal: space.xl, paddingVertical: space.md },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: space.xl, paddingVertical: space.lg },
    dateBtnText: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', marginTop: space.sm, paddingHorizontal: space.xxxl },
    errorEmpty: { height: 0, margin: 0, padding: 0 },
    lockedHint: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.sm, lineHeight: 18 },
    noWallets: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.warnBorder, borderRadius: radius.lg, padding: space.xl, gap: space.md, marginBottom: space.sm },
    noWalletsText: { color: c.text, fontSize: typeScale.body, textAlign: 'right', lineHeight: 21 },
    footer: stickyFooterStyle(c, c.bg, insetBottom),
    cancelBtn: { flex: 1 },
    deleteBtn: { flex: 1 },
    saveBtn: { flex: 2 },
    btnBusy: { opacity: 0.6 },
  });
}

/**
 * `usePreventRemove` جوه كومبوننت لوحده: بيحتاج navigator (بيرمي من غيره)، والمودال بيترسم في اختبارات
 * من غير navigator. بيرجّع `null` فمبيغيّرش شكل الشجرة (NUQTA-3)، ووجوده مبيتغيّرش وقت التشغيل.
 * بيغطي زرار أندرويد والسحب على iOS (native-stack بيقرا المنع من `PreventRemoveContext`)
 */
function BlockLeave({ when }: { when: boolean }) {
  usePreventRemove(when, () => { /* الرجوع اتمنع والحفظ لسه شغال — الزرار بيلف، ومفيش حاجة تتعمل */ });
  return null;
}
