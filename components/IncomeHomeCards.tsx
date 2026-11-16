import { Button } from '@/components/Button';
import DismissButton from '@/components/DismissButton';
import { Money } from '@/components/Money';
import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import { INCOME_RECORD_ALERT, useData } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { todayStr, walletHistoryName } from '@/lib/finance';
import { MONEY_MASK } from '@/lib/money';
import {
  incomeDiffNote, incomeOpenPeriods, incomePeriodLabel, morePeriodsPhrase, type RecurringIncome,
} from '@/lib/recurringIncome';
import { overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle, typeScale, radius, space, bigAmountInputStyle } from '@/lib/tokens';
import { useBusyKey } from '@/lib/useBusy';
import { useIncomeAutoRecord } from '@/lib/useIncomeAutoRecord';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, View,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';

/**
 * كروت الدخل الثابت:
 * - `"المرتب" نزل؟` لكل دخل بيستنى تأكيد ومعاده جه (الأقدم الأول) — في شيت
 *   "مستنيين ردك" (`PendingSheet`) من 2026-09-29، مش في الرئيسية نفسها
 * - `سجلنا "المرتب" عن سبتمبر وأكتوبر` بعد التسجيل التلقائي — في الرئيسية
 * - "ما سجلناش …" لو التلقائي فشل — في الرئيسية، مش بيتبلع ومش مستخبّي في شيت
 *
 * شكل مختلف عن بانرات التنبيه عن قصد: خط دهبي على الجنب وعنوان تقيل —
 * دي فلوس داخلة ومحتاجة دوسة، مش تحذير.
 */
/** الدخول الثابتة اللي بتستنى "نزل؟" دلوقتي — مصدر واحد للكروت ولعدّاد سطر "مستنيين ردك" */
export function usePendingIncomes() {
  const { incomes } = useData();
  const today = todayStr();
  return incomes
    .filter(i => i.mode === 'confirm')
    .map(inc => ({ inc, keys: incomeOpenPeriods(inc, today) }))
    .filter(x => x.keys.length > 0);
}

/**
 * رسايل التسجيل التلقائي ("سجلنا …" / "ما سجلناش …") — في الرئيسية على طول.
 * هنا كمان بيشتغل التسجيل التلقائي نفسه (`useIncomeAutoRecord`)، فالكومبوننت ده
 * لازم يفضل متركّب في الرئيسية حتى لو الشيت مقفول.
 */
export function IncomeAutoNotices() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { notices, dismiss } = useIncomeAutoRecord();

  // الرسايل دي نتيجة فلوس (اتسجل / ما اتسجلش) — `accessibilityLiveRegion` لوحده
  // أندرويد بس، فVoiceOver كان هيسكت عنها خالص
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
        <View key={n.id} testID={`income_notice_${n.kind}`} style={[styles.notice, n.kind === 'error' && { borderColor: colors.dangerBorder }]}
          accessibilityLiveRegion="polite">
          <Text style={[styles.noticeText, n.kind === 'error' && { color: colors.dangerText }]}>
            {n.kind === 'recorded' ? '✓ ' : ''}{n.text}
            {n.kind === 'recorded' ? '. لو الرقم مختلف عدّله من الأرشيف.' : ''}
          </Text>
          {/* رسالة حدث (اتسجل/ما اتسجلش) مش حالة — الـ✕ هنا بيقفلها خالص ومبترجعش */}
          <DismissButton onPress={() => dismiss(n.id)} label="اقفل الرسالة" />
        </View>
      ))}
    </View>
  );
}

