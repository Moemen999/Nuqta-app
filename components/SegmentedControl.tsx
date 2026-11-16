import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y } from '@/lib/selection';
import { hapticSelect } from '@/lib/haptics';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

export type Segment<K extends string> = { key: K; label: string; testID?: string };

/**
 * التابات الفرعية (التخطيط والالتزامات) — **مكوّن واحد** بدل نسختين كان بينهم فرق (دراسة الشكل 2026-11-05):
 * مسار واحد بخلفية هادية من غير حدود، والمختار بالدهبي الغامق (`selectedBg`) **وإطار دهبي هو بس** + خط عريض — نفس لغة
 * `PeriodChips`. (أول نسخة كانت المختار بلون الكارت: 1.1:1 على المسار، ومش باين — visual-identity + a11y-architect.)
 * الاسم بيلف لسطرين بدل ما يتقص بـ"…" مع خط كبير (a11y-architect).
 * **المؤشر طبقة واحدة بتتزحلق** (موجة البريميم 3، 2026-11-16) تحت الشريحة المختارة بدل ما الخلفية تنط: `translateX` بالـ
 * native driver (200ms ease-out)، و`Animated` مش reanimated عن قصد (مفيش `babel.config.js` في المشروع، والمطلوب انتقال
 * واحد). الإزاحة = x الشريحة − x المؤشر نفسه وهو في مكانه الأصلي، **الاتنين من `onLayout`** — فمفيش افتراض عن اتجاه RTL
 * ولا عن `left`/`right` اللي RN بيقلبهم. أول رسمة والمؤشر في مكانه من غير حركة، و«تقليل الحركة» ← ينط فورًا.
 * لقارئ الشاشة: `tablist` + كل واحد `tab` بحالة `selected` (بند E)، وطول 44 من الأول.
 */
export function SegmentedControl<K extends string>({ segments, value, onChange, style }: {
  segments: Segment<K>[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const [rects, setRects] = useState<Record<string, { x: number; w: number }>>({});
  const [originX, setOriginX] = useState<number | null>(null); // x المؤشر في مكانه الأصلي (translateX = 0)
  const tx = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);

  const onSegLayout = useCallback((k: string) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setRects(prev => (prev[k]?.x === x && prev[k]?.w === width ? prev : { ...prev, [k]: { x, w: width } }));
  }, []);

  const target = rects[value];
  useEffect(() => {
    if (!target || originX === null) return;
    const to = target.x - originX;
    if (!placed.current || reduceMotion) { placed.current = true; tx.setValue(to); return; }
    const anim = Animated.timing(tx, { toValue: to, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [target, originX, reduceMotion, tx]);

  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      <Animated.View testID="segmented_indicator" pointerEvents="none" accessible={false}
        importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
        onLayout={e => setOriginX(e.nativeEvent.layout.x)}
        style={[styles.indicator, { width: target?.w ?? 0, opacity: target && originX !== null ? 1 : 0, transform: [{ translateX: tx }] }]} />
      {segments.map(s => {
        const selected = s.key === value;
        return (
          <TouchableOpacity key={s.key} testID={s.testID} {...selectionA11y(selected, 'tab')} onLayout={onSegLayout(s.key)}
            onPress={() => { if (!selected) hapticSelect(); onChange(s.key); }} style={styles.segment}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{s.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    track: { flexDirection: 'row-reverse', backgroundColor: c.surface2, borderRadius: radius.lg, padding: space.xxs, gap: space.xxs },
    // الإطار موجود دايمًا (شفاف) عشان الاختيار ميزقّش الكلام
    segment: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxs },
    // الطبقة المتزحلقة: نفس شكل المختار القديم (`selectedBg` + إطار `selectedBorder`) وبتتحط تحت الشرايح
    indicator: { position: 'absolute', top: space.xxs, bottom: space.xxs, borderRadius: radius.md, borderWidth: 1.5, backgroundColor: c.selectedBg, borderColor: c.selectedBorder },
    label: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center' },
    labelSelected: { color: c.text, fontWeight: '700' },
  });
}
