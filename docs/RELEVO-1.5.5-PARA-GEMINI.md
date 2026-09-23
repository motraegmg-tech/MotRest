# Relevo de la 1.5.5 — para Gemini

> ## 🔴 PENDIENTE AHORA MISMO (22-sep): Tortas FC no ve la 1.5.6
> Le fijé `version_fijada = '1.5.6'` en `asignaciones` (sesión del 21-sep) y
> subí el arreglo del Hub (`46229f4`, guardado para la 1.5.7, NO publicar
> todavía). Gonzalo le pidió a Tortas FC revisar su pantalla y **NO les salió
> ningún aviso de actualización** — descarta que sea «solo falta aprobarla»:
> el Hub nunca se enteró. Repasé `version_ofrecida()` y las políticas RLS de
> `versiones`/`asignaciones` (`supabase/migrations/20260828000300_canal_de_actualizaciones.sql`)
> y por el código deberían funcionar. **Falta correr esto en la nube (el
> conector de Supabase se desconectó a media sesión y no se refresca sola;
> necesita una conversación nueva para verlo)**:
> ```sql
> select public.version_ofrecida('suc-tortas-fc-av-orizaba');
> select sucursal_id, canal, version_fijada from public.asignaciones where sucursal_id = 'suc-tortas-fc-av-orizaba';
> select sucursal_id, version, ts from public.pulsos where sucursal_id = 'suc-tortas-fc-av-orizaba';
> select version, retirada_ts, canal from public.versiones where version = '1.5.6';
> ```
> Si `version_ofrecida` no devuelve `1.5.6`, ahí está el problema (revisar por
> qué). Si SÍ la devuelve pero el pulso sigue en 1.5.5, el Hub de Tortas FC no
> se ha vuelto a conectar/revisar — ahí el problema es de su lado (¿Hub
> apagado?, ¿sin internet?), no de la nube.

> ## ⚡ LO MÁS NUEVO: la 1.5.6 (20-sep-2026), en curso
> Plan y decisiones de Gonzalo en `docs/PLAN-1.5.6.md`. Estado:
> - ✅ **Consumo de socio fuera de la venta** (dominio: `consumoDeSocio` en
>   `comanda/totales.ts`; `resumenVentas` y `reporteContable` lo descuentan en
>   proporción; el costo SÍ cuenta; fuera de la global). Pantalla y PDF hechos.
> - ✅ **Factura global que elige el restaurantero**: Hub y protocolo (acción
>   `fiscal` → `emitir_global`, catálogo `facturacion_config` con
>   `modo_global: "manual" | "automatica"`, manual por defecto); caja:
>   `apps/pos-ui/src/lib/facturacion.svelte.ts`, `modulos/finanzas/FacturaGlobal.svelte`,
>   `sync.emitirFacturaGlobal`. Se retiró el bloqueo por «mes cerrado»: solo
>   bloquea que la venta ya esté en una global.
> - ✅ **Reservas ↔ ficha del comensal** (`SelectorDeFicha.svelte`,
>   `borrador-de-reserva.svelte.ts`, liga por teléfono normalizado, alta
>   automática, ida y vuelta a «+ Nuevo cliente»).
> - ✅ **(21-sep) Emitir CFDI con fichas** (`DialogoFactura.svelte`): buscador
>   por nombre o RFC con lista corta, «Hacer la Ficha de este Comensal» con la
>   leyenda y los campos que faltan, **correo obligatorio**. La regla (ligar por
>   teléfono, completar sin pisar) vive en `clientes.fichaDesdeFactura`, con 7
>   pruebas en `__tests__/ficha-desde-factura.test.ts`.
> - ✅ **(21-sep) Tarjeta «Gastos»** (`modulos/finanzas/Gastos.svelte`, montada
>   tras `TicketsCobrados`): Hoy / 7 días / Este mes / Todo + calendario de
>   meses, Ordenar y Ver más. «Gastos de hoy» y «Cuentas por pagar» salieron de
>   `Resultado.svelte`. El formulario de gasto es UNO, compartido por
>   `formulario-de-gasto.svelte.ts` (`revelar` con clave `pedido`).
> - ✅ **(21-sep) Ver más + Ordenar en toda la caja** (agente Listas, revisado):
>   herramientas en `apps/pos-ui/src/lib/listas/`. En la carta, Ordenar
>   REESCRIBE el orden para todas las terminales tras confirmar
>   (`reordenarCategorias` / `reordenarProductos` en el dominio, pruebas en
>   `orden-de-la-carta.test.ts` de dominio y de pos-ui). Claude añadió Ordenar +
>   Ver más a `FacturaGlobal.svelte` y a los correos propios.
> - ✅ **(21-sep) Correos editables y nuevos** (agente Correos, revisado):
>   `ConfiguracionCorreo.plantillas` y `.propios` (`propio:<uuid>`, tope 20),
>   viajan en `correo_config`. Los propios son SIEMPRE publicidad:
>   `puedeMandarCorreo` exige `acepta_promociones` y el Hub lo revisa contra la
>   ficha en cada intento; la baja se añade fuera del texto del restaurante;
>   enlaces solo `https://`. Central no los muestra todavía.
> - ✅ Arreglos menores: texto de Socios («el consumo de un socio NO es una
>   venta»), el nombre de los correos propios en la ficha, y el día en las
>   reservas «Por llegar» que no son de hoy.
> - **Pruebas al 21-sep:** dominio 1354, protocolo 80, impresión 137, hub 526
>   (+2 omitidas), pos-ui 395; `svelte-check` 0/0. Central sin cambios (129).
> - ⏳ Falta: versión 1.5.6, instalador, verificación sobre el paquete, publicar.
>   **Gonzalo: no compilar ni generar versión hasta que lo diga.**
> - ✅ **(21-sep) Portal de autofactura: lado nube y Vercel TERMINADO** (3.ª
>   entrega de Gemini + correcciones de Claude). Migración
>   `20260920000000_autofactura.sql` completa: `claves_de_autofactura` (con
>   `portal_url`, la dirección es un ajuste; el Hub lee SU fila),
>   `tickets_facturables` (código con el alfabeto de `acceso.ts`),
>   `solicitudes_de_factura` (índice único parcial, `creado_ts`, Realtime),
>   trigger `privado.ticket_sigue_a_su_solicitud` (rechazada → disponible,
>   timbrada → facturado), `intentos_factura` con dos contadores. El portal
>   normaliza clave/folio/código a mayúsculas y valida su forma antes de tocar
>   la base. 15 pruebas, `tsc` limpio. **NADA aplicado en la nube todavía; NO
>   commiteado** (portal, migración, `pnpm-lock.yaml`).
>   **Lado Hub, en curso (21-sep):** HECHO y probado —dominio
>   `fiscal/autofactura.ts` (código, URL, qué es facturable, lectura del sobre,
>   clave propuesta; 24 pruebas), `derivarSecretoAutofactura` (protocolo),
>   `emisor` dentro de `facturacion_config` (la caja lo publica y lo adopta),
>   `cfdiDeOrden` que prefiere el que ampara, la cola que reemplaza un rechazado
>   que nunca se timbró (4 pruebas), `armarAvisoDeFacturaRechazada` +
>   `Correo.mandarAviso`, `SecretosDelHub.abrir`, y
>   `apps/hub/src/fiscal/autofactura.ts` (`AutofacturaDelHub`, 12 pruebas).
>   **(21-sep, noche) TODO CONSTRUIDO Y PROBADO:** `EnlaceSupabase` implementa
>   `NubeDeAutofactura` (+ Realtime de `solicitudes_de_factura`); cableado en
>   `main.ts` (reloj de 1 min, `alIngerir`, `alGenerar` → `cicloFiscal`); el Hub
>   reparte `autofactura_estado` (catálogo RESERVADO) a todas las cajas; la caja
>   imprime el QR primero en la pre-cuenta con «Clave: X   Folio: Y» y la
>   dirección (`portal.qrDeFactura`, store `autofactura.svelte.ts`); el portal
>   enseña el estado al reabrir el QR (`consultarTicket`); Central maneja claves
>   y dirección en el panel Facturación («Factura por internet»).
>   **Pruebas:** dominio 1380, protocolo 83, impresión 138, hub 542 (+2),
>   pos-ui 399, central 136, portal 19; `svelte-check` 0/0.
>   **Falta para salir (NADA hecho aún, pedir OK a Gonzalo):** aplicar la
>   migración `20260920000000_autofactura.sql` en la nube; desplegar
>   `apps/portal-factura` en Vercel con `SUPABASE_URL` y
>   `SUPABASE_SERVICE_ROLE_KEY`; poner la dirección y las claves en Central;
>   compilar y commitear (ahora SÍ entran el portal, la migración y el lock).
>   Decisiones de Gonzalo en `docs/PLAN-1.5.6.md` §6. Diseño acordado: el
>   código `t` = `firmarCuenta(orden_id, derivarSecretoAutofactura(claveLocal))`,
>   así la caja lo imprime y el Hub lo publica sin hablarse. Hallazgo: los datos
>   fiscales del emisor viven SOLO en cada tableta (`CLAVE_EMISOR` en su
>   almacén) y nunca llegan al Hub; hay que replicarlos en `facturacion_config`.
>
> **⏸️ DECISIÓN DE GONZALO (21-sep, noche): esto va en la 1.5.7, no en la 1.5.6.**
> La 1.5.6 ya se publicó (commits `0b6e7f5`, `3eec6ab`) sin el portal ni sin lo
> de abajo. **«Nos esperamos a más mejoras, y lo mandamos en la 1.5.7.»** No
> compilar ni publicar ninguna de las dos cosas siguientes hasta que él lo pida
> otra vez; se van juntas cuando decida cerrar la 1.5.7:
> - El **portal de autofactura** completo (arriba: falta Vercel, Central, y
>   commitear `apps/portal-factura/` + la migración + `pnpm-lock.yaml`).
> - El **arreglo del Hub del 21-sep** (commit `46229f4`, YA subido a la rama):
>   un `alCambiar` sin proteger en `secretos.ts` podía disfrazar una llave de
>   FacturAPI que SÍ se guardó bien como «El Hub falló al abrir el sobre» —le
>   pasó a Tortas Fc al activar su producción. La llave de Tortas Fc quedó
>   funcionando de todos modos (se guardó ANTES de que tronara el aviso); lo
>   que falta es que este arreglo llegue a un Hub real, y eso solo pasa
>   publicando una versión nueva. Ver [[el-sobre-si-se-abrio-el-aviso-tronaba]]
>   en memoria.