/** كروت "نزل؟" — جوه شيت "مستنيين ردك" */
export default function IncomeHomeCards() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { wallets, recordIncomePeriods, skipIncomePeriod } = useData();
  const notice = useNotice();
  const confirm = useConfirm();
  const { busyKey, run } = useBusyKey();
  const [editing, setEditing] = useState<{ inc: RecurringIncome; key: string } | null>(null);
  const today = todayStr();

  const pending = usePendingIncomes();

  // مفيش حركة خروج للكارت عن قصد: LayoutAnimation ما عملش أي حاجة على الجهاز
  // (Galaxy A56، New Architecture) حتى بمدة 3 ثواني — الكارت بيختفي على طول.
  // حركة بايظة أوحش من مفيش؛ لو اتعملت تاني تبقى بند لوحده بمكتبة تانية (TIMELINE).

  /** بيرجّع اتسجل ولا لأ — شيت المبلغ مبيتقفلش على فشل عشان الرقم اللي اتكتب مايضيعش */
  async function record(inc: RecurringIncome, key: string, amount: number) {
    let ok = false;
    await run(`rec_${inc.id}`, async () => {
      const r = await recordIncomePeriods(inc.id, [{ key, amount }]);
      if (r.outcome !== 'done') {
        notice(INCOME_RECORD_ALERT[r.outcome].title, INCOME_RECORD_ALERT[r.outcome].body);
        return;
      }
      ok = true;
      AccessibilityInfo.announceForAccessibility(`اتسجل "${inc.name}"`);
    });
    return ok;
  }

  function confirmSkip(inc: RecurringIncome, key: string) {
    const label = incomePeriodLabel(inc, key, today);
    confirm(`"${inc.name}" ما نزلش ${label}؟`, `مش هنسجل حاجة عن ${label} ومش هنسألك عنه تاني.`, [
      { text: 'رجوع', style: 'cancel' },
      {
        text: 'ما نزلش', onPress: () => {
          skipIncomePeriod(inc.id, key);
          // زي كارت الاشتراك: الكارت بيختفي، فقارئ الشاشة لازم يسمع حصل إيه (silent-failure-hunter)
          AccessibilityInfo.announceForAccessibility(`مش هنسجل "${inc.name}" عن ${label}`);
        },
      },
    ]);
  }

  if (pending.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {pending.map(({ inc, keys }) => {
        const key = keys[0];
        const busy = busyKey === `rec_${inc.id}`;
        const more = keys.length - 1;
        return (
          <View key={inc.id} style={styles.card} testID={`income_card_${inc.id}`}>
            <Text style={styles.title}>{`💵 "${inc.name}" نزل؟`}</Text>
            <Text style={styles.sub}>
              {incomePeriodLabel(inc, key, today)} · في {walletHistoryName(wallets, inc.walletId)}
              {more > 0 ? ` · ${morePeriodsPhrase(more)} بعدها` : ''}
            </Text>
            <Money value={inc.amount} sign="+" style={styles.amount} />
            <View style={styles.actions}>
              <Button
                testID={`income_card_yes_${inc.id}`}
                label="نزل"
                disabled={busyKey !== null}
                busy={busy}
                onPress={() => record(inc, key, inc.amount)}
                accessibilityLabel={`"${inc.name}" نزل`} />
              <Button variant="secondary" size="sm" label="المبلغ مختلف" disabled={busyKey !== null}
                onPress={() => setEditing({ inc, key })} />
              <Button variant="secondary" size="sm" label="ما نزلش" disabled={busyKey !== null}
                onPress={() => confirmSkip(inc, key)} />
            </View>
          </View>
        );
      })}

      {editing && (
        <IncomeAmountSheet
          inc={editing.inc}
          periodLabel={incomePeriodLabel(editing.inc, editing.key, today)}
          busy={busyKey === `rec_${editing.inc.id}`}
          onSave={async amount => { if (await record(editing.inc, editing.key, amount)) setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  );
}

/**
 * مبلغ الفترة دي بس — الأساس مبيتغيّرش. لو المبالغ مخفية الخانة بتبدأ فاضية
 * بقناع (الرقم المعتاد مايتكتبش على الشاشة من غير ما حد يطلبه)، والفاضي
 * معناه "المعتاد".
 */
function IncomeAmountSheet({ inc, periodLabel, busy, onSave, onClose }: {
  inc: RecurringIncome; periodLabel: string; busy: boolean;
  onSave: (amount: number) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { amountsHidden, money } = usePrivacy();
  const [value, setValue] = useState(amountsHidden ? '' : String(inc.amount));
  const typed = value.trim() === '' ? inc.amount : Number(value.replace(/,/g, ''));
  const valid = Number.isFinite(typed) && typed > 0;
  const diff = valid && value.trim() !== '' ? incomeDiffNote(typed, inc.amount, money) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>نزل كام في {periodLabel}؟</Text>
              <TextInput
                testID="income_amount_input"
                style={styles.bigInput}
                value={value}
                onChangeText={setValue}
                keyboardType="numeric"
                textAlign="center"
                autoFocus
                placeholder={amountsHidden ? `${MONEY_MASK} (المعتاد)` : '0'}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={`مبلغ ${periodLabel}`}
              />
              {!valid && <Text style={styles.error}>المبلغ لازم يكون أكبر من صفر.</Text>}
              {!!diff && <Text style={styles.diff}>{diff}</Text>}
              <Text style={styles.hint}>{`ده للفترة دي بس — "${inc.name}" هيفضل بمبلغه المعتاد.`}</Text>
            </ScrollView>
            <View style={styles.footer}>
              <Button variant="secondary" label="إلغاء" style={styles.cancelBtn} onPress={onClose} />
              <Button testID="income_amount_save" label="نزل" style={styles.saveBtn}
                disabled={!valid} busy={busy} onPress={() => onSave(typed)} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginBottom: space.xs },
    card: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: space.xl, marginBottom: space.md,
      borderWidth: 1, borderColor: c.border, borderRightWidth: 4, borderRightColor: c.accent,
    },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right' },
    sub: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    amount: { color: c.incomeText, fontSize: typeScale.figure, fontWeight: '700', textAlign: 'right', marginTop: space.sm },
    actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
    notice: {
      flexDirection: 'row-reverse', alignItems: 'flex-start', gap: space.sm, backgroundColor: c.surface,
      borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderStrong, padding: space.lg, marginBottom: space.md,
    },
    noticeText: { flex: 1, color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', lineHeight: 19 },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '70%' }), padding: 0, overflow: 'hidden' },
    sheetContent: { padding: space.xxxl },
    sheetTitle: sheetTitleStyle(c, 14),
    bigInput: { ...bigAmountInputStyle(c), fontVariant: ['tabular-nums'] },
    diff: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', marginTop: space.md },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', marginTop: space.md },
    hint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'center', marginTop: space.md },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
  });
}
