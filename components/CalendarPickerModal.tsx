import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const WEEKDAYS = ['أحد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];
const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <TouchableOpacity onPress={goPrev} style={styles.navBtn}>
              <Text style={styles.navText}>‹</Text>
            </TouchableOpacity>

            <View style={styles.labelRow}>
              {level === 'days' && (
                <>
                  <TouchableOpacity onPress={() => setLevel('years')}>
                    <Text style={styles.label}>{viewYear}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setLevel('months')}>
                    <Text style={styles.label}>{MONTH_NAMES[viewMonth]}</Text>
                  </TouchableOpacity>
                </>
              )}
              {level === 'months' && (
                <TouchableOpacity onPress={() => setLevel('years')}>
                  <Text style={styles.label}>{viewYear}</Text>
                </TouchableOpacity>
              )}
              {level === 'years' && (
                <Text style={styles.label}>{yearsPageStart} - {yearsPageStart + 11}</Text>
              )}
            </View>

            <TouchableOpacity onPress={goNext} style={styles.navBtn}>
              <Text style={styles.navText}>›</Text>
            </TouchableOpacity>
          </View>

          {level === 'days' && (
            <>
              <View style={styles.weekRow}>
                {WEEKDAYS.map(d => <Text key={d} style={styles.weekday}>{d}</Text>)}
              </View>
              <View style={styles.grid}>
                {dayCells.map((day, i) => {
                  const dateStr = day ? `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}` : null;
                  const isSelected = dateStr === value;
                  return (
                    <TouchableOpacity key={i} disabled={!day} onPress={() => day && selectDay(day)}
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
              {['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'].map((m, i) => (
                <TouchableOpacity key={m} onPress={() => selectMonth(i)}
                  style={[styles.monthCell, i === viewMonth && styles.cellSelected]}>
                  <Text style={[styles.cellText, i === viewMonth && styles.cellTextSelected]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {level === 'years' && (
            <View style={styles.grid}>
              {Array.from({ length: 12 }, (_, i) => yearsPageStart + i).map(y => (
                <TouchableOpacity key={y} onPress={() => selectYear(y)}
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
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
    card: { backgroundColor: c.surface, borderRadius: 16, padding: 16, width: '88%', borderWidth: 1, borderColor: c.borderStrong },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    navText: { color: c.text, fontSize: 20 },
    labelRow: { flexDirection: 'row-reverse', gap: 10 },
    label: { color: c.accent, fontSize: 15, fontWeight: '700' },
    weekRow: { flexDirection: 'row-reverse', marginBottom: 6 },
    weekday: { flex: 1, textAlign: 'center', color: c.textSecondary, fontSize: 11 },
    grid: { flexDirection: 'row-reverse', flexWrap: 'wrap' },
    dayCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    monthCell: { width: '33.33%', aspectRatio: 1.6, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    cellSelected: { backgroundColor: c.accent },
    cellText: { color: c.text, fontSize: 13 },
    cellTextSelected: { color: c.onAccent, fontWeight: '700' },
  });
}