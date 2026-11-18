---
name: Mis Finanzas
description: Finanzas personales en COP con la lectura rápida de una mesa de bolsa, en el bolsillo.
colors:
  tinta: "#0d1017"
  superficie: "#141922"
  superficie-2: "#1b212d"
  superficie-3: "#232a38"
  linea: "#262e3d"
  linea-2: "#323b4e"
  texto: "#edf0f6"
  texto-tenue: "#96a0b5"
  placeholder: "#7d879b"
  sube: "#34d39b"
  baja: "#ff6f61"
  alerta: "#f4a640"
  senal: "#f4c84a"
  senal-hover: "#ffd968"
  senal-tinta: "#191407"
  violeta: "#8c8fff"
typography:
  display:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "clamp(2.7rem, 12vw, 4.9rem)"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.05em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 450
    lineHeight: 1.5
  number:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontWeight: 600
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  label:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "20px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.senal}"
    textColor: "{colors.senal-tinta}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.senal-hover}"
  button-secondary:
    backgroundColor: "{colors.superficie-3}"
    textColor: "{colors.texto}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.linea-2}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.texto-tenue}"
    rounded: "{rounded.md}"
    height: "44px"
  input:
    backgroundColor: "{colors.superficie-2}"
    textColor: "{colors.texto}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "48px"
  panel:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.lg}"
    padding: "20px"
  chip:
    backgroundColor: "{colors.superficie-3}"
    textColor: "{colors.texto}"
    rounded: "6px"
    padding: "3px 9px"
---

# Design System: Mis Finanzas

## Overview

**Creative North Star: "La mesa de bolsa de bolsillo"**

Mis Finanzas se lee como una terminal financiera reducida al tamaño de una mano: tinta azul-negra, cifras en monoespaciada tabular y color solo cuando un número sube, baja o pide atención. La cifra que manda es siempre lo disponible del mes, en grande y sin adornos. Todo lo demás (bolsillos, presupuestos, metas, movimientos) se apila en paneles planos de tono ligeramente más claro que el fondo.

Es una interfaz de operación (modo Operate): densa pero respirable, pensada primero para el celular con barra inferior y botón + central, y que en pantallas anchas pasa a barra lateral y rejilla de 12 columnas. La personalidad vive en los detalles de mercado: la cinta de presupuestos que corre como un ticker, el logo de velas, el fondo de velas en el acceso.

Rechazos confirmados por el usuario: un diseño editorial y un fondo abstracto tipo "aurora".

**Key Characteristics:**
- Solo modo oscuro, sobre tinta azul-negra.
- Los números son el contenido: Geist Mono tabular en todas las cifras.
- Verde y coral significan "sube" y "baja", nunca decoración.
- Ámbar de señal para la acción principal y las metas.
- Profundidad por capas de tono, no por sombras.
- Cada pantalla tiene un skeleton de carga con su misma forma.

## Colors

Una escala de grises azulados casi negros con cuatro colores de significado y un ámbar de acción.

### Primary
- **Ámbar de señal** (senal): la acción principal (botón +, guardar), las metas de ahorro, el anillo de foco y la selección de texto. Su texto encima es la **tinta ámbar** (senal-tinta). En hover se aclara a senal-hover.

### Secondary
- **Verde de alza** (sube): ingresos, presupuestos sanos, lo libre en la barra de flujo y la vela que sube.
- **Coral de baja** (baja): gastos, presupuestos pasados, el disponible negativo, errores y acciones destructivas.
- **Naranja de alerta** (alerta): presupuestos cerca del límite.

### Tertiary
- **Violeta** (violeta): reservado; declarado en tokens pero sin uso actual. Usarlo solo para una categoría nueva de significado, nunca como acento decorativo.

### Neutral
- **Tinta** (tinta): fondo de la app y del acceso.
- **Superficie 1–3** (superficie, superficie-2, superficie-3): paneles, tarjetas internas y controles, cada uno un paso más claro.
- **Línea 1–2** (linea, linea-2): bordes de paneles y bordes en hover.
- **Texto** (texto) y **texto tenue** (texto-tenue): contenido principal y etiquetas. El placeholder usa su propio gris (placeholder) con contraste AA sobre superficie-2.

