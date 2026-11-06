import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y } from '@/lib/selection';
import { MIN_TOUCH, radius, space, type } from '@/lib/tokens';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

export type Segment<K extends string> = { key: K; label: string; testID?: string };

/**
 * التابات الفرعية (التخطيط والالتزامات) — **مكوّن واحد** بدل نسختين كان بينهم فرق (دراسة الشكل 2026-11-05):
 * مسار واحد بخلفية هادية، والمختار "مرفوع" بلون الكارت وخط عريض — **من غير حدود** (الحدود كانت في كل حتة).
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
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>{s.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    track: { flexDirection: 'row-reverse', backgroundColor: c.surface2, borderRadius: radius.lg, padding: space.xxs, gap: space.xxs },
    segment: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxs },
    segmentSelected: { backgroundColor: c.surface },
    label: { color: c.textSecondary, fontSize: type.body },
    labelSelected: { color: c.text, fontWeight: '700' },
  });
}
