import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { connectTv, disconnectTv, useRemote } from './phone';
import { parseAddress } from './protocol';

/** Developer / testing only (Settings > Diagnostics): connect to a Sangeet TV by address, for example through `adb forward`. */
export function ConnectByIp() {
  const [ip, setIp] = useState('');
  const status = useRemote((s) => s.status);
  const tvName = useRemote((s) => s.tvName);
  const error = useRemote((s) => s.error);
  const target = parseAddress(ip);
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Sangeet TV: connect by IP</Text>
      <View style={styles.row}>
        <TextInput style={styles.input} value={ip} onChangeText={setIp} placeholder="192.168.1.20 or 127.0.0.1:8765" placeholderTextColor="#8f8f8f" autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" accessibilityLabel="TV address" />
        <Pressable
          style={styles.btn}
          onPress={() => (status === 'off' ? target && void connectTv(target, { name: ip.trim() }) : void disconnectTv())}
          accessibilityRole="button"
          accessibilityLabel={status === 'off' ? 'Connect' : 'Disconnect'}>
          <Text style={styles.btnText}>{status === 'off' ? 'Connect' : 'Disconnect'}</Text>
        </Pressable>
      </View>
      <Text style={styles.status}>{status === 'off' ? (error ?? 'Not connected') : `${status}: ${tvName}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { gap: theme.spacing.sm, marginVertical: theme.spacing.md },
  title: { color: theme.colors.text, ...theme.typography.heading },
  row: { flexDirection: 'row', gap: theme.spacing.sm },
  input: { flex: 1, color: theme.colors.text, ...theme.typography.body, backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  btn: { backgroundColor: theme.colors.accent, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing.lg, justifyContent: 'center' },
  btnText: { color: '#000', ...theme.typography.heading },
  status: { color: theme.colors.textSecondary, ...theme.typography.caption },
}));
