import { useTheme } from '@/context/ThemeContext';
import { CHARGE_MODE_LABEL, type ChargeMode } from '@/lib/autoCharge';
import { selectionA11y, selectionStyle, selectionTextColor } from '@/lib/selection';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { radius, space, typeScale, leading } from '@/lib/tokens';
import { PressableScale } from '@/components/PressableScale';

/**
 * "بيسألك الأول" (الافتراضي — أي حاجة بتخصم فلوس) أو "بيتسجل لوحده". نفس شكل اختيار
 * الدخل الثابت (`IncomesView`). `what`: "الاشتراك" / "القسط".
 */
export default function ChargeModePicker({ value, onChange, what, verb, testIDPrefix }: {
  value: ChargeMode; onChange: (m: ChargeMode) => void; what: string;
  /** نفس الكلمة اللي على الكارت: "اتخصم" للاشتراك، "اتدفع" للقسط */
  verb: string; testIDPrefix: string;
}) {
  const { colors } = useTheme();
  return (
    // من غير radiogroup (شوف selection.ts): السؤال داخل اسم كل اختيار، فقارئ الشاشة بيقراه مع كل واحد
    <View>
      <Text style={[styles.label, { color: colors.textSecondary }]} accessible={false}>{`لما معاد ${what} ييجي`}</Text>
      {(['confirm', 'auto'] as const).map(m => {
        const body = m === 'confirm'
          ? `هيظهرلك كارت في الرئيسية: "${verb}؟" — تأكد أو تعدّل المبلغ. مفيش حاجة بتتسجل من غيرك.`
          : `أول ما تفتح التطبيق بعد المعاد هيتسجل، وهيجيلك إشعار إنه اتسجل عشان لو الرقم مختلف تعدّله. بيبدأ من يوم ما تفعّله (حتى لو معاده النهارده) — اللي فات قبله بيسألك.${what === 'القسط' ? ' شهر الاستلام بيسألك دايمًا.' : ''}`;
        return (
        <PressableScale key={m} testID={`${testIDPrefix}_mode_${m}`} onPress={() => onChange(m)}
          accessibilityLabel={`لما معاد ${what} ييجي: ${CHARGE_MODE_LABEL[m]}${m === 'confirm' ? ' (مقترح)' : ''}. ${body}`}
          {...selectionA11y(value === m, 'radio')}
          style={[styles.card, selectionStyle(colors, value === m)]}>
          <Text style={[styles.title, { color: colors.text }]}>{CHARGE_MODE_LABEL[m]}{m === 'confirm' ? ' (مقترح)' : ''}</Text>
          <Text style={[styles.body, { color: selectionTextColor(colors, value === m) }]}>{body}</Text>
        </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xl, marginBottom: space.xs },
  card: { borderWidth: 1.5, borderRadius: radius.lg, padding: space.xl, marginTop: space.lg },
  title: { fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
  body: { fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs, lineHeight: leading.caption },
});
