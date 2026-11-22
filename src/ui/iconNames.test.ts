import fs from 'fs';
import path from 'path';

import { MATERIAL_NAMES } from './iconNames';

const root = path.resolve(__dirname, '../..');
const sfNames = new Set([...fs.readFileSync(path.join(root, 'node_modules/sf-symbols-typescript/dist/index.d.ts'), 'utf8').matchAll(/'([a-z0-9.]+)'/g)].map((m) => m[1]));
const material = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/expo-symbols/build/android/symbols.json'), 'utf8')) as Record<string, number>;

function sources(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

/** Words that are SF Symbol names too but are used as plain strings (ids, sort keys), not icons. */
const NOT_ICONS = new Set(['pause', 'number']);

/** Every SF Symbol name a phone screen can hand to <Icon>: dotted names and `name=` / `icon` literals in files that use Icon. */
function usedNames(): Map<string, string> {
  const used = new Map<string, string>();
  const files = [...sources(path.join(root, 'app')), ...sources(path.join(root, 'src/ui')), path.join(root, 'src/remote/DeviceButton.tsx'), path.join(root, 'src/remote/RemoteBanner.tsx')];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    if (!/<Icon\b|SFSymbol|moodIcon/.test(s) || f.endsWith('Icon.tsx')) continue;
    for (const m of s.matchAll(/(['"])([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\1/g)) if (sfNames.has(m[2])) used.set(m[2], f);
    for (const m of s.matchAll(/<Icon[^>]*?name=(?:"([a-z0-9.]+)"|\{'([a-z0-9.]+)'\})/g)) used.set((m[1] ?? m[2])!, f);
    for (const m of s.matchAll(/\? '([a-z0-9.]+)' : '([a-z0-9.]+)'/g)) for (const n of [m[1], m[2]]) if (sfNames.has(n)) used.set(n, f);
    // Single-word names in icon tables: `key: 'shuffle'`, `icon: 'mic'`
    for (const m of s.matchAll(/(?:icon|symbol|name|ICON)\w*\s*[:=]\s*'([a-z][a-z0-9]*)'/gi)) if (sfNames.has(m[1])) used.set(m[1], f);
  }
  return used;
}

describe('Android icon names', () => {
  it('maps every SF Symbol used by phone screens', () => {
    const missing = [...usedNames()].filter(([n]) => !(n in MATERIAL_NAMES) && !NOT_ICONS.has(n)).map(([n, f]) => `${n} (${path.relative(root, f)})`);
    expect(missing).toEqual([]);
  });

  it('maps only to names that exist in the bundled Material Symbols font', () => {
    const bad = Object.entries(MATERIAL_NAMES).filter(([, m]) => !(m in material));
    expect(bad).toEqual([]);
  });

  it('knows real SF Symbols only', () => {
    expect(Object.keys(MATERIAL_NAMES).filter((n) => !sfNames.has(n))).toEqual([]);
  });
});
