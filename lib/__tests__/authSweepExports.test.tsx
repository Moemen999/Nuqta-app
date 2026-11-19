import React from 'react';
import { act, render } from '@testing-library/react-native';
import { sweepExportFiles } from '@/lib/exportFiles';

/**
 * Feature 9 — الجولة الأخيرة: على أندرويد ملف التصدير بيفضل بعد المشاركة (المستقبِل لسه بيقراه)، فلازم يتكنس:
 * أول ما التطبيق يفتح على حساب داخل (مرة واحدة)، وعند الخروج زي الأول. تسجيل دخول تاني في نفس الجلسة مش «فتح التطبيق».
 */
let mockAuthCb: ((u: unknown) => void) | null = null;
jest.mock('@/firebaseConfig', () => ({ auth: {}, db: {} }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => { mockAuthCb = cb; return () => {}; },
}));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), serverTimestamp: jest.fn(), setDoc: jest.fn() }));
jest.mock('@/lib/outboxStore', () => ({ markUserSignOut: jest.fn() }));
jest.mock('@/lib/exportFiles', () => ({ sweepExportFiles: jest.fn(async () => {}) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthProvider } = require('@/context/AuthContext');

it('فتح التطبيق على حساب داخل ← كنس مرة واحدة؛ تغيير تاني للحساب نفسه مبيكنسش؛ الخروج بيكنس', async () => {
  await render(<AuthProvider>{null}</AuthProvider>);
  await act(async () => { mockAuthCb!({ uid: 'u1' }); });
  expect(sweepExportFiles).toHaveBeenCalledTimes(1);
  await act(async () => { mockAuthCb!({ uid: 'u1' }); });
  expect(sweepExportFiles).toHaveBeenCalledTimes(1);
  await act(async () => { mockAuthCb!(null); });
  expect(sweepExportFiles).toHaveBeenCalledTimes(2);
});
