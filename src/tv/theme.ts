/** 10-foot UI tokens. Sizes are design px in a 1440x810 space; TVApp scales the whole tree to the window (see scale.ts), so every density looks the same. */
export const tv = {
  bg: '#0e0e10',
  surface: '#1b1b1f',
  surfaceHigh: '#2a2a30',
  text: '#ffffff',
  textDim: '#b8b8c0',
  accent: '#1ed760',
  focus: '#ffffff',
  /** Content inset reserved for the rail (screens add `gutter` on top of it). */
  rail: 96,
  /** The collapsed rail's own column: everything left of where content starts (rail + gutter), its 56px buttons centred in it. */
  railCol: 144,
  railOpen: 320,
  gutter: 48,
  card: 200,
  font: { regular: 'Figtree_400Regular', medium: 'Figtree_500Medium', bold: 'Figtree_700Bold', extraBold: 'Figtree_800ExtraBold' },
} as const;
