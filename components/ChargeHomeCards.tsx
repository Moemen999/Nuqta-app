import { Money } from '@/components/Money';
import { useNotice } from '@/components/NoticeProvider';
import {
  PAY_OUTCOME_ALERT, PAY_OUTCOME_ALERT_GAMIYA, useData, type ChargeKind, type Gamiya, type Subscription,
} from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { chargeDateLabel, gamiyaOpenCharges, subscriptionOpenCharges, type OpenCharge } from '@/lib/autoCharge';
import { todayStr, walletHistoryName } from '@/lib/finance';
import { MONEY_MASK } from '@/lib/money';
import { incomeDiffNote, morePeriodsPhrase } from '@/lib/recurringIncome';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useBusyKey } from '@/lib/useBusy';
import { useChargeAutoRecord } from '@/lib/useChargeAutoRecord';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

/**
 * كروت "اتخصم؟" — الاشتراكات وأقساط الجمعية اللي "بتأكيد" (الافتراضي) ومعادها
 * جه، + أي فترة رجعت تسأل بعد ما عمليتها اتمسحت، + شهر استلام الجمعية (بيسأل
 * دايمًا). نفس شكل كارت الدخل الثابت "نزل؟". الكروت في شيت "مستنيين ردك"
 * (`PendingSheet`) من 2026-09-29، ورسايل التلقائي في الرئيسية نفسها.
 */

export type PendingCharge = {
  kind: ChargeKind;
  id: string;
  name: string;
  walletId: string;
  charges: OpenCharge[];
  /** شهر الاستلام: فلوس داخلة مش خصم */
  payout: boolean;
  labelOf: (key: string) => string;
};

// "لسه" في الجمعية: الكارت بيستخبّى النهاردة بس (القسط لسه عليك — مش بيتقفل).
// في الذاكرة بس عن قصد: فتحة التطبيق الجاية بكرة بترجّعه
const snoozed = new Set<string>();
const listeners = new Set<() => void>();
let snoozeVersion = 0;
function snooze(key: string) {
  snoozed.add(key);
  snoozeVersion += 1;
  listeners.forEach(l => l());
}
function useSnoozeVersion() {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => snoozeVersion,
  );
}

function pendingFromSubscription(s: Subscription, today: string): PendingCharge | null {
  const charges = subscriptionOpenCharges(s, today).filter(c => !(s.chargeMode === 'auto' && c.autoOk));
  if (charges.length === 0) return null;
  return {
    kind: 'subscription', id: s.id, name: s.name, walletId: s.walletId, charges, payout: false,
    labelOf: key => chargeDateLabel(key, today),
  };
}

/** الأقساط والاستلام منفصلين: الاستلام فلوس داخلة وكارته بيقول كده */
function pendingFromGamiya(g: Gamiya, today: string): PendingCharge[] {
  const open = gamiyaOpenCharges(g, today).filter(c => !(g.chargeMode === 'auto' && c.autoOk));
  const monthOf = (key: string) => g.months.find(m => m.id === key);
  const base = { kind: 'gamiya' as const, id: g.id, name: g.name, walletId: g.walletId, labelOf: (key: string) => `شهر ${monthOf(key)?.monthIndex ?? ''}` };
  const installments = open.filter(c => !monthOf(c.key)?.isPayoutMonth);
  const payouts = open.filter(c => monthOf(c.key)?.isPayoutMonth);
  return [
    ...(installments.length ? [{ ...base, charges: installments, payout: false }] : []),
    ...(payouts.length ? [{ ...base, charges: payouts, payout: true }] : []),
  ];
}

const snoozeKey = (p: PendingCharge, today: string) => `${p.id}:${p.charges[0].key}:${today}`;

