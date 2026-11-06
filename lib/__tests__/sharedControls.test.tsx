import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PeriodChips } from '@/components/PeriodChips';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ThemeProvider } from '@/context/ThemeContext';
import { MIN_TOUCH } from '@/lib/tokens';

/** دراسة الشكل خطوة 1: المكوّنين المشتركين — دور وحالة لقارئ الشاشة وطول 44 من الأول */

it('SegmentedControl: tablist، كل واحد tab بحالة selected، وطوله ≥ 44، والدوس بيغيّر', async () => {
  const onChange = jest.fn();
  await render(<ThemeProvider><SegmentedControl value="a" onChange={onChange} segments={[
    { key: 'a', label: 'أ', testID: 'seg_a' }, { key: 'b', label: 'ب', testID: 'seg_b' },
  ]} /></ThemeProvider>);
  const a = screen.getByTestId('seg_a'), b = screen.getByTestId('seg_b');
  expect([a.props.accessibilityRole, a.props.accessibilityState.selected, b.props.accessibilityState.selected]).toEqual(['tab', true, false]);
  expect(StyleSheet.flatten(a.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
  await act(async () => { fireEvent.press(b); });
  expect(onChange).toHaveBeenCalledWith('b');
});

it('PeriodChips: testID `{prefix}_{key}` زي القديم، وحالة الاختيار، و≥ 44', async () => {
  const onChange = jest.fn();
  await render(<ThemeProvider><PeriodChips keys={['thisMonth', 'last7']} value="last7" onChange={onChange} testIDPrefix="x_preset" /></ThemeProvider>);
  const c = screen.getByTestId('x_preset_last7');
  expect(c.props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('x_preset_thisMonth').props.accessibilityState.selected).toBe(false);
  expect(StyleSheet.flatten(c.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
  await act(async () => { fireEvent.press(screen.getByTestId('x_preset_thisMonth')); });
  expect(onChange).toHaveBeenCalledWith('thisMonth');
});
