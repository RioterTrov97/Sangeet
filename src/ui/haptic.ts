import * as Haptics from 'expo-haptics';

/** Light impact on play / pause / skip and when a long-press menu opens. Never throws (simulator, unsupported). */
export const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
