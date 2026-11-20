import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { useCurrentMinute } from '@/lib/useCurrentMinute';

function Probe() { return <Text testID="m">{String(useCurrentMinute())}</Text>; }

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('بيتحدّث عند حدود الدقيقة مش كل ثانية، وبيتنضّف عند الإزالة', async () => {
  jest.setSystemTime(new Date(2026, 10, 17, 9, 12, 30));
  const r = await render(<Probe />);
  expect(screen.getByTestId('m').props.children).toBe(String(9 * 60 + 12));
  await act(async () => { jest.advanceTimersByTime(29_000); });
  expect(screen.getByTestId('m').props.children).toBe(String(9 * 60 + 12));
  await act(async () => { jest.advanceTimersByTime(1_500); });
  expect(screen.getByTestId('m').props.children).toBe(String(9 * 60 + 13));
  const spy = jest.spyOn(global, 'clearTimeout');
  await r.unmount();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
