import type { SFSymbol } from 'expo-symbols';
import { Icon } from '../ui/Icon';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { remoteNativeAvailable } from '../../modules/sangeet-remote';
import { outputIcon, outputKind, type OutputRoute } from '../ui/outputButton';
import { usePalette } from '../ui/palette/store';
import { showAirPlayPicker, useAirPlay } from '../ui/RoutePicker';
import { openCustomSheet } from '../ui/sheet';
import { connectTv, disconnectTv, useRemote, type FoundTv } from './phone';

const ANDROID = Platform.OS === 'android';
const connect = (t: FoundTv) => void connectTv(`svc:${t.key}`, { name: t.name, tvId: t.tvId });

/**
 * The one output button (mini player and full player). AirPlay targets only: opens the system AirPlay sheet. A Sangeet TV only:
 * connects (one TV), lists them (several) or disconnects. Both: a small sheet with This iPhone, the TV(s) and "AirPlay & Bluetooth".
 * The glyph shows where sound goes now.
 */
export function OutputButton({ size = 26, tint = '#FFFFFF', activeTint }: { size?: number; tint?: string; activeTint?: string }) {
  const status = useRemote((s) => s.status);
  const tvName = useRemote((s) => s.tvName);
  const found = useRemote((s) => s.found);
  const air = useAirPlay();
  const palette = usePalette();
  if (Platform.OS === 'web' || Platform.isTV) return null;
  const onTv = remoteNativeAvailable && status !== 'off';
  const route: OutputRoute = onTv ? 'tv' : air.active ? 'airplay' : 'phone';
  const kind = outputKind({ airplayAvailable: air.available, tvsFound: remoteNativeAvailable ? found.length : 0, route });
  if (kind === 'none') return null;

  const openPlayOn = () => openCustomSheet((close) => <PlayOnSheet close={close} />, { title: 'Play on' });
  const press = () => {
    if (kind === 'airplay') return showAirPlayPicker();
    if (kind === 'tv') {
      if (found.length > 1) return openPlayOn();
      return onTv ? void disconnectTv() : found.length === 1 ? connect(found[0]) : openPlayOn();
    }
    openPlayOn();
  };

  const name = kind === 'airplay' ? (ANDROID ? 'Output switcher' : 'AirPlay') : kind === 'tv' ? 'Sangeet TV' : 'output device';
  return (
    <Pressable
      hitSlop={8}
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={onTv ? `Playing on ${tvName}. Choose output` : `Choose ${name}`}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={outputIcon(kind, route)} size={size * 0.85} tintColor={route === 'phone' ? tint : (activeTint ?? palette.accent)} />
    </Pressable>
  );
}

const AIRPLAY_DELAY_MS = 350;

function OutRow({ icon, title, sub, active, onPress, accessory }: { icon: SFSymbol; title: string; sub?: string; active?: boolean; onPress?: () => void; accessory?: React.ReactNode }) {
  const { theme } = useUnistyles();
  const color = active ? theme.colors.accent : theme.colors.text;
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} accessibilityState={{ selected: !!active }}>
      <View style={styles.rowIcon}>{accessory ?? <Icon name={icon} size={22} tintColor={active ? theme.colors.accent : theme.colors.textSecondary} />}</View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={[styles.rowSub, active && { color: theme.colors.accent }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

/** "Listening on" + "Connect to a device": where the sound goes now and every place it can go. */
function PlayOnSheet({ close }: { close: () => void }) {
  const status = useRemote((s) => s.status);
  const tvName = useRemote((s) => s.tvName);
  const found = useRemote((s) => s.found);
  const air = useAirPlay();
  const onTv = remoteNativeAvailable && status !== 'off';
  const current = onTv ? { icon: 'tv.fill' as const, title: tvName ?? 'Sangeet TV', sub: 'Sangeet TV' } : air.active ? { icon: 'airplayaudio' as const, title: air.route || 'AirPlay', sub: 'AirPlay' } : { icon: 'iphone' as const, title: ANDROID ? 'This phone' : 'iPhone', sub: 'This device' };
  const after = (fn: () => void) => () => {
    close();
    setTimeout(fn, AIRPLAY_DELAY_MS);
  };
  return (
    <View style={styles.wrap}>
      <Text style={styles.section}>Listening on</Text>
      <OutRow {...current} active />
      <Text style={styles.section}>Connect to a device</Text>
      {(onTv || air.active) ? <OutRow icon="iphone" title={ANDROID ? 'This phone' : 'This iPhone'} sub="This device" onPress={after(() => void (onTv ? disconnectTv() : undefined))} /> : null}
      {found.filter((t) => !(onTv && t.name === tvName)).map((t) => (
        <OutRow key={t.key} icon="tv" title={t.name} sub="Sangeet TV" onPress={after(() => connect(t))} />
      ))}
      {!found.length && !onTv ? <OutRow icon="tv" title="Looking for TVs…" accessory={<ActivityIndicator />} /> : null}
      {air.available || air.active ? (
        <OutRow
          icon="airplayaudio"
          title={ANDROID ? 'Speakers & Bluetooth' : 'AirPlay & Bluetooth'}
          sub={ANDROID ? 'Speakers, headphones, Cast devices' : 'Speakers, headphones, Apple TV'}
          onPress={() => {
            close();
            if (onTv) void disconnectTv();
            setTimeout(showAirPlayPicker, AIRPLAY_DELAY_MS);
          }}
        />
      ) : null}
      {onTv ? <OutRow icon="xmark.circle" title="Disconnect" sub={`Stop controlling ${tvName ?? 'the TV'}`} onPress={after(() => void disconnectTv())} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 10 },
  section: { color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 60, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, borderRadius: 16, backgroundColor: theme.colors.surfaceElevated },
  rowIcon: { width: 28, alignItems: 'center' },
  rowText: { flex: 1 },
  rowTitle: { ...theme.typography.bodyLarge },
  rowSub: { color: theme.colors.textSecondary, ...theme.typography.body },
}));
