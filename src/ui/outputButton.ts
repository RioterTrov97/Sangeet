import type { SFSymbol } from 'expo-symbols';

/** Where the sound goes right now. */
export type OutputRoute = 'phone' | 'tv' | 'airplay';
export type OutputKind = 'none' | 'airplay' | 'tv' | 'unified';

/**
 * Which single output button to show: AirPlay only, Sangeet TV only, or one unified button when both exist.
 * A TV that is already connected counts as found.
 */
export function outputKind({ airplayAvailable, tvsFound, route }: { airplayAvailable: boolean; tvsFound: number; route: OutputRoute }): OutputKind {
  const air = airplayAvailable || route === 'airplay';
  const tv = tvsFound > 0 || route === 'tv';
  if (air && tv) return 'unified';
  if (air) return 'airplay';
  if (tv) return 'tv';
  return 'none';
}

/** The glyph for where sound goes now: TV when on a Sangeet TV, AirPlay when routed to AirPlay, the kind's own glyph otherwise. */
export function outputIcon(kind: OutputKind, route: OutputRoute): SFSymbol {
  if (route === 'tv') return 'tv.fill';
  if (route === 'airplay') return 'airplayaudio';
  return kind === 'tv' ? 'tv' : kind === 'airplay' ? 'airplayaudio' : 'hifispeaker.2';
}
