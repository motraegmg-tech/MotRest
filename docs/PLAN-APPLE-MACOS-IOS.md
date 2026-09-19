# Plan — MotRest en los equipos de Apple (macOS e iOS)

**Estado:** propuesta · **Fecha:** 2026-09-08 · **Decidido por:** Gonzalo (MOTRAE)

## Contexto

MotRest corre hoy en producción, todos los días, en Rodizio. Pero corre en
**Windows**: la caja es un instalador NSIS, el Hub es una copia de `node.exe`
con el código dentro, la impresión USB entra por `winspool.drv` y el arranque
automático se registra en `HKCU\...\Run`. Las tablets son Android.

Eso deja fuera un mercado entero. Un restaurante que ya trabaja con Mac —y en
gastronomía son muchos, sobre todo en administración— hoy no puede comprar
MotRest sin comprar además una PC. Y el PRD lo prometía desde el primer día:

> **R1** — «Instaladores nativos para Windows (caja), Android (tablets, KDS,
> kiosco) e **iOS (iPad/iPhone)**; una sola base de código.»
> — `Documentos_de_Primer_Orden/MOTRAE_MotRest_PRD.md:88`

El TRD llega a poner la tabla de actualización por plataforma (§11) y a elegir
Capacitor para iOS (§8). Nunca se implementó: **no existe un solo archivo de
Xcode en el repositorio**, y `docs/REMEDIACION-SEGURIDAD.md:602` lo dice con
todas sus letras — la herramienta de iOS «aquí no se ejecuta jamás».

Este plan cierra esa brecha. Al terminarlo, un restaurante puede operar con una
Mac como caja completa y con iPads como comanderos, enlazados al mismo Hub y al
mismo canal de actualizaciones firmado por MOTRAE.

## Lo que se decide

| Equipo | Papel | Artefacto | Canal |
|---|---|---|---|
| **Mac** (iMac, MacBook, Mac mini) | **La caja completa**: Hub + POS, igual que la PC de hoy | `.app` dentro de un `.dmg` firmado y notarizado | Manifiesto Ed25519 propio (el mismo de hoy) |
| **iPad / iPhone** | **Terminal**: comandero, POS móvil, panel del dueño | App Capacitor | **TestFlight** |
| PC Windows | Sin cambios | NSIS | Sin cambios |

La Mac es caja completa —decisión de Gonzalo— porque «que se pueda conectar con
Central» solo tiene sentido si la Mac **es** una instalación: Central habla con
Hubs, no con terminales. El iPad no puede ser caja, y no es una limitación
nuestra: **iOS no tiene Node**, así que no hay Hub, ni `node:sqlite`, ni un
servidor que escuche en el 8787. Un iPad es una terminal, como lo es hoy una
tablet Android.

## Lo que ya viaja sin tocar una línea

Esto no es un puerto desde cero. La arquitectura ya separó lo portable de lo que
no lo es, y la mayor parte del producto es lo primero:

- **Todo `packages/`** — `dominio` (event sourcing, costeo, firmas Ed25519,
  manifiestos), `protocolo-sync`, `ui`, y `impresion`, que genera los bytes
  ESC/POS y declara por escrito que **el transporte vive fuera porque depende de
  la plataforma**. Esa decisión, tomada hace meses, es la que abarata esto.
- **`apps/pos-ui` y `apps/portal`** — Svelte 5 compilado. El mismo `dist` que ya
  sirve al Windows, al navegador y a los dos APK.
- **`node:sqlite`** — parte de Node, sin `node-gyp` ni módulos nativos. No hay
  nada que recompilar. **Cero dependencias nativas de npm en todo el árbol.**
- **El transporte de red 9100** (`transporte-red.ts`) — `node:net` puro.
- **TLS autofirmado, el protocolo de sync por `ws`, el enlace con Supabase y la
  verificación de manifiestos.** Agnósticos de sistema operativo.
- **Los iconos.** `apps/escritorio/src-tauri/icons/` **ya contiene `icon.icns` y
  las carpetas `ios/` y `android/`**: los generó `tauri icon` en su día.

## Lo que hay que construir

Seis frentes. La superficie atada a Windows es sorprendentemente pequeña y está
concentrada: **seis archivos del Hub, más el empaquetador.**

### 1 · El Hub aprende a vivir en macOS

