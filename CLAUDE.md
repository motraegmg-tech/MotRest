# CLAUDE.md — MotRest · Software Restaurantero ERP (MOTRAE)

**Lee primero [`README.md`](README.md): es el contexto maestro completo** (empresa MOTRAE + producto MotRest + aplicación a Rodizio + las 10 ideas estratégicas). Este archivo es solo la guía operativa corta para trabajar en la carpeta.

## Lo esencial para no equivocarse
- Proyecto de **MOTRAE**. CEO: **Gonzalo** — empieza tus respuestas llamándolo por su nombre.
- **MotRest** es un **ERP restaurantero**, no “solo un POS”: administra todo el negocio (POS + KDS + inventario + **finanzas, RR. HH., compras e inteligencia**), con **panel por roles**.
- Es la **vertical gastronómica** de la Plataforma SaaS AI-first de MOTRAE (4 capas + DELTA OPS). No se construye desde cero: se aplica una plataforma que MOTRAE ya domina.
- **Cliente ancla: Rodizio** (pizzas y pasta). Su realidad manda: **recetas mitad-y-mitad** (costeo a nivel ingrediente), **merma sensible** (masa, quesos, salsas) y **picos de demanda** (viernes/fin de semana).
- **9 módulos** (M1 POS … M9 Roles) y **5 capacidades AI-first** propias: gemelo digital, menu engineering, compras/turnos autónomos, voz del cliente, centinela de mermas.
- **Modelo comercial:** suscripción por local **+ cobro por resultado** (ahorro verificado). Nunca “cobrar por licencia” a secas — ese es el principio MOTRAE.
- MOTRAE es el **proveedor**, no el cliente. Alineado con **ODS 9 y 12**.

## Marca (aplicar en todo artefacto visual)
- **Verde MOTRAE `#57AD30`** = acento dominante. Degradado de energía naranja `#F2853A` → rojo `#E0392B`, con moderación.
- Tipografía: **Space Grotesk** (títulos) + **Inter** (cuerpo). Tono: moderno, profesional, con movimiento; español.

## Estado actual
- Carpeta **nueva**: aún **sin código**. El producto está en definición; el README es la fuente de verdad.
- Las **10 ideas estratégicas** (cobro, entregable, producto, captación) viven como **backlog** en el README §10.

## Convenciones
- Español, tono profesional. Antes de cambios grandes, **propón un plan**.
- Ramas: `feature/…`, `fix/…`, `docs/…`. Nunca commitear directo a `main`.
- Secretos y llaves: **nunca** al repo (usar variables de entorno).
- Entregables finales van en `entregables/` y luego a Drive.

## Documentos de referencia
- Contexto maestro del producto: [`README.md`](README.md)
- Documento de proyecto original: `Clientes\04_Cliente_Rodizio\MOTRAE_Proyecto_Software_Restaurantero_ERP.md`
- Contexto de empresa MOTRAE: `Identidad y Presentativos\01_Identidad\Documentos_de_Primer_Orden\MOTRAE_Documento_Empresa.md`