Las categorías de gasto usan una paleta propia definida en `ui.js` (`PALETTE`); los ingresos siempre usan el verde de alza.

### Named Rules
**The Market Color Rule.** Verde, coral y naranja solo marcan dirección o estado de un número. Si un elemento no sube, baja ni se acerca a un límite, no lleva esos colores.

**The One Signal Rule.** El ámbar es la única llamada a la acción de la pantalla. Nunca dos botones ámbar compitiendo en la misma vista.

## Typography

**Display Font:** Geist Mono (con ui-monospace, SF Mono, Menlo)
**Body Font:** Geist (con ui-sans-serif, system-ui)
**Label/Mono Font:** Geist Mono

**Character:** Geist da una voz sobria y técnica a los textos; Geist Mono convierte cada cifra en dato de terminal, con columnas que siempre alinean.

### Hierarchy
- **Display** (600, clamp(2.7rem, 12vw, 4.9rem), 0.95): el disponible del mes en el hero. El símbolo de moneda va al 42 % del tamaño y en texto tenue.
- **Headline** (650, 1.6rem → 1.9rem desde 900 px, 1.15): saludo y título de cada vista; los encabezados de página usan 1.35rem.
- **Title** (600, 1rem): títulos de paneles, tarjetas y bolsillos.
- **Body** (450, 15px, 1.5): texto general; las notas secundarias bajan a 0.86–0.9rem en texto tenue.
- **Label** (600, 0.72rem, 0.06em, mayúsculas): etiqueta de la cinta, cabeceras de día y la moneda "COP".

### Named Rules
**The Tabular Rule.** Toda cifra de dinero, porcentaje o fecha numérica va en Geist Mono con `tabular-nums`. Nunca en Geist.

## Layout

Celular primero, con margen lateral de 16 px y espacio inferior para la barra de navegación (112 px más el área segura). La barra inferior tiene cinco espacios: Resumen, Movimientos, el botón + central, Presupuestos y Metas.

- **640 px:** más aire en el contenido (padding superior 28 px, separación 24 px).
- **900 px:** barra lateral fija de 248 px y rejilla de 12 columnas con contenido máximo de 1240 px. Resumen reparte 7/5 (hero y gráfica a la izquierda, bolsillos y categorías a la derecha); Movimientos reparte 8/4 con el resumen lateral fijo al hacer scroll. La hoja de registro pasa de subir desde abajo a abrir como panel lateral de 460 px.
- **≤480 px y ≤370 px:** los detalles se apilan en una columna y los avatares bajan a 36 px.

El ritmo usa separaciones de 6, 10, 16, 20 y 28 px; los paneles internos usan 16–20 px de padding.

## Elevation & Depth

El sistema es plano por defecto: la profundidad viene de capas de tono (tinta → superficie → superficie-2 → superficie-3) y bordes de 1 px. Las sombras solo aparecen en elementos que flotan sobre todo lo demás.

### Shadow Vocabulary
- **Botón flotante** (`box-shadow: 0 6px 16px rgb(0 0 0 / .45)`): el botón + en celular.
- **Hoja** (`box-shadow: 0 -12px 40px rgb(0 0 0 / .45)`; lateral `-20px 0 60px`): la hoja de registro.
- **Aviso** (`box-shadow: 0 10px 30px rgb(0 0 0 / .45)`): el toast.
- **Diálogo** (`box-shadow: 0 20px 60px rgb(0 0 0 / .5)`): el reporte de meta; el acceso usa `0 24px 70px rgb(0 0 0 / .45)` con desenfoque de fondo.
- **Anillo de foco** (`box-shadow: 0 0 0 3px` en ámbar, verde o coral al 20–22 %): campos enfocados, tintado según el tipo de movimiento.

