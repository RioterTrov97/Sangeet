import { Icon } from './Icon';
import { useUnistyles } from 'react-native-unistyles';

import { useIsAutoCached } from '../downloads/autoCache';
import { useDownloadRow } from '../downloads/manager';

/**
 * Tiny arrow-down-in-circle placed immediately before a song's artist line when the song is available offline:
 * accent green when you downloaded it, grey when the smart cache saved it automatically. Adds no row height.
 */
export function DlMark({ id }: { id?: string }) {
  const { theme } = useUnistyles();
  const dl = useDownloadRow(id);
  const auto = useIsAutoCached(id);
  if (dl?.state === 'done') return <Icon name="arrow.down.circle.fill" size={12} tintColor={theme.colors.accent} accessibilityLabel="Downloaded" />;
  if (!dl && auto) return <Icon name="arrow.down.circle.fill" size={12} tintColor={theme.colors.textTertiary} accessibilityLabel="Saved for offline" />;
  return null;
}
