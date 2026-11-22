import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';

export type AppIconChoice = { id: 'WhiteOnBlack' | 'BlackOnWhite' | 'GreenOnBlack' | 'Classic'; label: string; preview: number };

export const APP_ICONS: AppIconChoice[] = [
  { id: 'WhiteOnBlack', label: 'White on Black', preview: require('../../assets/icons/preview-WhiteOnBlack.png') },
  { id: 'BlackOnWhite', label: 'Black on White', preview: require('../../assets/icons/preview-BlackOnWhite.png') },
  { id: 'GreenOnBlack', label: 'Green on Black', preview: require('../../assets/icons/preview-GreenOnBlack.png') },
  { id: 'Classic', label: 'Classic', preview: require('../../assets/icons/preview-Classic.png') },
];

export const iconsSupported = () => supportsAlternateIcons;

/** Currently active icon id (the default icon reports null). */
export function currentIcon(): AppIconChoice['id'] {
  const n = getAppIconName();
  return (APP_ICONS.find((i) => i.id === n)?.id ?? 'WhiteOnBlack') as AppIconChoice['id'];
}

/** iOS shows its own "You have changed the icon" alert; that is expected. */
export async function chooseIcon(id: AppIconChoice['id']): Promise<void> {
  await setAlternateAppIcon(id === 'WhiteOnBlack' ? null : id);
}
