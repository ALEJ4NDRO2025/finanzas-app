// Arma la versión de un solo archivo que se publica en Claude: node claude-artifact/build.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const out = process.argv[2] || path.join(__dirname, 'mis-finanzas.html');

fs.writeFileSync(out, `<title>Mis Finanzas</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
${read('public/styles.css')}
</style>
<div id="app"><div class="wrap"><main class="auth panel"><h1>Mis Finanzas</h1><p class="muted">Cargando tus cuentas…</p></main></div></div>
<script>
${read('public/ui.js')}
</script>
<script>
${read('claude-artifact/store-claude.js')}
</script>
`);
console.log('Generado', out);
