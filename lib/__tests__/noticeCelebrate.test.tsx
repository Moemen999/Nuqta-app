import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { NoticeProvider, useNotice } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * «لحظة حلوة واحدة» (2026-11-07): `celebrate` بيرسم علامة صح + اهتزاز نجاح — مرة لكل رسالة، ومخفية عن قارئ الشاشة،
 * و«قلّل الحركة» بيظهرها ثابتة. ومن غير `celebrate` الرسالة زي الأول بالظبط.
 */
const mockHapticSuccess = jest.fn();
jest.mock('@/lib/haptics', () => ({ hapticSuccess: () => mockHapticSuccess(), hapticError: jest.fn(), hapticSelect: jest.fn() }));

let show: ReturnType<typeof useNotice> = () => {};
function Grab() { show = useNotice(); return null; }
const mount = () => render(<ThemeProvider><NoticeProvider><Grab /></NoticeProvider></ThemeProvider>);

beforeEach(() => { mockHapticSuccess.mockClear(); });

it('celebrate ← علامة صح مخفية عن قارئ الشاشة + اهتزاز نجاح مرة واحدة', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  await mount();
  await act(async () => { show('الدين اتسدد بالكامل', 'جملة', undefined, { celebrate: true }); });
  const mark = screen.getByTestId('notice_celebrate', { includeHiddenElements: true });
  expect(mark.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(mockHapticSuccess).toHaveBeenCalledTimes(1);
  // العنوان لسه هو اللي بيتقري
  expect(screen.getByLabelText('الدين اتسدد بالكامل. جملة')).toBeTruthy();
});

it('«قلّل الحركة» ← العلامة ظاهرة على طول (شفافية 1) من غير حركة', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await mount();
  await act(async () => { show('t', 'b', undefined, { celebrate: true }); });
  await act(async () => {});
  const style = screen.getByTestId('notice_celebrate', { includeHiddenElements: true }).props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.opacity).toBe(1);
});

it('من غير celebrate ← مفيش علامة ولا اهتزاز (الرسايل العادية زي ما هي)', async () => {
  await mount();
  await act(async () => { show('t', 'b'); });
  expect(screen.queryByTestId('notice_celebrate', { includeHiddenElements: true })).toBeNull();
  expect(mockHapticSuccess).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('notice_ok')); });
});

it('الدين اتقفل (settledNow) ← الرسالة بـcelebrate — ومفيش مكان تاني بيستخدمه', () => {
  const { readdirSync, readFileSync, statSync } = require('fs');
  const { join } = require('path');
  const root = join(__dirname, '..', '..');
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (n === '__tests__' || n === 'node_modules') continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && n !== 'NoticeProvider.tsx' && /celebrate\s*[:}]/.test(readFileSync(p, 'utf8'))) hits.push(n);
    }
  };
  for (const d of ['app', 'components', 'context', 'lib']) walk(join(root, d));
  expect(hits).toEqual(['DebtEntryModals.tsx']);
  expect(readFileSync(join(root, 'components', 'DebtEntryModals.tsx'), 'utf8'))
    .toContain('notice(DEBT_SETTLED_TITLE, DEBT_SETTLED_BODY, undefined, { celebrate: true })');
});

it('الزينة وقعت ← الرسالة و«تمام» لسه ظاهرين', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  mockHapticSuccess.mockImplementationOnce(() => { throw new Error('boom'); });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  await mount();
  await act(async () => { show('الدين اتسدد بالكامل', 'جملة', undefined, { celebrate: true }); });
  expect(screen.queryByTestId('notice_celebrate', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId('notice_ok')).toBeTruthy();
  expect(screen.getByLabelText('الدين اتسدد بالكامل. جملة')).toBeTruthy();
  warn.mockRestore(); err.mockRestore();
});
