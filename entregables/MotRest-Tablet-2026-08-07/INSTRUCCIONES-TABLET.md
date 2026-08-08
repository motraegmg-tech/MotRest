# MotRest Cocina — entrega para tablet

## Contenido de esta carpeta

- `MotRest-Cocina-1.0-debug.apk`: APK compilado el 7 de agosto de 2026 desde el
  código actual, con Capacitor 8, `targetSdkVersion 36` y mínimo Android 7
  (API 24).
- `SHA256.txt`: huella para comprobar que el archivo no cambió al transferirlo.
- `PONER-AQUI-CERTIFICADO-HUB.txt`: explica el único archivo que se obtiene del
  equipo donde corre el Hub, no de MOTRAE Central.

> Este APK está firmado con la llave de **depuración de Android**. Sirve para la
> validación en la tablet; no es un APK de distribución comercial definitivo.

## Instalarlo por USB

1. En la tablet activa **Opciones de desarrollador → Depuración USB**.
2. Conéctala por cable y acepta la huella RSA que muestra Android.
3. Desde una consola de esta computadora:

   ```powershell
   adb devices
   adb install -r .\MotRest-Cocina-1.0-debug.apk
   ```

   Debe aparecer una línea con el número de serie y el estado `device` antes de
   instalar. Si aparece `unauthorized`, desbloquea la tablet y acepta el aviso.

## Instalarlo sin cable

1. Copia el APK a `Downloads` de la tablet mediante cable en modo transferencia
   de archivos, Drive o una memoria USB-C.
2. En Android permite temporalmente *Instalar apps desconocidas* para la app
   desde la que abrirás el archivo (por ejemplo, Archivos).
3. Abre `MotRest-Cocina-1.0-debug.apk` e instala.
4. Desactiva de nuevo el permiso de instalar apps desconocidas cuando termines.

## Conectarla al Hub del restaurante

1. Instala y abre primero MotRest en la computadora de caja; el primer arranque
   crea el certificado TLS del Hub y muestra el QR en **Administración → Hub**.
2. Conecta tablet y caja a la misma red local.
3. Escanea el QR una vez desde la tablet. La primera terminal queda autorizada;
   las siguientes deben ser aprobadas por una terminal ya autorizada.
4. Copia desde la caja `datos/tls/hub.crt` a esta carpeta y sigue
   `PONER-AQUI-CERTIFICADO-HUB.txt` si Android muestra un aviso de certificado.

Nunca copies a la tablet llaves de MOTRAE Central, licencias privadas, archivos
DPAPI ni credenciales de publicación.

## Prueba física obligatoria

Marca cada punto en la tablet real antes de llevarla a Rodizio:

- [ ] La app abre directamente el tablero de cocina y permanece horizontal.
- [ ] El táctil, navegación, tickets y cambios de estado funcionan.
- [ ] La conexión HTTPS al Hub y el certificado funcionan en la red del local.
- [ ] Conectar teclado o cambiar tamaño de pantalla no recarga el WebView.
- [ ] La pantalla permanece encendida durante una comanda.
- [ ] Tras reiniciar la tablet, la app vuelve a estar disponible y conserva el
      comportamiento esperado.
- [ ] Se activa **Anclaje de pantalla** de Android para operación de cocina.

La compilación y las verificaciones automatizadas pasaron; esta prueba física es
el cierre pendiente de la etapa 12.
