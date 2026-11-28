import { ActionSheet } from '@/components/ActionSheet';
import { Button } from '@/components/Button';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { Money } from '@/components/Money';
import { usePrivacy } from '@/context/PrivacyContext';
import { overdueCountPhrase, overdueDaysPhrase, whenPhrase } from '@/lib/notificationStatus';
import { moneyText, speakable } from '@/lib/money';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { AMOUNT_CHANGED_ALERT, CHARGE_MISSING_ALERT, CHARGE_UNCERTAIN_ALERT, PAY_OUTCOME_ALERT, PERIOD_CHANGED_ALERT, useData, type Subscription } from '@/context/DataContext';
import { CUSTOM_DAYS_FIELD, CUSTOM_FREQUENCY_BUTTON, frequencyLabel } from '@/lib/frequencyLabel';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { cascadeDeleteBlock, cascadeDeleteConfirm, linkedTransactions, selectableOptions, subscriptionsPhrase, subscriptionTransactionIds } from '@/lib/archiving';
import FoldedSection from '@/components/FoldedSection';
import { splitDone } from '@/lib/doneSections';
import { dateText } from '@/lib/dateText';
import { CategoryIcon, categoryInlineRow } from '@/components/CategoryIcon';
import { useChartColors } from '@/hooks/use-chart-colors';
import { categoryLabel, categoryLabelById, daysUntil, todayStr, walletHistoryName } from '@/lib/finance';
import { defaultWalletId } from '@/lib/defaultWallet';
import { useWalletDefault } from '@/lib/useWalletDefault';
import { legacyNote, parseEntryNumber, subscriptionEntryProblem } from '@/lib/entryValidation';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import ChargeModePicker from '@/components/ChargeModePicker';
import { walletsNotReadyNotice } from '@/lib/listenerErrors';
import { subscriptionOpenCharges, subscriptionPayConfirmBody, subscriptionPayKey, subscriptionResumeDate, type ChargeMode } from '@/lib/autoCharge';
import { cardElevation, MIN_TOUCH, categoryIconSize, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle, typeScale, bigAmountInputStyle } from '@/lib/tokens';
import { BUSY_NOTICE, useBusy, useBusyKey } from '@/lib/useBusy';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { EmptyHint } from '@/components/EmptyHint';
import { NAME_MAX_LENGTH } from '@/lib/textLimits';
import { PressableScale } from '@/components/PressableScale';

// الاسم من مكان واحد: "كل 45 يوم" بدل "مخصص" (lib/frequencyLabel.ts)

export const SUBSCRIPTION_STOPPED_ALERT = {
  title: 'الاشتراك ده واقف',
  body: 'ما اتسجلش أي خصم. رجّعه الأول لو عايز تسجّل دفعة.',
};
export const SUBSCRIPTION_RESUME_WALLET_ALERT = {
  title: 'محتاج محفظة تانية',
  body: 'المحفظة المربوطة بيه اتمسحت أو اتأرشفت وهو واقف. عدّل الاشتراك واختار محفظة شغالة، وبعدين رجّعه.',
};
/** معاد الاشتراك المتخزّن مش تاريخ مقروء ← مفيش تأكيد لفترة مجهولة */
export const SUBSCRIPTION_DATE_UNREADABLE_ALERT = {
  title: 'معاد الاشتراك مش مقروء',
  body: 'ما اتسجلش أي خصم. عدّل الاشتراك وظبّط معاده وجرب تاني.',
};
/** الرجوع ذري من السيرفر — النتيجة قاطعة: رجع ولا لسه واقف */
export const SUBSCRIPTION_RESUME_FAIL_ALERT = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'الاشتراك لسه واقف. الرجوع لازم يتأكد من السيرفر عشان معاده الجاي يبقى صح — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما رجعش',
    body: 'الاشتراك لسه واقف. اتأكد إن النت شغال وجرب تاني.',
  },
};

/**
 * مرات متأخرة لسه ما اتسجلتش هتتشال لو المعاد اتقدّم لـ`next` (أو لو الاشتراك اتوقف ورجع) — الجدول بيبدأ من المعاد
 * الجديد. اللي رجعت تسأل مبتتشالش (بتسأل لوحدها). مصدر واحد للإيقاف والتعديل (بند D، 2026-11-17).
 */
