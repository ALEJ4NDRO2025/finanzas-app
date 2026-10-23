// Arma la versión de un solo archivo que se publica en Claude: node claude-artifact/build.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const out = process.argv[2] || path.join(__dirname, 'mis-finanzas.html');

fs.writeFileSync(out, `<title>Mis Finanzas</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800;900&display=swap">
<style>
${read('public/styles.css')}
</style>
<div id="app"><div class="wrap boot" aria-busy="true" aria-label="Cargando"><div class="boot-top"><div class="sk-stack"><span class="sk sk-line w-6"></span><span class="sk sk-line sk-title"></span></div><span class="sk sk-pill"></span></div><section class="balance-card sk-card"><div class="card-top"><span class="sk sk-line w-9"></span></div><div class="sk-stack"><span class="sk sk-big"></span><span class="sk sk-line w-14"></span></div><div class="flows"><span class="sk sk-flow"></span><span class="sk sk-flow"></span></div></section><section class="panel"><span class="sk sk-line sk-title"></span><span class="sk sk-input"></span><span class="sk sk-input"></span></section></div></div>
<script>
${read('public/ui.js')}
</script>
<script>
${read('claude-artifact/store-claude.js')}
</script>
`);
console.log('Generado', out);
