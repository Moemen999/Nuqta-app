import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { radius } from '@/lib/tokens';

/**
 * مكان محجوز بشكل اللي هييجي وهو بيحمّل (HIG Loading): مستطيل أو دايرة بلون `surface2` ونبض خفيف 0.5↔1 (~1 ثانية).
 * **من غير نبض لو «تقليل الحركة» شغّال** — بيفضل ثابت على 0.7. مخفي عن القارئ (`no-hide-descendants`)؛ اللي بيتقري
 * هو `SkeletonGroup` مرة واحدة. النبض على الـnative driver.
 */
export function Skeleton({ width, height, circle, style, testID }: {
  width?: DimensionValue; height: number; circle?: boolean; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) { opacity.setValue(0.7); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.5, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, opacity]);
  return (
    <Animated.View
      testID={testID}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        { width: circle ? height : width, height, borderRadius: circle ? radius.pill : radius.md, backgroundColor: colors.surface2, opacity },
        style,
      ]}
    />
  );
}

/** حاوية الهيكل: عقدة واحدة بتتقري «بنحمّل» مرة واحدة بدل ما كل مستطيل يتقري */
export function SkeletonGroup({ label, children, style, testID }: { label: string; children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
      {children}
    </View>
  );
}