| Archivo | Qué pasa hoy | Qué hay que hacer |
|---|---|---|
| `apps/hub/src/main.ts:161` | `carpetaDeDatos()` cae a `$HOME/MotRest/…` | En darwin, `~/Library/Application Support/MotRest/datos/` |
| `apps/hub/src/main.ts:444,451` | POS y portal en `dirname(process.execPath)/pos` | **Ver la trampa del bundle, abajo** |
| `apps/hub/src/main.ts:2591` | Relanza `MotRest.exe` vecino | En darwin, el `.app` tres niveles arriba |
| `apps/hub/src/permisos.ts:52` | `icacls`; fuera de win32 devuelve ok sin hacer nada | Aplicar `chmod 0o700` real a la carpeta de datos |
| `apps/hub/src/descubrimiento.ts` | mDNS artesanal en el 5353 | **No usarlo en macOS — ver abajo** |
| `apps/hub/src/autoarranque.ts` | `HKCU\Run` + `.vbs` + `wscript` | LaunchAgent |

**La trampa del bundle `.app`.** En Windows, el sidecar y los recursos quedan
juntos, y por eso `join(dirname(process.execPath), "pos")` funciona. En macOS
**no**: Tauri pone el ejecutable en `MotRest.app/Contents/MacOS/` y los recursos
en `MotRest.app/Contents/Resources/`. Esa ruta apuntaría a una carpeta que no
existe y el Hub arrancaría sin POS que servir.

La solución ya está escrita en el código: `RUTA_POS` y `RUTA_PORTAL` **ya
respetan `MOTREST_POS_DIST` y `MOTREST_PORTAL_DIST`**. Basta con que el proceso
Tauri se las pase al lanzar el sidecar (`tauri_plugin_shell` lo permite con
`.env()`). No hay que inventar nada ni ramificar por plataforma dentro del Hub.

**El descubrimiento en macOS mejora quitando código.** El responder mDNS de
`descubrimiento.ts` está escrito a mano y se ata al puerto 5353. En macOS ese
puerto es de `mDNSResponder`, que además es la autoridad de `.local`: nuestro
responder chocaría con el del sistema. Pero **macOS ya le da a cada equipo un
nombre Bonjour propio** (`scutil --get LocalHostName` → `caja-rodizio.local`), y
lo resuelve el sistema, sin código nuestro. Así que en darwin el Hub no anuncia
nada: lee el nombre del sistema y lo pone en los enlaces de emparejamiento.

Y hay un premio: **iOS sí resuelve `.local` de fábrica**, a diferencia de
Android — que es la razón documentada en `main.ts:651` de que hoy el QR ofrezca
la IP primero. Un iPad emparejado con una caja Mac sobrevive a un cambio de
DHCP sin que nadie toque nada.

### 2 · Impresión por CUPS

El frente más pesado. `transporte-usb.ts` son 22 KB de PowerShell incrustado con
`P/Invoke` a `winspool.drv`, y `transporte-bluetooth.ts` abre un puerto COM.
Ninguno de los dos existe en macOS.

La buena noticia es que la interfaz pública es diminuta —cinco funciones— y el
resto del sistema ya habla contra ella:

```
esDispositivoValido()  ·  enviarAUsb()  ·  impresorasDelSistema()
puertosSinCola()       ·  instalarImpresoraEnPuerto()
```

Se crea `apps/hub/src/impresion/transporte-cups.ts` con esas mismas cinco, sobre
las herramientas de CUPS que macOS ya trae:

| Función | Windows hoy | macOS |
|---|---|---|
| Listar impresoras | `Get-Printer` | `lpstat -l -p` + `lpstat -v` |
| Enviar ESC/POS | `WritePrinter` (winspool) | `lp -d <cola> -o raw` por stdin |
| Detectar USB sin cola | Puertos del spooler | `system_profiler SPUSBDataType -json` |
| Dar de alta la cola | `Add-Printer` | `lpadmin -p <cola> -E -v usb://… -m raw` |

Un `transporte-local.ts` elige implementación por `process.platform`, para que
`buscador.ts` y los llamantes no se llenen de ramas.

Bluetooth en macOS: el dispositivo emparejado aparece como `/dev/cu.<nombre>` y
se le puede escribir directo. Es menos prioritario —el caso real de la MP210 en
Rodizio es Windows— y se marca como *mejor esfuerzo*.

### 3 · El empaquetado de la caja

