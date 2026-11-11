import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { ThemeProvider } from '@/context/ThemeContext';
import { MIN_TOUCH } from '@/lib/tokens';

/**
 * خانات التقويم (fix/calendar-day-cells): على الشاومي (1.0.0.011) الخانة كانت 32 والرقم لازق تحت —
 * `aspectRatio` مع عرض بالنسبة جوه صف بيلف. دلوقتي طول ثابت، واسم كامل وحالة الاختيار لقارئ الشاشة.
 */

const show = (value = '2026-11-11') =>
  render(<ThemeProvider><CalendarPickerModal visible value={value} onSelect={jest.fn()} onClose={jest.fn()} /></ThemeProvider>);

describe('خانات أيام التقويم', () => {
  it('اسم كامل: اليوم والرقم والشهر والسنة، والمختار عليه selected', async () => {
    await show();
    const sel = screen.getByLabelText('الأربع 11 نوفمبر 2026');
    expect(sel.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('الحد 1 نوفمبر 2026').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByLabelText('الاتنين 30 نوفمبر 2026')).toBeTruthy();
  });

  it('طول ثابت ≥ 44 ومن غير aspectRatio (الخانة والشهر)', async () => {
    await show();
    const day = StyleSheet.flatten(screen.getByLabelText('الأربع 11 نوفمبر 2026').props.style);
    expect(day.aspectRatio).toBeUndefined();
    expect(day.height).toBeGreaterThanOrEqual(MIN_TOUCH);
    await fireEvent.press(screen.getByText('نوفمبر'));
    const month = StyleSheet.flatten(screen.getByLabelText('نوفمبر 2026').props.style);
    expect(month.aspectRatio).toBeUndefined();
    expect(month.height).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(screen.getByLabelText('نوفمبر 2026').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('الخانات الفاضية قبل أول يوم مش عناصر لقارئ الشاشة', async () => {
    await show('2026-11-11'); // نوفمبر 2026 بيبدأ الحد ← مفيش فاضي؛ أكتوبر بيبدأ الخميس ← 4 فاضيين
    await fireEvent.press(screen.getByLabelText('الشهر اللي فات'));
    expect(screen.getByLabelText('الخميس 1 أكتوبر 2026')).toBeTruthy();
    // الخانات الفاضية الأربعة مش زراير من غير اسم (كانت بتتقري «زرار» وبس)
    const days = screen.getAllByLabelText(/ أكتوبر 2026$/);
    expect(days).toHaveLength(31);
    expect(screen.getAllByRole('button').some(el => el.props.accessibilityLabel === undefined && el.props.disabled)).toBe(false);
  });
});
