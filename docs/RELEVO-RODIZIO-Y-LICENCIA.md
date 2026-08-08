# Relevo — caja de Rodizio, licencia como identidad y mejoras de producto

**Fecha:** 8 de agosto de 2026 · **Rama:** `feature/e1-cimientos` · **Sin commitear.**

Documento para que otra persona (o Gemini) continúe sin volver a investigar nada.
Lo escribo porque la sesión se quedó sin presupuesto a mitad del último tramo.

---

## 0. Lo primero que hay que saber

**Hay TRES flujos de cambios distintos en el árbol de trabajo.** No los mezcles.

| Flujo | Archivos | Estado |
|---|---|---|
| **A. Mío** (bug de Rodizio + licencia + usuarios + permisos) | `apps/hub/src/{main,servidor,licencia}.ts`, `packages/dominio/src/identidad/**`, `packages/dominio/src/organizacion/licencia.ts`, `apps/pos-ui/src/{App.svelte,lib/presentacion.ts,lib/sesion/**,lib/modulos/admin/{Usuarios,Bitacora}.svelte,lib/licencia/PantallaBloqueada.svelte}`, `apps/hub/package.json`, `apps/escritorio/src-tauri/tauri.conf.json` | **Terminado y verificado** |
| **B. Agentes que se cortaron** | `packages/dominio/src/catalogo/{fotos.ts,menu.ts,productos.ts,visibilidad.ts}` (fotos), `packages/dominio/src/inventario/explosion.ts` (rendimiento) | **A MEDIAS — hay que revisarlo o revertirlo** |
| **C. Actualización remota — lo está haciendo GEMINI en paralelo** | `apps/relay/**`, `apps/central/**`, `apps/hub/src/{actualizaciones,llaves-motrae,relay}.ts`, `packages/protocolo-sync/src/cifrado.ts`, `packages/dominio/src/organizacion/actualizaciones.ts`, `docs/RELEVO-ACTUALIZACION-REMOTA.md`, `docs/adr/ADR-26-actualizacion-remota.md` | **No lo toqué. Tiene su propio relevo.** |

Los flujos A y C **coinciden en dos archivos**: `apps/hub/src/main.ts` y
`packages/dominio/src/index.ts`. Las dos partes editaron zonas distintas y el typecheck pasaba
al cerrar, pero si aparece un conflicto raro es ahí donde hay que mirar primero.

Antes de nada: `git diff --stat` y separa por esa tabla.

---

## 1. El bug que rompía la caja de Rodizio · RESUELTO

### Síntoma
La computadora de Rodizio **es** el Hub del local, y aun así MotRest decía «Modo isla ·
Sin contacto con el Hub del local». Reconectaba en bucle (7 intentos en 9 segundos) y
**el registro del Hub no anotaba ni una línea**.

### Causa raíz
Al arrancar sobre un registro en blanco, el Hub no sabe a qué sucursal pertenece, así que
**se inventa** un identificador (`suc-90445ad2`) y lo graba en `sucursal.txt`. Las terminales
se presentan con el suyo (`suc-rodizio-centro`, que estaba **fijo en el código** del POS).
En `apps/hub/src/servidor.ts`, `saludar()` comparaba los dos y **rechazaba a todas las
terminales, incluida la caja del propio equipo**, con `sucursal_distinta`.

No se corregía nunca: sin terminales no entra un evento, sin eventos el identificador
inventado no se aprende, y como ya quedó escrito en disco sobrevive a cada reinstalación.
**Un local que no podía abrir jamás.** Y era invisible porque esa rama del código no
escribía en la bitácora.

### Arreglo
- `apps/hub/src/servidor.ts` · `saludar()`: con el registro **en blanco** (`log.seqActual === 0`)
  el Hub adopta la sucursal de su primera terminal, en vez de rechazarla. Nueva opción
  `adoptarSucursal` en `OpcionesHub`. **Y el rechazo ahora sí se anota.**
- `apps/hub/src/main.ts`: `adoptarSucursal()` persiste en `sucursal.txt`. Se niega si quien
  instaló impuso `MOTREST_SUCURSAL_ID`.

### Verificado
Sobre el **binario empaquetado**, base en blanco, POS real en Chrome:
```
AVISO Local sin identificador asignado. Se generó suc-90445ad2 de momento.
INFO  Identidad del local fijada de momento: suc-rodizio-centro.
INFO  Dispositivo conectado: 019fe23f-… (desde seq 0)
```
Una conexión, estable, sin bucle. Antes: 7 reconexiones en 9 s.