/** اللي بيستنى تأكيد دلوقتي — مصدر واحد للكروت ولعدّاد سطر "مستنيين ردك" */
export function usePendingCharges(): PendingCharge[] {
  const { subscriptions, gamiyas } = useData();
  useSnoozeVersion();
  const today = todayStr();
  return [
    ...subscriptions.map(s => pendingFromSubscription(s, today)).filter((x): x is PendingCharge => !!x),
    ...gamiyas.flatMap(g => pendingFromGamiya(g, today)),
  ].filter(p => !snoozed.has(snoozeKey(p, today)));
}

function titleOf(p: PendingCharge) {
  if (p.kind === 'subscription') return `🧾 اشتراك "${p.name}" اتخصم؟`;
  return p.payout ? `🤝 استلمت جمعية "${p.name}"؟` : `🤝 قسط جمعية "${p.name}" اتدفع؟`;
}
function yesLabel(p: PendingCharge) {
  if (p.kind === 'subscription') return 'اتخصم';
  return p.payout ? 'استلمت' : 'اتدفع';
}

/**
 * رسايل الخصم التلقائي ("سجلنا …" / "ما سجلناش …") — في الرئيسية على طول.
 * هنا كمان بيشتغل الخصم التلقائي نفسه (`useChargeAutoRecord`)، فلازم يفضل
 * متركّب في الرئيسية حتى لو الشيت مقفول.
 */
