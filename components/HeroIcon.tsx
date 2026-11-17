import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { LineIcon, type LineIconName } from '@/components/LineIcon';
import { tintBackground } from '@/components/CategoryIcon';
import { useTheme } from '@/context/ThemeContext';
import { heroIconGlyphRatio } from '@/lib/tokens';
import { useReduceMotion } from '@/lib/useReduceMotion';

/** مدة دخول الدايرة (موجة البريميم 6) */
const ENTER_MS = 300;
const ENTER_FROM_SCALE = 0.9;

/**
 * أيقونة خطية جوه دايرة دهبية خفيفة — بديل الإيموجي الكبير الزخرفي في الترحيب و"نبدأ بإيه؟" والحالة الفاضية
 * (`reports/2026-11-16-premium-gap.md` §4 نقطة 8). نفس لغة `CategoryIcon`: خلفية `accent` بشفافية، والأيقونة `accentText`.
 * `animateKey`: كل ما يتغيّر الدايرة بتدخل من جديد (scale 0.9←1 + opacity)؛ من غيره أو مع «تقليل الحركة» ثابتة.
 * زينة: مخفية عن قارئ الشاشة — النص اللي تحتها هو اللي بيتقري.
 */
export function HeroIcon({ name, size, animateKey, testID }: { name: LineIconName; size: number; animateKey?: string | number; testID?: string }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const animated = animateKey !== undefined && !reduceMotion;
  // أول رسمة بالقيمة الصح (0 لو هتتحرّك) — من غير فريم كاملة قبل الـeffect
  const enter = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (!animated) { enter.setValue(1); return; }
    enter.setValue(0);
    const anim = Animated.timing(enter, { toValue: 1, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [animated, animateKey, enter]);

  return (
    <Animated.View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={{
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: tintBackground(colors.accent), opacity: animated ? enter : 1,
        transform: [{ scale: animated ? enter.interpolate({ inputRange: [0, 1], outputRange: [ENTER_FROM_SCALE, 1] }) : 1 }],
      }}>
      <LineIcon name={name} size={Math.round(size * heroIconGlyphRatio)} color={colors.accentText} />
    </Animated.View>
  );
}
