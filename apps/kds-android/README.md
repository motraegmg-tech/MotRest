# MotRest Cocina — APK para la tablet de cocina

La pantalla de cocina **no es una aplicación aparte**: es el mismo POS abierto
en su módulo de cocina. Mantener dos aplicaciones significaría dos versiones del
tablero, dos veces los arreglos y dos oportunidades de que se desincronicen.

Lo que aporta el APK es lo que un navegador no da en una tablet de cocina:

- **Pantalla completa**, sin barra de direcciones ni gestos que saquen de la app
  con las manos llenas de harina.
- **La pantalla no se apaga** a media comanda.
- **Arranca sola** al encender la tablet.

## Construir

```bash
corepack pnpm@9.15.0 --filter pos-ui build     # el POS que va dentro
corepack pnpm@9.15.0 --filter @motrest/kds-android apk
```

El APK sale en `android/app/build/outputs/apk/debug/`.

Capacitor 8 requiere Java 21 y SDK 36. `JAVA_HOME` puede apuntar al que trae
Android Studio: `C:\Program Files\Android\Android Studio\jbr`. El script `apk`
sincroniza Capacitor y luego aplica `ajustar-android.mjs`: la carpeta `android/`
es generada y el script conserva ahí el mínimo 24, objetivo 36, Gradle 8.14.3 y
el manifiesto de modo cocina. Para sincronizar sin compilar:

```bash
corepack pnpm@9.15.0 --filter @motrest/kds-android sincronizar
```

## El certificado del Hub

La tablet habla con el Hub por la red, así que se topa con el mismo certificado
autofirmado que un navegador. Dos caminos:

1. **Instalar el certificado del Hub en la tablet**, una vez. Está en
   `datos/tls/hub.crt` del equipo donde corre el Hub. En Android:
   *Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado*.
2. Aceptar el aviso, como en el navegador.

El camino definitivo es **fijar el certificado en la app** (pinning), usando la
huella que el Hub ya publica en `/salud` y que el QR de emparejamiento puede
llevar. Está documentado en ADR-18 y es lo siguiente que toca.

## Modo kiosco

Para que la tablet no pueda salir de la aplicación, Android tiene *Anclaje de
pantalla* (Ajustes → Seguridad → Anclaje de pantalla). Para una instalación
seria conviene además un lanzador dedicado, que se decide con el restaurante
según su tablet.
