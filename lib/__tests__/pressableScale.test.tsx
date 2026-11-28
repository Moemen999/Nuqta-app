import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/AppText';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import type { PressableScaleProps } from '@/components/PressableScale';

/** 9.5-5 خطوة 3: الضغطة الواحدة — شفافية + تصغير وقت الضغط بس، ومفيش `TouchableOpacity` راجع. */
const flat = () => StyleSheet.flatten(screen.getByTestId('p').props.style) ?? {};

/** حالة الضغط: fireEvent('pressIn') مبيحرّكش Pressability في Jest، فبننادي PressableScale كدالة وناخد دالة الستايل اللي بتتبعت لـPressable */
const pressedStyle = (props: PressableScaleProps) => StyleSheet.flatten((PressableScale(props) as React.ReactElement<{ style: (s: { pressed: boolean }) => unknown }>).props.style({ pressed: true }) as object) ?? {};

describe('PressableScale', () => {
  it('بيضغط، ومن غير ضغط مفيش شفافية ولا تصغير', async () => {
    const onPress = jest.fn();
    await render(<PressableScale testID="p" style={{ padding: 12 }} onPress={onPress}><Text>x</Text></PressableScale>);
    expect(flat()).toEqual({ padding: 12 });
    await fireEvent.press(screen.getByTestId('p'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('وقت الضغط: 0.85 + تصغير 0.98 فوق الستايل', async () => {
    expect(pressedStyle({ style: { padding: 12 } })).toMatchObject({ padding: 12, opacity: 0.85, transform: [{ scale: 0.98 }] });
  });

  it('activeOpacity={1} (الخلفية ورا الورقة): مفيش أي رد فعل', async () => {
    expect(pressedStyle({ activeOpacity: 1 })).toEqual({});
    expect(pressedStyle({ activeOpacity: 1, style: { padding: 4 } })).toEqual({ padding: 4 });
  });

  it('activeOpacity مخصوص (لوحة الـPIN) بيتاخد', async () => {
    expect(pressedStyle({ activeOpacity: 0.6 })).toMatchObject({ opacity: 0.6 });
  });

  it('معطّل وقت الضغط: مفيش شفافية ولا تصغير', () => {
    expect(pressedStyle({ disabled: true, style: { padding: 4 } })).toEqual({ padding: 4 });
  });

  it('معطّل: مبيضغطش، والقارئ عارف', async () => {
    const onPress = jest.fn();
    await render(<PressableScale testID="p" disabled onPress={onPress}><Text>x</Text></PressableScale>);
    await fireEvent.press(screen.getByTestId('p'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('p').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('collapsable={false} دايمًا (NUQTA-3)', async () => {
    await render(<PressableScale testID="p" onPress={() => {}}><Text>x</Text></PressableScale>);
    expect(screen.getByTestId('p').props.collapsable).toBe(false);
  });
});

it('جرد: مفيش TouchableOpacity في app/ ولا components/ — الضغطة من PressableScale (أو Button)', () => {
  const root = join(__dirname, '..', '..');
  const walk = (d: string): string[] => readdirSync(join(root, d)).flatMap(f => {
    const rel = `${d}/${f}`;
    if (statSync(join(root, rel)).isDirectory()) return f === '__tests__' ? [] : walk(rel);
    return /\.tsx?$/.test(f) ? [rel] : [];
  });
  const offenders = [...walk('app'), ...walk('components')].filter(f =>
    /<TouchableOpacity\b|\bTouchableOpacity\b[^\n]*from 'react-native'|import\s*\{[^}]*\bTouchableOpacity\b[^}]*\}\s*from 'react-native'/.test(readFileSync(join(root, f), 'utf8')));
  expect(offenders).toEqual([]);
});
