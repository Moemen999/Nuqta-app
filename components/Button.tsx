import { Text } from '@/components/AppText';
import { LineIcon, type LineIconName } from '@/components/LineIcon';
import { useTheme } from '@/context/ThemeContext';
import { MIN_TOUCH, disabledOpacity, pressedOpacity, pressedScale, radius, rowRTL, space, typeScale } from '@/lib/tokens';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * الزرار الواحد للتطبيق (موجة البريميم 2، `reports/2026-11-16-premium-gap.md` §4 نقطة 3).
 *
 * - `primary`: accent/onAccent (الحفظ والإضافة) · `secondary`: surface + حد · `danger`: حد وخط الخطر (زي "حذف" القديم)
 *   · `outline`: حد accent وخط accentText من غير خلفية ("ضيف" جنب حقل) · `ghost`: نص من غير خلفية ولا حد.
 * - `busy`: مؤشر لف مكان النص، والزرار `disabled` طول ما هو busy (نفس عقد `useBusy`: الدوسة التانية متعدّيش).
 *   الاسم للقارئ بيفضل `label` حتى والنص مخفي.
 * - `style` للتخطيط بس (flex/width) — الشكل نفسه من الأنواع، مش من هنا.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

export interface ButtonProps {
  variant?: ButtonVariant;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  size?: 'md' | 'sm';
  icon?: LineIconName;
  /** أيقونة بس من غير نص مرئي — `label` بيبقى اسم الزرار للقارئ */
  iconOnly?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  variant = 'primary', label, onPress, disabled = false, busy = false, size = 'md',
  icon, iconOnly = false, testID, accessibilityLabel, accessibilityHint, style,
}: ButtonProps) {
  const { colors } = useTheme();
  const off = disabled || busy;

  const look = {
    primary: { bg: colors.accent, fg: colors.onAccent, border: 'transparent' },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
    outline: { bg: 'transparent', fg: colors.accentText, border: colors.accent },
    danger: { bg: 'transparent', fg: colors.dangerText, border: colors.dangerBorder },
    ghost: { bg: 'transparent', fg: colors.textSecondary, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      collapsable={false}
      testID={testID}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityLabel={busy ? `${accessibilityLabel ?? label}، جاري التنفيذ` : (accessibilityLabel ?? label)}
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
          opacity: off ? disabledOpacity : pressed ? pressedOpacity : 1,
          transform: [{ scale: pressed && !off ? pressedScale : 1 }],
        },
        style,
      ]}>
      {/* `collapsable={false}`: opacity 1↔0 كان بيخلي Fabric يعمل unflatten للـView ويحرّك ولاده (addViewAt index 0، NUQTA-3) */}
      {/* وهو busy المحتوى بيفضل مرسوم (شفاف) والمؤشر فوقه مطلق — فالعرض ميتغيّرش والصف ميتنطّطش */}
      <View collapsable={false} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, opacity: busy ? 0 : 1 }}>
        {icon ? <LineIcon name={icon} size={iconOnly ? 22 : typeScale.title} color={look.fg} /> : null}
        {iconOnly ? null : <Text style={{ color: look.fg, fontSize: typeScale.body, fontWeight: '700' }}>{label}</Text>}
      </View>
      {/* متركّب دايمًا: busy بيغيّر props بس. mount/unmount وقت إقفال المودال كان بيكرّش Fabric (NUQTA-3: addViewAt) */}
      {/* NUQTA-3 (1.0.0.028، «at index 1»): ActivityIndicator بيحط `style` على View خارجي بتاعه ومبيمرّرلوش
          `collapsable` (RN 0.81 ActivityIndicator.js سطر 100/112). فـ`opacity: 1` كان بيخلّي الخارجي layout-only
          فيتعمله flatten، و`opacity: 0` بيرجّعه view حقيقي ← reparent وقت busy ← Fabric بيكرّش. الحل: الـopacity
          والمكان على View بتاعنا بـ`collapsable={false}` (عمره ما يتعمله flatten)، والمؤشر جوّاه من غير style بيتغيّر */}
      <View
        collapsable={false}
        pointerEvents="none"
        importantForAccessibility={busy ? 'auto' : 'no-hide-descendants'}
        accessibilityElementsHidden={!busy}
        style={{ position: 'absolute', opacity: busy ? 1 : 0 }}>
        <ActivityIndicator
          testID={testID ? `${testID}_spinner` : undefined}
          animating={busy}
          color={look.fg}
        />
      </View>
    </Pressable>
  );
}