function overdueDroppedCount(s: Subscription, next?: string) {
  return subscriptionOpenCharges(s, todayStr()).filter(c => !s.closed?.[c.key]?.reopened && (next === undefined || c.key < next)).length;
}
const overduePhrase = overdueCountPhrase;

export default function SubscriptionsView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { subscriptions, wallets, categories, transactions, loadErrors, figuresPending, deleteSubscription, markSubscriptionPaid, setSubscriptionActive } = useData();
  const { amountsHidden } = usePrivacy();
  const notice = useNotice();
  // دوسة اتسقطت عشان عملية تانية شغالة ← بتتقال (مش بتختفي)
  const onBusy = () => notice(BUSY_NOTICE.title, BUSY_NOTICE.body);
  const confirm = useConfirm();
  const { busyKey, run: runBusy } = useBusyKey(onBusy);
  // الرجوع بقفل لوحده: "اتخصم" على اشتراك تاني بياخد لحد ~10 ثواني، ونفس القفل كان بيبلع "رجّعه" ساكت
  const { busyKey: resumeBusyKey, run: runResume } = useBusyKey(onBusy);
  const [showAdd, setShowAdd] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  // قايمة "⋯": المعرّف بس — الاشتراك بيتقري حي (نفس كارت الدين)
  const [menuSubId, setMenuSubId] = useState<string | null>(null);
  // آخر اشتراك اتفتح عليه (للعنوان وهي بتنزل) — بيتحط وقت الدوسة، مش وقت الرسم
  const [menuSnapshot, setMenuSnapshot] = useState<Subscription | null>(null);

  const sorted = [...subscriptions].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  // "اشتراكات واقفة" مطوي تحت (قرار مؤمن 2026-11-02) — نفس غلاف "ديون اتسددت"
  const { active, done: stopped } = splitDone(sorted, sub => sub.active === false);

  function confirmStop(s: Subscription) {
    // مرة متأخرة لسه ما اتسجلتش ← الرجوع بعدين بيبدأ من المعاد الجاي فهتتشال، فلازم تتقال دلوقتي
    // (money-reviewer، جولة 1)
    const overdue = overdueDroppedCount(s);
    const overdueLine = overdue > 0
      ? ` عليه ${overduePhrase(overdue)} لسه ما اتسجلتش — سجّلها أو فوّتها الأول، لأنها مش هتتسجل لو رجّعته بعدين.`
      : '';
    confirm('توقّف الاشتراك ده مؤقتًا؟', `"${s.name}" مش هيتخصم ولا هيفكّرك بيه لحد ما ترجّعه. الدفعات اللي اتسجلت بتفضل زي ما هي.${overdueLine}`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'وقّفه', onPress: () => {
          // كتابة عادية بتشتغل من غير نت ومبتستناش — مفيش قفل انشغال (كان بيبلع الضغطة)
          setSubscriptionActive(s.id, false);
          AccessibilityInfo.announceForAccessibility(`وقّفنا "${s.name}"، هتلاقيه في اشتراكات واقفة`);
        },
      },
    ]);
  }
  function confirmResume(s: Subscription) {
    const next = subscriptionResumeDate(s, todayStr());
    confirm('ترجّع الاشتراك ده؟', `هيرجع من معاده الجاي: ${dateText(next, todayStr())}. المرات اللي فاتت مش هتتسجل، إلا اللي مستنية ردك في الرئيسية.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'رجّعه', onPress: () => runResume(`resume_${s.id}`, async () => {
          const outcome = await setSubscriptionActive(s.id, true);
          if (outcome === 'wallet-missing') notice(SUBSCRIPTION_RESUME_WALLET_ALERT.title, SUBSCRIPTION_RESUME_WALLET_ALERT.body);
          else if (outcome === 'missing') notice('الاشتراك ده اتمسح', 'اتمسح من جهاز تاني، فمفيش حاجة ترجع.');
          else if (outcome === 'no-connection' || outcome === 'failed') notice(SUBSCRIPTION_RESUME_FAIL_ALERT[outcome].title, SUBSCRIPTION_RESUME_FAIL_ALERT[outcome].body);
          else AccessibilityInfo.announceForAccessibility(`رجّعنا "${s.name}"`);
        }),
      },
    ]);
  }

  /** نفس فحص الدين: عملية من الاشتراك على محفظة مؤرشفة ← ممنوع قبل التأكيد */
  function confirmDelete(s: Subscription) {
    // بند H: كل عمليات الاشتراك (history + closed + subscriptionId) — نفس اللي المسح بيمسحه
    const txIds = subscriptionTransactionIds(s, transactions);
    const blocked = cascadeDeleteBlock({ kind: 'subscription', name: s.name, txIds, transactions, wallets, loadErrors, loading: figuresPending });
    if (blocked) { notice(blocked.title, blocked.body); return; }
    // المسح بيشيل كل الدفعات اللي اتسجلت والرصيد بيتحرك — التأكيد لازم يقول كده
    const { title, body } = cascadeDeleteConfirm('subscription', s.name, linkedTransactions(txIds, transactions).length);
    confirm(title, body, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'امسحه', style: 'destructive', onPress: () => runBusy(`del_${s.id}`, async () => {
          const result = await deleteSubscription(s.id);
          if (result.outcome === 'blocked') notice(result.title, result.body);
        }),
      },
    ]);
  }
  function confirmPay(s: Subscription) {
    // محفظة مؤرشفة أو ممسوحة ← الكتابة الذرية هترفض (wallet-missing)، فمنوعدش بخصم من غير ما نفتح التأكيد
    // المحافظ لسه ما وصلتش (أو الـlistener وقع) ← مش نحكم إن المحفظة مفقودة
    const notReady = walletsNotReadyNotice(loadErrors, figuresPending);
    if (notReady) { notice(notReady.title, notReady.body); return; }
    const wallet = wallets.find(w => w.id === s.walletId);
    if (!wallet || wallet.archived) {
      notice(PAY_OUTCOME_ALERT['wallet-missing'].title, PAY_OUTCOME_ALERT['wallet-missing'].body);
      return;
    }
    // الفترة بتتحسب **مرة واحدة**: اللي التأكيد بيسمّيها هي اللي بتتبعت للكتابة، والكتابة بترفض لو اتغيّرت
    const today = todayStr();
    const periodKey = subscriptionPayKey(s, today);
    if (periodKey === null) {
      console.warn('[subscription] unreadable due date, pay confirm not offered');
      notice(SUBSCRIPTION_DATE_UNREADABLE_ALERT.title, SUBSCRIPTION_DATE_UNREADABLE_ALERT.body);
      return;
    }
    confirm('تسجيل الدفع', subscriptionPayConfirmBody(s, walletHistoryName(wallets, s.walletId), today, periodKey), [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'سجّل الخصم',
        onPress: () => runBusy(`pay_${s.id}`, async () => {
          // العملية دي بتقرا من السيرفر، فبتاخد وقتها لحد ما تطلع بإجابة قاطعة
          // (أقصاها ~10 ثواني) — والزرار بيلف طول الوقت ده عشان يبان إنه شغال.
          // نفس الرسايل بالظبط في شاشة الجمعية
          // المبلغ اللي في جملة التأكيد بالظبط — لو اتعدّل من جهاز تاني والتأكيد مفتوح، الذرة بترفض
          // + الفترة اللي في الجملة: لو جهاز تاني قفلها، الذرة بترفض (period-changed) بدل ما تقفل اللي بعدها
          const outcome = await markSubscriptionPaid(s.id, todayStr(), s.amount, periodKey);
          if (outcome === 'missing') {
            notice(CHARGE_MISSING_ALERT.subscription.title, CHARGE_MISSING_ALERT.subscription.body);
          } else if (outcome === 'uncertain') {
            // ممكن يكون اتسجل — ممنوع "ما اتسجلش" (المستخدم كان هيعيد ويتخصم مرتين)
            notice(CHARGE_UNCERTAIN_ALERT.title, CHARGE_UNCERTAIN_ALERT.body);
          } else if (outcome === 'amount-changed') {
            notice(AMOUNT_CHANGED_ALERT.subscription.title, AMOUNT_CHANGED_ALERT.subscription.body);
          } else if (outcome === 'period-changed') {
            notice(PERIOD_CHANGED_ALERT.title, PERIOD_CHANGED_ALERT.body);
          } else if (outcome === 'stopped') {
            notice(SUBSCRIPTION_STOPPED_ALERT.title, SUBSCRIPTION_STOPPED_ALERT.body);
          } else if (outcome === 'already-paid-today') {
            notice('اتسجل النهاردة خلاص', `دفعة "${s.name}" اتسجلت النهاردة بنفس المبلغ، فما سجلناش تاني عشان ميتخصمش مرتين. لو عليه مرة متأخرة تانية، هتلاقيها في الرئيسية "اتخصم؟".`);
          } else if (outcome !== 'done') {
            const m = PAY_OUTCOME_ALERT[outcome];
            notice(m.title, m.body);
          }
        }),
      },
    ], { key: `pay_${s.id}` });
  }

  function renderSubscription(s: Subscription) {
    const walletLabel = walletHistoryName(wallets, s.walletId);
    const catLabel = categoryLabelById(categories, s.categoryId);
    const days = daysUntil(s.nextDueDate);
    const isStopped = s.active === false;
    const soon = !isStopped && days <= s.reminderDaysBefore;
    // واقف وفيه مرة رجعت تسأل (عمليتها اتمسحت) ← كارتها في الرئيسية، فبيتقال هنا كمان
    const waitingReply = isStopped && subscriptionOpenCharges(s, todayStr()).length > 0;
    const tone = isStopped ? colors.textSecondary : colors.text;
    const dueLine = isStopped ? `واقف مؤقتًا — مش هيتخصم ولا هيفكّرك لحد ما ترجّعه${waitingReply ? '. لسه فيه مرة مستنية ردك في الرئيسية' : ''}`
      : days < 0 ? overdueDaysPhrase(Math.abs(days)) : days === 0 ? 'مستحق النهاردة' : `مستحق ${whenPhrase(days)} (${dateText(s.nextDueDate, todayStr())})`;
    // الكارت جملة واحدة لقارئ الشاشة، والأزرار برّه المجموعة عشان تتفتح لوحدها
    const cardSentence = speakable(`${s.name}، ${moneyText(s.amount, amountsHidden)}، ${walletLabel}${catLabel ? '، ' + catLabel : ''}، ${frequencyLabel(s.frequency, s.customDays)}، ${dueLine}`);
    return (
      <View key={s.id} style={[styles.card, soon && { borderWidth: 1, borderColor: colors.warnBorder }]}>
        <View accessible accessibilityLabel={cardSentence}>
        <View style={styles.cardHead}>
          <Text style={[styles.name, { color: tone }]}>{s.name}</Text>
          <Money value={s.amount} style={[styles.amount, { color: tone }]} />
        </View>
        <Text style={styles.sub}>
          {walletLabel}{catLabel ? ' · ' + catLabel : ''} · {frequencyLabel(s.frequency, s.customDays)}
        </Text>
        <Text style={[styles.due, { color: soon ? colors.accentText : colors.textSecondary }]}>
          {dueLine}
        </Text>
        </View>
        <View style={styles.actionsRow}>
          {isStopped ? (
            <Button testID={`subscription_resume_${s.id}`} size="sm" label="رجّعه" accessibilityLabel={`رجّع اشتراك ${s.name}`}
              onPress={() => confirmResume(s)} busy={resumeBusyKey === `resume_${s.id}`} />
          ) : (
            <Button size="sm" label="اتخصم" accessibilityLabel={`اتخصم اشتراك ${s.name}`}
              onPress={() => confirmPay(s)} busy={busyKey === `pay_${s.id}`} />
          )}
          {/* دراسة الشكل خطوة 3: زرار أساسي واحد (اتخصم/رجّعه) والباقي في "⋯" — نفس كارت الدين */}
          <PressableScale testID={`subscription_more_${s.id}`} accessibilityRole="button" accessibilityLabel={`باقي الاختيارات لاشتراك ${s.name}`}
            accessibilityHint="بيفتح قايمة" disabled={busyKey === `del_${s.id}`} accessibilityState={{ disabled: busyKey === `del_${s.id}`, busy: busyKey === `del_${s.id}` }}
            style={[styles.moreBtn, busyKey === `del_${s.id}` && styles.btnBusy]} onPress={() => { setMenuSnapshot(s); setMenuSubId(s.id); }}>
            <Text style={styles.moreBtnText}>{busyKey === `del_${s.id}` ? '...' : '⋯'}</Text>
          </PressableScale>
        </View>
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
        <Button testID="subscription_add_button" label="+ اشتراك جديد" accessibilityLabel="اشتراك جديد" size="sm" onPress={() => setShowAdd(true)} />
        <Text style={styles.title} accessibilityRole="header">الاشتراكات</Text>
      </View>

      {subscriptions.length === 0 && <EmptyHint testID="subs_empty" icon="repeat-outline" message="مفيش اشتراكات مسجلة" />}
      {subscriptions.length > 0 && active.length === 0 && <EmptyHint testID="subs_empty_active" icon="repeat-outline" message="مفيش اشتراكات شغالة دلوقتي" />}
      {active.map(renderSubscription)}
      <FoldedSection testID="subscriptions_stopped" title="اشتراكات واقفة" a11yLabel={`اشتراكات واقفة، ${subscriptionsPhrase(stopped.length)}`} count={stopped.length}>
        {stopped.map(renderSubscription)}
      </FoldedSection>

      <AddSubscriptionModal visible={showAdd} onClose={() => setShowAdd(false)} />
      {editingSub && <EditSubscriptionModal sub={editingSub} onClose={() => setEditingSub(null)} />}
      {(() => {
        // حي بالمعرّف؛ اتمسح من جهاز تاني والقايمة مفتوحة ← بتتقفل لوحدها
        const live = subscriptions.find(x => x.id === menuSubId) ?? null;
        const m = live ?? menuSnapshot;
        const busy = busyKey !== null || resumeBusyKey !== null;
        return (
          <ActionSheet visible={!!live} testID="subscription_menu" title={m?.name ?? ''} onClose={() => setMenuSubId(null)} actions={m ? [
            { key: 'edit', label: 'تعديل', testID: `subscription_edit_${m.id}`, disabled: busy, onPress: () => setEditingSub(m) },
            ...(m.active !== false ? [{ key: 'stop', label: 'وقّفه مؤقتًا', testID: `subscription_stop_${m.id}`, disabled: busy, onPress: () => confirmStop(m) }] : []),
            { key: 'delete', label: 'امسح الاشتراك', danger: true, testID: `subscription_delete_${m.id}`, disabled: busy, onPress: () => confirmDelete(m) },
          ] : []} />
        );
      })()}
    </ScrollView>
  );
}

function AddSubscriptionModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, transactions, addSubscription } = useData();
  const { categoryColors } = useChartColors();
  const { busy, run: runBusy } = useBusy();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  // المحفظة: آخر محفظة اتستخدمت، بتتبع البيانات لحد أول إدخال وبعدها بتتثبّت. والمودال ده متركّب طول
  // الوقت (`visible` بس بيتغيّر) فكل فتحة بتبدأ من الأول — مبنفضلش على اختيار الفتحة اللي فاتت،
  // اللي ممكن تكون اتأرشفت في الفاصل (ب4)
  const { walletId, pickWallet, freeze, reopen } = useWalletDefault(
    useMemo(() => defaultWalletId({ wallets, transactions, nowMs: Date.now() }), [wallets, transactions]),
  );
  useEffect(() => { if (visible) reopen(); }, [visible, reopen]);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [frequency, setFrequency] = useState<'monthly' | 'yearly' | 'custom'>('monthly');
  const [customDays, setCustomDays] = useState('30');
  const [nextDueDate, setNextDueDate] = useState(todayStr());
  const [reminderDays, setReminderDays] = useState('3');
  const [chargeMode, setChargeMode] = useState<ChargeMode>('confirm');
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    reopen();
    setName(''); setAmount(''); setFrequency('monthly'); setCustomDays('30');
    setNextDueDate(todayStr()); setReminderDays('3'); setError(''); setCategoryId(undefined); setChargeMode('confirm');
  }

  async function handleSave() {
    if (!name.trim() || !walletId) { setError('دخّل اسم ومبلغ ومحفظة صحيحين'); return; }
    // بند 15: "1e999" كان بيتخزّن Infinity، و`Number(x) || 30` كان بيحوّل الغلط
    // لقيمة افتراضية ساكت. دلوقتي الغلط بيترفض برسالته (نفس الفحص جوه DataContext)
    const data = {
      name: name.trim(), amount: parseEntryNumber(amount), walletId, categoryId,
      frequency, customDays: frequency === 'custom' ? parseEntryNumber(customDays) : undefined,
      nextDueDate, reminderDaysBefore: parseEntryNumber(reminderDays), chargeMode,
    };
    const problem = subscriptionEntryProblem(data);
    if (problem) { setError(problem.message); return; }
    await runBusy(async () => {
      try {
        const result = await addSubscription(data);
        if (result.outcome === 'invalid') { setError(result.message); return; }
      } catch {
        // مبيمسكش فشل الكتابة: الكتابة بتعدي من `track` اللي بيبلع الرفض
        // ويعرضه بنفسه مسمّى بالسجل (`lib/writeError.ts`) — والمودال بيكون
        // اتقفل خلاص قبل ما الرفض يوصل، فرسالة جوه الفورم مستحيلة أصلاً.
        // فاضل هنا للأخطاء المتزامنة جوه الـtry نفسه (تجهيز البيانات، التنقل).
        setError('حصل خطأ، جرب تاني');
        return;
      }
      reset();
      onClose();
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle} accessibilityRole="header">اشتراك جديد</Text>

          <Text style={styles.label}>الاسم</Text>
          <TextInput accessibilityLabel="اسم الاشتراك" maxLength={NAME_MAX_LENGTH} style={styles.input} value={name} onChangeText={v => { freeze(); setName(v); }}
            placeholder="مثلاً: نتفليكس" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ</Text>
          <TextInput accessibilityLabel="المبلغ" style={styles.bigInput} value={amount} onChangeText={v => { freeze(); setAmount(v); }}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <PressableScale {...selectionA11y(walletId === w.id, 'radio')} key={w.id} onPress={() => pickWallet(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: typeScale.body }}>{walletHistoryName(wallets, w.id)}</Text>
              </PressableScale>
            ))}
          </View>

          <Text style={styles.label}>الفئة (اختياري)</Text>
          <View style={styles.chipRow}>
            {selectableOptions(categories, categoryId).map(c => (
              <PressableScale {...selectionA11y(categoryId === c.id)} key={c.id} onPress={() => { freeze(); setCategoryId(categoryId === c.id ? undefined : c.id); }}
                style={[styles.chip, selectionStyle(colors, categoryId === c.id)]}>
                <View style={categoryInlineRow}>
                  <CategoryIcon icon={c.icon} size={categoryIconSize.chip} tint={categoryColors.get(c.id)} onSelected={categoryId === c.id} />
                  <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: typeScale.body, flexShrink: 1 }}>{categoryLabel(c, { icon: false })}</Text>
                </View>
              </PressableScale>
            ))}
          </View>

          <Text style={styles.label}>التكرار</Text>
          <View style={styles.row}>
            <PressableScale {...selectionA11y(frequency === 'monthly', 'radio')} onPress={() => { freeze(); setFrequency('monthly'); }} style={[styles.typeBtn, selectionStyle(colors, frequency === 'monthly')]}>
              <Text style={{ color: colors.text, fontSize: typeScale.body }}>شهري</Text>
            </PressableScale>
            <PressableScale {...selectionA11y(frequency === 'yearly', 'radio')} onPress={() => { freeze(); setFrequency('yearly'); }} style={[styles.typeBtn, selectionStyle(colors, frequency === 'yearly')]}>
              <Text style={{ color: colors.text, fontSize: typeScale.body }}>سنوي</Text>
            </PressableScale>
            <PressableScale {...selectionA11y(frequency === 'custom', 'radio')} onPress={() => { freeze(); setFrequency('custom'); }} style={[styles.typeBtn, selectionStyle(colors, frequency === 'custom')]}>
              <Text style={{ color: colors.text, fontSize: typeScale.body }}>{CUSTOM_FREQUENCY_BUTTON}</Text>
            </PressableScale>
          </View>

          {frequency === 'custom' && (
            <>
              <Text style={styles.label}>{CUSTOM_DAYS_FIELD}</Text>
              <TextInput accessibilityLabel="عدد الأيام" style={styles.input} value={customDays} onChangeText={v => { freeze(); setCustomDays(v); }}
                keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          <Text style={styles.label}>أول موعد استحقاق</Text>
          <PressableScale accessibilityRole="button" accessibilityLabel={`أول موعد استحقاق، ${dateText(nextDueDate, todayStr())}`} style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{dateText(nextDueDate, todayStr())}</Text>
          </PressableScale>

          <Text style={styles.label}>التذكير قبل الموعد بكام يوم؟</Text>
          <TextInput accessibilityLabel="عدد أيام التذكير" style={styles.input} value={reminderDays} onChangeText={v => { freeze(); setReminderDays(v); }}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <ChargeModePicker value={chargeMode} onChange={m => { freeze(); setChargeMode(m); }} what="الاشتراك" verb="اتخصم" testIDPrefix="subscription" />

          <CalendarPickerModal visible={showPicker} value={nextDueDate} onSelect={d => { freeze(); setNextDueDate(d); }} onClose={() => setShowPicker(false)} />
        </ScrollView>

        {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
        <View style={styles.footer}>
          <Button variant="secondary" testID="subscription_add_cancel" label="إلغاء" style={styles.cancelBtn} onPress={() => { reset(); onClose(); }} />
          <Button testID="subscription_add_save" label="حفظ" style={styles.saveBtn} onPress={handleSave} busy={busy} />
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scrollArea: { flex: 1 },
    content: { padding: space.xxl, paddingBottom: 40 },
    titleRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xxl },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700' },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.xl, marginBottom: space.md, ...cardElevation(c) },
    cardHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    name: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    amount: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    sub: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    due: { fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs, fontWeight: '600' },
    actionsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
    moreBtn: { minWidth: MIN_TOUCH + space.lg, minHeight: MIN_TOUCH, borderRadius: radius.sm, borderWidth: 1.5, borderColor: c.controlEdge, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    moreBtnText: { color: c.text, fontSize: typeScale.title, fontWeight: '700' },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { padding: space.xxxl },
    sheetTitle: sheetTitleStyle(c, 10),
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xl, marginBottom: space.xs },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, fontSize: typeScale.body, paddingHorizontal: space.xl, paddingVertical: space.md },
    bigInput: bigAmountInputStyle(c),
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: MIN_TOUCH, justifyContent: 'center' },
    row: { flexDirection: 'row-reverse', gap: space.sm },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', paddingVertical: space.md, justifyContent: 'center', minHeight: MIN_TOUCH },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: space.xl, paddingVertical: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    dateBtnText: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', paddingHorizontal: space.xxxl, paddingVertical: space.md },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
    btnBusy: { opacity: 0.6 },
  });
}
function EditSubscriptionModal({ sub, onClose }: { sub: Subscription; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, updateSubscription } = useData();
  const { categoryColors } = useChartColors();
  const { busy, run: runBusy } = useBusy();
  const confirm = useConfirm();

  const [name, setName] = useState(sub.name);
  const [amount, setAmount] = useState(String(sub.amount));
  const [walletId, setWalletId] = useState(sub.walletId);
  const [categoryId, setCategoryId] = useState<string | undefined>(sub.categoryId);
  const [frequency, setFrequency] = useState<'monthly' | 'yearly' | 'custom'>(sub.frequency);
  const [customDays, setCustomDays] = useState(String(sub.customDays || 30));
  const [nextDueDate, setNextDueDate] = useState(sub.nextDueDate);
  const [reminderDays, setReminderDays] = useState(String(sub.reminderDaysBefore ?? 0));
  const [chargeMode, setChargeMode] = useState<ChargeMode>(sub.chargeMode ?? 'confirm');
  const [showPicker, setShowPicker] = useState(false);
  // C2: قيمة قديمة برّه الحدود ← رسالتها بتبان من أول ما التعديل يتفتح
  const [error, setError] = useState(() => legacyNote(subscriptionEntryProblem({
    amount: sub.amount, frequency: sub.frequency, customDays: sub.frequency === 'custom' ? sub.customDays : undefined,
    reminderDaysBefore: sub.reminderDaysBefore ?? 0,
  })));

  async function handleSave() {
    // بعد التقريب مش قبله: "1e999" و"1e307" كانوا بيتخزّنوا Infinity (بند 15)
    if (!name.trim() || !walletId) { setError('دخّل اسم ومبلغ ومحفظة صحيحين'); return; }
    // نفس فحص الإضافة (بند 15)
    const data = {
      name: name.trim(),
      amount: parseEntryNumber(amount),
      walletId,
      categoryId: categoryId ?? undefined,
      frequency,
      customDays: frequency === 'custom' ? parseEntryNumber(customDays) : undefined,
      // بند D (2026-11-17): المعاد بيتبعت بس لو اتغيّر — تعديل الاسم مثلاً مبيلمسش الجدول
      ...(nextDueDate !== sub.nextDueDate ? { nextDueDate } : {}),
      reminderDaysBefore: parseEntryNumber(reminderDays),
      chargeMode,
    };
    const problem = subscriptionEntryProblem(data);
    if (problem) { setError(problem.message); return; }
    // المعاد اتقدّم بعد مرات متأخرة لسه ما اتسجلتش ← هتتشال، فلازم تتقال قبل الحفظ (نفس تأكيد الإيقاف)
    const dropped = nextDueDate > sub.nextDueDate ? overdueDroppedCount(sub, nextDueDate) : 0;
    if (dropped > 0) {
      confirm('نغيّر المعاد؟', `عليه ${overduePhrase(dropped)} لسه ما اتسجلتش قبل المعاد الجديد — مش هتتسجل ومش هنسألك عنها تاني. لو اتخصمت فعلاً، سجّلها أو فوّتها من "مستنيين ردك" الأول.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'غيّر المعاد', onPress: () => { save(data); } },
      ]);
      return;
    }
    await save(data);
  }

  async function save(data: Partial<Subscription>) {
    await runBusy(async () => {
      try {
        const result = await updateSubscription(sub.id, data);
        if (result.outcome === 'invalid') { setError(result.message); return; }
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
          <Text style={styles.sheetTitle} accessibilityRole="header">تعديل اشتراك</Text>

          <Text style={styles.label}>الاسم</Text>
          <TextInput accessibilityLabel="اسم الاشتراك" maxLength={NAME_MAX_LENGTH} style={styles.input} value={name} onChangeText={setName}
            placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ</Text>
          <TextInput accessibilityLabel="المبلغ" style={styles.bigInput} value={amount} onChangeText={setAmount}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <PressableScale {...selectionA11y(walletId === w.id, 'radio')} key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: typeScale.body }}>{walletHistoryName(wallets, w.id)}</Text>
              </PressableScale>
            ))}
          </View>

          <Text style={styles.label}>الفئة (اختياري)</Text>
          <View style={styles.chipRow}>
            {selectableOptions(categories, categoryId).map(c => (
              <PressableScale {...selectionA11y(categoryId === c.id)} key={c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                style={[styles.chip, selectionStyle(colors, categoryId === c.id)]}>
                <View style={categoryInlineRow}>
                  <CategoryIcon icon={c.icon} size={categoryIconSize.chip} tint={categoryColors.get(c.id)} onSelected={categoryId === c.id} />
                  <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: typeScale.body, flexShrink: 1 }}>{categoryLabel(c, { icon: false })}</Text>
                </View>
              </PressableScale>
            ))}
          </View>

          <Text style={styles.label}>التكرار</Text>
          <View style={styles.row}>
            <PressableScale {...selectionA11y(frequency === 'monthly', 'radio')} onPress={() => setFrequency('monthly')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'monthly')]}>
              <Text style={{ color: colors.text, fontSize: typeScale.body }}>شهري</Text>
            </PressableScale>
            <PressableScale {...selectionA11y(frequency === 'yearly', 'radio')} onPress={() => setFrequency('yearly')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'yearly')]}>
              <Text style={{ color: colors.text, fontSize: typeScale.body }}>سنوي</Text>
            </PressableScale>
            <PressableScale {...selectionA11y(frequency === 'custom', 'radio')} onPress={() => setFrequency('custom')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'custom')]}>
              <Text style={{ color: colors.text, fontSize: typeScale.body }}>{CUSTOM_FREQUENCY_BUTTON}</Text>
            </PressableScale>
          </View>

          {frequency === 'custom' && (
            <>
              <Text style={styles.label}>{CUSTOM_DAYS_FIELD}</Text>
              <TextInput accessibilityLabel="عدد الأيام" style={styles.input} value={customDays} onChangeText={setCustomDays}
                keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          <Text style={styles.label}>موعد الاستحقاق الجاي</Text>
          <PressableScale testID="subscription_edit_due" accessibilityRole="button" accessibilityLabel={`موعد الاستحقاق الجاي، ${dateText(nextDueDate, todayStr())}`} style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{dateText(nextDueDate, todayStr())}</Text>
          </PressableScale>

          <Text style={styles.label}>التذكير قبل الموعد بكام يوم؟</Text>
          <TextInput accessibilityLabel="عدد أيام التذكير" style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <ChargeModePicker value={chargeMode} onChange={setChargeMode} what="الاشتراك" verb="اتخصم" testIDPrefix="subscription" />

          <CalendarPickerModal visible={showPicker} value={nextDueDate} onSelect={setNextDueDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

        {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
        <View style={styles.footer}>
          <Button variant="secondary" testID="subscription_edit_cancel" label="إلغاء" style={styles.cancelBtn} onPress={onClose} />
          <Button testID="subscription_edit_save" label="حفظ التعديل" style={styles.saveBtn} onPress={handleSave} busy={busy} />
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
