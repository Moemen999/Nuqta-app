import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y } from '@/lib/selection';
import { MIN_TOUCH, overlayCenteredStyle, radius, glyphSize, typeScale } from '@/lib/tokens';
// اسم اليوم كامل لقارئ الشاشة («الأربع، 11 نوفمبر 2026») — نفس قايمة الدخل الثابت، عشان الاتنين ميختلفوش
import { MONTH_NAMES } from '@/lib/dateText';
import { WEEKDAY_NAMES } from '@/lib/recurringIncome';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';

const WEEKDAYS = ['أحد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];
/** خانة الشهر — نفس طول الشكل القديم (عرض ~104 × 1/1.6)، ثابت عشان مفيش aspectRatio (شوف dayCell) */
const MONTH_CELL_HEIGHT = 64;

function daysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function firstWeekday(year: number, month: number) { return new Date(year, month, 1).getDay(); }
function pad(n: number) { return String(n).padStart(2, '0'); }

type ViewLevel = 'days' | 'months' | 'years';

/** بيتقال لقارئ الشاشة لما المستوى يتغيّر — الشبكة كلها بتتبدّل من غير ما التركيز يعرف (الميزة 8، a11y-architect) */
const LEVEL_ANNOUNCE: Record<ViewLevel, string> = { days: 'اختار اليوم', months: 'اختار الشهر', years: 'اختار السنة' };

function viewOf(value: string) {
  const now = new Date();
  return value
    ? { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 }
    : { year: now.getFullYear(), month: now.getMonth() };
}

type Props = {
  visible: boolean;
  value: string;
  onSelect: (date: string) => void;
  onClose: () => void;
};

export default function CalendarPickerModal({ visible, value, onSelect, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // بنقرا السنة والشهر من نص التاريخ مباشرةً. لو حوّلناه لـ Date الأول، التحويل
  // بيتعمل على UTC والقراية بالتوقيت المحلي، فالتقويم كان ممكن يفتح على الشهر
  // اللي قبله في أول يوم في الشهر.
  const init = viewOf(value);
  const [viewYear, setViewYear] = useState(init.year);
  const [viewMonth, setViewMonth] = useState(init.month);
  const [level, setLevelState] = useState<ViewLevel>('days');
  const [yearsPageStart, setYearsPageStart] = useState(Math.floor(init.year / 12) * 12);

  // الكومبوننت بيفضل متركّب والمودال مقفول، فالشهر كان بيتقري مرة واحدة: تعديل عملية قديمة (القيمة وصلت بعد التركيب)
  // كان بيفتح على الشهر الحالي. كل فتحة بتبدأ من شهر القيمة (الميزة 8)
  useEffect(() => {
    if (!visible) return;
    const v = viewOf(value);
    setViewYear(v.year);
    setViewMonth(v.month);
    setYearsPageStart(Math.floor(v.year / 12) * 12);
    setLevelState('days');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- مع الفتح بس؛ القيمة بتتغيّر من الاختيار نفسه والمودال بيتقفل
  }, [visible]);

  function setLevel(next: ViewLevel) {
    setLevelState(next);
    AccessibilityInfo.announceForAccessibility(LEVEL_ANNOUNCE[next]);
  }

  function goPrev() {
    if (level === 'days') {
      if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1);
    } else if (level === 'months') {
      setViewYear(y => y - 1);
    } else {
      setYearsPageStart(s => s - 12);
    }
  }
  function goNext() {
    if (level === 'days') {
      if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1);
    } else if (level === 'months') {
      setViewYear(y => y + 1);
    } else {
      setYearsPageStart(s => s + 12);
    }
  }

  const totalDays = daysInMonth(viewYear, viewMonth);
  const startWeekday = firstWeekday(viewYear, viewMonth);
  const dayCells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  function selectDay(day: number) {
    onSelect(`${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`);
    close();
  }
  function selectMonth(m: number) { setViewMonth(m); setLevel('days'); }
  function selectYear(y: number) { setViewYear(y); setLevel('months'); }
  function close() { setLevelState('days'); onClose(); }

  const prevLabel = level === 'days' ? 'الشهر اللي فات' : level === 'months' ? 'السنة اللي فاتت' : 'السنين اللي فاتت';
  const nextLabel = level === 'days' ? 'الشهر الجاي' : level === 'months' ? 'السنة الجاية' : 'السنين الجاية';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      {/* الخلفية والكارت مش أزرار لقارئ الشاشة (accessible=false): الخلفية كانت "زرار" من غير اسم، والكارت ماسك الدوس بس */}
      <PressableScale accessible={false} style={styles.overlay} activeOpacity={1} onPress={close}>
        {/* iOS: التركيز محبوس جوّه، وإيماءة الخروج بتقفل (a11y-architect جولة 2). أندرويد: زرار الرجوع ← onRequestClose */}
        <PressableScale testID="calendar_card" accessible={false} accessibilityViewIsModal onAccessibilityEscape={close} activeOpacity={1} style={styles.card} onPress={() => {}}>
          {/* عنوان ظاهر وإغلاق صريح (الميزة 8): قبل كده أول حاجة بيقراها قارئ الشاشة «الشهر اللي فات» من غير ما يعرف هو فين،
              والخروج كان بالدوس برّه بس (مش زرار) */}
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">اختار التاريخ</Text>
            <PressableScale testID="calendar_close" onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="إغلاق">
              <Text style={styles.closeText}>✕</Text>
            </PressableScale>
          </View>
          <View style={styles.header}>
            <PressableScale onPress={goPrev} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={prevLabel}>
              <Text style={styles.navText}>›</Text>
            </PressableScale>

            <View style={styles.labelRow}>
              {level === 'days' && (
                <>
                  <PressableScale style={styles.labelBtn} accessibilityRole="button" accessibilityHint="اختار سنة تانية" onPress={() => setLevel('years')}>
                    <Text style={styles.label}>{viewYear}</Text>
                  </PressableScale>
                  <PressableScale style={styles.labelBtn} accessibilityRole="button" accessibilityHint="اختار شهر تاني" onPress={() => setLevel('months')}>
                    <Text style={styles.label}>{MONTH_NAMES[viewMonth]}</Text>
                  </PressableScale>
                </>
              )}
              {level === 'months' && (
                <PressableScale style={styles.labelBtn} accessibilityRole="button" accessibilityHint="اختار سنة تانية" onPress={() => setLevel('years')}>
                  <Text style={styles.label}>{viewYear}</Text>
                </PressableScale>
              )}
              {level === 'years' && (
                <Text style={styles.label} accessibilityRole="header">{`${yearsPageStart} - ${yearsPageStart + 11}`}</Text>
              )}
            </View>

            <PressableScale onPress={goNext} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={nextLabel}>
              <Text style={styles.navText}>‹</Text>
            </PressableScale>
          </View>

          {level === 'days' && (
            <>
              {/* كل خانة فيها اسم يومها، فالصف ده سبع محطات زيادة لقارئ الشاشة */}
              <View style={styles.weekRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {WEEKDAYS.map(d => <Text key={d} style={styles.weekday}>{d}</Text>)}
              </View>
              <View style={styles.grid}>
                {dayCells.map((day, i) => {
                  const dateStr = day ? `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}` : null;
                  const isSelected = dateStr === value;
                  return (
                    <PressableScale key={i} disabled={!day} onPress={() => day && selectDay(day)}
                      {...selectionA11y(isSelected)}
                      accessible={!!day}
                      accessibilityLabel={day ? `${WEEKDAY_NAMES[(startWeekday + day - 1) % 7]}، ${day} ${MONTH_NAMES[viewMonth]} ${viewYear}` : undefined}
                      style={[styles.dayCell, isSelected && styles.cellSelected]}>
                      {day ? <Text style={[styles.cellText, isSelected && styles.cellTextSelected]}>{day}</Text> : null}
                    </PressableScale>
                  );
                })}
              </View>
            </>
          )}

          {level === 'months' && (
            <View style={styles.grid}>
              {/* الاسم كامل: «سبت» المختصر كان بيتقري السبت */}
              {MONTH_NAMES.map((m, i) => (
                <PressableScale key={m} onPress={() => selectMonth(i)}
                  {...selectionA11y(i === viewMonth)} accessibilityLabel={`${MONTH_NAMES[i]} ${viewYear}`}
                  style={[styles.monthCell, i === viewMonth && styles.cellSelected]}>
                  <Text style={[styles.cellText, i === viewMonth && styles.cellTextSelected]}>{m}</Text>
                </PressableScale>
              ))}
            </View>
          )}

          {level === 'years' && (
            <View style={styles.grid}>
              {Array.from({ length: 12 }, (_, i) => yearsPageStart + i).map(y => (
                <PressableScale key={y} onPress={() => selectYear(y)} {...selectionA11y(y === viewYear)}
                  style={[styles.monthCell, y === viewYear && styles.cellSelected]}>
                  <Text style={[styles.cellText, y === viewYear && styles.cellTextSelected]}>{y}</Text>
                </PressableScale>
              ))}
            </View>
          )}
        </PressableScale>
      </PressableScale>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayCenteredStyle,
    // أقصى عرض: الخانة طولها ثابت، فعلى تابلت أو موبايل بيتفرد كانت هتبقى شريط عريض (visual-identity-reviewer)
    // عرض الخانة ≥ 44 (الميزة 8): 94% وحواف جنب 12 ← على موبايل 360 الخانة ~44.9 (كانت ~40.7 بـ88% و16)
    card: { backgroundColor: c.surface, borderRadius: radius.xl, paddingVertical: 16, paddingHorizontal: 12, width: '94%', maxWidth: 360, borderWidth: 1, borderColor: c.borderStrong },
    titleRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { color: c.text, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
    closeBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: c.textSecondary, fontSize: typeScale.body },
    header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    navBtn: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    navText: { color: c.text, fontSize: glyphSize.chevron },
    labelRow: { flexDirection: 'row-reverse', gap: 10 },
    labelBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    label: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700' },
    weekRow: { flexDirection: 'row-reverse', marginBottom: 6 },
    weekday: { flex: 1, textAlign: 'center', color: c.textSecondary, fontSize: typeScale.caption },
    grid: { flexDirection: 'row-reverse', flexWrap: 'wrap' },
    // طول ثابت مش `aspectRatio`: مع عرض بالنسبة جوه صف بيلف، أندرويد كان بيحسب الطول من غير ما يعيد
    // توسيط الرقم — على الشاومي (1.0.0.011) الخانة 32 بس والرقم لازق تحت في كل الصفوف ماعدا صف واحد
    dayCell: { width: '14.28%', height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    monthCell: { width: '33.33%', height: MONTH_CELL_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    cellSelected: { backgroundColor: c.accent },
    cellText: { color: c.text, fontSize: typeScale.body },
    cellTextSelected: { color: c.onAccent, fontWeight: '700' },
  });
}