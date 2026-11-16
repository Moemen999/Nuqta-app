import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { periodPresets, type PeriodPresetKey } from '@/lib/periodPresets';
import { selectionA11y } from '@/lib/selection';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';

/**
 * شرايح الفترة — **مكوّن واحد** للتقارير والأرشيف (كانوا نسختين، دراسة الشكل 2026-11-05). من غير حد: الخلفية
 * الهادية بتفصل، والمختارة بالدهبي الغامق (`selectedBg`) + إطار دهبي (هي بس) + خط عريض — الدهبي للي بيتداس بس.
 * الإطار لأن الخلفية لوحدها 1.2:1 في الغامق (a11y-architect: المؤشر لازم 3:1).
 * الـtestID بيفضل زي ما كان (`{prefix}_{key}`) — الاختبارات وMaestro عليه.
 *
 * **سطر واحد بيتسحب بالعرض** (موجة البريميم 1، 2026-11-16): 5 شرايح مش بيكفّوا عرض 360dp، فكانوا بيلفّوا لسطرين.
 * **البداية من اليمين:** التطبيق مبيعملش `I18nManager.forceRTL` (الاتجاه كله `row-reverse`)، فـ`ScrollView` الأفقي
 * بيفتح عند الشمال. الحل: نفس `row-reverse` بتاع باقي الشاشات (أول شريحة = أقصى اليمين) + `flexGrow: 1` عشان لو
 * الشرايح كفّت الصف يتراص يمين، ولو زادت `scrollToEnd` مرة واحدة أول ما الحجم يتعرف (`onContentSizeChange`) —
 * ده بيشتغل على أندرويد وiOS من غير الاعتماد على سلوك RTL الأصلي. وبعدها المختارة بتتجاب للشاشة لو برّه.
 * `bleed` = الـpadding الأفقي بتاع الأب: الصف بيطلع لحافة الشاشة (margin سالب) والشرايح بتبدأ من نفس الهامش.
 */
export function PeriodChips<K extends PeriodPresetKey>({ keys, value, onChange, testIDPrefix, bleed = 0 }: {
  keys: K[]; value: K; onChange: (k: K) => void; testIDPrefix: string; bleed?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scroller = useRef<ScrollView>(null);
  const scrollX = useRef(0);
  const viewW = useRef(0);
  const contentW = useRef(0);
  const startedAtRight = useRef(false);
  const chipBox = useRef<Record<string, { x: number; w: number }>>({});

  const revealSelected = useCallback((animated: boolean) => {
    const box = chipBox.current[value];
    if (!box || !viewW.current) return;
    const left = scrollX.current, right = left + viewW.current;
    if (box.x >= left && box.x + box.w <= right) return;
    const target = Math.max(0, Math.min(box.x + box.w / 2 - viewW.current / 2, Math.max(0, contentW.current - viewW.current)));
    scrollX.current = target;
    scroller.current?.scrollTo({ x: target, animated });
  }, [value]);

  useEffect(() => { if (startedAtRight.current) revealSelected(true); }, [value, revealSelected]);

  const onContentSizeChange = (w: number) => {
    contentW.current = w;
    if (startedAtRight.current || !viewW.current) return;
    startedAtRight.current = true;
    scroller.current?.scrollToEnd({ animated: false });
    scrollX.current = Math.max(0, w - viewW.current);
    revealSelected(false);
  };

  return (
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} testID={`${testIDPrefix}_row`}
      style={bleed ? { marginHorizontal: -bleed } : undefined}
      contentContainerStyle={[styles.row, { paddingHorizontal: bleed }]}
      scrollEventThrottle={16} onScroll={e => { scrollX.current = e.nativeEvent.contentOffset.x; }}
      onLayout={(e: LayoutChangeEvent) => { viewW.current = e.nativeEvent.layout.width; }}
      onContentSizeChange={onContentSizeChange}>
      {periodPresets(keys).map(p => {
        const selected = p.key === value;
        return (
          <TouchableOpacity key={p.key} testID={`${testIDPrefix}_${p.key}`} {...selectionA11y(selected, 'radio')}
            onLayout={e => { chipBox.current[p.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; }}
            onPress={() => onChange(p.key as K)} style={[styles.chip, selected && styles.chipSelected]}>
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>{p.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row-reverse', gap: space.sm, flexGrow: 1, alignItems: 'center' },
    chip: { backgroundColor: c.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    chipSelected: { backgroundColor: c.selectedBg, borderColor: c.selectedBorder },
    label: { color: c.textSecondary, fontSize: typeScale.body },
    labelSelected: { color: c.text, fontWeight: '700' },
  });
}
