export const colors = {
  background: '#121212',
  surface: '#181818',
  surfaceHigh: '#1F1F1F',
  surfaceElevated: '#282828',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#8f8f8f',
  accent: '#1ED760',
  error: '#F15E6C',
  border: '#2A2A2A',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** sm = cards, md = sheets, full = pills and artists. */
export const radii = { sm: 4, md: 8, lg: 16, full: 999 } as const;

export const fonts = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  bold: 'Figtree_700Bold',
  extraBold: 'Figtree_800ExtraBold',
} as const;

/** Type scale: display 28/800, title 22/700, heading 16/700, body 14/500, caption 12/500. */
export const typography = {
  display: { fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  bodyLarge: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  headline: { fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 34 },
} as const;

/** Vertical layout constants shared by Screen/SheetScreen: header bar height and the gap under a card sheet's top edge. */
export const layout = { headerBar: 60, sheetTop: 12, heroGap: 8 } as const;

export const darkTheme = { colors, spacing, radii, typography, layout } as const;

export const appThemes = { dark: darkTheme };

export type AppThemes = typeof appThemes;
