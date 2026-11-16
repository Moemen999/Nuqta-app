import { Text } from '@/components/AppText';
import { LineIcon, type LineIconName } from '@/components/LineIcon';
import { useTheme } from '@/context/ThemeContext';
import { MIN_TOUCH, radius, rowRTL, space, typeScale } from '@/lib/tokens';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';

/**
 * الزرار الواحد للتطبيق (موجة البريميم 2، `reports/2026-11-16-premium-gap.md` §4 نقطة 3).
 *
 * - `primary`: accent/onAccent (الحفظ والإضافة) · `secondary`: surface + حد · `danger`: حد وخط الخطر (زي "حذف" القديم)
 *   · `ghost`: نص من غير خلفية ولا حد.
 * - `busy`: مؤشر لف مكان النص، والزرار `disabled` طول ما هو busy (نفس عقد `useBusy`: الدوسة التانية متعدّيش).
 *   الاسم للقارئ بيفضل `label` حتى والنص مخفي.
 * - `style` للتخطيط بس (flex/width) — الشكل نفسه من الأنواع، مش من هنا.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  variant?: ButtonVariant;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  size?: 'md' | 'sm';
  icon?: LineIconName;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  variant = 'primary', label, onPress, disabled = false, busy = false, size = 'md',
  icon, testID, accessibilityLabel, style,
}: ButtonProps) {
  const { colors } = useTheme();
  const off = disabled || busy;

  const look = {
    primary: { bg: colors.accent, fg: colors.onAccent, border: 'transparent' },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
    danger: { bg: 'transparent', fg: colors.dangerText, border: colors.dangerBorder },
    ghost: { bg: 'transparent', fg: colors.textSecondary, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: MIN_TOUCH,
          borderRadius: radius.md,
          borderWidth: 1,
          backgroundColor: look.bg,
          borderColor: look.border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: size === 'sm' ? space.sm : space.lg,
          paddingHorizontal: space.lg,
          ...rowRTL(space.sm),
          opacity: off ? 0.6 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !off ? 0.98 : 1 }],
        },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={look.fg} />
      ) : (
        <>
          {icon ? <LineIcon name={icon} size={typeScale.title} color={look.fg} /> : null}
          <Text style={{ color: look.fg, fontSize: typeScale.body, fontWeight: '700' }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}
