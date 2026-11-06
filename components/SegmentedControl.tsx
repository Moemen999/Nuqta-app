import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y } from '@/lib/selection';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

export type Segment<K extends string> = { key: K; label: string; testID?: string };

/**
 * التابات الفرعية (التخطيط والالتزامات) — **مكوّن واحد** بدل نسختين كان بينهم فرق (دراسة الشكل 2026-11-05):
 * مسار واحد بخلفية هادية من غير حدود، والمختار بالدهبي الغامق (`selectedBg`) **وإطار دهبي هو بس** + خط عريض — نفس لغة
 * `PeriodChips`. (أول نسخة كانت المختار بلون الكارت: 1.1:1 على المسار، ومش باين — visual-identity + a11y-architect.)
 * الاسم بيلف لسطرين بدل ما يتقص بـ"…" مع خط كبير (a11y-architect).
 * لقارئ الشاشة: `tablist` + كل واحد `tab` بحالة `selected` (بند E)، وطول 44 من الأول.
 */
export function SegmentedControl<K extends string>({ segments, value, onChange, style }: {
  segments: Segment<K>[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {segments.map(s => {
        const selected = s.key === value;
        return (
          <TouchableOpacity key={s.key} testID={s.testID} {...selectionA11y(selected, 'tab')}
            onPress={() => onChange(s.key)} style={[styles.segment, selected && styles.segmentSelected]}>
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
    segmentSelected: { backgroundColor: c.selectedBg, borderColor: c.selectedBorder },
    label: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center' },
    labelSelected: { color: c.text, fontWeight: '700' },
  });
}
