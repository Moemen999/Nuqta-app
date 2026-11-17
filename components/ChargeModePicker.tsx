import { useTheme } from '@/context/ThemeContext';
import { CHARGE_MODE_LABEL, type ChargeMode } from '@/lib/autoCharge';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { radius, space, typeScale } from '@/lib/tokens';

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
    // radiogroup بنفس السؤال اللي ظاهر: قارئ الشاشة بيقول إن الاختيارين واحد من اتنين
    <View accessibilityRole="radiogroup" accessibilityLabel={`لما معاد ${what} ييجي`}>
      <Text style={[styles.label, { color: colors.textSecondary }]} accessible={false}>{`لما معاد ${what} ييجي`}</Text>
      {(['confirm', 'auto'] as const).map(m => (
        <TouchableOpacity key={m} testID={`${testIDPrefix}_mode_${m}`} onPress={() => onChange(m)}
          {...selectionA11y(value === m, 'radio')}
          style={[styles.card, selectionStyle(colors, value === m)]}>
          <Text style={[styles.title, { color: colors.text }]}>{CHARGE_MODE_LABEL[m]}{m === 'confirm' ? ' (مقترح)' : ''}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {m === 'confirm'
              ? `هيظهرلك كارت في الرئيسية: "${verb}؟" — تأكد أو تعدّل المبلغ. مفيش حاجة بتتسجل من غيرك.`
              : `أول ما تفتح التطبيق بعد المعاد هيتسجل، وهيجيلك إشعار إنه اتسجل عشان لو الرقم مختلف تعدّله. بيبدأ من المعاد الجاي — اللي فات بيسألك.`}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xl, marginBottom: space.xs },
  card: { borderWidth: 1.5, borderRadius: radius.lg, padding: space.xl, marginTop: space.lg },
  title: { fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
  body: { fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs, lineHeight: 18 },
});
