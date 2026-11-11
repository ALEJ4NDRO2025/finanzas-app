# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Una persona en Colombia que lleva sus finanzas personales en pesos (COP), sobre todo desde el celular. Registra gastos e ingresos del día y revisa cómo va el mes.

## Product Purpose
Mis Finanzas registra ingresos y gastos, los reparte en bolsillos (sostenimiento y ahorro), controla presupuestos mensuales y semanales y sigue metas de ahorro. El éxito es saber en segundos cuánto queda disponible y si algún presupuesto se está pasando.

## Positioning
Los gastos enlazados a metas suman a la meta y no cuentan como gasto. Los presupuestos semanales se calculan por la fecha del gasto, sin escribir "semana N" en el nombre. El salario va a sostenimiento y los demás ingresos a ahorro.

## Capabilities and Constraints
- Servidor Express con cookies httpOnly, CSRF y una CSP estricta (`script-src 'self'`). Nada de estilos ni scripts inline en el HTML.
- Una versión de un solo archivo se publica también como artifact de Claude.
- Moneda sin decimales, en formato es-CO.

## Brand Commitments
- Fondo del acceso: un loop de gráfico de velas de bolsa (pedido por el usuario).
- Cada pantalla debe tener un skeleton de carga a la medida de su diseño (preferencia permanente del usuario).
- El usuario rechazó un diseño editorial y un fondo abstracto tipo "aurora".

## Product Principles
- Lo primero que se ve es cuánto queda disponible.
- Registrar un movimiento debe tomar segundos desde cualquier pantalla.
- Los números son el contenido: tabulares, alineados y legibles.

## Accessibility & Inclusion
Contraste AA, uso con teclado, áreas de toque de 44 px y respeto a "reducir movimiento".
