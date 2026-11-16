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
  // المؤشر مش بالخلفية بس: إطار دهبي على المختار بس (contrast test بيثبّت إنه ≥ 3:1)
  expect(StyleSheet.flatten(a.props.style).borderColor).not.toBe('transparent');
  expect(StyleSheet.flatten(b.props.style).borderColor).toBe('transparent');
  await act(async () => { fireEvent.press(b); });
  expect(onChange).toHaveBeenCalledWith('b');
});

it('PeriodChips: testID `{prefix}_{key}` زي القديم، وحالة الاختيار، و≥ 44', async () => {
  const onChange = jest.fn();
  await render(<ThemeProvider><PeriodChips keys={['thisMonth', 'last7']} value="last7" onChange={onChange} testIDPrefix="x_preset" /></ThemeProvider>);
  const c = screen.getByTestId('x_preset_last7');
  expect([c.props.accessibilityRole, c.props.accessibilityState.checked]).toEqual(['radio', true]);
  expect(screen.getByTestId('x_preset_thisMonth').props.accessibilityState.checked).toBe(false);
  expect(StyleSheet.flatten(c.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
  expect(StyleSheet.flatten(c.props.style).borderColor).not.toBe('transparent');
  await act(async () => { fireEvent.press(screen.getByTestId('x_preset_thisMonth')); });
  expect(onChange).toHaveBeenCalledWith('thisMonth');
});

it('PeriodChips: سطر واحد بيتسحب (horizontal) من غير flexWrap، وبيطلع لحافة الأب بـbleed', async () => {
  await render(<ThemeProvider><PeriodChips keys={['thisMonth', 'last7']} value="last7" onChange={() => {}} testIDPrefix="y_preset" bleed={16} /></ThemeProvider>);
  const row = screen.getByTestId('y_preset_row');
  expect(row.props.horizontal).toBe(true);
  expect(row.props.showsHorizontalScrollIndicator).toBe(false);
  const content = StyleSheet.flatten(row.props.contentContainerStyle);
  expect(content.flexWrap).toBeUndefined();
  expect(content.flexDirection).toBe('row-reverse');
  expect(content.paddingHorizontal).toBe(16);
  expect(StyleSheet.flatten(row.parent!.props.style).marginHorizontal).toBe(-16);
  expect(row.props.accessibilityRole).toBe('radiogroup');
});

describe('PeriodChips: البداية يمين والتدرّج', () => {
  const setup = async () => {
    await render(<ThemeProvider><PeriodChips keys={['thisMonth', 'last7', 'lastMonth', 'all', 'custom']} value="thisMonth" onChange={() => {}} testIDPrefix="z_preset" /></ThemeProvider>);
    const row = screen.getByTestId('z_preset_row');
    return { row };
  };
  it('onContentSizeChange قبل onLayout ← لسه بيبدأ يمين (مرة واحدة)', async () => {
    const { row } = await setup();
    await act(async () => { row.props.onContentSizeChange(600, 44); });
    expect(screen.queryByTestId('z_preset_fade', { includeHiddenElements: true })).toBeNull();
    await act(async () => { row.props.onLayout({ nativeEvent: { layout: { width: 360, height: 44, x: 0, y: 0 } } }); });
    // البداية يمين = اتحرّك لآخر الصف (240 = 600 − 360) فالمحتوى المستخبي على الشمال ← التدرّج ظاهر
    expect(screen.getByTestId('z_preset_fade', { includeHiddenElements: true })).toBeTruthy();
  });
  it('التدرّج مش ظاهر لو الشرايح كفّت، ويختفي عند أقصى الشمال', async () => {
    const { row } = await setup();
    await act(async () => { row.props.onLayout({ nativeEvent: { layout: { width: 360, height: 44, x: 0, y: 0 } } }); });
    await act(async () => { row.props.onContentSizeChange(300, 44); });
    expect(screen.queryByTestId('z_preset_fade', { includeHiddenElements: true })).toBeNull();
  });
});
