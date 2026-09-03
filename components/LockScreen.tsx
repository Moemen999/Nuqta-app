import { useAppLock } from '@/context/AppLockContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function LockScreen() {
  const { colors } = useTheme();
  const { lockType, verify, unlock } = useAppLock();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const styles = makeStyles(colors);

  async function handleSubmit(value?: string) {
    const toCheck = value ?? code;
    if (!toCheck) return;
    const ok = await verify(toCheck);
    if (ok) {
      unlock();
      setCode('');
      setError('');
    } else {
      setError('غلط، جرب تاني');
      setCode('');
    }
  }

  function pressDigit(d: string) {
    if (code.length >= 4) return;
    const next = code + d;
    setCode(next);
    if (next.length === 4) handleSubmit(next);
  }
  function backspace() {
    setCode(c => c.slice(0, -1));
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>نقطة مقفولة 🔒</Text>
      {lockType === 'pin' ? (
        <>
          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[styles.dot, { backgroundColor: i < code.length ? colors.accent : colors.surface2 }]} />
            ))}
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.keypad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
              <TouchableOpacity
                key={i}
                style={styles.key}
                disabled={k === ''}
                onPress={() => (k === '⌫' ? backspace() : k !== '' && pressDigit(k))}>
                <Text style={styles.keyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="الباسورد"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            textAlign="right"
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.submitBtn} onPress={() => handleSubmit()}>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>دخول</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { color: c.text, fontSize: 20, fontWeight: '700', marginBottom: 30 },
    dotsRow: { flexDirection: 'row', gap: 14, marginBottom: 20 },
    dot: { width: 16, height: 16, borderRadius: 8 },
    error: { color: c.danger, fontSize: 13, marginBottom: 14 },
    keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center' },
    key: { width: 70, height: 70, alignItems: 'center', justifyContent: 'center' },
    keyText: { color: c.text, fontSize: 24 },
    input: { width: '100%', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, padding: 14, fontSize: 16, marginBottom: 14 },
    submitBtn: { backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 30, paddingVertical: 12 },
  });
}