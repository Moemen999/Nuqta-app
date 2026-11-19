import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { periodPresets, type PeriodPresetKey } from '@/lib/periodPresets';
import { selectionA11y } from '@/lib/selection';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';

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
  const started = useRef(false);
  const atRight = useRef(true);
  const chipBox = useRef<Record<string, { x: number; w: number }>>({});
  const [moreLeft, setMoreLeft] = useState(false);

  // `scrollX` بيتحدّث من القيمة اللي اتبعتت لـscrollTo (مش من حساب يدوي)، و`onScroll` بيصحّحه بعدها
  const goTo = (x: number, animated: boolean) => {
    scrollX.current = x;
    setMoreLeft(x > 1);
    scroller.current?.scrollTo({ x, animated });
  };
  const maxX = () => Math.max(0, contentW.current - viewW.current);

  const revealSelected = useCallback((animated: boolean) => {
    const box = chipBox.current[value];
    if (!box || !viewW.current) return;
    const left = scrollX.current, right = left + viewW.current;
    if (box.x >= left && box.x + box.w <= right) return;
    goTo(Math.max(0, Math.min(box.x + box.w / 2 - viewW.current / 2, maxX())), animated);
  }, [value]);

  useEffect(() => { if (started.current) revealSelected(true); }, [value, revealSelected]);

  // البداية يمين: بتتنادى من `onLayout` ومن `onContentSizeChange` — الترتيب بينهم مش مضمون، فبتستنى الاتنين
  // يبقوا معروفين وبتشتغل مرة واحدة. وبعدها لو العرض اتغيّر (دوران/خط أكبر) والمستخدم كان عند اليمين تعيد.
  const tryStart = () => {
    if (!viewW.current || !contentW.current) return;
    if (!started.current) {
      started.current = true;
      goTo(maxX(), false);
      scroller.current?.scrollToEnd({ animated: false });
      revealSelected(false);
    } else if (atRight.current) {
      goTo(maxX(), false);
      revealSelected(false);
    }
  };

  return (
    <View style={bleed ? { marginHorizontal: -bleed } : undefined}>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} testID={`${testIDPrefix}_row`}
        // من غير `radiogroup`: الحاوية مبتوصلش لأندرويد (`lib/selection.ts`) — كل شريحة radio وفيها اسمها
        contentContainerStyle={[styles.row, { paddingHorizontal: bleed }]}
        scrollEventThrottle={16}
        onScroll={e => {
          const x = e.nativeEvent.contentOffset.x;
          scrollX.current = x;
          atRight.current = x >= maxX() - 2;
          setMoreLeft(m => (m === x > 1 ? m : x > 1));
        }}
        onLayout={(e: LayoutChangeEvent) => { viewW.current = e.nativeEvent.layout.width; tryStart(); }}
        onContentSizeChange={w => { contentW.current = w; tryStart(); }}>
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
      {/* تلميح "فيه شرايح تانية": تدرّج بلون الخلفية على الحافة الشمال (الفيزيائية) — يظهر بس لما فيه محتوى مستخبي هناك */}
      {moreLeft && (
        <View testID={`${testIDPrefix}_fade`} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.fade}>
          {FADE_STEPS.map((o, i) => <View key={i} style={{ flex: 1, backgroundColor: colors.bg, opacity: o }} />)}
        </View>
      )}
    </View>
  );
}

const FADE_STEPS = [1, 0.85, 0.65, 0.45, 0.25, 0.1];

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row-reverse', gap: space.sm, flexGrow: 1, alignItems: 'center' },
    // flexDirection 'row' عن قصد: التدرّج مربوط بالحافة الفيزيائية الشمال (الأكثف عندها) مش باتجاه القراية
    fade: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 24, flexDirection: 'row' },
    chip: { backgroundColor: c.controlBg, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: space.lg, minHeight: MIN_TOUCH, justifyContent: 'center' },
    chipSelected: { backgroundColor: c.selectedBg, borderColor: c.selectedBorder },
    label: { color: c.textSecondary, fontSize: typeScale.body },
    labelSelected: { color: c.text, fontWeight: '700' },
  });
}
