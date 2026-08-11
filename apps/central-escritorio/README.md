# MotRest Central para Windows

El panel de MOTRAE como aplicación de escritorio: cartera de restaurantes,
licencias, salud de cada instalación y publicación de versiones.

> **Esta app NO se instala en ningún restaurante.** Guarda las **llaves privadas
> Ed25519** con las que se firman las licencias y las actualizaciones de todos
> los locales. Quien las tenga puede emitir licencias gratis y publicar una
> actualización que los Hubs aceptarían como legítima.

## Por qué es una app y no una pestaña

1. **Necesita `crypto.subtle`.** Aquí se firman licencias y manifiestos, y se
   derivan hashes PBKDF2. El motor criptográfico del navegador solo existe en
   contextos seguros.

2. **Las privadas tienen su propio almacén DPAPI.** Tauri pide a Windows que las
   cifre antes de escribirlas en `%LOCALAPPDATA%`; copiar el blob a otra cuenta
   no permite abrirlo. No se usan `localStorage` ni las credenciales del
   navegador. Esa es la razón de peso.

## Preparar un instalador de MotRest

En **Llaves**, genera los dos pares y copia únicamente sus públicas. Antes de
empaquetar el Hub, pásalas como variables de entorno de la máquina de build:

```powershell
$env:MOTREST_LICENCIA_PUBLICA = "<Central → Llave pública de licencias>"
$env:MOTREST_ACTUALIZACIONES_PUBLICA = "<Central → Llave pública de publicación>"
corepack pnpm@9.15.0 --filter @motrest/hub empaquetar
```

El empaquetador valida que ambas sean SPKI Ed25519 y las incrusta en el
ejecutable. Ninguna llave privada viaja al restaurante.

## Lo que esta app no hace

No arranca procesos, no abre puertos y no habla con la red de ningún local. Es
un panel de lectura y firma. Por eso, a diferencia de la caja, **no lleva
`tauri-plugin-shell`** ni ninguna capacidad remota: la aplicación que guarda las
llaves de todos los restaurantes se queda con el mínimo de permisos.

## Construir el instalador

```bash
corepack pnpm@9.15.0 --filter @motrest/central build       # el panel
corepack pnpm@9.15.0 --filter @motrest/central-escritorio build
```

Sale en `src-tauri/target/release/bundle/nsis/MotRest Central_1.0.0_x64-setup.exe`.

### En Windows, compila fuera de `Documents`

```bash
CARGO_TARGET_DIR=C:\motrest-build
```

Defender en tiempo real bloquea los archivos objeto mientras Rust los escribe y
la compilación falla con `os error 32`.

## El icono

Es **deliberadamente distinto** del de MotRest: un anillo con el degradado de
energía y tres puntos alrededor. No es estética — vas a tener las dos apps
ancladas en la misma barra de tareas, y confundirlas significa abrir el panel
que guarda las llaves creyendo que es un punto de venta.

Se regenera con `corepack pnpm@9.15.0 --filter @motrest/central-escritorio icono`.

## Copia de seguridad

**Las privadas no salen en el respaldo de la cartera** (a propósito: ese archivo
se manda por correo sin pensarlo). En **Llaves** se puede descargar un respaldo
DPAPI separado: sigue cifrado y solo se restaura bajo el mismo perfil de Windows.
Guárdalo fuera de la computadora.

Si se pierden: hay que generar pares nuevos, compilar un Hub con sus públicas y
**reemitir las licencias de todos los locales antes de actualizarles el Hub**.
