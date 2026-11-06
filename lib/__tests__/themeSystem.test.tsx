import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

/** دراسة الشكل خطوة 6: «زي الموبايل» بيمشي مع إعداد الموبايل؛ الموبايل مقالش ← الغامق */
let mockScheme: 'light' | 'dark' | null = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider, useTheme } = require('@/context/ThemeContext');
let api: { theme: string; preference: string; setTheme: (t: string) => void };
function Probe() { api = useTheme(); return <Text>{api.theme}</Text>; }

it('system ← بياخد ثيم الموبايل، والثابت مبيتأثرش', async () => {
  await render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(api.theme).toBe('dark'); // الافتراضي زي ما هو
  await act(async () => { api.setTheme('system'); });
  expect([api.preference, api.theme]).toEqual(['system', 'light']);
  // الموبايل مقالش ← الغامق (بنعيد الاختيار عشان يترسم تاني)
  mockScheme = null;
  await act(async () => { api.setTheme('light'); });
  await act(async () => { api.setTheme('system'); });
  expect(screen.getByText('dark')).toBeTruthy();
});
