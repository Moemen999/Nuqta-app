import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppLock } from '@/context/AppLockContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

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
      <Text style={styles.lockEmoji}>🔒</Text>
      <Text style={styles.title}>نقطة مقفولة</Text>

      {lockType === 'pin' ? (
        <>
          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[styles.dot, { backgroundColor: i < code.length ? colors.accent : colors.surface2, borderColor: colors.borderStrong }]} />
            ))}
          </View>
          <Text style={styles.error}>{error || ' '}</Text>

          <View style={styles.keypad}>
            {KEY_ROWS.map((row, ri) => (
              <View key={ri} style={styles.keyRow}>
                {row.map((k, ki) => (
                  <TouchableOpacity
                    key={ki}
                    style={[styles.key, k === '' && styles.keyHidden, { backgroundColor: colors.surface }]}
                    disabled={k === ''}
                    activeOpacity={0.6}
                    onPress={() => (k === '⌫' ? backspace() : k !== '' && pressDigit(k))}>
                    <Text style={[styles.keyText, { color: colors.text }]}>{k}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.passwordArea}>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="الباسورد"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            textAlign="right"
            autoFocus
          />
          <Text style={styles.error}>{error || ' '}</Text>
          <TouchableOpacity style={styles.submitBtn} onPress={() => handleSubmit()}>
            <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 16 }}>دخول</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
    lockEmoji: { fontSize: 44, marginBottom: 10 },
    title: { color: c.text, fontSize: 20, fontWeight: '700', marginBottom: 28 },
    dotsRow: { flexDirection: 'row', gap: 18, marginBottom: 14 },
    dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1 },
    error: { color: c.danger, fontSize: 13, marginBottom: 18, minHeight: 18, textAlign: 'center' },
    keypad: { gap: 18 },
    keyRow: { flexDirection: 'row', gap: 22, justifyContent: 'center' },
    key: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' },
    keyHidden: { backgroundColor: 'transparent' },
    keyText: { fontSize: 28, fontWeight: '500' },
    passwordArea: { width: '100%', maxWidth: 320 },
    input: { width: '100%', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, color: c.text, padding: 16, fontSize: 17 },
    submitBtn: { backgroundColor: c.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 15, marginTop: 4 },
  });
}