**`apps/hub/empaquetar.mjs:33`** tiene `const SUFIJO = "x86_64-pc-windows-msvc"`
a fuego. Pasa a derivarse de `process.platform`/`process.arch`:
`aarch64-apple-darwin` en Apple Silicon. **Se conserva intacta la comprobación
de `.nvmrc`**: sigue siendo cierto —y ahora en dos plataformas— que el binario
del Hub es una copia literal del Node que empaquetó.

El bloque de `signtool` gana su hermano de macOS: `codesign` + `notarytool` +
`stapler`.

**`apps/escritorio/src-tauri/tauri.conf.json`** pasa de `"targets": ["nsis"]` a
targets por plataforma, y gana una sección `macOS` con `minimumSystemVersion`,
la identidad de firma, el archivo de *entitlements* y las claves de `Info.plist`
que macOS 15 exige (`NSLocalNetworkUsageDescription`).

Se compila **solo `aarch64`** (Apple Silicon). Todo Mac vendido desde noviembre
de 2020 lo es; un binario universal duplicaría el peso de un artefacto que ya
pesa ~91 MB por llevar Node dentro.

### 4 · El canal de actualizaciones aprende plataformas

Hoy el manifiesto es plano y describe un solo archivo: un `.exe`. Un Hub en Mac
que lo lea se bajaría un instalador de Windows.

Lo importante es que **esto se puede cambiar sin romper a Rodizio ni a ningún
local ya instalado**, y está comprobado en el código:

- `esManifiesto()` (`apps/hub/src/actualizaciones.ts:129`) valida que los campos
  obligatorios estén y sean del tipo correcto — **no rechaza campos
  desconocidos**. Un Hub 1.4.1 acepta sin problema un manifiesto con campos
  nuevos.
- `contenidoFirmableDe()` (`packages/dominio/src/comun/firma.ts:203`)
  canonicaliza **recursivamente y ordenando claves**. Un objeto anidado nuevo
  queda firmado solo, sin tocar el firmador de Central.

Así que el manifiesto gana un campo opcional, y los campos planos siguen
significando *el artefacto de Windows*:

```json
{
  "version": "1.5.0",
  "url": "…/MotRest_1.5.0_x64-setup.exe",
  "sha256": "…",
  "artefactos": {
    "windows-x64": { "url": "…/MotRest_1.5.0_x64-setup.exe", "sha256": "…" },
    "macos-arm64": { "url": "…/MotRest_1.5.0_aarch64.tar.gz", "sha256": "…" }
  },
  "firma": "…"
}
```

Un Hub viejo lee `url`/`sha256` y sigue su vida. Un Hub nuevo prefiere la
entrada de su plataforma. **Las tres verificaciones de SHA-256, el anillo
canario, la memoria anti-reversión y la lista blanca de hosts no cambian.**

**Cómo se instala en macOS.** No hay `/S` de NSIS ni `relevo.cmd`. El artefacto
que baja el Hub es un `.tar.gz` del `.app` (el `.dmg` queda en el release para
quien instala a mano la primera vez), y el relevo es un guion de shell que
espera a que MotRest cierre, sustituye el bundle con `ditto` y reabre con
`open -a`. Es lo mismo que hace el actualizador de Tauri, pero **la autoridad
sigue siendo nuestra firma Ed25519, no Apple ni GitHub** — que es el principio
que gobierna `actualizaciones.ts` y no se toca.

### 5 · El iPad como terminal

`apps/motrest-ios/`, copia fiel de `apps/motrest-android/`: un `preparar.mjs`
que copia `apps/pos-ui/dist` a `www` y corre `cap add ios`, un `ajustar-ios.mjs`
que sincroniza la versión, y `Info.plist` con
`NSLocalNetworkUsageDescription`, `NSBonjourServices` y
`NSCameraUsageDescription` — la cámara hace falta para leer el QR de
emparejamiento.

**El obstáculo real es el certificado.** El Hub se sirve con un certificado
autofirmado, y `WKWebView` en iOS lo rechaza sin la escapatoria que Android sí
tiene (`network_security_config`). ADR-18 ya había previsto esto y ya había
elegido el destino correcto:

> «**Fijar el certificado en la app (pinning).** El QR de emparejamiento ya
> podría llevar la huella del certificado del Hub… **Se elige (1) como destino y
> se documenta (3) como estado actual.**»

