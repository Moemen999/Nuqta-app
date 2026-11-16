import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { progressRing } from '@/lib/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** نسبة الرسم 0..1 — للرسم بس (النسبة المعروضة للمستخدم مش هنا). غير رقم أو سالب ← 0 */
export function ringFraction(spent: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(spent) || !Number.isFinite(total)) return 0;
  return Math.min(1, Math.max(0, spent / total));
}

type Props = { spent: number; total: number; color: string; trackColor: string; testID?: string };

/**
 * دايرة تقدّم: بتتملي من صفر وتبدأ من فوق **عكس عقارب الساعة** (RTL — HIG: اعكس اتجاه التقدّم).
 * زينة بس: مخفية عن القارئ لأن الأرقام جنبها بتتقري. من غير حركة مع «تقليل الحركة».
 */
export function ProgressRing({ spent, total, color, trackColor, testID }: Props) {
  const { size, stroke, durationMs } = progressRing;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = ringFraction(spent, total);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? fraction : 0)).current;

  useEffect(() => {
    if (reduceMotion) { progress.setValue(fraction); return; }
    progress.setValue(0);
    const anim = Animated.timing(progress, { toValue: fraction, duration: durationMs, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [fraction, reduceMotion, progress, durationMs]);

  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });

  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, transform: [{ scaleX: -1 }] }}
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          testID={testID ? `${testID}_fill` : undefined}
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset as unknown as number}
          rotation={-90} originX={size / 2} originY={size / 2}
        />
      </Svg>
    </View>
  );
}
