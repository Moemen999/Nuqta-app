import React from 'react';
import { render, act } from '@testing-library/react-native';
import { auth } from '@/firebaseConfig';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';

/**
 * مسح الحساب — الخطوة 2 (على محاكي Auth الحقيقي): إعادة الدخول بالباسورد (غلط ← `wrong-password`، صح ← `done`)، وبعدها
 * `deleteSignInAccount` بيمسح حساب الدخول نفسه — الدخول بنفس البيانات بعدها بيفشل.
 *
 * **مفيش بيانات دخول مكتوبة في الملف** (الريبو عام — CLAUDE.md): مستخدم محاكي جديد كل مرة، بقيم بتتعمل وقت التشغيل.
 */
const holder: { current: ReturnType<typeof useAuth> | null } = { current: null };
function Probe() { holder.current = useAuth(); return null; }

const runtimeValue = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function mountSignedIn() {
  try { await signOut(auth); } catch { /* مفيش مستخدم */ }
  const login = { email: `${runtimeValue('del')}@test.local`, pw: runtimeValue('p') };
  await createUserWithEmailAndPassword(auth, login.email, login.pw);
  const view = await render(<AuthProvider><Probe /></AuthProvider>);
  return { login, view };
}

it('باسورد غلط ← wrong-password ومفيش حاجة اتمسحت؛ صح ← done', async () => {
  const { login, view } = await mountSignedIn();
  let r: string | undefined;
  await act(async () => { r = await holder.current!.reauthenticate({ kind: 'password', password: `${login.pw}-x` }); });
  expect(r).toBe('wrong-password');
  expect(auth.currentUser).not.toBeNull();
  await act(async () => { r = await holder.current!.reauthenticate({ kind: 'password', password: login.pw }); });
  expect(r).toBe('done');
  view.unmount();
});

it('بعد إعادة الدخول ← deleteSignInAccount بيمسح حساب الدخول، والدخول بيه تاني بيفشل', async () => {
  const { login, view } = await mountSignedIn();
  let r: string | undefined;
  await act(async () => { r = await holder.current!.reauthenticate({ kind: 'password', password: login.pw }); });
  expect(r).toBe('done');
  await act(async () => { r = await holder.current!.deleteSignInAccount(); });
  expect(r).toBe('done');
  expect(auth.currentUser).toBeNull();
  await expect(signInWithEmailAndPassword(auth, login.email, login.pw)).rejects.toMatchObject({ code: expect.stringMatching(/user-not-found|invalid-credential|invalid-login-credentials/) });
  view.unmount();
});
