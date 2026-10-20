// Turns dist-demo/ into a page the claude.ai Artifact host can serve:
// the page body only (the host adds <html>/<head>), the app's JS and CSS as
// files beside it, and KaTeX's fonts inlined as woff2 data URIs so maths
// renders without any other file loads.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../dist-demo/', import.meta.url).pathname;
const assets = readdirSync(join(dir, 'assets'));
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));

let styles = readFileSync(join(dir, 'assets', css), 'utf8');
styles = styles.replace(/src:url\(([^)]+?\.woff2)\) format\("woff2"\)(?:,url\([^)]+?\) format\("woff"\))?(?:,url\([^)]+?\) format\("truetype"\))?/g, (_, file) => {
  const data = readFileSync(join(dir, 'assets', file.replace(/^\.?\/?(assets\/)?/, ''))).toString('base64');
  return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
});
writeFileSync(join(dir, 'assets', 'app.css'), styles);
writeFileSync(join(dir, 'assets', 'app.js'), readFileSync(join(dir, 'assets', js)));

writeFileSync(
  join(dir, 'artifact.html'),
  `<title>MathCloud</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/app.css">
<div id="root"></div>
<script type="module" src="assets/app.js"></script>
`,
);
console.log(`artifact.html + assets/app.js (${(readFileSync(join(dir, 'assets/app.js')).length / 1024).toFixed(0)} KB) + assets/app.css (${(styles.length / 1024).toFixed(0)} KB)`);
