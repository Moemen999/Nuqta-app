import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { IncomeAutoNotices } from '@/components/IncomeHomeCards';
import { ThemeProvider } from '@/context/ThemeContext';

/** الميزة 7 (a11y-architect): زرار ✕ على رسالة «ما سجلناش» بيقول اسم الدخل — كذا رسالة كانت كلها «اقفل الرسالة» */
jest.mock('@/lib/useIncomeAutoRecord', () => ({
  useIncomeAutoRecord: () => ({
    notices: [
      { id: 'a', kind: 'error', name: 'المرتب', text: 'ما سجلناش "المرتب" دلوقتي، ومفيش حاجة اتسجلت.' },
      { id: 'b', kind: 'error', text: 'رسالة قديمة من غير اسم' },
    ],
    dismiss: jest.fn(),
  }),
}));
jest.mock('@/context/DataContext', () => ({ useData: () => ({ incomes: [], wallets: [] }) }));

it('الـ✕ بيقول الاسم، ومن غير اسم ← «اقفل الرسالة»', async () => {
  await render(<ThemeProvider><IncomeAutoNotices /></ThemeProvider>);
  expect(screen.getByLabelText('اقفل رسالة "المرتب"')).toBeTruthy();
  expect(screen.getByLabelText('اقفل الرسالة')).toBeTruthy();
});
