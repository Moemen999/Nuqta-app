import { useEffect, useState } from 'react';
import { AccessibilityInfo, Text, type StyleProp, type TextStyle } from 'react-native';
import { usePrivacy } from '@/context/PrivacyContext';
import { fmt } from '@/lib/finance';
import { CURRENCY, MONEY_MASK } from '@/lib/money';

/** مدة الكشف لما المستخدم يدوس على رقم مخفي */
export const REVEAL_MS = 3000;

type Props = {
  value: number;
  style?: StyleProp<TextStyle>;
  /** «ج.م» بعد الرقم — افتراضيًا موجودة */
  currency?: boolean;
  /** «+» أو «-» قبل الرقم (العمليات). بتفضل ظاهرة مع القناع: اللون بيقولها أصلاً */
  sign?: string;
};

/**
 * أي مبلغ بيتعرض في شاشة بيعدّي من هنا — مش `fmt` مباشرة. الاختبار
 * `amountsPrivacyInventory` بيرفض `fmt(` في الشاشات إلا في الاستثناءات
 * المكتوبة بأسبابها.
 *
 * الأرقام بعرض ثابت (`tabular-nums`) عشان الرقم ميتهزّش والخانات تحت بعض.
 * لو المبالغ مخفية، الدوسة بتكشف الرقم ده لوحده ٣ ثواني.
 */
export function Money({ value, style, currency = true, sign = '' }: Props) {
  const { amountsHidden } = usePrivacy();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  // لو المستخدم رجّع الإظهار من العين، الكشف المؤقت ملوش لازمة
  useEffect(() => {
    if (!amountsHidden) setRevealed(false);
  }, [amountsHidden]);

  const masked = amountsHidden && !revealed;
  const text = `${sign}${masked ? MONEY_MASK : fmt(value)}${currency ? ` ${CURRENCY}` : ''}`;

  function reveal() {
    setRevealed(true);
    // قارئ الشاشة مش بيعيد قراية النص لوحده لما يتغيّر، والكشف ٣ ثواني بس —
    // من غير الإعلان ده اللي بيستخدم TalkBack بيدوس ومبيسمعش الرقم خالص
    AccessibilityInfo.announceForAccessibility(`${sign}${fmt(value)} ${CURRENCY}`);
  }

  return (
    <Text
      style={[{ fontVariant: ['tabular-nums'] }, style]}
      onPress={masked ? reveal : undefined}
      suppressHighlighting
      accessibilityRole={masked ? 'button' : 'text'}
      accessibilityLabel={masked ? 'مبلغ مخفي' : undefined}
      accessibilityHint={masked ? 'دوس عشان يبان ٣ ثواني' : undefined}
    >
      {text}
    </Text>
  );
}
