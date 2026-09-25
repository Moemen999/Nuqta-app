import { Money } from '@/components/Money';
import { INCOME_RECORD_ALERT, useData } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { todayStr, walletHistoryName } from '@/lib/finance';
import { MONEY_MASK } from '@/lib/money';
import {
  incomeDiffNote, incomeOpenPeriods, incomePeriodLabel, morePeriodsPhrase, type RecurringIncome,
} from '@/lib/recurringIncome';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useBusyKey } from '@/lib/useBusy';
import { useIncomeAutoRecord } from '@/lib/useIncomeAutoRecord';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

/**
 * كروت الدخل الثابت في الرئيسية:
 * - `"المرتب" نزل؟` لكل دخل بيستنى تأكيد ومعاده جه (الأقدم الأول)
 * - `سجلنا "المرتب" عن سبتمبر وأكتوبر` بعد التسجيل التلقائي
 * - "ما سجلناش …" لو التلقائي فشل — مش بيتبلع
 *
 * شكل مختلف عن بانرات التنبيه عن قصد: خط دهبي على الجنب وعنوان تقيل —
 * دي فلوس داخلة ومحتاجة دوسة، مش تحذير.
 */
export default function IncomeHomeCards() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { incomes, wallets, recordIncomePeriods, skipIncomePeriod } = useData();
  const { notices, dismiss } = useIncomeAutoRecord();
  const { busyKey, run } = useBusyKey();
  const [editing, setEditing] = useState<{ inc: RecurringIncome; key: string } | null>(null);
  const today = todayStr();

  const pending = incomes
    .filter(i => i.mode === 'confirm')
    .map(inc => ({ inc, keys: incomeOpenPeriods(inc, today) }))
    .filter(x => x.keys.length > 0);

  // الكارت بيقع بنعومة بدل ما يختفي فجأة
  function animateOut() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }

  /** بيرجّع اتسجل ولا لأ — شيت المبلغ مبيتقفلش على فشل عشان الرقم اللي اتكتب مايضيعش */
  async function record(inc: RecurringIncome, key: string, amount: number) {
    let ok = false;
    await run(`rec_${inc.id}`, async () => {
      const r = await recordIncomePeriods(inc.id, [{ key, amount }]);
      if (r.outcome !== 'done') {
        Alert.alert(INCOME_RECORD_ALERT[r.outcome].title, INCOME_RECORD_ALERT[r.outcome].body);
        return;
      }
      ok = true;
      animateOut();
      AccessibilityInfo.announceForAccessibility(`اتسجل "${inc.name}"`);
    });
    return ok;
  }

  function confirmSkip(inc: RecurringIncome, key: string) {
    const label = incomePeriodLabel(inc, key, today);
    Alert.alert(`"${inc.name}" ما نزلش ${label}؟`, `مش هنسجل حاجة عن ${label} ومش هنسألك عنه تاني.`, [
      { text: 'رجوع', style: 'cancel' },
      { text: 'ما نزلش', onPress: () => { animateOut(); skipIncomePeriod(inc.id, key); } },
    ]);
  }

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

  if (pending.length === 0 && notices.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {notices.map(n => (
        <View key={n.id} style={[styles.notice, n.kind === 'error' && { borderColor: colors.dangerBorder }]}
          accessibilityLiveRegion="polite">
          <Text style={[styles.noticeText, n.kind === 'error' && { color: colors.danger }]}>
            {n.kind === 'recorded' ? '✓ ' : ''}{n.text}
            {n.kind === 'recorded' ? '. لو الرقم مختلف عدّله من الأرشيف.' : ''}
          </Text>
          <TouchableOpacity onPress={() => { animateOut(); dismiss(n.id); }} style={styles.dismiss}
            accessibilityRole="button" accessibilityLabel="اقفل الرسالة" hitSlop={8}>
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

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
              <TouchableOpacity
                testID={`income_card_yes_${inc.id}`}
                style={[styles.yesBtn, busy && { opacity: 0.6 }]}
                disabled={busyKey !== null}
                onPress={() => record(inc, key, inc.amount)}
                accessibilityRole="button"
                accessibilityLabel={busy ? `بنسجّل "${inc.name}"` : `"${inc.name}" نزل`}
                accessibilityState={{ busy }}>
                {busy
                  ? <ActivityIndicator size="small" color={colors.onAccent} />
                  : <Text style={styles.yesText}>نزل</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} disabled={busyKey !== null}
                onPress={() => setEditing({ inc, key })} accessibilityRole="button">
                <Text style={styles.ghostText}>المبلغ مختلف</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} disabled={busyKey !== null}
                onPress={() => confirmSkip(inc, key)} accessibilityRole="button">
                <Text style={styles.ghostText}>ما نزلش</Text>
              </TouchableOpacity>
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
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} accessibilityRole="button">
                <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="income_amount_save" style={[styles.saveBtn, (!valid || busy) && { opacity: 0.5 }]}
                disabled={!valid || busy} onPress={() => onSave(typed)}
                accessibilityRole="button" accessibilityLabel={busy ? "بنسجّل" : "نزل"}
                accessibilityState={{ disabled: !valid || busy, busy }}>
                {busy
                  ? <ActivityIndicator size="small" color={colors.onAccent} />
                  : <Text style={{ color: colors.onAccent, fontWeight: '700' }}>نزل</Text>}
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