---

## 2. Licencia = identidad del restaurante · TERMINADO

Lo que pidió Gonzalo: *«genero los restaurantes en MOTRAE Central, cada uno con su
licencia JSON, la pongo dentro del MotRest del restaurante y automáticamente identificará
qué restaurante es»*.

### Cómo quedó
1. **`packages/dominio/src/organizacion/licencia.ts`** — nueva `firmaDeMotrae(licencia, llave)`:
   comprueba la firma **sin** mirar a qué local pertenece. `verificarLicencia` ahora la usa.
   Es el alta: un equipo virgen no tiene contra qué comparar, pero sí puede comprobar que
   el documento lo emitió MOTRAE.
2. **`apps/hub/src/licencia.ts`** — `GestorLicencia` recibe `sucursalActual: () => string`
   (se PREGUNTA cada vez, porque cambia debajo) y `fijarIdentidad`. Tanto `cargar()` como
   `instalar()` adoptan la identidad de una licencia auténtica cuando procede. `cargar()`
   también, para que copiar `licencia.json` a mano a la carpeta del Hub funcione.
3. **`apps/hub/src/main.ts`** — marca de **identidad provisional**: el archivo
   `sucursal-provisional` junto a la base. Mientras existe, la licencia puede sustituir el
   identificador. Su **ausencia** = identidad firme (y por eso los locales instalados antes
   de esto quedan protegidos: llevan tiempo operando con el suyo).
   - `fijarSucursalPorLicencia()` — el alta. Se niega si hay `MOTREST_SUCURSAL_ID` o si la
     identidad ya es firme.
   - `GET /licencia` ahora devuelve `sin_asignar: boolean`.
4. **`apps/pos-ui/src/lib/presentacion.ts`** — `SUCURSAL_ID` **ya no es un literal**. Se
   resuelve al importar (tiene que ser síncrono: media docena de módulos calculan su stream
   al cargarse) en este orden: marcador inyectado por el Hub → `?s=` del QR → `localStorage`
   → `suc-rodizio-centro` como último recurso (los locales viejos tienen su historia sellada
   con él).
5. **`apps/hub/src/main.ts`** — el Hub inyecta `sucursal_id` en `window.__MOTREST_HUB__` y lo
   añade a los enlaces de emparejamiento (`&s=…`), para que la tablet selle sus eventos bien.
6. **`apps/pos-ui/src/lib/licencia/PantallaBloqueada.svelte`** — un equipo nuevo ya no dice
   «Servicio suspendido» sino **«Active su MotRest»**, y no pide código de instalación
   (no hace falta: la licencia dice qué restaurante es). Un local que dejó de pagar sigue
   viendo lo de antes.

**MOTRAE Central ya estaba listo**: `alta()` acepta `datos.id` o lo deriva del nombre, y
`emitirLicencia` usa `sucursal_id: cliente.id`. No hubo que tocarlo.

### Verificado de punta a punta sobre el binario empaquetado
```
1) equipo recién instalado → sucursal_id: suc-b656148c · sin_asignar: true · opera: false
2) se pega la licencia de «Rodizio» → { "ok": true, "estado": "activa" }
3) sucursal_id: suc-rodizio · sin_asignar: false · nombre: Rodizio · opera: true
   sucursal.txt = suc-rodizio · la marca sucursal-provisional desapareció
4) en Chrome: __MOTREST_HUB__ = { …, "sucursal_id": "suc-rodizio" }
   el POS abre en «Bienvenido. Vamos a crear su usuario» y el WebSocket queda conectado
```

### Cuidado al probar a mano
La firma de la licencia va en **hexadecimal**, no en base64 (`packages/dominio/src/comun/firma.ts`).
Perdí un rato por eso. El contenido firmable es `JSON.stringify` con las claves **ordenadas
recursivamente** y los `undefined` descartados.

---

## 3. Rangos y permisos · TERMINADO

**Los roles ya estaban bien**: un mesero no tiene ni un permiso de finanzas o inteligencia,
y el sidebar filtra por `sesion.puedeVer(m.permiso)`. Lo que estaba mal era un parche sin
commitear.

