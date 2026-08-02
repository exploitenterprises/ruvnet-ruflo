import { readFileSync, writeFileSync } from 'node:fs';

const FONT_DIR = '/mnt/skills/examples/canvas-design/canvas-fonts';
const b64 = (name) => readFileSync(`${FONT_DIR}/${name}`).toString('base64');

let html = readFileSync(new URL('./template.html', import.meta.url), 'utf8');

const replacements = {
  '{{FONT_ERICAONE_REG}}': b64('EricaOne-Regular.ttf'),
  '{{FONT_OUTFIT_REG}}': b64('Outfit-Regular.ttf'),
  '{{FONT_OUTFIT_BOLD}}': b64('Outfit-Bold.ttf'),
  '{{FONT_REDHATMONO_REG}}': b64('RedHatMono-Regular.ttf'),
  '{{FONT_REDHATMONO_BOLD}}': b64('RedHatMono-Bold.ttf'),
};

for (const [key, value] of Object.entries(replacements)) {
  html = html.split(key).join(value);
}

writeFileSync(new URL('./nfl-edge.html', import.meta.url), html);
console.log('built', html.length, 'bytes');
