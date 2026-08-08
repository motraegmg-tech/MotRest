# Entorno Android para compilar MotRest Cocina

Esta computadora ya tiene instalados Android Studio/JBR 21, Platform Tools,
Android SDK Platform 36 y Build Tools 36.0.0.

## Variables de usuario permanentes

En **Sistema → Información → Configuración avanzada del sistema → Variables de
entorno**, crea o actualiza estas variables de **usuario**:

| Variable | Valor |
|---|---|
| `JAVA_HOME` | `C:\Program Files\Android\Android Studio\jbr` |
| `ANDROID_SDK_ROOT` | `%LOCALAPPDATA%\Android\Sdk` |
| `ANDROID_HOME` | `%LOCALAPPDATA%\Android\Sdk` |
| `GRADLE_USER_HOME` | `%LOCALAPPDATA%\MotRest\gradle` |

Agrega al `Path` de usuario, sin borrar entradas existentes:

```text
%JAVA_HOME%\bin
%ANDROID_SDK_ROOT%\platform-tools
%ANDROID_SDK_ROOT%\cmdline-tools\latest\bin
```

Cierra y abre PowerShell antes de comprobarlo:

```powershell
java -version
adb version
sdkmanager --list
```

## Compilar un APK nuevo

Desde la raíz del repositorio:

```powershell
corepack pnpm@9.15.0 --filter pos-ui build
corepack pnpm@9.15.0 --filter @motrest/kds-android apk
```

El segundo comando prepara el POS para cocina, sincroniza Capacitor, aplica los
ajustes Android de la versión 8 y ejecuta Gradle. El resultado siempre se toma
de `apps/kds-android/android/app/build/outputs/apk/debug/app-debug.apk`.

Para actualizar el SDK en otra computadora, abre Android Studio → SDK Manager,
o ejecuta:

```powershell
sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

La aceptación de licencias de Android debe hacerla el titular de esa cuenta.
