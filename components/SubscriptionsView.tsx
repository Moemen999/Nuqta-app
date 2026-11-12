import { ActionSheet } from '@/components/ActionSheet';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { Money } from '@/components/Money';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { AMOUNT_CHANGED_ALERT, PAY_OUTCOME_ALERT, useData, type Subscription } from '@/context/DataContext';
import { CUSTOM_DAYS_FIELD, CUSTOM_FREQUENCY_BUTTON, frequencyLabel } from '@/lib/frequencyLabel';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { cascadeDeleteBlock, cascadeDeleteConfirm, linkedTransactions, selectableOptions, subscriptionsPhrase, subscriptionTransactionIds } from '@/lib/archiving';
import FoldedSection from '@/components/FoldedSection';
import { splitDone } from '@/lib/doneSections';
import { categoryLabel, categoryLabelById, daysUntil, todayStr, walletHistoryName } from '@/lib/finance';
import { legacyNote, parseEntryNumber, subscriptionEntryProblem } from '@/lib/entryValidation';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import ChargeModePicker from '@/components/ChargeModePicker';
import { subscriptionOpenCharges, subscriptionPayConfirmBody, subscriptionResumeDate, type ChargeMode } from '@/lib/autoCharge';
import { MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, stickyFooterStyle } from '@/lib/tokens';
import { BUSY_NOTICE, useBusy, useBusyKey } from '@/lib/useBusy';
import { useMemo, useState, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { NAME_MAX_LENGTH } from '@/lib/textLimits';

// الاسم من مكان واحد: "كل 45 يوم" بدل "مخصص" (lib/frequencyLabel.ts)

export const SUBSCRIPTION_STOPPED_ALERT = {
  title: 'الاشتراك ده واقف',
  body: 'ما اتسجلش أي خصم. رجّعه الأول لو عايز تسجّل دفعة.',
};
export const SUBSCRIPTION_RESUME_WALLET_ALERT = {
  title: 'محتاج محفظة تانية',
  body: 'المحفظة المربوطة بيه اتمسحت أو اتأرشفت وهو واقف. عدّل الاشتراك واختار محفظة شغالة، وبعدين رجّعه.',
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

export default function SubscriptionsView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { subscriptions, wallets, categories, transactions, loadErrors, figuresPending, deleteSubscription, markSubscriptionPaid, setSubscriptionActive } = useData();
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
    const overdue = subscriptionOpenCharges(s, todayStr()).filter(c => !s.closed?.[c.key]?.reopened).length;
    const overdueLine = overdue > 0
      ? ` عليه ${overdue === 1 ? 'مرة متأخرة' : `${overdue} مرات متأخرة`} لسه ما اتسجلتش — سجّلها أو فوّتها الأول، لأنها مش هتتسجل لو رجّعته بعدين.`
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
    confirm('ترجّع الاشتراك ده؟', `هيرجع من معاده الجاي: ${next}. المرات اللي فاتت مش هتتسجل، إلا اللي مستنية ردك في الرئيسية.`, [
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
    const txIds = subscriptionTransactionIds(s);
    const blocked = cascadeDeleteBlock({ kind: 'subscription', name: s.name, txIds, transactions, wallets, loadErrors, loading: figuresPending });
    if (blocked) { notice(blocked.title, blocked.body); return; }
    // المسح بيشيل كل الدفعات اللي اتسجلت والرصيد بيتحرك — التأكيد لازم يقول كده
    const { title, body } = cascadeDeleteConfirm('subscription', s.name, linkedTransactions(txIds, transactions).length);
    confirm(title, body, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: () => runBusy(`del_${s.id}`, async () => {
          const result = await deleteSubscription(s.id);
          if (result.outcome === 'blocked') notice(result.title, result.body);
        }),
      },
    ]);
  }
  function confirmPay(s: Subscription) {
    // محفظة مؤرشفة أو ممسوحة ← الكتابة الذرية هترفض (wallet-missing)، فمنوعدش بخصم من غير ما نفتح التأكيد
    const wallet = wallets.find(w => w.id === s.walletId);
    if (!wallet || wallet.archived) {
      notice(PAY_OUTCOME_ALERT['wallet-missing'].title, PAY_OUTCOME_ALERT['wallet-missing'].body);
      return;
    }
    confirm('تسجيل الدفع', subscriptionPayConfirmBody(s, walletHistoryName(wallets, s.walletId), todayStr()), [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تأكيد',
        onPress: () => runBusy(`pay_${s.id}`, async () => {
          // العملية دي بتقرا من السيرفر، فبتاخد وقتها لحد ما تطلع بإجابة قاطعة
          // (أقصاها ~10 ثواني) — والزرار بيلف طول الوقت ده عشان يبان إنه شغال.
          // نفس الرسايل بالظبط في شاشة الجمعية
          // المبلغ اللي في جملة التأكيد بالظبط — لو اتعدّل من جهاز تاني والتأكيد مفتوح، الذرة بترفض
          const outcome = await markSubscriptionPaid(s.id, todayStr(), s.amount);
          if (outcome === 'amount-changed') {
            notice(AMOUNT_CHANGED_ALERT.subscription.title, AMOUNT_CHANGED_ALERT.subscription.body);
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
    return (
      <View key={s.id} style={[styles.card, soon && { borderColor: colors.warnBorder }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.name, { color: tone }]}>{s.name}</Text>
          <Money value={s.amount} style={[styles.amount, { color: tone }]} />
        </View>
        <Text style={styles.sub}>
          {walletLabel}{catLabel ? ' · ' + catLabel : ''} · {frequencyLabel(s.frequency, s.customDays)}
        </Text>
        <Text style={[styles.due, { color: soon ? colors.accent : colors.textSecondary }]}>
          {isStopped ? `واقف مؤقتًا — مش هيتخصم ولا هيفكّرك لحد ما ترجّعه${waitingReply ? '. لسه فيه مرة مستنية ردك في الرئيسية' : ''}`
            : days < 0 ? `متأخر ${Math.abs(days)} يوم` : days === 0 ? 'مستحق النهاردة' : `مستحق بعد ${days} يوم (${s.nextDueDate})`}
        </Text>
        <View style={styles.actionsRow}>
          {isStopped ? (
            <TouchableOpacity testID={`subscription_resume_${s.id}`} style={[styles.payBtn, resumeBusyKey === `resume_${s.id}` && styles.btnBusy]} onPress={() => confirmResume(s)} disabled={resumeBusyKey === `resume_${s.id}`}
              accessibilityRole="button" accessibilityLabel={`رجّع اشتراك ${s.name}`} accessibilityState={{ busy: resumeBusyKey === `resume_${s.id}`, disabled: resumeBusyKey === `resume_${s.id}` }}>
              {resumeBusyKey === `resume_${s.id}` ? (
                <View style={styles.btnLoading}>
                  <ActivityIndicator size="small" color={colors.onAccent} />
                  <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>بنرجّعه</Text>
                </View>
              ) : (
                <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>رجّعه</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.payBtn, busyKey === `pay_${s.id}` && styles.btnBusy]} onPress={() => confirmPay(s)} disabled={busyKey === `pay_${s.id}`}
              accessibilityRole="button" accessibilityLabel={`اتخصم اشتراك ${s.name}`} accessibilityState={{ busy: busyKey === `pay_${s.id}`, disabled: busyKey === `pay_${s.id}` }}>
              {busyKey === `pay_${s.id}` ? (
                <View style={styles.btnLoading}>
                  <ActivityIndicator size="small" color={colors.onAccent} />
                  <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>بنسجّل</Text>
                </View>
              ) : (
                <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>اتخصم</Text>
              )}
            </TouchableOpacity>
          )}
          {/* دراسة الشكل خطوة 3: زرار أساسي واحد (اتخصم/رجّعه) والباقي في "⋯" — نفس كارت الدين */}
          <TouchableOpacity testID={`subscription_more_${s.id}`} accessibilityRole="button" accessibilityLabel={`باقي الاختيارات لاشتراك ${s.name}`}
            accessibilityHint="بيفتح قايمة" disabled={busyKey === `del_${s.id}`} accessibilityState={{ disabled: busyKey === `del_${s.id}`, busy: busyKey === `del_${s.id}` }}
            style={[styles.moreBtn, busyKey === `del_${s.id}` && styles.btnBusy]} onPress={() => { setMenuSnapshot(s); setMenuSubId(s.id); }}>
            <Text style={styles.moreBtnText}>{busyKey === `del_${s.id}` ? '...' : '⋯'}</Text>
          </TouchableOpacity>
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
        <TouchableOpacity accessibilityRole="button" testID="subscription_add_button" style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 13 }}>+ اشتراك جديد</Text>
        </TouchableOpacity>
        <Text style={styles.title}>الاشتراكات</Text>
      </View>

      {subscriptions.length === 0 && <Text style={styles.emptyState}>مفيش اشتراكات مسجلة</Text>}
      {subscriptions.length > 0 && active.length === 0 && <Text style={styles.emptyState}>مفيش اشتراكات شغالة دلوقتي</Text>}
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
            { key: 'delete', label: 'حذف', danger: true, testID: `subscription_delete_${m.id}`, disabled: busy, onPress: () => confirmDelete(m) },
          ] : []} />
        );
      })()}
    </ScrollView>
  );
}

function AddSubscriptionModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, addSubscription } = useData();
  const { busy, run: runBusy } = useBusy();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState(selectableOptions(wallets)[0]?.id);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [frequency, setFrequency] = useState<'monthly' | 'yearly' | 'custom'>('monthly');
  const [customDays, setCustomDays] = useState('30');
  const [nextDueDate, setNextDueDate] = useState(todayStr());
  const [reminderDays, setReminderDays] = useState('3');
  const [chargeMode, setChargeMode] = useState<ChargeMode>('confirm');
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  function reset() {
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
        <View style={styles.sheet}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>اشتراك جديد</Text>

          <Text style={styles.label}>الاسم</Text>
          <TextInput maxLength={NAME_MAX_LENGTH} style={styles.input} value={name} onChangeText={setName}
            placeholder="مثلاً: نتفليكس" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ</Text>
          <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
            placeholder="0" placeholderTextColor={colors.textSecondary} keyboardType="numeric" textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <TouchableOpacity {...selectionA11y(walletId === w.id, 'radio')} key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{walletHistoryName(wallets, w.id)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>الفئة (اختياري)</Text>
          <View style={styles.chipRow}>
            {selectableOptions(categories, categoryId).map(c => (
              <TouchableOpacity {...selectionA11y(categoryId === c.id)} key={c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                style={[styles.chip, selectionStyle(colors, categoryId === c.id)]}>
                <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: 13 }}>{categoryLabel(c)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>التكرار</Text>
          <View style={styles.row}>
            <TouchableOpacity {...selectionA11y(frequency === 'monthly', 'radio')} onPress={() => setFrequency('monthly')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'monthly')]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>شهري</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(frequency === 'yearly', 'radio')} onPress={() => setFrequency('yearly')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'yearly')]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>سنوي</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(frequency === 'custom', 'radio')} onPress={() => setFrequency('custom')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'custom')]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>{CUSTOM_FREQUENCY_BUTTON}</Text>
            </TouchableOpacity>
          </View>

          {frequency === 'custom' && (
            <>
              <Text style={styles.label}>{CUSTOM_DAYS_FIELD}</Text>
              <TextInput style={styles.input} value={customDays} onChangeText={setCustomDays}
                keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          <Text style={styles.label}>أول موعد استحقاق</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{nextDueDate}</Text>
          </TouchableOpacity>

          <Text style={styles.label}>التذكير قبل الموعد بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <ChargeModePicker value={chargeMode} onChange={setChargeMode} what="الاشتراك" verb="اتخصم" testIDPrefix="subscription" />
          {!!error && <Text style={styles.error}>{error}</Text>}


          <CalendarPickerModal visible={showPicker} value={nextDueDate} onSelect={setNextDueDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity accessibilityRole="button" testID="subscription_add_cancel" style={styles.cancelBtn} onPress={() => { reset(); onClose(); }}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="subscription_add_save" style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ'}</Text>
          </TouchableOpacity>
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
    content: { padding: 16, paddingBottom: 40 },
    titleRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    addBtn: { backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: MIN_TOUCH, justifyContent: 'center' },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    cardHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    name: { color: c.text, fontSize: 14.5, fontWeight: '700' },
    amount: { color: c.text, fontSize: 14, fontWeight: '700' },
    sub: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 4 },
    due: { fontSize: 12, textAlign: 'right', marginTop: 6, fontWeight: '600' },
    actionsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    payBtn: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minHeight: MIN_TOUCH, justifyContent: 'center' },
    btnLoading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
    moreBtn: { minWidth: MIN_TOUCH + space.lg, minHeight: MIN_TOUCH, borderRadius: radius.sm, borderWidth: 1.5, borderColor: c.controlEdge, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    moreBtnText: { color: c.text, fontSize: 17, fontWeight: '700' },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { padding: 20 },
    sheetTitle: sheetTitleStyle(c, 10),
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    bigInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: MIN_TOUCH, justifyContent: 'center' },
    row: { flexDirection: 'row-reverse', gap: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 10, justifyContent: 'center', minHeight: MIN_TOUCH },
    dateBtn: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    error: { color: c.dangerText, fontSize: 13, textAlign: 'center', marginTop: 12 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.6 },
  });
}
function EditSubscriptionModal({ sub, onClose }: { sub: Subscription; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, categories, updateSubscription } = useData();
  const { busy, run: runBusy } = useBusy();

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
      nextDueDate,
      reminderDaysBefore: parseEntryNumber(reminderDays),
      chargeMode,
    };
    const problem = subscriptionEntryProblem(data);
    if (problem) { setError(problem.message); return; }
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
        <View style={styles.sheet}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.sheetTitle}>تعديل اشتراك</Text>

          <Text style={styles.label}>الاسم</Text>
          <TextInput maxLength={NAME_MAX_LENGTH} style={styles.input} value={name} onChangeText={setName}
            placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المبلغ</Text>
          <TextInput style={styles.bigInput} value={amount} onChangeText={setAmount}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <Text style={styles.label}>المحفظة</Text>
          <View style={styles.chipRow}>
            {selectableOptions(wallets, walletId).map(w => (
              <TouchableOpacity {...selectionA11y(walletId === w.id, 'radio')} key={w.id} onPress={() => setWalletId(w.id)}
                style={[styles.chip, selectionStyle(colors, walletId === w.id)]}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{walletHistoryName(wallets, w.id)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>الفئة (اختياري)</Text>
          <View style={styles.chipRow}>
            {selectableOptions(categories, categoryId).map(c => (
              <TouchableOpacity {...selectionA11y(categoryId === c.id)} key={c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                style={[styles.chip, selectionStyle(colors, categoryId === c.id)]}>
                <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.text, fontSize: 13 }}>{categoryLabel(c)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>التكرار</Text>
          <View style={styles.row}>
            <TouchableOpacity {...selectionA11y(frequency === 'monthly', 'radio')} onPress={() => setFrequency('monthly')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'monthly')]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>شهري</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(frequency === 'yearly', 'radio')} onPress={() => setFrequency('yearly')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'yearly')]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>سنوي</Text>
            </TouchableOpacity>
            <TouchableOpacity {...selectionA11y(frequency === 'custom', 'radio')} onPress={() => setFrequency('custom')} style={[styles.typeBtn, selectionStyle(colors, frequency === 'custom')]}>
              <Text style={{ color: colors.text, fontSize: 12.5 }}>{CUSTOM_FREQUENCY_BUTTON}</Text>
            </TouchableOpacity>
          </View>

          {frequency === 'custom' && (
            <>
              <Text style={styles.label}>{CUSTOM_DAYS_FIELD}</Text>
              <TextInput style={styles.input} value={customDays} onChangeText={setCustomDays}
                keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          <Text style={styles.label}>موعد الاستحقاق الجاي</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateBtnText}>{nextDueDate}</Text>
          </TouchableOpacity>

          <Text style={styles.label}>التذكير قبل الموعد بكام يوم؟</Text>
          <TextInput style={styles.input} value={reminderDays} onChangeText={setReminderDays}
            keyboardType="numeric" placeholderTextColor={colors.textSecondary} textAlign="right" />

          <ChargeModePicker value={chargeMode} onChange={setChargeMode} what="الاشتراك" verb="اتخصم" testIDPrefix="subscription" />
          {!!error && <Text style={styles.error}>{error}</Text>}


          <CalendarPickerModal visible={showPicker} value={nextDueDate} onSelect={setNextDueDate} onClose={() => setShowPicker(false)} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity accessibilityRole="button" testID="subscription_edit_cancel" style={styles.cancelBtn} onPress={onClose}>
            <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" testID="subscription_edit_save" style={[styles.saveBtn, busy && styles.btnBusy]} onPress={handleSave} disabled={busy}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'حفظ التعديل'}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
