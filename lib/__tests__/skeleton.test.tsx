import { AccessibilityInfo, Animated } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { SpendLoading } from '@/components/SpendStatus';
import { ThemeProvider } from '@/context/ThemeContext';
import { TRANSFERS_LOADING } from '@/lib/spending';

const wrap = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;
afterEach(() => jest.restoreAllMocks());

it('Skeleton: من غير نبض لو تقليل الحركة شغّال', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const loop = jest.spyOn(Animated, 'loop');
  await render(wrap(<Skeleton testID="sk" width={100} height={20} />));
  await act(async () => { await Promise.resolve(); });
  loop.mockClear();
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('sk', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
  // بعد وصول الإجابة مفيش لفّة جديدة بتتبدأ
  expect(loop.mock.calls.length).toBe(0);
});

it('Skeleton: بينبض لو الحركة مش مقلّلة', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const loop = jest.spyOn(Animated, 'loop');
  await render(wrap(<Skeleton width={100} height={20} />));
  await act(async () => { await Promise.resolve(); });
  expect(loop).toHaveBeenCalled();
});

it('SkeletonGroup: عقدة واحدة بتتقري «بنحمّل…» ومعاها progressbar', async () => {
  await render(wrap(<SkeletonGroup testID="g" label={TRANSFERS_LOADING}><Skeleton height={10} /><Skeleton height={10} /></SkeletonGroup>));
  const g = screen.getByTestId('g');
  expect(g.props.accessible).toBe(true);
  expect(g.props.accessibilityRole).toBe('progressbar');
  expect(g.props.accessibilityLabel).toBe(TRANSFERS_LOADING);
  expect(screen.queryByText(/\d/)).toBeNull();
});

it('SpendLoading: هيكل بالتسمية، مفيش نص ولا أرقام', async () => {
  await render(wrap(<SpendLoading testID="sl" />));
  expect(screen.getByTestId('sl').props.accessibilityLabel).toBe(TRANSFERS_LOADING);
  expect(screen.queryByText(TRANSFERS_LOADING)).toBeNull();
});
