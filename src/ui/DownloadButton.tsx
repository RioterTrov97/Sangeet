import { SymbolView } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

import { withAlpha } from './emptyTones';

/** Circular progress ring (0..1) drawn with SVG. */
export function ProgressRing({ fraction, size = 22, color, track }: { fraction: number; size?: number; color: string; track?: string }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track ?? 'rgba(255,255,255,0.2)'} strokeWidth={2.5} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={2.5} fill="none" strokeDasharray={`${c * Math.max(0.04, fraction)} ${c}`} strokeLinecap="round" rotation={-90} origin={`${size / 2}, ${size / 2}`} />
    </Svg>
  );
}

const pillStyle = { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' } as const;
const pillText = { color: '#fff', fontFamily: 'Figtree_700Bold', fontSize: 14, lineHeight: 18 } as const;

export type DlStatus = { fraction: number; active: boolean; done: number; failed: number; total: number };

/** Header download button for a collection: arrow -> progress ring -> filled check; tap removes when complete. */
export function CollectionDownloadButton({ status, onDownload, onRemove, onRetry, label, pill, tint: pillTint }: { status: DlStatus; onDownload: () => void; onRemove: () => void; onRetry: () => void; label: string; /** Render as a labelled pill ("Offline") instead of a bare icon. */ pill?: string; /** Accent for the pill (the screen's palette); defaults to the app accent. */ tint?: string }) {
  const { theme } = useUnistyles();
  const complete = status.total > 0 && status.done === status.total;
  const tint = theme.colors.accent;
  let body;
  let a11y = `Download ${label}`;
  let press = onDownload;
  if (status.active) {
    body = <ProgressRing fraction={status.fraction} color={tint} size={26} />;
    a11y = `Downloading ${label}, ${Math.round(status.fraction * 100)} percent`;
    press = () => {};
  } else if (complete) {
    body = <SymbolView name="arrow.down.circle.fill" size={26} tintColor={tint} />;
    a11y = `Downloaded. Remove download of ${label}`;
    press = onRemove;
  } else if (status.failed) {
    body = <SymbolView name="exclamationmark.arrow.circlepath" size={24} tintColor={theme.colors.error} />;
    a11y = `Download failed. Retry ${label}`;
    press = onRetry;
  } else {
    body = <SymbolView name="arrow.down.circle" size={26} tintColor={theme.colors.text} />;
  }
  if (pill) {
    // Same glyph size and weight as the other pills (Sort, Share); the download pill stands out by colour only.
    const tone = status.failed && !status.active && !complete ? theme.colors.error : (pillTint ?? tint);
    const icon = status.active ? (
      <ProgressRing fraction={status.fraction} color={tone} size={16} track={withAlpha(tone, 0.3)} />
    ) : (
      <SymbolView name={complete ? 'checkmark' : status.failed ? 'arrow.clockwise' : 'arrow.down'} size={14} weight="semibold" tintColor={tone} />
    );
    const text = status.active ? `${Math.round(status.fraction * 100)}%` : complete ? 'Downloaded' : status.failed ? 'Retry' : pill;
    return (
      <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={a11y} testID="download-collection" style={[pillStyle, { backgroundColor: withAlpha(tone, 0.18) }]}>
        {icon}
        <Text style={[pillText, { color: tone }]}>{text}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable hitSlop={12} onPress={press} accessibilityRole="button" accessibilityLabel={a11y} testID="download-collection">
      <View>{body}</View>
    </Pressable>
  );
}
