# MotRest para Android

Este APK contiene el **POS completo** de MotRest para una tablet del
restaurante. No está limitado a Cocina: después de iniciar sesión, el POS
aplica los permisos del usuario y muestra solo los módulos y acciones que le
corresponden.

El APK de `kds-android` se conserva aparte para una pantalla fija de cocina.

## Construir

```powershell
corepack pnpm@9.15.0 --filter pos-ui build
corepack pnpm@9.15.0 --filter @motrest/motrest-android apk
```

El resultado queda en:

```text
apps/motrest-android/android/app/build/outputs/apk/debug/app-debug.apk
```

Antes de conectarla al restaurante, la tablet debe emparejarse con el Hub del
local y confiar en su certificado, igual que cualquier otra terminal MotRest.
