// Generates web/tokens.css from design/tokens.json (the Daybook design-system artifact's tokens file).
// Run: npm run tokens   — never edit web/tokens.css by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = JSON.parse(fs.readFileSync(path.join(root, 'design/tokens.json'), 'utf8'));
const themes = t.color.themes.map((x) => x.id);
const first = themes[0];
const val = (tok, theme) => (typeof tok.value === 'string' ? tok.value : tok.value[theme] ?? tok.value[first]);
const alias = (v) => (typeof v === 'string' && /^\{.+\}$/.test(v) ? `var(--${v.slice(1, -1)})` : v);
let css = `/* ${t.name} — generated from design/tokens.json by scripts/tokens-to-css.mjs. Do not edit. */\n`;
for (const theme of themes) {
  const sel = theme === first ? `:root, [data-theme="${theme}"]` : `[data-theme="${theme}"]`;
  css += `${sel} {\n`;
  for (const tok of t.color.tokens) css += `  --${tok.name}: ${alias(val(tok, theme))};\n`;
  for (const tok of t.shadow?.tokens ?? []) css += `  --${tok.name}: ${val(tok, theme)};\n`;
  css += `  color-scheme: ${theme};\n}\n`;
}
css += ':root {\n';
for (const fam of ['spacing', 'radius']) for (const tok of t[fam]?.tokens ?? []) css += `  --${tok.name}: ${tok.value};\n`;
for (const [k, v] of Object.entries(t.type.families)) css += `  --font-${k}: ${v};\n`;
// Each type style as a `font` shorthand (+ tracking) so app CSS can say `font: var(--type-body)`.
for (const g of t.type.groups) for (const s of g.styles) {
  css += `  --type-${s.name}: ${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-${s.family ?? g.family});\n`;
  css += `  --track-${s.name}: ${s.letterSpacing ?? 'normal'};\n`;
}
css += '}\n';
for (const g of t.type.groups) for (const s of g.styles) {
  const fam = t.type.families[s.family ?? g.family];
  css += `.${s.name} { font-family: ${fam}; font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''}${g.family === 'mono' ? ' font-variant-numeric: tabular-nums;' : ''} }\n`;
}
fs.writeFileSync(path.join(root, 'web/tokens.css'), css);
console.log(`web/tokens.css written: ${t.color.tokens.length} colors × ${themes.length} themes`);
