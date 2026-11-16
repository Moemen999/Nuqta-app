import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y } from '@/lib/selection';
import { hapticSelect } from '@/lib/haptics';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, I18nManager, StyleSheet, TouchableOpacity, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

export type Segment<K extends string> = { key: K; label: string; testID?: string };

/**
 * التابات الفرعية (التخطيط والالتزامات) — **مكوّن واحد** بدل نسختين كان بينهم فرق (دراسة الشكل 2026-11-05):
 * مسار واحد بخلفية هادية من غير حدود، والمختار بالدهبي الغامق (`selectedBg`) **وإطار دهبي هو بس** + خط عريض — نفس لغة
 * `PeriodChips`. (أول نسخة كانت المختار بلون الكارت: 1.1:1 على المسار، ومش باين — visual-identity + a11y-architect.)
 * الاسم بيلف لسطرين بدل ما يتقص بـ"…" مع خط كبير (a11y-architect).
 * **المؤشر طبقة واحدة بتتزحلق** (موجة البريميم 3، 2026-11-16) تحت الشريحة المختارة بدل ما الخلفية تنط: `translateX` بالـ
 * native driver (200ms ease-out)، و`Animated` مش reanimated عن قصد (مفيش `babel.config.js` في المشروع، والمطلوب انتقال
 * واحد). المؤشر مثبّت على الحافة **الفيزيائية الشمال** (`left: 0`، و`right: 0` لو `I18nManager.isRTL` عشان RN
 * بيقلب `left`/`right` هناك)، فالإزاحة = x الشريحة من `onLayout` مباشرة من غير قياس للمؤشر نفسه (القياس بعرض 0 كان بيدّي
 * أصل غلط في أول فتحة). **الشرايح لازم تفضل بعرض متساوي (`flex: 1`)** — `width` المؤشر مش بيتحرك، بيتظبط بس. أول رسمة والمؤشر في مكانه من غير حركة، و«تقليل الحركة» ← ينط فورًا.
 * لقارئ الشاشة: `tablist` + كل واحد `tab` بحالة `selected` (بند E)، وطول 44 من الأول.
 */
export function SegmentedControl<K extends string>({ segments, value, onChange, style }: {
  segments: Segment<K>[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const [rects, setRects] = useState<Record<string, { x: number; w: number }>>({});
  const tx = useRef(new Animated.Value(0)).current;
  const lastValue = useRef<K | null>(null); // آخر `value` اتحط المؤشر تحته (null = لسه أول رسمة)

  const onSegLayout = useCallback((k: string) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setRects(prev => (prev[k]?.x === x && prev[k]?.w === width ? prev : { ...prev, [k]: { x, w: width } }));
  }, []);

  const target = rects[value];
  const ready = !!target;
  useEffect(() => {
    if (!target) return;
    const valueChanged = lastValue.current !== null && lastValue.current !== value;
    lastValue.current = value;
    // حركة بس لما `value` يتغيّر؛ أول رسمة وتغيّر المقاس (دوران/تكبير خط) ← snap
    if (!valueChanged || reduceMotion) { tx.setValue(target.x); return; }
    const anim = Animated.timing(tx, { toValue: target.x, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [target, value, reduceMotion, tx]);

  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      <Animated.View testID="segmented_indicator" pointerEvents="none" accessible={false}
        importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
        style={[styles.indicator, { width: target?.w ?? 0, opacity: ready ? 1 : 0, transform: [{ translateX: tx }] }]} />
      {segments.map(s => {
        const selected = s.key === value;
        return (
          <TouchableOpacity key={s.key} testID={s.testID} {...selectionA11y(selected, 'tab')} onLayout={onSegLayout(s.key)}
            onPress={() => { if (!selected) hapticSelect(); onChange(s.key); }} style={[styles.segment, selected && !ready && styles.segmentSelected]}>
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
    // ستايل احتياطي للمختارة قبل ما المؤشر يبقى جاهز (أول رسمة/قبل القياس) — مؤشر مش لون بس
    segmentSelected: { backgroundColor: c.selectedBg, borderColor: c.selectedBorder },
    // الطبقة المتزحلقة: نفس شكل المختار القديم (`selectedBg` + إطار `selectedBorder`) وبتتحط تحت الشرايح
    indicator: { position: 'absolute', ...(I18nManager.isRTL ? { right: 0 } : { left: 0 }), top: space.xxs, bottom: space.xxs, borderRadius: radius.md, borderWidth: 1.5, backgroundColor: c.selectedBg, borderColor: c.selectedBorder },
    label: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center' },
    labelSelected: { color: c.text, fontWeight: '700' },
  });
}