Y **el dato ya existe**: `apps/hub/src/certificado.ts` calcula y persiste la
huella SHA-256, y `main.ts:1552` ya la expone. Solo hay que meterla en el QR y
enseñar al lado nativo a exigir exactamente ese certificado.

Se hace en dos tiempos, para que Rodizio pueda probar un iPad en semanas y no en
meses:

1. **Interino** — el Hub sirve su certificado y el iPad lo instala como perfil
   de configuración. Son dos pasos por dispositivo (instalar el perfil y
   activarlo en *Ajustes → General → Información → Ajustes de confianza*). Feo,
   pero funciona y no enseña a nadie a ignorar advertencias rojas.
2. **Destino** — un plugin Capacitor en Swift que valida el TLS contra la huella
   del QR. **Esto cierra ADR-18 y arregla también las tablets Android**, que
   llevan desde julio aceptando la advertencia a mano.

Imprimir desde el iPad no requiere trabajo: la impresión está centralizada en el
Hub por ADR-08.

### 6 · Central en macOS

`apps/central-escritorio/src-tauri/src/lib.rs` protege las llaves privadas de
firma de **toda la cartera** con **DPAPI**, que es una API de Windows. En macOS
el equivalente es el **Keychain** (`security-framework`, ítem de contraseña
genérica con `kSecAttrAccessibleWhenUnlocked`).

Se refactoriza en `secretos_windows.rs` / `secretos_macos.rs` tras una interfaz
común. Pero hay un detalle que no es cosmético: **`respaldo_de_secretos`
devuelve hoy el blob DPAPI**, que solo se abre en el mismo perfil de Windows. Un
ítem del Keychain no es un blob portátil. Así que hace falta un **respaldo
cifrado con contraseña** (PBKDF2 + AES-GCM) que funcione en los dos sistemas —
y eso, además de arreglar el respaldo, es **la única vía para mover las llaves
de firma de Gonzalo de la PC a la Mac**.

Central **no está en el camino crítico**: Gonzalo puede seguir firmando y
publicando desde la Central de Windows aunque el `.dmg` se haya compilado en la
Mac. Por eso va al final.

## Requisitos previos, y son bloqueantes

1. **Apple Developer Program — 99 USD/año.** No es opcional y no hay atajo. Sin
   él no hay Developer ID con el que firmar, no hay notarización (y sin
   notarizar, Gatekeeper bloquea el `.dmg` en cualquier Mac que no sea la
   nuestra) y no hay TestFlight. Es el primer trámite y tarda de horas a días en
   activarse. **Gonzalo aún no lo tiene: hay que contratarlo antes de empezar.**
2. **Una Mac.** Confirmada. Es obligatoria y no por comodidad: **Tauri no puede
   compilar para macOS desde Windows**, el binario SEA es una copia del Node de
   la máquina que empaqueta, y `notarytool` solo existe en macOS. Al principio
   se compila a mano en la Mac, exactamente como hoy se compila a mano el
   instalador de Windows.
3. **Un iPad o iPhone.** Confirmado, para el ensayo real.
4. Xcode y las *Command Line Tools* en la Mac; Node **24.16.0** exacto
   (`.nvmrc`), porque `empaquetar.mjs` aborta si no coincide.

## Las etapas

Cada una cierra con su criterio verificable, siguiendo el ritual de siempre: no
se da por buena una etapa hasta comprobarla **sobre la app instalada**, nunca en
desarrollo.

| # | Etapa | Cierra cuando… |
|---|---|---|
| **A1** | Trámites Apple: programa, certificados Developer ID, identificadores | `codesign` firma un binario de prueba y `notarytool` lo acepta |
| **A2** | El Hub arranca en macOS desde el código: rutas, permisos, nombre `.local` del sistema | El Hub en la Mac sirve el POS y una tablet se empareja contra él |
| **A3** | Impresión por CUPS | Una comanda sale por una térmica USB conectada a la Mac |
| **A4** | La caja empaquetada: SEA arm64 + `.app` + `.dmg` firmado y notarizado | El `.dmg` se instala en una Mac **limpia** sin advertencias y la caja vende |
| **A5** | Arranque automático (LaunchAgent) | Se reinicia la Mac y el Hub está arriba sin que nadie lo abra |
| **A6** | El manifiesto aprende plataformas | Una Mac se actualiza sola **y Rodizio, en Windows, sigue actualizándose igual** |
| **A7** | iPad como terminal, TestFlight, certificado por perfil | Un mesero comanda desde un iPad contra la caja Mac, y contra una caja Windows |
| **A8** | *Pinning* del certificado en el QR — **cierra ADR-18** | El iPad empareja sin ver una sola advertencia; la tablet Android tampoco |
| **A9** | Central en macOS: Keychain + respaldo con contraseña | Gonzalo firma una licencia desde la Mac con sus llaves migradas |
| **A10** | Ensayo real | Un servicio de viernes completo en Rodizio con la caja Mac y un iPad |

