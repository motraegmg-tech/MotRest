# Relevo — actualización remota (ADR-26)

**Documento de traspaso.** Estado del trabajo del 8 de agosto de 2026 sobre el
sistema de actualización remota, por si otra persona o herramienta tiene que
continuarlo. Se borra cuando el trabajo esté cerrado.

> **Lee primero** [`adr/ADR-26-actualizacion-remota.md`](adr/ADR-26-actualizacion-remota.md):
> ahí está el diseño completo y el porqué de cada decisión. Este archivo solo
> dice qué está hecho y qué falta.

---

## El problema que se está arreglando

MotRest tenía el sistema de actualización escrito casi entero pero **no
actualizaba nada**, por tres cortes:

1. La decisión del restaurante (`decidir()` en el POS) se guardaba en el almacén
   de esa terminal y no llegaba al Hub, que es quien instala. Nadie llamaba a
   `descargar()` ni a `instalar()`.
2. `MOTREST_ACTUALIZACIONES_REPO` no la escribía nadie —ni el instalador NSIS ni
   Tauri al lanzar el Hub—, así que **el canal venía apagado en cada
   instalación**, incluida la de Rodizio.
3. Tras instalar, nadie volvía a abrir MotRest: actualizarse de madrugada
   equivalía a apagar el restaurante.

Y se añaden dos capacidades que Gonzalo pidió: **anillos** (no publicar a toda
la flota a la vez) y **saber qué versión tiene cada restaurante**.

---

## Hecho y verificado

Todo lo de abajo compila y sus pruebas pasan.

**Dominio** (`packages/dominio/src/organizacion/actualizaciones.ts`)
- `anillo?: number` en `VersionDisponible`, dentro de la firma.
- `debeInstalar()` — separa «ahora»/«a las X» (instalar) de «más tarde» (recordar).
- `debeAvisar()` ya no repite el diálogo cuando el restaurante ya dijo que sí.
- `enHorarioDeServicio()`, `hayTurnoAbierto()`, `posicionEnLaFlota()`, `leTocaElAnillo()`.
- Pruebas: `packages/dominio/src/__tests__/actualizaciones.test.ts` → **42 en verde**.

**Hub**
- `apps/hub/src/actualizaciones.ts`: filtra por anillo antes de recordar el
  manifiesto; `instalar()` acepta la app a relanzar y escribe un guion de relevo
  (`prepararRelevo`) que cierra la caja, instala en silencio y la reabre.
- `apps/hub/src/main.ts`: estado persistente `actualizacion_estado`, ruta
  `GET/POST /actualizacion` (solo desde la caja), `evaluarActualizacion()` cada
  minuto, `turnoDeCajaAbierto()`, `appDeEscritorio()`, y el pulso
  (`pulsoDelLocal`, `reportarPulso`, cada 24 h y al conectar).
- `apps/hub/src/llaves-motrae.ts` + `empaquetar.mjs`: el repositorio se incrusta
  en el binario (`__MOTREST_ACTUALIZACIONES_REPO__`, por defecto `motraegmg-tech/MotRest`).
- Typecheck en verde.

**POS**
- `apps/pos-ui/src/lib/actualizaciones.svelte.ts`: `decidir()` manda la decisión
  al Hub y revierte si no la acepta.
- `AvisoActualizacion.svelte`: no cierra hasta que el Hub confirma; muestra el
  error (incluido «se confirma desde la caja» cuando se pulsa en una tablet).
- `svelte-check`: 481 archivos, **0 errores**.

**Relay**
- `apps/relay/src/sobre.ts` — cifrado extraído de `inquilinos.ts` (lo usan los dos).
- `apps/relay/src/pulsos.ts` — `Pulsos` + `sanearPulso`, cifrado en disco, solo
  el último por local, con topes contra un Hub que mande basura.
- `apps/relay/src/main.ts` — mensaje `pulso` (la sucursal sale de la credencial)
  y `GET /pulsos` contra `MOTREST_RELAY_CLAVE_ADMIN`.