### Named Rules
**The Flat-By-Default Rule.** Nada que esté en el flujo de la página lleva sombra. Si no flota sobre otra capa, se separa con tono y borde.

## Shapes

Esquinas suaves y consistentes: 10 px en controles pequeños, 14 px en botones y campos, 20 px en paneles y 24 px en las tarjetas flotantes (acceso, reporte). Las píldoras (999 px) quedan para el selector de mes y el indicador de pestaña activa en celular. Las barras de progreso son delgadas (4–6 px) con esquinas de 3 px, y los avatares de movimiento son cuadrados redondeados de 12 px.

## Components

### Buttons
- **Shape:** esquinas suaves (14 px); 10 px en la variante pequeña.
- **Primary:** ámbar de señal con tinta ámbar, 44 px de alto mínimo, padding horizontal de 18 px.
- **Hover / Focus:** cambio de fondo en 0.2 s con la curva de la app; al presionar se encoge a 0.97; foco con contorno ámbar de 2 px y 2 px de separación.
- **Secondary / Ghost / Danger:** secundario en superficie-3; fantasma transparente en texto tenue; peligro en coral sobre coral al 14 %.

### Chips
- **Style:** etiqueta de 0.74rem en superficie-3 con esquina de 6 px.
- **State:** naranja de alerta, coral de pasado o ámbar de meta cumplida, siempre sobre su color al 15 %.

### Cards / Containers
- **Corner Style:** 20 px en paneles, presupuestos y metas; 14 px en bolsillos internos.
- **Background:** superficie; las tarjetas dentro de un panel bajan a superficie-2.
- **Shadow Strategy:** ninguna (ver Flat-By-Default).
- **Border:** 1 px en línea.
- **Internal Padding:** 16–20 px.

### Inputs / Fields
- **Style:** superficie-2, borde de 1 px en línea, 14 px de radio, 48 px de alto.
- **Focus:** borde ámbar, fondo superficie-3 y anillo ámbar al 22 %. El campo de monto grande (64 px, 1.9rem en mono) se tiñe de verde o coral según sea ingreso o gasto.
- **Error:** mensaje en coral de 0.9rem debajo del formulario.

### Navigation
- **Celular:** barra inferior translúcida con desenfoque; la pestaña activa pinta su ícono en ámbar dentro de una píldora superficie-3.
- **Escritorio:** barra lateral con marca arriba; la pestaña activa lleva fondo superficie y una barra ámbar de 3 px en el borde izquierdo.

### Cinta (signature)
Un ticker en mono que recorre los presupuestos con su porcentaje y un triángulo de dirección (verde sano, naranja cerca, coral pasado). Se detiene en una lista estática con scroll cuando el usuario pide reducir el movimiento.

### Skeletons (signature)
Cada vista tiene un esqueleto con su misma estructura (hero, bolsillos, filas de movimientos, cinta) en superficie-2 con un brillo de 1.4 s; con reducir movimiento queda fijo.

## Do's and Don'ts

### Do:
- **Do** poner el disponible del mes como la cifra más grande de la pantalla de Resumen.
- **Do** usar Geist Mono tabular para todo número.
- **Do** dar a cada pantalla nueva un skeleton con su misma forma.
- **Do** mantener áreas de toque de 44 px como mínimo.
- **Do** usar la curva `cubic-bezier(.16, 1, .3, 1)` para las transiciones de estado.
- **Do** respetar `prefers-reduced-motion`: sin cinta animada, sin brillo de skeleton, sin transiciones.

### Don't:
- **Don't** usar verde, coral o naranja como decoración.
- **Don't** poner sombras en paneles o tarjetas que están en el flujo.
- **Don't** añadir un modo claro sin rediseñar los tokens: el sistema es solo oscuro.
- **Don't** volver a un estilo editorial ni a fondos abstractos tipo "aurora" (rechazados por el usuario).
- **Don't** poner estilos ni scripts inline en el HTML: la CSP es `script-src 'self'`.