## Las trampas que van a doler

Escritas antes de tropezarlas, porque todas cuestan un día si sorprenden:

1. **El runtime endurecido mata al Hub.** Un ejecutable SEA es Node, y Node lleva
   V8, y V8 compila código en memoria. Bajo *hardened runtime* —obligatorio para
   notarizar— eso se prohíbe salvo con permisos explícitos:
   `com.apple.security.cs.allow-jit` y
   `com.apple.security.cs.allow-unsigned-executable-memory`. Sin ellos el
   instalador se firma, se notariza, se instala precioso… y el Hub muere al
   arrancar.
2. **Hay que firmar el sidecar aparte.** Es la misma lección que ya está
   aprendida y comentada en `empaquetar.mjs`: la firma del instalador acredita al
   instalador, pero quien se ejecuta cada mañana en la caja es el Hub. En macOS
   además es requisito técnico: la notarización revisa **todo** ejecutable dentro
   del bundle.
3. **El permiso de red local (macOS 15+).** La primera vez que el Hub hable con
   la LAN, macOS pregunta. Si alguien dice que no, las tablets dejan de ver la
   caja **y el fallo es mudo**. Hay que detectarlo y explicarlo en pantalla, no
   dejar que parezca un problema de red.
4. **TestFlight caduca a los 90 días.** Cada build. Es una tarea de calendario de
   soporte, no un detalle técnico: un iPad que deja de abrir la app un martes
   cualquiera es una llamada de un restaurante.
5. **`lpadmin` puede pedir permisos.** Dar de alta una cola de impresión exige
   pertenecer a `_lpadmin`. El usuario administrador de la Mac lo cumple, pero
   conviene comprobarlo y decirlo claro si no.
6. **La cola tiene que ser cruda (`raw`).** Si la impresora se dio de alta con un
   driver, CUPS podría reinterpretar los bytes ESC/POS y salir un churro.

## Cómo se verifica

- **Automático:** `pnpm -r test` y `pnpm -r lint` en la Mac; `cargo audit` en los
  dos `src-tauri`. Los tests de `autoarranque.test.ts` afirman hoy que el comando
  no contiene `powershell|cmd.exe` — hay que añadir sus equivalentes de macOS,
  no relajarlos.
- **De compatibilidad, y es el más importante:** antes de publicar el primer
  manifiesto con `artefactos`, un Hub **1.4.1 real** —el que tiene Rodizio— tiene
  que leerlo, verificar la firma y actualizarse a su `.exe` como si nada hubiera
  cambiado. Se prueba contra el Hub instalado, no contra el código.
- **Sobre la app instalada:** las tres trampas del empaquetado se comprueban en
  una Mac limpia, no en la de desarrollo, que tiene Xcode y Node y por eso miente.
- **En sitio:** el ensayo del viernes en Rodizio, con la caja Mac sirviendo a un
  iPad y a una tablet Android a la vez.

## Qué documentos salen de aquí

- **ADR-29 — MotRest en los equipos de Apple.** El reparto de papeles (Mac =
  caja, iPad = terminal), y por qué iOS no puede ser caja.
- **ADR-30 — El manifiesto multiplataforma.** Por qué se extiende en vez de
  versionarse, y por qué eso no rompe a los locales instalados.
- **Actualización de ADR-18**, que queda cerrado en la etapa A8.
- `docs/INSTALAR-EN-UN-RESTAURANTE.md` y `docs/PUBLICAR-UNA-ACTUALIZACION.md`
  ganan su carril de macOS.
- El **TRD §8 y §11** pasan a describir lo que existe: hoy prometen Capacitor 6 y
  PowerSync, y el código real usa Capacitor 8 y enlace directo a Supabase.
