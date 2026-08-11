# Relevo — impresión USB, pre-cuenta y propina

**Fecha:** 2026-08-08 · **Rama:** `feature/impresion-usb` · **Estado:** funcionando en la caja de Gonzalo, con dos pendientes.

Documento para que otra persona (o agente) continúe sin volver a diagnosticar.
Lo que sigue es lo que **no** se deduce leyendo el código.

---

## 1. El problema original

Gonzalo no podía imprimir tickets. La causa no era configuración:

- Su impresora es una **BIXOLON SRP-350plus por USB**, y MotRest solo tenía
  transporte de **red** (socket al 9100).
- Una impresora que no fuera de red caía en `TransporteSimulado`, cuyo `puede()`
  acepta cualquier impresora y cuyo `enviar()` devolvía `{ ok: true }`.
- Resultado: **el POS marcaba las comandas como «impreso» sin que saliera papel
  y sin ningún error.** Ese era el verdadero defecto — un fallo silencioso.

Además, las impresoras precargadas apuntan a `192.168.1.60/61/62` (demostración)
y la red real es `192.168.100.x`.

---

## 2. Qué se hizo (3 commits en `feature/impresion-usb`)

| Commit | Qué trae |
|---|---|
| `3f4d009` | Transporte USB en el Hub + fin del fallo silencioso + herramientas |
| `b2d3336` | Pre-cuenta con IVA dentro de cada renglón |
| `f63523e` | Propina al cobrar, con cantidad libre, y arreglo del ajuste a la baja |

### 2.1 Transporte USB (`apps/hub/src/impresion/transporte-usb.ts`)

Entrega los bytes ESC/POS al **spooler de Windows en modo RAW** vía
`winspool.drv`, con un PowerShell de un solo uso incrustado en el binario.

Decisiones que no hay que revisitar:

- **RAW** es lo que impide que el controlador interprete los datos. Por eso da
  igual qué driver esté instalado — no hace falta el del fabricante.
- **No** se habla USB directo: exigiría reemplazar el controlador por WinUSB y
  la impresora dejaría de serlo para el resto de Windows.
- **Un proceso por trabajo** (~440 ms medidos), no un helper persistente:
  imprimir no bloquea la venta, y un proceso permanente es una pieza más que se
  puede colgar un viernes.
- El nombre de impresora viaja por **variable de entorno** y los bytes por
  **stdin**: nada se interpola en el guion (hay test de inyección) y un ticket de
  40 KB no choca con el límite de la línea de comandos.
- `/imprimir` acepta `modo: "usb"`; **sin `modo` sigue siendo red**, para que una
  terminal a medio actualizar no se quede muda.

### 2.2 Fin del fallo silencioso

`ResultadoEnvio` y `TrabajoImpresion` llevan `simulado`, la cola lo propaga y la
pantalla muestra **«sin papel»** en naranja en vez de «impreso» en verde.

### 2.3 Pre-cuenta (`precuenta()` en `packages/impresion/src/plantillas.ts`)

Botón **«Imprimir cuenta»** en el panel de cuenta, antes de Cobrar.

**Lo crítico:** imprime cada renglón **con el IVA dentro**. En la carta de
Rodizio el precio NO incluye IVA (perfil `IVA_16`, `incluido_en_precio: false`),
así que el ticket muestra 289 + 330 + 135 = 754 y el total dice 874.64 — un papel
inservible en la mano del comensal.

Las rebajas se derivan **por diferencia** (`suma − total`), nunca se recalculan:
los totales descuentan sobre la base y aplican impuesto después, así que la
rebaja arrastra su parte de IVA. Derivarla es lo único que hace cuadrar el papel
al centavo. Hay pruebas en `packages/dominio/src/__tests__/cuenta.test.ts` que
fijan esa correspondencia.

Va sin RFC y marcada «NO ES COMPROBANTE DE PAGO». No emite evento.

### 2.4 Propina

Bloque de propina en el **panel de cobro** (antes solo estaba en la vista de
cuenta, y solo con 10/15/20 %): porcentajes + **campo de cantidad libre**.

**Fallo que existía y se arregló:** el evento `propina_registrada` es un
**INCREMENTO** (`sumar(estado.propina, ev.monto)` en el reducer), y
`registrarPropina` descartaba todo `monto <= 0`. Por tanto «Quitar» y bajar de
20 % a 10 % **no hacían nada**: la pantalla seguía mostrando la propina vieja y
esa se cobraba. Ahora solo se rechaza el ajuste que dejaría la propina negativa,
y `fijarPropina(monto)` traduce «déjale 100» al ajuste correspondiente.

---

## 3. Estado de la máquina de Gonzalo

- **Impresora instalada**: `BIXOLON SRP-350plus`, puerto `USB002`, driver
  `Generic / Text Only`. Windows ya tenía el dispositivo y el puerto; solo
  faltaba la cola de impresión.
