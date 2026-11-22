// Rasterises assets/brand/*.svg into the PNGs referenced by app.config.ts (run: node scripts/build-icons.mjs).
//   assets/images/icon.png            default app icon (white glyph on black)
//   assets/images/splash-icon.png     white glyph, transparent (splash on black)
//   assets/images/splash-icon-light.png  black glyph, transparent (SANGEET_SPLASH=light)
//   assets/images/android-icon-*.png  Android adaptive icon layers; assets/tv/banner.{svg,png}  Android TV banner
//   assets/icons/<Name>.png           alternate app icons (1024) and preview-<Name>.png (192) for Settings
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const glyph = readFileSync('assets/brand/glyph.svg', 'utf8');
const classic = readFileSync('assets/brand/icon-classic.svg', 'utf8');
const png = (s, size) => new Resvg(s, { fitTo: { mode: 'width', value: size } }).render().asPng();

/** Glyph in `fg`, optionally on a solid `bg`, as a complete SVG. */
function variant(fg, bg) {
  const body = glyph.replace(/currentColor/g, fg).replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}`);
  return body;
}

mkdirSync('assets/icons', { recursive: true });
const icons = {
  WhiteOnBlack: variant('#ffffff', '#000000'),
  BlackOnWhite: variant('#000000', '#ffffff'),
  GreenOnBlack: variant('#1ed760', '#000000'),
  Classic: classic,
};
for (const [name, svg] of Object.entries(icons)) {
  writeFileSync(`assets/icons/${name}.png`, png(svg, 1024));
  writeFileSync(`assets/icons/preview-${name}.png`, png(svg, 192));
}
writeFileSync('assets/images/icon.png', png(icons.WhiteOnBlack, 1024));
writeFileSync('assets/images/favicon.png', png(icons.WhiteOnBlack, 48));
writeFileSync('assets/images/splash-icon.png', png(variant('#ffffff'), 512));
writeFileSync('assets/images/splash-icon-light.png', png(variant('#000000'), 512));
console.log('icons written');

// Android adaptive icon (app list / Settings on TV): 1024 layers, 108dp canvas, glyph kept inside the 66% safe zone.
const crop = (fg) => variant(fg).replace('viewBox="0 0 1024 1024"', 'viewBox="190 140 740 740"');
const layer = (inner, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}${inner}</svg>`;
const place = (fg, size) => crop(fg).replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="190 140 740 740" x="${(1024 - size) / 2}" y="${(1024 - size) / 2}" width="${size}" height="${size}">`);
writeFileSync('assets/images/android-icon-foreground.png', png(layer(place('#ffffff', 540)), 1024));
writeFileSync('assets/images/android-icon-background.png', png(layer('', '#000000'), 1024));
writeFileSync('assets/images/android-icon-monochrome.png', png(layer(place('#000000', 540)), 1024));

// Android TV launcher banner (320x180 dp, xhdpi = 640x360 px, shown on the Google TV home row): glyph left, wordmark right, on black.
mkdirSync('assets/tv', { recursive: true });
const bannerGlyph = crop('#ffffff').replace(/<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="190 140 740 740" x="64" y="60" width="240" height="240">');
const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#000"/>${bannerGlyph}<text x="330" y="200" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="64" fill="#fff">Sangeet</text></svg>`;
writeFileSync('assets/tv/banner.svg', bannerSvg);
writeFileSync('assets/tv/banner.png', new Resvg(bannerSvg, { font: { loadSystemFonts: true } }).render().asPng());
console.log('tv banner + android adaptive icon written');
