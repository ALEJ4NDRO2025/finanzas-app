// Arma la versión de un solo archivo que se publica en Claude: node claude-artifact/build.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const out = process.argv[2] || path.join(__dirname, 'mis-finanzas.html');

fs.writeFileSync(out, `<title>Mis Finanzas</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..700&display=swap">
<style>
${read('public/styles.css')}
</style>
<div id="app"><div class="app" aria-busy="true" aria-label="Cargando"><nav class="rail"><span class="sk sk-line sk-brand"></span></nav><div class="main"><header class="top"><div class="sk-stack"><span class="sk sk-line w-6"></span><span class="sk sk-line sk-title"></span></div><span class="sk sk-pill"></span></header><main class="view view-resumen"><div class="ticker sk-ticker"><span class="sk sk-line w-6"></span><span class="sk sk-line"></span></div><div class="a-hero"><section class="hero"><span class="sk sk-line w-9"></span><span class="sk sk-big"></span><span class="sk sk-line w-14"></span><span class="sk sk-meter"></span></section></div><section class="panel a-pockets"><span class="sk sk-line sk-title"></span><span class="sk sk-fig"></span><span class="sk sk-meter"></span></section></main></div></div></div>
<script>
${read('public/vendor/gsap-3.13.0.min.js')}
</script>
<script>
${read('public/ui.js')}
</script>
<script>
${read('claude-artifact/store-claude.js')}
</script>
`);
console.log('Generado', out);