- Pruebas: `apps/relay/src/__tests__/pulsos.test.ts` → **61 en verde** en total.

**Central (lógica)** — `apps/central/src/lib/central.svelte.ts`
- Valida el anillo al firmar (entero 1–100).
- `ordenDeDespliegue` y `localesEnElAnillo()` — quién entra con cada porcentaje.
- `relay_url` y `relay_clave_admin` en el almacén DPAPI; `traerPulsos()`.
- `apps/central-escritorio/src-tauri/tauri.conf.json`: `connect-src 'self' https:`.

---

## Lo que falta

En orden. Lo de arriba es lo que impide que la funcionalidad se pueda usar.

1. **`apps/central/src/paneles/Actualizaciones.svelte`** — está a medias: ya
   tiene el estado (`anillo`, `anilloNumero`, `alcanzados`, `orden`) pero **le
   falta el marcado**: el campo del porcentaje, la lista de a qué locales
   alcanza, y pasar `anillo: anilloNumero` a `central.firmarActualizacion(...)`.
2. **`apps/central/src/paneles/Llaves.svelte`** — añadir dirección del relay y
   su clave de administración, guardándolas con `central.guardarConfiguracion({
   repositorio, relay_url, relay_clave_admin })`.
3. **`apps/central/src/paneles/Hoy.svelte`** (o `Restaurantes.svelte`) — botón
   «Traer estado de los locales» que llame a `central.traerPulsos()`. La columna
   de versión ya existe en `Restaurantes.svelte` y hoy sale vacía porque nunca
   llega un pulso.
4. **Pruebas nuevas**: en `apps/central/src/lib/__tests__/central.test.ts` para
   el anillo y `traerPulsos`; en `apps/hub/src/__tests__/actualizaciones.test.ts`
   para que un manifiesto con anillo que no toca **no se recuerde** (si se
   recordara, ese local quedaría fuera del despliegue para siempre).
5. **Suite completa**: `corepack pnpm@9.15.0 -r test` y `-r lint`.
6. **Documentación**: `docs/PUBLICAR-UNA-ACTUALIZACION.md` (anillos, canal ya
   incrustado, el relevo) e `docs/INSTALAR-EN-UN-RESTAURANTE.md` (ya no hay que
   poner `MOTREST_ACTUALIZACIONES_REPO` a mano).
7. **Verificación sobre el paquete compilado — NO HECHA Y ES OBLIGATORIA.**
   Ver [`../CLAUDE.md`](../CLAUDE.md) y la nota de abajo.

---

## Avisos para quien continúe

- **Otra sesión está trabajando en paralelo** en la identidad del local por
  licencia (`sucursal-provisional`, `fijarSucursalPorLicencia`, `adoptarSucursal`
  en `apps/hub/src/main.ts`, y cambios en `servidor.ts` y `licencia.ts`). **No
  pisar eso.** Releer los archivos antes de cada edición.
- **Nada se da por bueno en desarrollo.** En este proyecto un cambio no está
  hecho hasta comprobarlo sobre el paquete compilado: `tauri build` no
  reconstruye lo que empaqueta, y `pos-ui/dist` puede quedarse viejo en silencio.
  Antes de publicar hay que instalar el `.exe` **sobre una instalación anterior**
  y comprobar que el Hub arranca con el canal encendido (su bitácora debe decir
  «Actualizaciones desde motraegmg-tech/MotRest»).
- **El relevo de instalación no se ha probado en Windows real.** Es un `.cmd` que
  hace `taskkill` sin `/t` —a propósito: `/t` mataría el propio guion, que cuelga
  de ese árbol—, espera a que la caja cierre, instala y reabre. Hay que verlo
  funcionar una vez de principio a fin antes de confiar en él.
- **El primer salto a Rodizio tiene que ser manual.** El MotRest que hay
  instalado allí no tiene canal, así que no verá ninguna publicación: hay que
  llevarle el instalador a mano una última vez. De ahí en adelante se actualiza
  solo.