- **Quitado el usuario fantasma**: `sesion.usuarioActual` devolvía un «Configuración Inicial»
  **con permisos de propietario** mientras faltaba dar de alta al responsable. Resolvía un
  problema real (el alta se pintaba encima de la app, que sin sesión mostraba «Sin acceso»
  detrás) pero regalaba el negocio entero a quien abriera la caja.
- **Arreglado de raíz**: el alta del responsable se pinta **sola** (`App.svelte`, rama
  `{:else if altaInicial}`), no encima. `AltaResponsable.svelte` vuelve a fondo opaco.
- **Restaurado `MODO_DEMO`** en `apps/pos-ui/src/lib/sesion/usuarios.ts`. Gonzalo lo había
  puesto a `[]` fijo; comprobé sobre el bundle de producción que la guarda ya funcionaba:
  `usr-lucia`, `Lucía` y `usuariosDemo` **no aparecen** en `dist/assets/*.js`. (`usr-gonzalo`
  sí aparece, pero es `USUARIO_RESPONSABLE_ID`, intencional.)
- **Prueba nueva**: `apps/pos-ui/src/lib/__tests__/que-ve-cada-rango.test.ts` (5 pruebas).

---

## 4. Eliminar usuarios en definitiva · TERMINADO

Solo el **rango más alto** (propietario, `RANGO` 100). Nunca a un igual, nunca a uno mismo,
nunca al soporte de MOTRAE (rango 120).

- `packages/dominio/src/identidad/acciones.ts` — acción `admin.usuario.eliminar` (sensible).
  El propietario la obtiene sola porque usa `todas("autorizar")`.
- `packages/dominio/src/identidad/eventos.ts` — evento `usuario_eliminado
  { usuario_id, eliminado_por, nombre }`. La validación rechaza `usuario_id === eliminado_por`.
- `packages/dominio/src/identidad/reducers.ts` — la proyección lo **saca del arreglo**
  (`filter`), no lo marca. «Eliminado» no es un estado del empleado: es que ya no es uno.
- `packages/dominio/src/identidad/matriz.ts` — `puedeEliminarA(actor, objetivo)`.
- `apps/pos-ui/src/lib/sesion/sesion.svelte.ts` — `eliminarUsuario()` y `puedeEliminar()`.
  **Destruye también la credencial** y reescribe los secretos: si el hash sobreviviera, el
  PIN de un despedido seguiría firmando cancelaciones desde el diálogo de autorización, que
  busca por credencial y no por la lista.
- `apps/hub/src/servidor.ts` — el Hub **revalida**: `PERMISO_POR_EVENTO.usuario_eliminado` y
  un caso en `revalidarEventoIdentidad`. Esconder el botón no protege de nada.
- `apps/pos-ui/src/lib/modulos/admin/Usuarios.svelte` — botón «Eliminar» solo para quien puede,
  y **confirmación escribiendo el nombre** (un «¿seguro?» se contesta que sí por reflejo).
- `apps/pos-ui/src/lib/modulos/admin/Bitacora.svelte` — la baja sale en alerta, con el nombre
  que traía el evento (el usuario ya no está en la lista para resolverlo).

**Lo que NO borra:** la bitácora. El log solo agrega. Quien cobró una mesa la sigue habiendo
cobrado, y queda escrito quién lo eliminó.

Pruebas: `apps/pos-ui/src/lib/__tests__/eliminar-usuario.test.ts` (9) + 2 en
`apps/hub/src/__tests__/sincronizacion.test.ts`.

---

## 5. LO QUE FALTA

### 5.1 Fotos de productos — A MEDIAS, revisar antes de seguir
Archivos que dejó el agente: `packages/dominio/src/catalogo/fotos.ts` (nuevo) y cambios en
`catalogo/{menu,productos,visibilidad}.ts`. **No sé en qué estado quedaron: no los revisé.**
Primero `git diff` de esos cuatro y decidir si se continúan o se revierten.

Requisito: en **Cocina → Menú** cada producto puede recibir imagen; en **Venta**, sin imagen
se ve **exactamente igual que hoy** (nada de huecos ni «sin imagen»).

**Restricción que no se puede violar:** las imágenes **no** van al event log ni al catálogo
replicado. El log se replica entero y cada terminal lo carga al arrancar; base64 de fotos ahí
degrada el arranque de las tablets hasta lo inusable (por eso existe `apps/hub/src/crecimiento.ts`).
Diseño esperado: bytes en **disco del Hub**, servidos por él (calcar `archivoDentroDe` de
`apps/hub/src/seguridad-http.ts` contra path traversal); el menú guarda solo la referencia;
subida por ruta HTTP con límite de tamaño, tipos jpeg/png/webp y permiso `cat.producto.editar`;
redimensionar en el cliente con canvas antes de subir. **Tiene que verse también desde la
tablet** (llega por https al 8787), no solo en la caja.

