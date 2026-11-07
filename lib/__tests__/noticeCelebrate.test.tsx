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

it('الدين اتقفل (settledNow) ← الرسالة بـcelebrate — ومفيش رسالة تانية بتاخدها', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'components', 'DebtEntryModals.tsx'), 'utf8');
  expect(src).toContain('notice(DEBT_SETTLED_TITLE, DEBT_SETTLED_BODY, undefined, { celebrate: true })');
  const all = (require('child_process').execSync('git grep -n "celebrate: true" -- app components', { cwd: require('path').join(__dirname, '..', '..') }) as Buffer).toString().trim().split('\n');
  expect(all).toHaveLength(1);
});
