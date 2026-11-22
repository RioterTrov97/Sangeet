import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression for the Settings crash: `useScrollY()` returns a Reanimated worklet handler *object*. Handing it to a plain
 * `ScrollView`/`FlatList` makes `ScrollView._handleScroll` call an object ("Object is not a function"), a fatal JS error
 * in Release. Screens that use it must render an Animated.* / AnimatedFlashList component.
 */
describe('useScrollY consumers', () => {
  const dir = join(__dirname);
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
  it('never pass the animated scroll handler to a plain ScrollView / FlatList', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (!src.includes('useScrollY')) continue;
      for (const m of src.matchAll(/<(ScrollView|FlatList|SectionList)\b[^>]*onScroll=\{onScroll\}/g)) bad.push(`${f}: <${m[1]} onScroll={onScroll}>`);
    }
    expect(bad).toEqual([]);
  });
});
