import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useMemo, useState } from 'react';
import Animated from 'react-native-reanimated';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { ConnectByIp } from '../remote/ConnectByIp';
import { clearLogs, logFileUri, readLogLines, type LogEntry, type LogLevel } from '../util/logFile';
import { useHealth } from '../youtube/resolver/health';
import { Header, Screen, useScreenTop } from './Layout';
import { useScrollY } from './scroll';

const LEVELS: ('all' | LogLevel)[] = ['all', 'W', 'E'];
const LEVEL_NAME = { all: 'All', I: 'Info', W: 'Warn+', E: 'Errors' } as const;

function buildInfo(): string {
  const c = Constants.expoConfig;
  const build = Constants.platform?.ios?.buildNumber ?? '-';
  return `Sangeet ${c?.version ?? '?'} (build ${build}) ${__DEV__ ? 'dev' : 'release'}\niOS ${Platform.Version}, ${Device.modelName ?? 'unknown device'}`;
}

export function DiagnosticsScreen() {
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  const records = useHealth((s) => s.records);
  const [rev, setRev] = useState(0);
  const [tag, setTag] = useState<string>('all');
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `rev` is the refresh trigger for the file read
  const lines = useMemo(() => readLogLines(), [rev]);
  const tags = useMemo(() => ['all', ...Array.from(new Set(lines.map((l) => l.tag))).sort()], [lines]);
  const shown = useMemo(() => {
    const rank = { I: 0, W: 1, E: 2 } as const;
    const min = level === 'all' ? 0 : rank[level];
    return lines.filter((l) => (tag === 'all' || l.tag === tag) && rank[l.level] >= min).slice(-400).reverse();
  }, [lines, tag, level]);
  const health = useMemo(() => [...records].reverse().slice(0, 12), [records]);

  const share = async () => {
    const url = logFileUri();
    if (url) await Share.share({ url, message: Platform.OS === 'ios' ? undefined : url }).catch(() => {});
  };

  const header = (
    <View>
      <View style={styles.block}>
        <Text style={styles.h}>App</Text>
        <Text style={styles.mono} selectable>{buildInfo()}</Text>
      </View>
      <View style={styles.block}>
        <Text style={styles.h}>Resolver health</Text>
        {health.length === 0 ? <Text style={styles.dim}>No checks yet. One runs shortly after launch and every 30 minutes.</Text> : null}
        {health.map((r) => (
          <Text key={`${r.at}-${r.source}`} style={[styles.mono, !r.ok && styles.bad]} selectable>
            {`${new Date(r.at).toLocaleTimeString()} ${r.kind === 'check' ? 'check' : 'play '} ${r.source}${r.client ? `/${r.client}` : ''} ${r.ok ? `ok ${r.latencyMs}ms` : `FAIL ${r.reason ?? ''} ${r.latencyMs}ms`}`}
          </Text>
        ))}
      </View>
      <View style={styles.block}>
        <ConnectByIp />
        <Text style={styles.h}>Logs</Text>
        <View style={styles.pills}>
          {LEVELS.map((l) => (
            <Pressable key={l} onPress={() => setLevel(l)} style={[styles.pill, level === l && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: level === l }} accessibilityLabel={`Level ${LEVEL_NAME[l === 'all' ? 'all' : l]}`}>
              <Text style={[styles.pillText, level === l && styles.pillTextOn]}>{LEVEL_NAME[l === 'all' ? 'all' : l]}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.pills}>
          {tags.map((t) => (
            <Pressable key={t} onPress={() => setTag(t)} style={[styles.pill, tag === t && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: tag === t }} accessibilityLabel={`Tag ${t}`}>
              <Text style={[styles.pillText, tag === t && styles.pillTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.pills}>
          <Pressable style={styles.btn} onPress={() => void share()} accessibilityRole="button" accessibilityLabel="Share log file">
            <Text style={styles.btnText}>Share log file</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => setRev(rev + 1)} accessibilityRole="button" accessibilityLabel="Refresh logs">
            <Text style={styles.btnText}>Refresh</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => { clearLogs(); setRev(rev + 1); }} accessibilityRole="button" accessibilityLabel="Clear logs">
            <Text style={styles.btnText}>Clear</Text>
          </Pressable>
        </View>
        <Text style={styles.dim}>{`${shown.length} of ${lines.length} lines, newest first. Cookies, tokens and Authorization headers are redacted.`}</Text>
      </View>
    </View>
  );

  return (
    <Screen top="header">
      <Animated.FlatList<LogEntry>
        data={shown}
        keyExtractor={(l, i) => `${l.ts}-${i}`}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: topInset }]}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Text style={[styles.line, item.level === 'W' && styles.warn, item.level === 'E' && styles.bad]} selectable>
            {`${item.ts.slice(11, 23)} [${item.tag}] ${item.msg}`}
          </Text>
        )}
      />
      <Header title="Diagnostics" scrollY={scrollY} back inline />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.spacing.xxl },
  block: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, gap: theme.spacing.sm },
  h: { color: theme.colors.text, ...theme.typography.heading },
  dim: { color: theme.colors.textTertiary, ...theme.typography.body },
  mono: { color: theme.colors.textSecondary, fontFamily: 'Menlo', fontSize: 11 },
  line: { color: theme.colors.textSecondary, fontFamily: 'Menlo', fontSize: 10, paddingHorizontal: theme.spacing.lg, paddingVertical: 2 },
  warn: { color: '#E8B44C' },
  bad: { color: theme.colors.error },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  pill: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  pillOn: { backgroundColor: theme.colors.accent },
  pillText: { color: theme.colors.text, ...theme.typography.body },
  pillTextOn: { color: '#000' },
  btn: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  btnText: { color: theme.colors.text, ...theme.typography.body },
}));
