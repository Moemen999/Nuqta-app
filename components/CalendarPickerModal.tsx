import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y } from '@/lib/selection';
import { MIN_TOUCH, overlayCenteredStyle, radius } from '@/lib/tokens';
// اسم اليوم كامل لقارئ الشاشة («الأربع، 11 نوفمبر 2026») — نفس قايمة الدخل الثابت، عشان الاتنين ميختلفوش
import { MONTH_NAMES } from '@/lib/dateText';
import { WEEKDAY_NAMES } from '@/lib/recurringIncome';
import { useMemo, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

const WEEKDAYS = ['أحد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];
/** خانة الشهر — نفس طول الشكل القديم (عرض ~104 × 1/1.6)، ثابت عشان مفيش aspectRatio (شوف dayCell) */
const MONTH_CELL_HEIGHT = 64;

function daysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function firstWeekday(year: number, month: number) { return new Date(year, month, 1).getDay(); }
function pad(n: number) { return String(n).padStart(2, '0'); }

type ViewLevel = 'days' | 'months' | 'years';

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
  const now = new Date();
  const [initYear, initMonth] = value
    ? [Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1]
    : [now.getFullYear(), now.getMonth()];
  const [viewYear, setViewYear] = useState(initYear);
  const [viewMonth, setViewMonth] = useState(initMonth);
  const [level, setLevel] = useState<ViewLevel>('days');
  const [yearsPageStart, setYearsPageStart] = useState(Math.floor(initYear / 12) * 12);

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
  function close() { setLevel('days'); onClose(); }

  const prevLabel = level === 'days' ? 'الشهر اللي فات' : level === 'months' ? 'السنة اللي فاتت' : 'السنين اللي فاتت';
  const nextLabel = level === 'days' ? 'الشهر الجاي' : level === 'months' ? 'السنة الجاية' : 'السنين الجاية';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      {/* الخلفية والكارت مش أزرار لقارئ الشاشة (accessible=false): الخلفية كانت "زرار" من غير اسم، والكارت ماسك الدوس بس */}
      <TouchableOpacity accessible={false} style={styles.overlay} activeOpacity={1} onPress={close}>
        {/* iOS: التركيز محبوس جوّه، وإيماءة الخروج بتقفل (a11y-architect جولة 2). أندرويد: زرار الرجوع ← onRequestClose */}
        <TouchableOpacity accessible={false} accessibilityViewIsModal onAccessibilityEscape={close} activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <TouchableOpacity onPress={goPrev} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={prevLabel}>
              <Text style={styles.navText}>›</Text>
            </TouchableOpacity>

            <View style={styles.labelRow}>
              {level === 'days' && (
                <>
                  <TouchableOpacity style={styles.labelBtn} accessibilityRole="button" accessibilityHint="اختار سنة تانية" onPress={() => setLevel('years')}>
                    <Text style={styles.label}>{viewYear}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.labelBtn} accessibilityRole="button" accessibilityHint="اختار شهر تاني" onPress={() => setLevel('months')}>
                    <Text style={styles.label}>{MONTH_NAMES[viewMonth]}</Text>
                  </TouchableOpacity>
                </>
              )}
              {level === 'months' && (
                <TouchableOpacity style={styles.labelBtn} accessibilityRole="button" accessibilityHint="اختار سنة تانية" onPress={() => setLevel('years')}>
                  <Text style={styles.label}>{viewYear}</Text>
                </TouchableOpacity>
              )}
              {level === 'years' && (
                <Text style={styles.label}>{yearsPageStart} - {yearsPageStart + 11}</Text>
              )}
            </View>

            <TouchableOpacity onPress={goNext} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={nextLabel}>
              <Text style={styles.navText}>‹</Text>
            </TouchableOpacity>
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
                    <TouchableOpacity key={i} disabled={!day} onPress={() => day && selectDay(day)}
                      {...selectionA11y(isSelected)}
                      accessible={!!day}
                      accessibilityLabel={day ? `${WEEKDAY_NAMES[(startWeekday + day - 1) % 7]}، ${day} ${MONTH_NAMES[viewMonth]} ${viewYear}` : undefined}
                      style={[styles.dayCell, isSelected && styles.cellSelected]}>
                      {day ? <Text style={[styles.cellText, isSelected && styles.cellTextSelected]}>{day}</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {level === 'months' && (
            <View style={styles.grid}>
              {/* الاسم كامل: «سبت» المختصر كان بيتقري السبت */}
              {MONTH_NAMES.map((m, i) => (
                <TouchableOpacity key={m} onPress={() => selectMonth(i)}
                  {...selectionA11y(i === viewMonth)} accessibilityLabel={`${MONTH_NAMES[i]} ${viewYear}`}
                  style={[styles.monthCell, i === viewMonth && styles.cellSelected]}>
                  <Text style={[styles.cellText, i === viewMonth && styles.cellTextSelected]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {level === 'years' && (
            <View style={styles.grid}>
              {Array.from({ length: 12 }, (_, i) => yearsPageStart + i).map(y => (
                <TouchableOpacity key={y} onPress={() => selectYear(y)} {...selectionA11y(y === viewYear)}
                  style={[styles.monthCell, y === viewYear && styles.cellSelected]}>
                  <Text style={[styles.cellText, y === viewYear && styles.cellTextSelected]}>{y}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayCenteredStyle,
    // أقصى عرض: الخانة طولها ثابت، فعلى تابلت أو موبايل بيتفرد كانت هتبقى شريط عريض (visual-identity-reviewer)
    card: { backgroundColor: c.surface, borderRadius: radius.xl, padding: 16, width: '88%', maxWidth: 360, borderWidth: 1, borderColor: c.borderStrong },
    header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    navBtn: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    navText: { color: c.text, fontSize: 20 },
    labelRow: { flexDirection: 'row-reverse', gap: 10 },
    labelBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    label: { color: c.accentText, fontSize: 15, fontWeight: '700' },
    weekRow: { flexDirection: 'row-reverse', marginBottom: 6 },
    weekday: { flex: 1, textAlign: 'center', color: c.textSecondary, fontSize: 11 },
    grid: { flexDirection: 'row-reverse', flexWrap: 'wrap' },
    // طول ثابت مش `aspectRatio`: مع عرض بالنسبة جوه صف بيلف، أندرويد كان بيحسب الطول من غير ما يعيد
    // توسيط الرقم — على الشاومي (1.0.0.011) الخانة 32 بس والرقم لازق تحت في كل الصفوف ماعدا صف واحد
    dayCell: { width: '14.28%', height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    monthCell: { width: '33.33%', height: MONTH_CELL_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    cellSelected: { backgroundColor: c.accent },
    cellText: { color: c.text, fontSize: 13 },
    cellTextSelected: { color: c.onAccent, fontWeight: '700' },
  });
}