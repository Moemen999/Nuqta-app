import React from 'react';
import { act, render } from '@testing-library/react-native';
import { FabScrollProvider, useFabScroll, useFabVisible } from '@/context/FabScrollContext';
import { FAB_DRAG_FALLBACK_MS } from '@/lib/fabScroll';

/**
 * مراجعة التطبيق كله، الميزة 7 (LOW): `onScrollEndDrag` ممكن ميجيش (الشاشة اتشالت، أندرويد بلع الحدث) —
 * ساعتها `dragging` كان بيفضل true، وكل `onScroll` بيمسح المهلة، فالزرار "+" كان بيفضل مستخبي للأبد.
 * دلوقتي فيه مهلة احتياطية من آخر حدث وهو ماسك.
 */
jest.mock('expo-router', () => ({ usePathname: () => '/' }));

let actions: ReturnType<typeof useFabScroll>;
let visible = true;
function Probe() {
  actions = useFabScroll();
  visible = useFabVisible();
  return null;
}
const scroll = (y: number) => actions.scrollProps.onScroll({ nativeEvent: { contentOffset: { y } } } as never);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('الصباع نزل ومرّر ومفيش endDrag ← الزرار بيرجع بعد المهلة الاحتياطية', async () => {
  await render(<FabScrollProvider><Probe /></FabScrollProvider>);
  await act(async () => { jest.advanceTimersByTime(10); });
  await act(async () => {
    actions.scrollProps.onScrollBeginDrag();
    scroll(100); // المرساة
    scroll(200); // نازل ← يختفي
  });
  expect(visible).toBe(false);
  // وهو لسه بيتحرك قبل المهلة ← مستخبي
  await act(async () => { jest.advanceTimersByTime(FAB_DRAG_FALLBACK_MS - 100); scroll(260); });
  expect(visible).toBe(false);
  await act(async () => { jest.advanceTimersByTime(FAB_DRAG_FALLBACK_MS - 100); });
  expect(visible).toBe(false);
  // مفيش ولا حدث من آخر حركة لمدة المهلة ← يرجع
  await act(async () => { jest.advanceTimersByTime(200); });
  expect(visible).toBe(true);
});

it('endDrag جه عادي ← نفس السلوك القديم (يرجع بعد FAB_SETTLE_MS)، والمهلة الاحتياطية بتتلغي', async () => {
  await render(<FabScrollProvider><Probe /></FabScrollProvider>);
  await act(async () => {
    actions.scrollProps.onScrollBeginDrag();
    scroll(100);
    scroll(200);
  });
  expect(visible).toBe(false);
  await act(async () => { actions.scrollProps.onScrollEndDrag(); jest.advanceTimersByTime(150); });
  expect(visible).toBe(true);
  // أطول من «الإصبع ماسك ثانيتين ← مستخبي» (fabIncomeCard.test.tsx)
  expect(FAB_DRAG_FALLBACK_MS).toBeGreaterThan(2000);
});
