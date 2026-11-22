import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { isDegraded, useHealth } from '../youtube/resolver/health';
import { testServer } from '../youtube/resolver/PersonalServerResolver';
import { clearServerToken, normalizeServerUrl, saveServerConfig, setForceServerOnly, useServerConfig } from '../youtube/resolver/serverConfig';

/** "Streaming is degraded" banner: on-device resolving keeps failing and no backup server is set. */
export function DegradedBanner() {
  const records = useHealth((s) => s.records);
  const { url, hasToken } = useServerConfig();
  if (!isDegraded(records, !!url && hasToken)) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerTitle}>Streaming is degraded</Text>
      <Text style={styles.body}>The on-device resolver is failing. Set up a backup server below, or update the app. </Text>
      <Pressable onPress={() => router.push('/diagnostics')} accessibilityRole="link" accessibilityLabel="Open the logs">
        <Text style={styles.link}>View logs</Text>
      </Pressable>
    </View>
  );
}

export function BackupServerNote() {
  const { url, hasToken } = useServerConfig();
  return <Text style={styles.note}>{url && hasToken ? 'On' : 'Off'}</Text>;
}

export function BackupServerSection() {
  const { theme } = useUnistyles();
  const cfg = useServerConfig();
  const [url, setUrl] = useState(cfg.url);
  const [token, setToken] = useState('');
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    await saveServerConfig(url, token);
    setToken('');
    setResult('Saved');
  };
  const test = async () => {
    setBusy(true);
    setResult(undefined);
    const clean = normalizeServerUrl(url);
    const tok = token || useServerConfig.getState().token;
    if (!clean || !tok) {
      setResult('Enter the server URL and token first');
    } else {
      const r = await testServer(clean, tok);
      setResult(r.ok ? `Connected in ${r.latencyMs} ms (${r.detail})` : `${r.detail} after ${r.latencyMs} ms`);
    }
    setBusy(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.body}>Optional. If on-device streaming breaks, Sangeet falls back to your own server (see server/README.md). The token is stored in the iOS keychain.</Text>
      <TextInput style={styles.input} value={url} onChangeText={setUrl} placeholder="http://sangeet-server:8000" placeholderTextColor={theme.colors.textTertiary} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Backup server URL" />
      <TextInput style={styles.input} value={token} onChangeText={setToken} placeholder={cfg.hasToken ? 'Token saved (enter a new one to replace)' : 'Token'} placeholderTextColor={theme.colors.textTertiary} autoCapitalize="none" autoCorrect={false} secureTextEntry accessibilityLabel="Backup server token" />
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => void save()} accessibilityRole="button" accessibilityLabel="Save server settings">
          <Text style={styles.btnText}>Save</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void test()} disabled={busy} accessibilityRole="button" accessibilityLabel="Test connection">
          <Text style={styles.btnText}>{busy ? 'Testing…' : 'Test connection'}</Text>
        </Pressable>
        {cfg.hasToken ? (
          <Pressable style={styles.btn} onPress={() => void clearServerToken().then(() => setResult('Token removed'))} accessibilityRole="button" accessibilityLabel="Remove token">
            <Text style={[styles.btnText, { color: theme.colors.error }]}>Remove token</Text>
          </Pressable>
        ) : null}
      </View>
      {result ? <Text style={styles.body} accessibilityLiveRegion="polite">{result}</Text> : null}
      {__DEV__ ? (
        <View style={styles.row}>
          <Text style={[styles.body, { flex: 1 }]}>Developer: skip the on-device resolver</Text>
          <Switch value={cfg.forceServerOnly} onValueChange={setForceServerOnly} accessibilityLabel="Use only the backup server" trackColor={{ true: theme.colors.accent }} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' },
  body: { color: theme.colors.textSecondary, ...theme.typography.body },
  note: { color: theme.colors.textTertiary, ...theme.typography.body },
  input: { color: theme.colors.text, backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, ...theme.typography.body },
  btn: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  btnText: { color: theme.colors.text, ...theme.typography.heading },
  banner: { marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceElevated, gap: theme.spacing.xs },
  bannerTitle: { color: theme.colors.error, ...theme.typography.heading },
  link: { color: theme.colors.accent, ...theme.typography.heading },
}));
