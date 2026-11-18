import { Button } from '@/components/Button';
import { Money } from '@/components/Money';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { storableAmount } from '@/lib/linkedEdit';
import { bigAmountInputStyle, overlayStyle, sheetStyle, sheetTitleStyle, space, stickyFooterStyle, typeScale } from '@/lib/tokens';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';

/**
 * قسطك في شهر استلام الجمعية لما القسط الشهري المتخزّن مش مقروء (بيانات قديمة، أو أقل من نص قرش — الجولة 1 على 3a72d99).
 * الاستلام وقسطك بيتسجلوا مع بعض أو مفيش (اختيار أ)، والقسط الشهري نفسه مش بيتعدّل من الجمعية — فالمخرج إن المستخدم
 * يكتب قسطه **للشهر ده بس**. نفس الخانة في شيت "المبلغ مختلف" بتاع الكارت وفي شاشة الجمعية.
 */
export const PAYOUT_INSTALLMENT_INPUT_LABEL = 'قسطك في الشهر ده كام؟';
export const PAYOUT_INSTALLMENT_INPUT_HINT = 'القسط الشهري المتسجّل للجمعية مش رقم صالح، فاكتبه هنا — هيتسجل مصروف من نفس المحفظة للشهر ده بس.';
/** سطر الكارت مكان مبلغ قسطك لما مش مقروء */
export const PAYOUT_INSTALLMENT_UNREADABLE_LINE = 'قسطك الشهري المتسجّل مش رقم صالح — هتكتبه بنفسك قبل ما نسجّل الاستلام.';

/** القسط المكتوب ← مبلغ ينفع يتسجل (مقرّب للقرش وأكبر من صفر)، أو `null` */
export function parseInstallment(value: string): number | null {
  if (value.trim() === '') return null;
  return storableAmount(Number(value.replace(/,/g, '')));
}

/** الخانة نفسها: العنوان، والرقم، والسبب، ورسالة لو المكتوب مش مبلغ */
export function PayoutInstallmentField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const invalid = value.trim() !== '' && parseInstallment(value) === null;
  return (
    <View testID="payout_installment_field">
      <Text style={styles.label}>{PAYOUT_INSTALLMENT_INPUT_LABEL}</Text>
      <TextInput
        testID="payout_installment_input"
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        textAlign="center"
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={PAYOUT_INSTALLMENT_INPUT_LABEL}
        accessibilityHint={PAYOUT_INSTALLMENT_INPUT_HINT}
      />
      {invalid && <Text style={styles.error} accessibilityLiveRegion="polite">القسط لازم يبقى أكبر من صفر.</Text>}
      <Text style={styles.hint}>{PAYOUT_INSTALLMENT_INPUT_HINT}</Text>
    </View>
  );
}

/**
 * شاشة الجمعية: "استلمت" والقسط الشهري مش مقروء ← الشيت ده بدل التأكيد. هو التأكيد نفسه (قاعدة 7): بيقول الاستلام
 * ومحفظته، وقسطك بيتكتب فيه، والزرار مقفول لحد ما المكتوب يبقى مبلغ.
 */
export default function PayoutInstallmentSheet({ title, payoutAmount, walletName, busy, onSave, onClose }: {
  title: string; payoutAmount: number; walletName: string; busy: boolean;
  onSave: (installment: number) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [value, setValue] = useState('');
  const installment = parseInstallment(value);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.overlay}>
          <View style={styles.sheet} accessibilityViewIsModal testID="payout_installment_sheet">
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text>
              <Text style={styles.summary}>
                هيتسجل استلام <Money value={payoutAmount} /> في {walletName}، ومعاه قسطك من نفس المحفظة.
              </Text>
              <PayoutInstallmentField value={value} onChange={setValue} />
            </ScrollView>
            <View style={styles.footer}>
              <Button variant="secondary" label="إلغاء" style={styles.cancelBtn} onPress={onClose} />
              <Button testID="payout_installment_save" label="سجّل الاستلام" style={styles.saveBtn}
                disabled={installment === null} busy={busy} onPress={() => { if (installment !== null) onSave(installment); }} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    label: { color: c.text, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right', marginTop: space.lg },
    input: { ...bigAmountInputStyle(c), fontVariant: ['tabular-nums'] },
    error: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', marginTop: space.md },
    hint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'center', marginTop: space.md },
    summary: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', marginTop: space.sm },
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '80%' }), padding: 0, overflow: 'hidden' },
    sheetContent: { padding: space.xxxl },
    sheetTitle: sheetTitleStyle(c, 14),
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
  });
}
