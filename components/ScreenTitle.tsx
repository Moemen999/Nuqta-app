import type { StyleProp, TextStyle } from 'react-native';
import { Text } from '@/components/AppText';
import { useTheme } from '@/context/ThemeContext';
import { typeScale } from '@/lib/tokens';

/**
 * عنوان الشاشة — واحد في كل التطبيق (`typeScale.title`، عريض، لون النص،
 * يمين) وبدور `header` للقارئ. أي شاشة بتعرض عنوانها بيعدّي من هنا؛ اختبار
 * الجرد `screenTitle.test.ts` بيرفض الرجوع لـ`fontSize` حرفي.
 * `style` للمسافات بس (margin/flex) — مش للحجم ولا اللون.
 */
export function ScreenTitle({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[{ color: colors.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right' }, style]}>
      {children}
    </Text>
  );
}