export function ChargeAutoNotices() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { notices, dismiss } = useChargeAutoRecord();

  // نتيجة فلوس (اتسجل / ما اتسجلش): `accessibilityLiveRegion` أندرويد بس
  const announced = useRef(new Set<string>());
  useEffect(() => {
    notices.forEach(n => {
      if (announced.current.has(n.id)) return;
      announced.current.add(n.id);
      AccessibilityInfo.announceForAccessibility(n.text);
    });
  }, [notices]);

  if (notices.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {notices.map(n => (
        <View key={n.id} testID={`charge_notice_${n.kind}`} style={[styles.notice, n.kind === 'error' && { borderColor: colors.dangerBorder }]}
          accessibilityLiveRegion="polite">
          <Text style={[styles.noticeText, n.kind === 'error' && { color: colors.danger }]}>
            {n.kind === 'recorded' ? '✓ ' : ''}{n.text}
            {n.kind === 'recorded' ? '. لو الرقم مختلف عدّله من الأرشيف.' : ''}
          </Text>
          <TouchableOpacity onPress={() => dismiss(n.id)} style={styles.dismiss}
            accessibilityRole="button" accessibilityLabel="اقفل الرسالة" hitSlop={8}>
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

/** كروت "اتخصم؟"/"اتدفع؟"/"استلمت؟" — جوه شيت "مستنيين ردك". `kind` بيقسمهم مجموعات */
export default function ChargeHomeCards({ kind }: { kind?: ChargeKind } = {}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, recordCharges, skipSubscriptionCharge } = useData();
  const notice = useNotice();
  const { busyKey, run } = useBusyKey();
  const [editing, setEditing] = useState<{ p: PendingCharge; charge: OpenCharge } | null>(null);
  const today = todayStr();
  const pending = usePendingCharges().filter(p => !kind || p.kind === kind);

  const alertFor = (p: PendingCharge) => (p.kind === 'gamiya' ? PAY_OUTCOME_ALERT_GAMIYA : PAY_OUTCOME_ALERT);
  const busyId = (p: PendingCharge) => `charge_${p.id}_${p.payout ? 'in' : 'out'}`;

  /** بيرجّع اتسجل ولا لأ — شيت المبلغ مبيتقفلش على فشل عشان الرقم اللي اتكتب مايضيعش */
  async function record(p: PendingCharge, charge: OpenCharge, amount: number) {
    let ok = false;
    await run(busyId(p), async () => {
      const r = await recordCharges(p.kind, p.id, [{ key: charge.key, amount }]);
      if (r.outcome !== 'done') {
        notice(alertFor(p)[r.outcome].title, alertFor(p)[r.outcome].body);
        return;
      }
      ok = true;
      // اتقفلت قبلنا (جهاز تاني، أو "سدّد" من الشاشة) ← مبلغنا ما اتكتبش، ولازم يتقال
      if (r.recorded.length === 0) {
        notice('اتسجلت قبل كده', 'المرة دي كانت اتسجلت خلاص (من جهاز تاني أو من شاشة الديون)، فما سجلناش تاني. لو المبلغ مختلف عدّله من الأرشيف.');
        return;
      }
      AccessibilityInfo.announceForAccessibility(`اتسجل "${p.name}"`);
    });
    return ok;
  }

  function confirmSkip(p: PendingCharge, charge: OpenCharge) {
    const label = p.labelOf(charge.key);
    Alert.alert(`اشتراك "${p.name}" ما اتخصمش ${label}؟`, `مش هنسجل خصم عن ${label} ومش هنسألك عنه تاني.`, [
      { text: 'رجوع', style: 'cancel' },
      {
        text: 'ما اتخصمش',
        onPress: () => {
          run(busyId(p), async () => {
            const r = await skipSubscriptionCharge(p.id, charge.key);
            if (r !== 'done') notice(PAY_OUTCOME_ALERT[r].title, 'ما اتغيّرش حاجة — لسه هيسألك. جرب تاني أول ما النت يرجع.');
            else AccessibilityInfo.announceForAccessibility(`مش هنسجل خصم "${p.name}" عن ${label}`);
          });
        },
      },
    ]);
  }

  if (pending.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {pending.map(p => {
        const charge = p.charges[0];
        const busy = busyKey === busyId(p);
        const more = p.charges.length - 1;
        return (
          <View key={busyId(p)} style={styles.card} testID={`charge_card_${p.id}${p.payout ? '_payout' : ''}`}>
            <Text style={styles.title}>{titleOf(p)}</Text>
            <Text style={styles.sub}>
              {p.kind === 'subscription' ? `معاده ${p.labelOf(charge.key)}` : p.labelOf(charge.key)} · من {walletHistoryName(wallets, p.walletId)}
              {more > 0 ? ` · ${morePeriodsPhrase(more)} بعدها` : ''}
            </Text>
            <Money value={charge.amount} sign={p.payout ? '+' : '−'} style={[styles.amount, !p.payout && { color: colors.danger }]} />
            <View style={styles.actions}>
              <TouchableOpacity
                testID={`charge_card_yes_${p.id}`}
                style={[styles.yesBtn, busy && { opacity: 0.6 }]}
                disabled={busyKey !== null}
                onPress={() => record(p, charge, charge.amount)}
                accessibilityRole="button"
                accessibilityLabel={busy ? `بنسجّل "${p.name}"` : `"${p.name}" ${yesLabel(p)}`}
                accessibilityState={{ busy }}>
                {busy
                  ? <ActivityIndicator size="small" color={colors.onAccent} />
                  : <Text style={styles.yesText}>{yesLabel(p)}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} disabled={busyKey !== null}
                onPress={() => setEditing({ p, charge })} accessibilityRole="button"
                accessibilityLabel={`"${p.name}" المبلغ مختلف`}>
                <Text style={styles.ghostText}>المبلغ مختلف</Text>
              </TouchableOpacity>
              {p.kind === 'subscription' ? (
                <TouchableOpacity style={styles.ghostBtn} disabled={busyKey !== null}
                  onPress={() => confirmSkip(p, charge)} accessibilityRole="button"
                  accessibilityLabel={`"${p.name}" ما اتخصمش`}>
                  <Text style={styles.ghostText}>ما اتخصمش</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.ghostBtn} disabled={busyKey !== null}
                  onPress={() => {
                    snooze(snoozeKey(p, today));
                    AccessibilityInfo.announceForAccessibility(`"${p.name}" هيسألك تاني بكرة`);
                  }} accessibilityRole="button"
                  accessibilityLabel={`"${p.name}" لسه`} accessibilityHint="الكارت هيستخبّى النهاردة بس">
                  <Text style={styles.ghostText}>لسه</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}

      {editing && (
        <ChargeAmountSheet
          name={editing.p.name}
          question={`${editing.p.payout ? 'استلمت' : editing.p.kind === 'gamiya' ? 'اتدفع' : 'اتخصم'} كام في ${editing.p.labelOf(editing.charge.key)}؟`}
          yes={yesLabel(editing.p)}
          base={editing.charge.amount}
          busy={busyKey === busyId(editing.p)}
          onSave={async amount => { if (await record(editing.p, editing.charge, amount)) setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  );
}

/**
 * مبلغ الفترة دي بس — المبلغ المعتاد مبيتغيّرش. لو المبالغ مخفية الخانة
 * بتبدأ فاضية بقناع، والفاضي معناه "المعتاد" (زي شيت الدخل الثابت).
 */
function ChargeAmountSheet({ name, question, yes, base, busy, onSave, onClose }: {
  name: string; question: string; yes: string; base: number; busy: boolean;
  onSave: (amount: number) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { amountsHidden, money } = usePrivacy();
  const [value, setValue] = useState(amountsHidden ? '' : String(base));
  const typed = value.trim() === '' ? base : Number(value.replace(/,/g, ''));
  const valid = Number.isFinite(typed) && typed > 0;
  const diff = valid && value.trim() !== '' ? incomeDiffNote(typed, base, money) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{question}</Text>
              <TextInput
                testID="charge_amount_input"
                style={styles.bigInput}
                value={value}
                onChangeText={setValue}
                keyboardType="numeric"
                textAlign="center"
                autoFocus
                placeholder={amountsHidden ? `${MONEY_MASK} (المعتاد)` : '0'}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={question}
              />
              {!valid && <Text style={styles.error}>المبلغ لازم يكون أكبر من صفر.</Text>}
              {!!diff && <Text style={styles.diff}>{diff}</Text>}
              <Text style={styles.hint}>{`ده للمرة دي بس — "${name}" هيفضل بمبلغه المعتاد.`}</Text>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} accessibilityRole="button">
                <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="charge_amount_save" style={[styles.saveBtn, (!valid || busy) && { opacity: 0.5 }]}
                disabled={!valid || busy} onPress={() => onSave(typed)}
                accessibilityRole="button" accessibilityLabel={busy ? 'بنسجّل' : yes}
                accessibilityState={{ disabled: !valid || busy, busy }}>
                {busy
                  ? <ActivityIndicator size="small" color={colors.onAccent} />
                  : <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{yes}</Text>}
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
    wrap: { marginBottom: 6 },
    card: {
      backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 10,
      borderWidth: 1, borderColor: c.border, borderRightWidth: 4, borderRightColor: c.accent,
    },
    title: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },
    sub: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 4 },
    amount: { color: c.success, fontSize: 22, fontWeight: '700', textAlign: 'right', marginTop: 8 },
    actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    yesBtn: {
      backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 22, minHeight: MIN_TOUCH,
      alignItems: 'center', justifyContent: 'center',
    },
    yesText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
    ghostBtn: {
      borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, minHeight: MIN_TOUCH,
      alignItems: 'center', justifyContent: 'center',
    },
    ghostText: { color: c.text, fontSize: 13 },
    notice: {
      flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8, backgroundColor: c.surface,
      borderRadius: 12, borderWidth: 1, borderColor: c.borderStrong, padding: 12, marginBottom: 10,
    },
    noticeText: { flex: 1, color: c.textSecondary, fontSize: 13, textAlign: 'right', lineHeight: 19 },
    dismiss: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
    dismissText: { color: c.textMuted, fontSize: 14 },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '70%' }), padding: 0, overflow: 'hidden' },
    sheetContent: { padding: 20 },
    sheetTitle: sheetTitleStyle(c, 14),
    bigInput: {
      backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, color: c.text,
      fontSize: 26, fontWeight: '700', paddingVertical: 14, fontVariant: ['tabular-nums'],
    },
    diff: { color: c.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 10 },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 10 },
    hint: { color: c.textMuted, fontSize: 11.5, textAlign: 'center', marginTop: 10 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
  });
}
