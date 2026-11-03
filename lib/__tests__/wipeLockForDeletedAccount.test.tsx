import React from 'react';
import { act, render } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppLockProvider, useAppLock } from '@/context/AppLockContext';

/**
 * مسح الحساب ← قفل التطبيق ومهلته بيتمسحوا (قرار مؤمن على ترشيح البحث 2026-11-03). silent-failure-hunter: لو مفتاح واحد رمى،
 * الباقي برضه يتمسح، والحالة تبقى "مفيش قفل" على طول — مش شاشة قفل لحساب اتمسح على شاشة الدخول.
 */
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => {
      if (k === 'nuqta_lock_type') throw new Error('keystore busy');
      delete store[k];
    }),
  };
});

const holder: { current: ReturnType<typeof useAppLock> | null } = { current: null };
function Probe() { holder.current = useAppLock(); return null; }

it('مفتاح واحد رمى ← الباقي بيتمسح (ومعاه المهلة)، والحالة "مفيش قفل"', async () => {
  const store = (SecureStore as unknown as { __store: Record<string, string> }).__store;
  Object.assign(store, { nuqta_lock_enabled: 'true', nuqta_lock_type: 'pin', nuqta_lock_hash: 'h', nuqta_lock_freq: 'onOpen', nuqta_lock_grace: '5' });
  await render(<AppLockProvider><Probe /></AppLockProvider>);
  await act(async () => { await holder.current!.wipeLockForDeletedAccount(); });
  const deleted = (SecureStore.deleteItemAsync as jest.Mock).mock.calls.map(c => c[0]);
  expect(deleted).toEqual(expect.arrayContaining(['nuqta_lock_enabled', 'nuqta_lock_type', 'nuqta_lock_hash', 'nuqta_lock_freq', 'nuqta_lock_grace']));
  expect(store.nuqta_lock_enabled).toBeUndefined();
  expect(store.nuqta_lock_hash).toBeUndefined();
  expect(store.nuqta_lock_grace).toBeUndefined();
  expect(holder.current!.enabled).toBe(false);
  expect(holder.current!.isLocked).toBe(false);
  expect(holder.current!.graceMinutes).toBe(0);
});
