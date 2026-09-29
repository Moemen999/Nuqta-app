import React from 'react';
import { Alert, Text, TouchableOpacity } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NoticeProvider, spoken, useNotice } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * رسالة النتيجة بشكل التطبيق (2026-09-29) بدل Alert الأصلي في مسارات الفلوس.
 * اللي لازم يفضل: بتظهر بالعنوان والجملة وزرار "تمام" عربي؛ رسايل ورا بعض
 * مبتضيعش (بتتصف)؛ ومن غير Provider بترجع للأصلي بدل ما تختفي.
 */

let alertSpy: jest.SpyInstance;
beforeEach(() => { alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => alertSpy.mockRestore());

function Trigger({ items }: { items: [string, string][] }) {
  const notice = useNotice();
  return (
    <TouchableOpacity testID="fire" onPress={() => items.forEach(([t, b]) => notice(t, b))}>
      <Text>fire</Text>
    </TouchableOpacity>
  );
}

const mount = (items: [string, string][]) =>
  render(<ThemeProvider><NoticeProvider><Trigger items={items} /></NoticeProvider></ThemeProvider>);

it('بتظهر بالعنوان والجملة وزرار "تمام" — مش الـAlert الأصلي', async () => {
  await mount([['عدد الأقساط اتظبط', 'بعد الزيادة، الأقساط بقت 8 بدل 6.']]);
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('fire')); });
  expect(screen.getByTestId('notice_title').props.children).toBe('عدد الأقساط اتظبط');
  expect(screen.getByTestId('notice_body').props.children).toBe('بعد الزيادة، الأقساط بقت 8 بدل 6.');
  expect(screen.getByText('تمام')).toBeTruthy();
  expect(alertSpy).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('notice_ok')); });
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
});

it('رسالتين ورا بعض ← التانية بتظهر بعد ما الأولى تتقفل (مفيش رسالة بتضيع)', async () => {
  await mount([['ما اتسجلش', 'جرب تاني'], ['عدد الأقساط اتظبط', 'الأقساط بقت 7']]);
  await act(async () => { fireEvent.press(screen.getByTestId('fire')); });
  expect(screen.getByTestId('notice_title').props.children).toBe('ما اتسجلش');
  await act(async () => { fireEvent.press(screen.getByTestId('notice_ok')); });
  expect(screen.getByTestId('notice_title').props.children).toBe('عدد الأقساط اتظبط');
  await act(async () => { fireEvent.press(screen.getByTestId('notice_ok')); });
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
});

it('من غير Provider ← بترجع للـAlert الأصلي بدل ما تختفي', async () => {
  await render(<ThemeProvider><Trigger items={[['ما اتسجلش', 'جرب تاني']]} /></ThemeProvider>);
  await act(async () => { fireEvent.press(screen.getByTestId('fire')); });
  expect(alertSpy).toHaveBeenCalledWith('ما اتسجلش', 'جرب تاني');
});

it('المصدر: Provider في الجذر، ومسارات الفلوس مبتنادِيش Alert.alert برسالة نتيجة بزرار واحد', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const layout = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');
  expect(layout).toMatch(/<NoticeProvider>/);
  // رسايل النتيجة (نجاح/فشل بعد كتابة فلوس) — التأكيدات اللي فيها اختيار لسه Alert عن قصد
  const results: [string, RegExp][] = [
    ['components/DebtEntryModals.tsx', /Alert\.alert\((alert\.title|INSTALLMENTS_CHANGED_TITLE)/],
    ['components/ChargeHomeCards.tsx', /Alert\.alert\((alertFor|'اتسجلت قبل كده'|PAY_OUTCOME_ALERT)/],
    ['components/IncomeHomeCards.tsx', /Alert\.alert\(INCOME_RECORD_ALERT/],
    ['components/IncomesView.tsx', /Alert\.alert\((INCOME_RECORD_ALERT|INCOME_DELETE_ALERT)/],
    ['components/GamiyaView.tsx', /Alert\.alert\(m\.title/],
    ['components/SubscriptionsView.tsx', /Alert\.alert\((m\.title|'اتسجل النهاردة خلاص')/],
    ['app/(tabs)/debts.tsx', /Alert\.alert\((blocked\.title|DEBT_ENTRY_DELETE_ALERT)/],
  ];
  for (const [file, re] of results) {
    expect({ file, found: re.test(fs.readFileSync(path.join(root, file), 'utf8')) }).toEqual({ file, found: false });
  }
});

it('قارئ الشاشة: العنوان والجملة من غير علامات مكررة', () => {
  expect(spoken({ title: 'ما اتسجلش', body: 'جرب تاني.' })).toBe('ما اتسجلش. جرب تاني.');
  expect(spoken({ title: 'تمسحها؟', body: 'مش هترجع.' })).toBe('تمسحها؟ مش هترجع.');
  expect(spoken({ title: 'اتسجلت', body: '' })).toBe('اتسجلت');
});

it('دوستين بسرعة على "تمام" ← بتقفل الرسالة اللي اتعرضت بس، والجاية بتفضل ظاهرة', async () => {
  await mount([['ما اتسجلش', 'جرب تاني'], ['عدد الأقساط اتظبط', 'الأقساط بقت 7']]);
  await act(async () => { fireEvent.press(screen.getByTestId('fire')); });
  const ok = screen.getByTestId('notice_ok');
  await act(async () => { fireEvent.press(ok); fireEvent.press(ok); });
  expect(screen.getByTestId('notice_title').props.children).toBe('عدد الأقساط اتظبط');
});

it('قارئ الشاشة بيقرا العنوان والجملة عنصر واحد', async () => {
  await mount([['ما اتسجلش', 'جرب تاني.']]);
  await act(async () => { fireEvent.press(screen.getByTestId('fire')); });
  expect(screen.getByLabelText('ما اتسجلش. جرب تاني.')).toBeTruthy();
});
