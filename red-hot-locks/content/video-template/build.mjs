import { readFileSync, writeFileSync } from 'node:fs';

// Usage: node build.mjs [inputFile] [outputFile]
// Defaults to the base template.html -> video-template.html for local preview.
// For a dated daily video: node build.mjs daily/2026-08-02.html daily/2026-08-02-built.html
const FONT_DIR = '/mnt/skills/examples/canvas-design/canvas-fonts';
const b64 = (name) => readFileSync(`${FONT_DIR}/${name}`).toString('base64');

const [, , inArg, outArg] = process.argv;
const inputPath = inArg ? new URL(inArg, import.meta.url) : new URL('./template.html', import.meta.url);
const outputPath = outArg ? new URL(outArg, import.meta.url) : new URL('./video-template.html', import.meta.url);

let html = readFileSync(inputPath, 'utf8');

const replacements = {
  '{{FONT_ERICAONE_REG}}': b64('EricaOne-Regular.ttf'),
  '{{FONT_OUTFIT_REG}}': b64('Outfit-Regular.ttf'),
  '{{FONT_OUTFIT_BOLD}}': b64('Outfit-Bold.ttf'),
  '{{FONT_REDHATMONO_BOLD}}': b64('RedHatMono-Bold.ttf'),
};

for (const [key, value] of Object.entries(replacements)) {
  html = html.split(key).join(value);
}

writeFileSync(outputPath, html);
console.log('built', outputPath.pathname, html.length, 'bytes');
