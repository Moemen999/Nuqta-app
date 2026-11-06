import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { periodPresets, type PeriodPresetKey } from '@/lib/periodPresets';
import { selectionA11y } from '@/lib/selection';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

/**
 * شرايح الفترة — **مكوّن واحد** للتقارير والأرشيف (كانوا نسختين، دراسة الشكل 2026-11-05). من غير حد: الخلفية
 * الهادية بتفصل، والمختارة بالدهبي الغامق (`selectedBg`) + إطار دهبي (هي بس) + خط عريض — الدهبي للي بيتداس بس.
 * الإطار لأن الخلفية لوحدها 1.2:1 في الغامق (a11y-architect: المؤشر لازم 3:1).
 * الـtestID بيفضل زي ما كان (`{prefix}_{key}`) — الاختبارات وMaestro عليه.
 */
export function PeriodChips<K extends PeriodPresetKey>({ keys, value, onChange, testIDPrefix }: {
  keys: K[]; value: K; onChange: (k: K) => void; testIDPrefix: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      {periodPresets(keys).map(p => {
        const selected = p.key === value;
        return (
          <TouchableOpacity key={p.key} testID={`${testIDPrefix}_${p.key}`} {...selectionA11y(selected)}
            onPress={() => onChange(p.key as K)} style={[styles.chip, selected && styles.chipSelected]}>
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>{p.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row-reverse', gap: space.sm, flexWrap: 'wrap' },
    chip: { backgroundColor: c.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    chipSelected: { backgroundColor: c.selectedBg, borderColor: c.selectedBorder },
    label: { color: c.textSecondary, fontSize: typeScale.body },
    labelSelected: { color: c.text, fontWeight: '700' },
  });
}
