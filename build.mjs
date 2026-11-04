// Bundles the app into a single self-contained HTML file: dist/woo-dj-trainer.html
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const order = ['src/deck.js', 'src/bpm.js', 'src/demo-tracks.js', 'src/midi.js', 'src/lessons.js', 'src/main.js'];
// each module gets its own scope; its exports are returned and destructured for later modules
const js = order.map((f) => {
  const src = readFileSync(f, 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = src
    .replace(/^import\s[^;]+;\s*$/gm, '')
    .replace(/^export\s+(?=(async\s+)?(function|class|const|let)\b)/gm, '');
  return `// ---- ${f}\n${names.length ? `const { ${names.join(', ')} } = ` : ''}(() => {\n${body}\n${names.length ? `return { ${names.join(', ')} };\n` : ''}})();`;
}).join('\n\n');
const css = readFileSync('styles.css', 'utf8');
const html = readFileSync('index.html', 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>\n(() => {\n${js}\n})();\n</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/woo-dj-trainer.html', html);
console.log(`dist/woo-dj-trainer.html (${(html.length / 1024).toFixed(0)} KB)`);
