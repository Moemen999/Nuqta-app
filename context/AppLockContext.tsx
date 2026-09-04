import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type LockType = 'pin' | 'password';
type LockFrequency = 'onOpen' | 'everyResume';

type AppLockContextType = {
  enabled: boolean;
  lockType: LockType;
  frequency: LockFrequency;
  isLocked: boolean;
  loading: boolean;
  setupLock: (type: LockType, code: string) => Promise<void>;
  disableLock: (code: string) => Promise<boolean>;
  changeCode: (oldCode: string, newCode: string, newType: LockType) => Promise<boolean>;
  setFrequency: (f: LockFrequency) => void;
  graceMinutes: number;
  setGraceMinutes: (m: number) => void;
  verify: (code: string) => Promise<boolean>;
  unlock: () => void;
};

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

const K_ENABLED = 'nuqta_lock_enabled';
const K_TYPE = 'nuqta_lock_type';
const K_FREQ = 'nuqta_lock_freq';
const K_HASH = 'nuqta_lock_hash';
const K_GRACE = 'nuqta_lock_grace';

async function hash(code: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [lockType, setLockType] = useState<LockType>('pin');
  const [frequency, setFrequencyState] = useState<LockFrequency>('onOpen');
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [graceMinutes, setGraceMinutesState] = useState(0);
  const appState = useRef(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const en = await SecureStore.getItemAsync(K_ENABLED);
        const t = await SecureStore.getItemAsync(K_TYPE);
        const f = await SecureStore.getItemAsync(K_FREQ);
        const isEnabled = en === '1';
        setEnabled(isEnabled);
        if (t === 'pin' || t === 'password') setLockType(t);
        if (f === 'onOpen' || f === 'everyResume') setFrequencyState(f);
        const g = await SecureStore.getItemAsync(K_GRACE);
        if (g !== null) setGraceMinutesState(Number(g) || 0);
        setIsLocked(isEnabled);
      } catch {
        // لو التخزين الآمن مش متاح لأي سبب، التطبيق يكمل من غير قفل بدل ما يتكسر
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/);
      if (next.match(/inactive|background/)) {
        backgroundedAt.current = Date.now();
      }
      if (enabled && frequency === 'everyResume' && wasBackground && next === 'active') {
        // لو المستخدم حدد مهلة، منقفلش إلا لو عدّت المهلة دي وهو بره التطبيق
        const awayMs = backgroundedAt.current ? Date.now() - backgroundedAt.current : Infinity;
        if (awayMs >= graceMinutes * 60 * 1000) {
          setIsLocked(true);
        }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [enabled, frequency, graceMinutes]);

  async function setupLock(type: LockType, code: string) {
    const h = await hash(code);
    await SecureStore.setItemAsync(K_ENABLED, '1');
    await SecureStore.setItemAsync(K_TYPE, type);
    await SecureStore.setItemAsync(K_HASH, h);
    const existingFreq = await SecureStore.getItemAsync(K_FREQ);
    if (!existingFreq) await SecureStore.setItemAsync(K_FREQ, 'onOpen');
    setEnabled(true);
    setLockType(type);
  }

  async function disableLock(code: string) {
    const ok = await verify(code);
    if (!ok) return false;
    await SecureStore.deleteItemAsync(K_ENABLED);
    await SecureStore.deleteItemAsync(K_TYPE);
    await SecureStore.deleteItemAsync(K_HASH);
    await SecureStore.deleteItemAsync(K_FREQ);
    setEnabled(false);
    setIsLocked(false);
    return true;
  }

  async function changeCode(oldCode: string, newCode: string, newType: LockType) {
    const ok = await verify(oldCode);
    if (!ok) return false;
    const h = await hash(newCode);
    await SecureStore.setItemAsync(K_HASH, h);
    await SecureStore.setItemAsync(K_TYPE, newType);
    setLockType(newType);
    return true;
  }

  async function setGraceMinutes(m: number) {
    await SecureStore.setItemAsync(K_GRACE, String(m));
    setGraceMinutesState(m);
  }

  async function setFrequency(f: LockFrequency) {
    await SecureStore.setItemAsync(K_FREQ, f);
    setFrequencyState(f);
  }

  async function verify(code: string) {
    try {
      const stored = await SecureStore.getItemAsync(K_HASH);
      if (!stored) return false;
      const h = await hash(code);
      return h === stored;
    } catch {
      return false;
    }
  }

  function unlock() {
    setIsLocked(false);
  }

  return (
    <AppLockContext.Provider value={{ enabled, lockType, frequency, isLocked, loading, setupLock, disableLock, changeCode, setFrequency, graceMinutes, setGraceMinutes, verify, unlock }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}