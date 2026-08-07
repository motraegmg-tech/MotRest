# MOTRAE Central para Windows

El panel de MOTRAE como aplicación de escritorio: cartera de restaurantes,
licencias, salud de cada instalación y publicación de versiones.

> **Esta app NO se instala en ningún restaurante.** Guarda los secretos con los
> que se firman las licencias y las actualizaciones de todos los locales. Quien
> los tenga puede emitir licencias gratis y publicar una actualización que se
> instala sola en cada MotRest de la calle.

## Por qué es una app y no una pestaña

1. **Necesita `crypto.subtle`.** Aquí se firman licencias y manifiestos, y se
   derivan hashes PBKDF2. El motor criptográfico del navegador solo existe en
   contextos seguros.

2. **Los secretos tienen su propio almacén.** En una pestaña compartirían
   espacio con toda la navegación normal: cualquier extensión instalada podría
   leerlos, y bastaría con "borrar datos de navegación" para perder las llaves
   con las que se firma todo. Esa es la razón de peso.

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

Sale en `src-tauri/target/release/bundle/nsis/MOTRAE Central_1.0.0_x64-setup.exe`.

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

**Los secretos no se respaldan solos y no salen en el respaldo de la cartera**
(a propósito: ese archivo se manda por correo sin pensarlo). Guárdalos en un
gestor de contraseñas el día que los generes.

Si se pierden: no se puede volver a firmar nada, hay que generar secretos nuevos
y **reemitir las licencias de todos los locales**.