### 5.2 Contador de rendimiento — A MEDIAS, revisar antes de seguir
El agente tocó `packages/dominio/src/inventario/explosion.ts` y su último mensaje fue
«confirmado el riesgo de punto flotante, ahora escribo el dominio». **Revisar `git diff` de
ese archivo.**

Requisito: «compré 3 kg de queso y cada pizza usa 150 g → ¿cuántas pizzas salen?».
Lo importante: un platillo usa varios insumos y manda el **insumo limitante**; hay que
**nombrarlo** («salen 8, topa la masa»), porque un número sin la causa no sirve para decidir
qué comprar. Cuadrar unidades (kg/g/piezas/litros). Decir en pantalla que es aproximado.
Cálculo puro en `packages/dominio`, muy probado; pantalla en Inventario.

### 5.3 Lo que solo puede hacer Gonzalo
**Reempaquetar con las llaves reales de Central.** Yo compilé con llaves desechables para
verificar y **restauré el binario de producción**, así que el `.exe` que está en
`apps/escritorio/src-tauri/binarios/` **NO lleva estos arreglos**.

```powershell
$env:MOTREST_LICENCIA_PUBLICA = "<Central → pública de licencias>"
$env:MOTREST_ACTUALIZACIONES_PUBLICA = "<Central → pública de publicación>"
corepack pnpm@9.15.0 --filter pos-ui build
corepack pnpm@9.15.0 --filter @motrest/hub empaquetar
# y después el instalador de escritorio con tauri build
```

Versiones ya subidas a **1.1.2** en `apps/hub/package.json` y
`apps/escritorio/src-tauri/tauri.conf.json`.

**Para Rodizio en concreto:** su caja ya tiene historia sellada con `suc-rodizio-centro`.
Emítele la licencia **con ese identificador** desde Central (el campo id acepta que se lo
escribas), no con uno nuevo. Si no, la adopción por licencia se negará —correctamente— por
tener ya identidad firme.

---

## 6. Estado de la verificación

| Comprobación | Resultado |
|---|---|
| `--filter @motrest/dominio lint` | limpio |
| `--filter @motrest/dominio test` | **1001 pruebas** |
| `--filter @motrest/hub lint` | limpio |
| `--filter @motrest/hub test` | **344 pruebas** |
| `--filter pos-ui lint` (svelte-check) | 0 errores, 481 archivos |
| `--filter pos-ui test` | **114 pruebas** |

**Comprobado también DESPUÉS de que los agentes se cortaran**: `dominio lint` limpio,
`dominio test` 1001 pruebas, `pos-ui lint` 0 errores en 483 archivos. Lo que dejaron a medias
es **aditivo y no rompe el árbol** — pero eso no significa que esté terminado ni que haga lo
que debe: §5.1 y §5.2 siguen pendientes de revisar.

Aun así, vuelve a correr los seis comandos antes de tocar nada.

`pnpm` **solo** por `corepack pnpm@9.15.0`, nunca a secas.

---

## 7. Cómo se verifica en este proyecto

No se da nada por bueno con el código fuente ni con las pruebas verdes. Las trampas conocidas:

1. **`tauri build` NO reconstruye lo que empaqueta.** Toma `pos-ui/dist` y el binario del Hub
   tal como estén.
2. **Código muerto que el empaquetador elimina**: comprobar cadenas concretas con
   `grep -a "loQueSea" apps/pos-ui/dist/assets/*.js`.
3. **Compilar fuera de `Documents`** (`CARGO_TARGET_DIR=C:/motrest-build`): si no, Defender
   bloquea los objetos de Rust (`os error 32`).

El arnés que usé para probar contra el Hub real está en el scratchpad de la sesión
(`sonda.mjs` conduce Chrome por CDP y reporta el marcador inyectado, los chips del encabezado,
la consola y las tramas WebSocket; `emitir-licencia.mjs` firma una licencia como Central;
`saludo.mjs` habla el protocolo cifrado). Vale la pena rehacerlos: son ~60 líneas cada uno y
fueron lo único que encontró el bug de verdad.