- **POS parcheado en caliente** dos veces (bundle actual `index-DqJBsKD2.js`).
  Respaldos en `%LOCALAPPDATA%\MotRest\pos-respaldo-*`.
- **Hub nunca se detuvo** (PID 33600 durante toda la sesión). Rodizio estaba
  operando.

### El puente de impresión (parche temporal)

`herramientas/puente-impresion.mjs` escucha en **`127.0.0.1:9100`** y reenvía al
spooler USB. El Hub instalado **no tiene** el transporte USB todavía, pero su
lista blanca ya acepta el loopback como destino de impresión — así que imprime
por USB creyendo que habla con una impresora de red.

En MotRest la impresora **Caja** debe estar como: Red (9100), dirección
`127.0.0.1`, puerto `9100`, ancho 80 mm (42).

> **Este puente muere al cerrarse la sesión que lo lanzó.** Hay un lanzador
> preparado para la carpeta de Inicio (ver §4).

---

## 4. Pendientes

### 4.1 Arranque automático del puente (bloqueado por permisos)

El `.vbs` está escrito pero **no** se pudo copiar a la carpeta de Inicio (lo
bloqueó el clasificador de permisos). Gonzalo debe ejecutarlo él:

```powershell
Copy-Item "<scratchpad>\motrest-puente-impresion.vbs" `
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\"
```

El `.vbs` apunta a `herramientas/puente-impresion.mjs` **por ruta absoluta del
repositorio**. Si el repo se mueve, hay que corregirla.

### 4.2 Release del Hub — lo que de verdad cierra esto

El puente sobra en cuanto el Hub instalado lleve el transporte USB nativo.
Requiere:

1. Las llaves **públicas** de MotRest Central en el entorno:
   `MOTREST_LICENCIA_PUBLICA` y `MOTREST_ACTUALIZACIONES_PUBLICA`.
   No están en el repo (correcto). Ver `entregables/MotRest-Tablet-2026-08-07/LLAVES-PUBLICAS-E-INSTALADOR.md`.
2. **Node exactamente 24.16.0** (`.nvmrc`): el ejecutable del Hub es una copia
   del Node que corre el empaquetado.
3. `corepack pnpm@9.15.0 --filter @motrest/hub empaquetar`.
4. **Detener el Hub** para reemplazar el binario — tira terminales y
   sincronización, así que hay que hacerlo fuera de servicio.

Después: cambiar la impresora a conexión **USB** (aparecerá `BIXOLON
SRP-350plus` en el desplegable), apagar el puente y borrar el `.vbs`.

---

## 5. Cómo verificar sin adivinar

```bash
# ¿Windows ve la impresora? ¿sale papel?
node herramientas/probar-impresora.mjs
node herramientas/probar-impresora.mjs "BIXOLON SRP-350plus"

# El puente (deja la ventana abierta; registra cada trabajo)
node herramientas/puente-impresion.mjs "BIXOLON SRP-350plus"

# Suites
cd packages/dominio  && corepack pnpm@9.15.0 vitest run   # 1008
cd packages/impresion && corepack pnpm@9.15.0 vitest run  # 54
cd apps/hub          && corepack pnpm@9.15.0 vitest run   # 354
cd apps/pos-ui       && corepack pnpm@9.15.0 vitest run   # 115
cd apps/pos-ui       && corepack pnpm@9.15.0 lint         # svelte-check
```

Para probar el Hub sin tocar la instalación: levantarlo con `MOTREST_HUB_DB`
apuntando a una base temporal y `MOTREST_HUB_PUERTO=8887`. El `Origin` de las
peticiones a `/imprimir` debe coincidir con el `Host` o el candado anti-CSRF
responde 403 (no es un fallo, es la defensa funcionando).

---

## 6. Trampas conocidas

- **Nunca reemplazar el POS con `Copy-Item` borrando lo viejo**: la ventana
  abierta sigue pidiendo sus assets hasta que se recargue. Copiar **encima**.
- Si el arreglo toca el Hub o el dominio que el Hub ejecuta, el parche en
  caliente del POS **no basta**: hay release completo.
- En el árbol de Gonzalo hay **trabajo sin commitear sobre el menú**
  (`menu.ts`, `Menu.svelte`, `plano.svelte.ts`, `menu.test.ts`) y
  `docs/motrest.json`. Los builds en caliente se hicieron **desde el árbol
  actual** a propósito, para no quitarle lo que ya tenía desplegado. No
  commitear eso sin preguntarle.
- `packages/dominio/src/comun/ids.ts` (funciones `idCorto`/`idCortoLibre`) entró
  en el commit `3f4d009` porque `impresion.svelte.ts` ya dependía de él y sin eso
  el commit no compilaba.
- PowerShell escupe su barra de progreso como CLIXML por stderr; todos los
  guiones llevan `$ProgressPreference = 'SilentlyContinue'`.