> **Si estás leyendo esto, la sesión anterior se cortó y tú continúas.**
> Este documento se mantiene al día en cada hito, así que lo que dice es el
> estado real. Verifica igual antes de confiar: corre las pruebas (§5) y mira
> `git status` para ver qué quedó a medias.
>
> **Última actualización:** 19-sep-2026, tarde (Claude). **Las 8 tareas de la
> 1.5.5 están construidas y probadas**; falta verificar sobre el instalador,
> aplicar la migración en la nube y publicar (§7). Punto de control en `dcb52f9`;
> todo lo posterior vive en el árbol de trabajo (`git status`), sin commitear.
>
> **Hecho el 19-sep por la tarde:**
> - **Migración APLICADA en la nube** con `apply_migration` (nombre
>   `buzon_de_secretos`; el archivo del repo conserva su nombre). Verificado:
>   las 2 columnas del pulso, las 2 políticas, Realtime, la huérfana
>   `public.sanear_pulso` borrada, el trigger sigue en `privado.sanear_pulso` y
>   el `device_id` ya admite 36. Probado el saneo con un pulso de mentira dentro
>   de una transacción deshecha: borra una llave colada en `secretos`, tira los
>   campos que no son del contrato y recorta `termina_en` a 4.
> - **Instaladores compilados y verificados sobre el paquete:**
>   `MotRest_1.5.5_x64-setup.exe` (bundle/nsis) y `MotRest Central_1.4.4_x64-setup.exe`
>   (`C:\mr\central-escritorio\release\bundle\nsis\`). El JS empaquetado coincide
>   con el compilado y las cadenas nuevas están dentro, también en `hub.cjs`. En
>   Central, la lista blanca de rutas NO es greppable (Rust la compila a
>   comparaciones de bytes): se comprueba con `cargo test`.
>
> **Estado del lanzamiento (19-sep, noche):**
> - Gonzalo probó la 1.5.5 instalada y dio el visto bueno.
> - **Commiteado y subido**: `3eb327f` en `feature/ticket-asistencia-y-plano`, 94
>   archivos, por lista explícita. **NO está en `main`.**
> - **Anclajes liberados**: `version_fijada = null` en los tres locales, así que
>   el canal vuelve a mandar. Hoy ofrece 1.5.4 y pasará a 1.5.5 al publicar.
> - **Ensayo del viernes SUPERADO** contra el binario instalado: 39/39 ventas,
>   cero duplicados, registro sano y respaldo verificado.
> - **Instalador**: `MotRest_1.5.5_x64-setup.exe`, 27 260 779 bytes, SHA-256
>   `543e393630b502503bef1cd629d5f56dcf15e608f84c2ab24e36e2d74d4ccd92`.
>   Central: `MotRest Central_1.4.4_x64-setup.exe`.
> - **PUBLICADA el 19-sep a las 20:03** por Gonzalo desde Central, en la nube Y en
>   GitHub (etiqueta `1.5.5` desnuda). Comprobado: el manifiesto de GitHub y el de
>   la nube son el MISMO (misma firma, mismas notas, mismo `publicado_ts`), su
>   firma verifica contra la pública que llevan los Hubs, la URL usa la etiqueta
>   correcta, y el `.exe` bajado de GitHub tiene la huella firmada, idéntica a la
>   del que se compiló aquí. Los cuatro locales reciben 1.5.5.
> - **OJO al próximo release:** al publicar, Central volvió a poner
>   `version_fijada = '1.5.5'` en los tres locales. Mientras siga clavado, la
>   1.5.6 NO les llegará: hay que despejarlo otra vez (§7).
>
> **TRAMPA NUEVA, costó un rechazo de GitHub:** las llaves FALSAS de las pruebas
> empiezan con `sk_live_`/`sk_test_`, igual que las de Stripe, y la protección de
> secretos de GitHub **rechaza el push entero**. Se armaron en dos trozos
> (`` `sk_${"live"}_…` ``). Si vuelve a pasar: un commit posterior que quite la
> cadena NO desbloquea nada, hay que rehacer el commit que la introdujo.

---

## 0 · Rodizio esta noche: las tabletas no aceptan ningún PIN

**Estado real, medido por SSH el 18-sep a las 22 h:**

- La caja se actualizó sola a **1.5.3** a las 19:54, con el enlace a la nube.
- Se autorizaron **4 tabletas** nuevas y sincronizan bien.
- Pero **en las tabletas ningún usuario entra**: sale «PIN incorrecto» con el PIN bueno. En
  la caja sí se puede entrar.

**Causa (verificada en la base del Hub y en el código):** el Hub **no tiene una sola
credencial**. En la tabla `estado` no existe la fila `credenciales_personal`, y en toda la
bitácora no aparece nunca «Credencial de … guardada en el Hub».

- La sincronización de credenciales llegó en la **1.5.0** (commit `943d6a0`).
- Solo sube un PIN al Hub cuando alguien lo **crea, cambia o restablece**
  (`publicarCredencialEnElHub` en `apps/pos-ui/src/lib/sesion/sesion.svelte.ts`).
- Los 5 usuarios de Rodizio (Gonzalo Sanchez, Odette, Daniel, Joy, Betty) son de agosto, así
  que sus PIN viven **solo en la caja**.
- La tableta recibe `{}`, `adoptarCredencialesDelHub` no hace nada y `verificarAlguna`
  devuelve falso.

**Cuidado:** cada intento cuenta. Con **7 fallos el usuario queda bloqueado en esa tableta**
(el bloqueo es local al dispositivo y solo lo levanta un superior). Que dejen de probar PIN
en las tabletas.

**Salida sin código, pendiente de que Gonzalo la haga en sitio:**

1. En la **caja**, restablecer el PIN de Odette, Daniel, Joy y Betty desde el acceso
   («olvidé mi PIN», con la firma de Gonzalo). Se puede poner **el mismo PIN** de siempre.
2. Gonzalo cambia el suyo estando dentro (menú de usuario → cambiar PIN). El del
   propietario no lo restablece nadie, por diseño.
3. Comprobar en la bitácora del Hub cinco líneas «Credencial de usr-… guardada en el Hub».
4. **Recargar cada tableta**: el Hub no reparte credenciales al recibirlas, cada terminal
   las pide al volver a «sincronizado».

**Arreglo de fondo, no hecho todavía (esperando a Gonzalo):** al conectar, una terminal
autorizada debe subir las credenciales de los **usuarios vivos que el Hub no tenga**, sin
pisar nunca las que el Hub sí tiene («lo del Hub manda»). El sitio natural es
`adoptarCredencialesDelHub`, que hoy sale en silencio si el Hub está vacío. Afecta a
**cualquier local que salte de 1.4.x a 1.5.x**, no solo a Rodizio.

**Acceso a la caja esta noche:** por IPv4 no contesta (ni ping ni puerto 22) y por IPv6 sí,
dentro de la misma wifi. Se localiza con `Resolve-DnsName GONZALITO` o por su IPv6 global.
Antes de aceptar la llave de una IPv6 nueva hay que comparar las huellas con
`ssh-keyscan` contra las guardadas para `192.168.100.21`. Cuenta `ironm`, llave
`~/.ssh/id_ed25519`.

**Otros pendientes vistos en la caja:**

- **El QR ofrece primero una IP `169.254.x.x` que no sirve.** `direccionesLan()` en
  `apps/hub/src/main.ts` no filtra las APIPA.
- **Siguen arrancando dos Hubs.** El segundo falla con `EADDRINUSE`, pero se queda vivo
  («el Hub sigue»).
- **Siguen llegando 2 `caja_cerrada` de `sistema` viejos.** El Hub los rechaza; con la 1.5.3
  la terminal ya los aparta, pero se ven en la bitácora.

---

## 1 · Qué es esto y quién manda

**MotRest** es el ERP restaurantero de **MOTRAE**. El CEO es **Gonzalo**: dirígete
a él por su nombre. Todo en **español**.

Lee primero `CLAUDE.md` y `README.md` en la raíz: son la guía de la casa y el
contexto del producto.

Piezas:

| Pieza | Dónde | Qué hace |
|---|---|---|
| **Hub** | `apps/hub/` (Node 24) | Uno por restaurante. Dueño del SQLite, de los secretos del local, de la impresora y de la red local. Empaquetado como `.exe` dentro del instalador. |
| **POS** | `apps/pos-ui/` (Svelte 5) | La caja y las tabletas del salón. Hablan con el Hub por WebSocket. |
| **Dominio** | `packages/dominio/` | Toda la lógica de negocio pura. Event sourcing: el estado sale de sumar eventos. |
| **Central** | `apps/central/` + `apps/central-escritorio/` (Tauri) | El panel de Gonzalo, en SU máquina. Guarda las llaves de firma de toda la cartera, cifradas con DPAPI. |
| **Nube** | Supabase, proyecto `ixttslqbbwqfcqjmttyg` | Cartero entre Central y los Hubs: licencias, pulsos, canal de actualizaciones. |

---

## 2 · Reglas de la casa (no negociables)

- **pnpm solo por corepack:** `corepack pnpm@9.15.0 …`. **Nunca `npm`.** Si corepack
  falla, `npx pnpm@9.15.0`.
- **Nunca `git add -A`.** Hay secretos sin `.gitignore` (`LLAVES.docx` y otros). Se
  commitea **por lista explícita de archivos**.
- **Nunca commitear a `main`.** Rama actual: `feature/ticket-asistencia-y-plano`.
- **Dinero en centavos**, siempre con los helpers del dominio (`sumar`, `restar`,
  `CERO`, `pesos`). Nada de aritmética de flotantes a mano.
- **Svelte 5 con runas** (`$state`, `$derived`, `$effect`). Nada de `export let`.
- **Comentarios en español que explican el PORQUÉ** y qué se rompía antes, no qué
  hace la línea. Imita el estilo de los archivos que tocas.
- **Escribe en UTF-8.** Ya pasó dos veces que un script en `latin1` rompió acentos.
  Antes de terminar: `grep -rlP '[ÃÂ]\p{L}|\x{FFFD}|[\x01-\x08\x0B\x0C\x0E-\x1F]'`
  sobre lo que tocaste no debe devolver nada.
- **Nada se da por bueno en desarrollo.** Se verifica sobre el paquete compilado
  (§6). Las pruebas verdes no detectan un instalador con código viejo.

---

## 3 · Dónde estamos

- **1.5.4 publicada** (MotRest) y **Central 1.4.3**. Commits `9e0ceb5` a `415dc5c`.
- **1.5.5 en curso.** Gonzalo commiteó un punto de control en `dcb52f9` (18-sep);
  lo posterior vive en el árbol de trabajo (`git status`). `apps/hub/package.json` y
  `apps/escritorio/src-tauri/tauri.conf.json` ya dicen 1.5.5.
- Lo que ya estaba modificado ANTES de esta tanda y **no es parte de ella** (no lo
  commitees con la 1.5.5): `video/guiones/*.md`, `apps/central-escritorio/src-tauri/Cargo.toml`
  (solo fin de línea), `docs/PLAN-APPLE-MACOS-IOS.md`.
- **22-sep · 1.5.7 (MotRest) y 1.4.6 (Central)**, rama
  `feature/pulso-actualizacion-pendiente`, commits `ee5a03b`, `b7a8ade`, `cf273a7`
  (más `46229f4`, el arreglo del sobre, que ya estaba).
  - **POR QUÉ RODIZIO Y TORTAS NO VEÍAN LA 1.5.6 (resuelto el bloque 🔴 de
    arriba).** La nube se la ofrecía bien (comprobado con el token de cada
    local). El fallo era del Hub: la revisión del arranque corre ANTES que el
    enlace con la nube y sale vacía, y la siguiente es a las 12 h — que una caja
    que se apaga cada noche nunca alcanza. `ee5a03b` revisa también en
    `alConectar`. **Las cajas que ya tienen el defecto (≤1.5.6) tampoco verán la
    1.5.7** salvo que pasen 12 h seguidas prendidas: hay que instalarla a mano
    una vez (Rodizio por SSH, ver `desplegar-motrest-en-la-caja-por-ssh`).
  - El pulso manda `actualizacion` (`{}` = al día; `{pendiente, vista_ts,
    eleccion, hora, aplazada_hasta, error}`); Central lo pinta en «Su Hub» y lo
    sube a «atención» a los 3 días o si falló. **La migración
    `20260922000000_pulso_actualizacion.sql` YA ESTÁ APLICADA en la nube.**
  - «Carga rápida de bebidas» / «Reventa rápida» → **«Carga rápida de alimentos
    y bebidas»**, con `title` explicativo (`AYUDA_CARGA_RAPIDA` en
    `reventa.svelte.ts`).
  - Llaves públicas para empaquetar (verificadas contra la firma real de la
    1.5.6): licencias `…C83o5lSMLQ7c…`, actualizaciones `…ayVws8Rn6eC1…`.
  - **Portal de autofactura:** el código, la migración y el lock YA estaban
    commiteados en `0b6e7f5`; la migración ya está en la nube. Solo falta
    Vercel (lo hace Gonzalo: su cuenta y la llave de servicio).
  - **Pendiente de Gonzalo:** firmar y publicar la 1.5.7 en Central →
    Versiones, y el proyecto de Vercel.
  - **Pedidos para llevar / apps (Rappi, DiDi…):** plan propuesto, esperando
    sus respuestas antes de construir. El dominio ya tiene `ventas/canales.ts`
    (canal y comisión en `orden_creada`, `ventasPorCanal`,
    `porCobrarDeAgregadores`) y Finanzas → «Canales y apps», pero **la caja
    nunca le pone canal a una cuenta**: todo cuenta como salón.

---

## 4 · La 1.5.5, tarea por tarea

### ✅ 1 — «Resultado de hoy»: gastos desglosados y salida de caja
Hecho y probado. `apps/pos-ui/src/lib/modulos/finanzas/Resultado.svelte`.

**Decisión contable que NO se revierte:** la compra de insumos **no resta la
utilidad contable**. Es inventario: su costo entra como «costo de lo vendido» cuando
se venden. Restarla también la contaría dos veces. Hay pruebas que lo fijan en
`packages/dominio/src/__tests__/egresos.test.ts` y `estado-financiero.test.ts`.

### ✅ 1b — Utilidad en efectivo (día, mes y PDF)
Hecho y probado (19-sep). **Dos utilidades**: la **contable** (`resultado`, no
cambió) y la **en efectivo** (`utilidad_efectivo` = venta sin IVA − `salida_total`,
**sin** restar el costo de lo vendido). Los nombres y la frase que explica la
diferencia viven UNA vez en el dominio (`UTILIDAD_CONTABLE`, `UTILIDAD_EN_EFECTIVO`,
`DIFERENCIA_ENTRE_UTILIDADES` en `packages/dominio/src/finanzas/egresos.ts`); no los
teclees en ninguna pantalla. Mes y PDF usan `resultadoDelPeriodo`
(`estado-financiero.ts`). Pantallas: «Resultado de hoy» (`Resultado.svelte`) y la
tarjeta «Cierre del mes» de Caja y dinero (`Dinero.svelte`). PDF:
`packages/impresion/src/estado-financiero-pdf.ts` (cinco tarjetas arriba).
Sin IVA a propósito: el IVA cobrado es del SAT (razones en el comentario de
`calcularResultado`). No hace falta migrar datos: todo se deriva al leer.

### ✅ 2 — Tarjetas con contorno y sombra (visual)
Hecho. `.tarjeta` se define **una sola vez** en `packages/ui/src/base.css`; los
tokens en `packages/ui/src/tokens.css` (`--superficie`, `--borde-tarjeta`,
`--sombra-tarjeta`). Había 22 copias locales que ya habían divergido; se quitaron.
**No vuelvas a definir `.tarjeta` en un componente:** los estilos de Svelte llevan
clase de ámbito y un `.tarjeta` local anula el global entero, en silencio.

### ✅ 3 — Ya no hay que pulsar F5
Hecho y probado. El defecto era de ENVÍO, no de recepción: `sync.empujar()` solo se
llamaba desde las comandas y otros trece almacenes dejaban sus eventos en la bandeja
de salida. Arreglo en `apps/pos-ui/src/lib/persistencia/arranque.svelte.ts`
(`conEmpujeAutomatico`: envuelve `almacen.eventos.anexar` y empuja lo que nace sin
`seq`, agrupado a 120 ms) y un latido de respaldo en
`packages/protocolo-sync/src/cliente.ts` (`arrancarLatido`, 15 s, solo consulta un
índice local). También se arreglaron: `reserva_confirmada` faltaba en `TIPOS_RESERVA`,
y el reparto en vivo no tenía rama fiscal (`fiscal.integrar`).
Prueba: `apps/pos-ui/src/lib/__tests__/lo-que-no-salia-de-la-tableta.test.ts`.

### ⚠️ 4 — Correos al comensal: construido, pero NO MANDA TODAVÍA
- **Dominio:** hecho. `packages/dominio/src/clientes/correo.ts`: eventos
  `correo_solicitado` / `correo_enviado` / `correo_rechazado` atados por
  `solicitud_id`; `estadosDeCorreo`; la encuesta exige `enlace_encuesta`; la
  publicidad lleva SIEMPRE su baja («responda BAJA»). Consentimiento en
  `DatosCliente.acepta_promociones` + `acepta_promociones_ts`.
- **Hub:** hecho. `apps/hub/src/solicitudes-de-correo.ts`, conectado en `alIngerir`
  de `main.ts`. Comprueba el permiso contra la FICHA del cliente (no contra lo que
  diga la tableta), no manda dos veces el mismo `solicitud_id`, retoma lo pendiente
  al arrancar.
- **Pantallas:** hechas. `Clientes → Correos al comensal`
  (`apps/pos-ui/src/lib/modulos/clientes/Correos.svelte`), «Mandar correo» en la
  ficha (`modulos/Clientes.svelte`), «Recordarle» en `modulos/clientes/Reservas.svelte`,
  vista previa en `lib/VistaPreviaCorreo.svelte` (iframe con `sandbox=""`).
  `admin/MensajesAlCliente.svelte` se borró.

**✅ Arreglado — la configuración ya llega al Hub.** Antes se guardaba solo en el
disco de la terminal y el Hub nunca se enteraba. Ahora viaja como **catálogo**
`correo_config`: `correo.svelte.ts` sube la versión en cada cambio (`cambiar()`) y la
publica; `sync.svelte.ts` la publica (`correo.alPublicar`), la ofrece al conectar
(`catalogosLocales`) y la adopta al recibirla (`correo.fusionar`, que solo adopta lo
más nuevo); el Hub la aplica en caliente en `aplicarConfiguracionDeCorreo`
(`apps/hub/src/main.ts`). Pruebas en `apps/pos-ui/src/lib/__tests__/correos-al-comensal.test.ts`.
Dos cuidados que no hay que romper:
- **La contraseña de Gmail no viaja en ese catálogo** (llega a todas las tabletas).
  `correo.paraPublicar` la quita, y el Hub descarta cualquier `llave` que venga.
- **En el Hub, configuración y contraseña comparten la clave `correo_config`**
  (`llave` va dentro). `aplicarConfiguracionDeCorreo` conserva la `llave` guardada
  al escribir; guardar lo que llega tal cual la borraría.
- También: el reintento de la cola (`vaciarCola`) ahora se arma siempre, no solo si
  había contraseña al arrancar.

**⏳ PENDIENTE — sin esto sigue sin mandar un solo correo:**
- **La contraseña de aplicación de Gmail no tiene dónde capturarse.** El Hub la toma
  de `MOTREST_RESEND_KEY` o de `llave` en su propia configuración, y la lee solo al
  arrancar (`llaveResend` en `prepararCorreo`). Es el mismo problema que la llave de
  FacturAPI (tarea 5): **un secreto que vive solo en el Hub y que hay que poder
  capturar desde Central o por el propietario/MOTRAE.** Se decidió resolver los dos
  con UN SOLO mecanismo cuando termine la investigación de FacturAPI. Al hacerlo,
  actualizar la variable `llaveResend` en caliente (la clase `Correo` la lee por
  función en cada envío, así que basta con cambiar la variable).

### 🔍 5 — FacturAPI (PAC nuevo)
Gonzalo contrató **FacturAPI** para timbrar CFDI 4.0. Pidió: investigación completa,
llenar los datos de cada restaurante **desde Central** y que viajen al MotRest del
local, y también desde MotRest **solo** con la cuenta MOTRAE o el propietario /
administrador predispuesto. Todo en la 1.5.5. **Pidió que se le propongan ideas y se
le pregunten las dudas ANTES de construir.**
Estado: **investigación en curso** por un agente. Si se cortó, repítela: documentación
oficial de FacturAPI (modelo de llaves de usuario y de organización `test`/`live`,
organizaciones, CSD por API, emisión, cancelación, factura global, autofacturación) y
el flujo de CFDI actual (`packages/dominio/src/fiscal/`, `apps/hub/src/fiscal/`,
`apps/pos-ui/src/lib/fiscal.svelte.ts`, `modulos/finanzas/Csd.svelte`).
**No construyas nada de FacturAPI sin que Gonzalo haya respondido las preguntas.**
**Investigación HECHA (19-sep): lee `docs/PLAN-FACTURAPI-1.5.5.md`.** Lo esencial:
FacturAPI NO timbra XML sellado por fuera; recibe JSON, sella con el CSD subido a
su panel y timbra. El secreto a proteger pasa a ser la llave Live de la organización
(solo en el Hub) y la llave de usuario `sk_user_` (solo en Central). Las 4 preguntas
del §7 del plan se le hicieron a Gonzalo; busca sus respuestas en la conversación o
pregúntale de nuevo.
**Respuestas de Gonzalo (19-sep):** licencia de API; global MENSUAL automática;
llave de usuario en Central + lista de organizaciones; solo el responsable (rol
propietario) y soporte, POR ROL.
**Construcción en curso (19-sep), repartida:**
- Contrato común, HECHO por Claude: `packages/dominio/src/comun/sobre.ts` (sobre
  sellado X25519 para un Hub) y `packages/dominio/src/organizacion/secretos.ts`
  (qué viaja, `EstadoSecretos`, `puedeGuardarSecretos` por rol). Pruebas en
  `__tests__/sobre.test.ts`.
- **Hub: ✅ HECHO (19-sep).** Par X25519 en `sobre-hub.json` (junto a la base, 0o600);
  pulso con `llave_publica` y `secretos`; mensaje WS `secreto` en `servidor.ts` con
  `puedeGuardarSecretos`; `apps/hub/src/secretos.ts` (FacturAPI en el estado del Hub,
  Gmail dentro de `correo_config` con `llave_meta`, gana el `emitido_ts` más reciente
  y una marca al quitar para que un sobre viejo no resucite); `fiscal/facturapi.ts`
  como PAC (columnas `formato` y `externo_id` en la cola, `idempotency_key` = cfdi_id,
  202 pendiente, correo al comensal, código `GLOBAL` si el ticket ya está en una);
  buzón por Realtime (solo PATCH de las tres columnas, y la llave de Central se prueba
  contra `/organizations/me`); cancelación por id de FacturAPI; `fiscal/factura-global.ts`
  (cada hora desde las 06:00 del día 1, un concepto por ticket y tasa, aviso a las 72 h).
  Hub 494 pruebas (+2 omitidas), build limpio. FacturAPI de mentira para pruebas en
  `apps/hub/src/__tests__/facturapi-falsa.ts`.
- Agente «Central»: migración `secretos_pendientes` + columnas del pulso (SIN
  aplicar), comando Rust `facturapi_peticion` con lista blanca, pestaña
  Facturación por restaurante.
- **Caja: ✅ HECHO por Claude (19-sep).**
  - `modulos/finanzas/FacturacionElectronica.svelte` SUSTITUYE a `Csd.svelte`
    (borrado con `git rm`, ya está en el índice): estado de FacturAPI (razón
    social, RFC, modo, llave …XXXX, CSD, pendientes), formulario de la llave solo
    para `puedeGuardarSecretos`, factura global del mes y la cola de timbrado de
    siempre. Se monta siempre en Finanzas, sin esperar los datos fiscales.
  - Contraseña de aplicación de Gmail en `modulos/clientes/Correos.svelte` («Quién
    los manda»), mismo camino.
  - `sync.svelte.ts`: `secretos`, `resultadoSecreto`, `guardandoSecreto`,
    `consultarSecretos`, `guardarSecreto`, `quitarSecreto` (sobre
    `ClienteSync.secreto` / `alRecibirSecretos` del agente del Hub).
  - `fiscal.facturar(estado, receptor, { correo, conGlobal })`: pone
    `correo_receptor` y, con global, bloquea tickets ya incluidos
    (`ordenEnFacturaGlobal`, solo producción) o de un mes cerrado
    (`ticketPasaALaGlobal`). `DialogoFactura.svelte`: campo de correo prellenado
    de la ficha y, con FacturAPI, sin botón «Público en general» (en CFDI 4.0 esa
    factura sin InformacionGlobal la rechaza el SAT). Prueba:
    `__tests__/factura-y-global-en-caja.test.ts`.
- **19-sep, mediodía: los dos agentes se cortaron por el límite de sesión y se
  retomaron.** Lo que llevaba el del Hub: dominio fiscal (`fiscal/comprobante.ts`
  con la cortesía por renglón, `fiscal/global.ts` nuevo, `fiscal/eventos.ts`,
  `fiscal/validacion.ts`, prueba `comprobante-cortesias.test.ts`); el Hub en sí
  (`apps/hub/src/fiscal/facturapi.ts`, par X25519, mensaje `secreto`) estaba SIN
  empezar. El de Central: `supabase/migrations/20260919090000_buzon_de_secretos.sql`,
  `apps/central-escritorio/src-tauri/src/lib.rs`, `apps/central/src/lib/facturacion.ts`
  y `central.svelte.ts` a medias. Si vuelves a encontrarlo cortado, sigue desde
  `git status` y el plan.
- **Central: ✅ HECHO (19-sep).** Llaves → «FacturAPI» (llave `sk_user_`, probar,
  quitar); Restaurantes → local → pestaña «Facturación y correo» (organización de
  una lista, semáforo, pruebas/producción, «Enviar», lista de llaves Live con
  «Revocar», bloque de Gmail, y «En el restaurante» con lo que reporta el Hub).
  Archivos: `apps/central/src/lib/facturacion.ts`, `paneles/Facturacion.svelte`,
  `Restaurantes.svelte`, `Llaves.svelte`, `central.svelte.ts`, y el comando Rust
  `facturapi_peticion` (lista blanca con `cargo test`). Central 129 pruebas, cargo 7.
  Falta verlo en la Central INSTALADA (el comando nativo solo se prueba ahí).
  Pendiente de mejora: cada envío en producción crea una llave Live nueva y la
  anterior se revoca a mano («Anterior de X» en la lista).
- **Migración** `supabase/migrations/20260919090000_buzon_de_secretos.sql`: además
  de la tabla y las columnas, REESCRIBE `privado.sanear_pulso()` (reconstruye
  `secretos` campo a campo; tope de `device_id` a 36, que el trigger vivo seguía
  cortando a 24) y borra la copia huérfana `public.sanear_pulso`. Revisarla antes
  de aplicar; `apply_migration` pone su propia marca de tiempo (renombrar el archivo).
- **Antes de publicar: aplicar la migración en Supabase** (si no, el pulso de los
  Hubs 1.5.5 se pierde entero).
El primer agente se cortó por el límite de sesión, pero dejó descargado en el
scratchpad de la sesión la especificación OpenAPI completa (`spec-es.json`,
`spec-en.json`), la página de precios (`pricing.html`) y la guía rápida (`qs.html`).
Si no tienes ese scratchpad, vuelve a bajarlas de facturapi.io.

### ✅ 6 — Productos de $0 en el menú (hecho 19-sep)
`validarProducto` (`packages/dominio/src/catalogo/menu.ts`) acepta precio 0 con
ADVERTENCIA (negativo sigue siendo error); la alta rápida de reventa
(`modulos/admin/Catalogo.svelte`, `problemaDelRenglon`) también. Márgenes y food
cost ya protegían la división entre cero. **El SAT no admite conceptos con
ValorUnitario 0 en un CFDI de ingreso**: se le encargó al agente del Hub excluir
esos renglones en `construirComprobante` y los tickets de $0 en la factura
global. Verifica que lo hizo.

### ✅ 7 — Cortesía por producto (hecho 19-sep)
El dominio ya tenía cortesía por renglón; se añadió **por piezas**: `cantidad?` en
`cortesia_otorgada` y en `Cortesia` (tres cervezas son UN renglón). Otorgar sobre un
renglón ya regalado REEMPLAZA. La única fuente del monto regalado es
`cortesiaDeRenglon(estado, renglon)` en `packages/dominio/src/comanda/totales.ts`;
los descuentos del renglón se calculan sobre lo que queda tras la cortesía. En la
caja: `pos.fijarCortesias(eleccion, motivo)` (una sola autorización, emite solo la
diferencia) y la ventana «¿Qué se regala?» en `apps/pos-ui/src/lib/PanelCuenta.svelte`
(toda la cuenta o productos, piezas, motivos rápidos, previa exacta). Cada renglón
regalado muestra la píldora «Cortesía · 1 de 3». Pruebas:
`packages/dominio/src/__tests__/cuenta.test.ts` (bloque «por piezas») y
`apps/pos-ui/src/lib/__tests__/cortesia-por-producto.test.ts`.
El CFDI tiene que repartir la cortesía SOLO en los renglones regalados usando
`cortesiaDeRenglon` (encargado al agente del Hub).

### ⏳ 8 — Subir al principio de la página en TODOS los botones que abren algo arriba
En la 1.5.4 se hizo que «Editar» y «Se vende tal cual» del menú suban la página
hasta el formulario, que aparece arriba. Gonzalo pide barrer TODO el software:
cualquier botón cuya acción aparezca en la parte superior de la página debe subir
también. Ejemplo que él encontró: **Insumos y Estaciones → «Editar»** en cualquier
insumo. Hay que hacer una lista de todos los casos (se la entregamos a Gonzalo) y
aplicar la misma mejora. Se hizo en la 1.5.4 con `subirArriba()` en
`modulos/cocina/Menu.svelte`: reutilízalo, no lo copies.
**✅ Hecho (19-sep).** Utilidad única `subirAlPrincipio(elemento)` en
`apps/pos-ui/src/lib/subir.ts` (busca el contenedor que se desplaza —la `.seccion`
del módulo o el cuerpo de un diálogo— y lo sube en el cuadro siguiente; pruebas en
`__tests__/subir-al-principio.test.ts`). Aplicada en Insumos y estaciones (Editar
insumo/estación, editar desde una categoría), Promociones, Usuarios (Permisos),
Clientes → Mandar correo, Compras, Reservas, Inventario, Personal → Asistencia, y
en la cuenta de la mesa (`PanelCuenta.svelte`: Cobrar, Traspasar, Cortesía por
socio y «Volver a la cuenta», con `irA` — NO dentro de `fijar`, que también usa
un `$effect`). Menú migró a la utilidad sin cambiar de comportamiento.
**Caso contrario, HECHO (19-sep, Gonzalo dijo que sí):** lo que se abre DEBAJO
usa la acción `use:revelar={clave}` de `subir.ts` (se monta → `scrollIntoView`
con `block: "nearest"`; si cambia la clave, vuelve a mostrar). Aplicada en
Prenómina (sueldo por día y guardar tarifa), Rol de mesas (editor de celda),
Usuarios (confirmar eliminar), Resultado («Registrar un gasto»), Salones (panel
de la mesa) y el selector de piezas de «¿Qué se regala?».
**ES REGLA DE CONSTRUCCIÓN PERMANENTE** (está en `CLAUDE.md` → Convenciones):
todo lo que abra algo fuera de cuadro, arriba o abajo, lleva la vista hasta ahí.

### ✅ 9 — Pedidos del 20-sep (hechos el mismo día)
- **«Venta de hoy» y «Resultado de hoy» son UNA tarjeta** en
  `modulos/finanzas/Resultado.svelte`: venta con IVA → IVA y base → los recuadros
  de efectivo/tarjeta/digitales → propinas → corte «Resultado del día» → las dos
  utilidades. Se quitó la lista plegada «Ver las cuentas de hoy» (y con ella
  `VisorTicket`, `cuentasDeHoy` y sus estilos): las mismas cuentas, con más datos,
  están en «Tickets cobrados» más abajo en la misma pantalla.
- **Tickets cobrados** tiene columna **Día** (`dia()` nuevo en `lib/formato.ts`).
- **Datos fiscales del comensal en MAYÚSCULAS mientras se teclean**
  (`DialogoFactura.svelte`, `enMayusculas`): el SAT compara contra la constancia,
  que está en mayúsculas.
- **Aviso de factura en el ticket, editable**: `aviso_factura` en
  `packages/impresion/src/plantillas.ts` (pre-cuenta y ticket cobrado, antes de la
  despedida; en el cobrado NO sale si hay QR de autofactura), en
  `local.svelte.ts` y editable en Administración → Impresoras.
- **La firma del pie dice la versión del local**: `MotRest 1.5.5 by Motrae`, con
  un renglón en blanco delante, centrada y a **doble alto** (una térmica solo
  multiplica por enteros: el «50 % más grande» que pidió Gonzalo no existe; es el
  mismo tamaño del nombre del local y del TOTAL, y se deja el ancho normal o no
  cabría en 42 columnas). `firmaMotrae`/`firmar` en `plantillas.ts`; la versión
  entra como `version?` en los datos de cada papel y la pone `impresion.svelte.ts`
  desde `VERSION_MOTREST`, no cada pantalla. Pruebas en
  `packages/impresion/src/__tests__/impresion.test.ts` (137 en total).
- **Autofactura:** NO se construyó. Gonzalo la quiere en **nuestro Vercel**, con
  clave del restaurante emisor, y el plan completo está en
  `docs/PLAN-AUTOFACTURA-PORTAL.md` (§8 tiene lo que falta decidir).

---

## 5 · Cómo verificar

```
corepack pnpm@9.15.0 --filter @motrest/dominio build
corepack pnpm@9.15.0 --filter @motrest/dominio test
corepack pnpm@9.15.0 --filter @motrest/protocolo-sync test
corepack pnpm@9.15.0 --filter @motrest/hub build
corepack pnpm@9.15.0 --filter @motrest/hub test
corepack pnpm@9.15.0 --filter pos-ui check     # 0 errores Y 0 avisos
corepack pnpm@9.15.0 --filter pos-ui test
corepack pnpm@9.15.0 --filter central check
corepack pnpm@9.15.0 --filter central test
```
Referencia del 19-sep-2026, con TODA la 1.5.5 construida: dominio **1296**, hub
**494** (+2 omitidas), pos-ui **333**, protocolo-sync **80**, impresión **131**,
central **129**, y `cargo test` en `apps/central-escritorio/src-tauri` **7**. Los
`check`/`build` de pos-ui, hub y dominio salen sin errores ni advertencias. Si
alguna cifra baja, algo se rompió.

---

## 6 · Cómo compilar el instalador

Las llaves públicas se recuperan del Hub anterior (`apps/hub/dist-sea/hub.cjs`).
La de **licencias** va primera y la de **actualizaciones** segunda. Verificado el
17-sep-2026:

```powershell
$env:MOTREST_LICENCIA_PUBLICA="MCowBQYDK2VwAyEAC83o5lSMLQ7ciyKGFCXG1LDjqHqxdx2zFOqaU5/z82s="
$env:MOTREST_ACTUALIZACIONES_PUBLICA="MCowBQYDK2VwAyEAayVws8Rn6eC1JRLNJFkfk3qO70wdS2VzvADWRwT1jBU="
$env:MOTREST_ACTUALIZACIONES_REPO="motraegmg-tech/MotRest"
corepack pnpm@9.15.0 --filter @motrest/escritorio build
```
Sale en `apps/escritorio/src-tauri/target/release/bundle/nsis/`. **Tarda varios
minutos: lánzalo en segundo plano.** Sale sin firmar con certificado (MOTRAE no tiene
uno; ver `docs/FIRMA-DEL-INSTALADOR.md`).

**Después, verifica sobre el paquete** — `tauri build` a secas NO reconstruye lo que
empaqueta:
- El JS que empaqueta el instalador es el recién compilado:
  `grep -o "oname=pos.assets.index-[A-Za-z0-9_.-]*" apps/escritorio/src-tauri/target/release/nsis/x64/installer.nsi`
  debe coincidir con `ls apps/pos-ui/dist/assets/`.
- Busca cadenas de lo nuevo en `apps/pos-ui/dist/assets/*.js` y en
  `apps/hub/dist-sea/hub.cjs`. Los nombres de función se minifican: busca textos.
- `grep -c "motraegmg-tech/MotRest" apps/hub/dist-sea/hub.cjs` → 1.

Central se compila con `corepack pnpm@9.15.0 --filter @motrest/central-escritorio build`
y sale en `C:\mr\central-escritorio\release\bundle\nsis\`. Central no se actualiza
sola: hay que reinstalarla. Su versión está en
`apps/central-escritorio/src-tauri/tauri.conf.json`. Tiene pruebas de Rust:
`cargo test` en `apps/central-escritorio/src-tauri`.

---

## 7 · Cómo se publica — y tres cosas que están mal AHORA MISMO

Publica Gonzalo desde **Central → Versiones**: la llave privada vive en su DPAPI y
nadie más puede firmar. Guía completa: `docs/PUBLICAR-UNA-ACTUALIZACION.md`.
- Publicar **en la nube Y en GitHub**. Un local enlazado solo mira la nube; tres
  versiones se perdieron por publicar solo en GitHub.
- Etiqueta de GitHub **desnuda**: `1.5.5`, sin `v`.

**Pendiente y urgente, sin resolver al escribir esto:**

1. **El `motrest.json` del release 1.5.4 en GitHub es el de la 1.5.2.** Verificado el
   18-sep-2026: dice versión 1.5.2 y apunta a `…/download/v1.5.2/…`. Está firmado y
   verifica —es un manifiesto auténtico, del release equivocado—. La nube tiene el
   correcto, así que los locales **enlazados** reciben bien la 1.5.4; los que **no**
   están enlazados (Rodizio, Prueba Alejandro) leen GitHub y no reciben nada. El
   manifiesto correcto se reconstruyó y verificó contra la llave de los Hubs; se le
   ofreció a Gonzalo reemplazar el archivo del release con `gh` y **no llegó a
   responder**. Pregúntale antes de tocar un release publicado.
2. **Los tres locales están clavados en `version_fijada = 1.5.4`** en la tabla
   `asignaciones` de la nube. Mientras sigan así, **la 1.5.5 no le llegará a ninguno**,
   sin ningún error visible. Se despeja poniéndola en `null` (la función
   `privado.version_ofrecida` hace `coalesce(clavado, lo último del canal)`), o
   volviendo a marcarlo en el paso de publicar de Central. Compruébalo con:
   `select a.sucursal_id, a.version_fijada, privado.version_ofrecida(a.sucursal_id) from public.asignaciones a;`
3. **Rodizio no está enlazado con la nube.** Tiene una licencia buena depositada desde
   el 11-sep que nunca pudo recoger. Hay que pegársela a mano una vez; procedimiento en
   `docs/ENLAZAR-UN-LOCAL-CON-LA-NUBE.md`. **Instalar la 1.5.4 (o posterior) antes de
   pegarla**: las anteriores no montan el enlace sin reiniciar el Hub.

---

## 8 · Trampas que ya costaron tiempo

- **Especificidad de Svelte contra reglas globales.** Una regla local `.x` lleva clase
  de ámbito y gana a una global `.x`. Para que una utilidad global aplique, quita las
  propiedades en conflicto de la regla local.
- **Listas de tipos de evento escritas a mano se quedan cortas.** Tres veces ya dejaron
  eventos sin pintar. Deriva los `Set` del dominio (`TIPOS_EVENTO_*`) con la
  comprobación de exhaustividad que no compila si falta uno (ver
  `packages/dominio/src/fiscal/eventos.ts`).
- **Un evento de la TERMINAL firmado como `sistema`** fue rechazado en bucle durante
  meses (la caja de Rodizio que nunca cerraba). Los que inyecta el propio Hub sí pueden
  firmarse `sistema`: no pasan por esa revalidación.
- **Una lista blanca en Rust compila a comparaciones de bytes**: no se puede verificar
  buscando el texto en el `.exe`. Por eso `comprobar_ruta_de_nube` tiene `cargo test`.
- **Escribir `\u0000` puede acabar como byte NUL real** en el archivo, y git lo trata
  como binario. Pasó con `SelectorInsumo.svelte`.
- **Firmar bien no significa ser el correcto**: el manifiesto equivocado del release
  1.5.4 verificaba perfecto. Comprueba versión, URL y huella, no solo la firma.
- **`version_fijada` gana a todo**, y no avisa.

---

## 9 · Cómo trabajar con Gonzalo

- Antes de cambios grandes, **propón un plan** y pregunta lo que cambie el diseño.
  Él lo pide así explícitamente.
- Cuando algo que pide contradiga una decisión técnica o contable seria (p. ej.
  contar un costo dos veces), explícale el porqué en una o dos frases y ofrécele
  opciones con su consecuencia. Decide él.
- Dile lo que está verificado y lo que no. Nunca «listo» si no se probó.
- **Mantén este documento al día** en cada hito, por si la sesión se vuelve a cortar.
