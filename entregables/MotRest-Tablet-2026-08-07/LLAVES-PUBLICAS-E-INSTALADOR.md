# Las dos llaves públicas y el instalador de MotRest

## Qué es cada llave

| Variable | Se copia desde MOTRAE Central | Sirve para |
|---|---|---|
| `MOTREST_LICENCIA_PUBLICA` | Llave pública de licencias | Verificar las licencias de los locales. |
| `MOTREST_ACTUALIZACIONES_PUBLICA` | Llave pública de publicación | Verificar manifiestos y actualizaciones. |

Son dos llaves **distintas**. Las privadas se quedan en MOTRAE Central,
protegidas por Windows DPAPI: nunca se pegan en PowerShell, nunca se agregan al
repositorio, nunca viajan en el instalador y nunca se copian a una tablet.

## Obtenerlas correctamente

1. Abre **MOTRAE Central** con el perfil Windows de MOTRAE que administra las
   llaves.
2. Ve a **Llaves**.
3. Si ya aparecen ambos pares Ed25519, pulsa **Copiar** junto a la pública de
   licencias y la pública de publicación. No pulses *Regenerar pares*.
4. Si es una Central nueva sin pares ni licencias emitidas, pulsa **Generar los
   dos pares** una sola vez y guarda el respaldo DPAPI cifrado fuera de la
   computadora.
5. Si Central indica migración desde HMAC o ya hay restaurantes con licencia,
   generar o regenerar pares invalida las licencias anteriores. La secuencia es:
   generar y respaldar pares → compilar el Hub con las públicas nuevas →
   reemitir y entregar la licencia Ed25519 de cada local → confirmar el
   `sucursal_id` → actualizar el Hub. Nunca lo hagas al revés.

## Usarlas solo durante la compilación

Abre PowerShell en la raíz del repositorio y pega las dos públicas completas,
sin modificar sus caracteres Base64:

```powershell
$env:MOTREST_LICENCIA_PUBLICA = '<Central: llave pública de licencias>'
$env:MOTREST_ACTUALIZACIONES_PUBLICA = '<Central: llave pública de publicación>'
$env:CARGO_TARGET_DIR = 'C:\tmp\motrest-build'

corepack pnpm@9.15.0 --filter @motrest/escritorio build
```

El empaquetador valida que ambas sean llaves públicas Ed25519 SPKI válidas y
las incrusta en el Hub. Si una está mal copiada, aborta: no la sustituyas por
otra ni uses una llave de prueba.

Al terminar, elimina las variables de la sesión:

```powershell
Remove-Item Env:\MOTREST_LICENCIA_PUBLICA
Remove-Item Env:\MOTREST_ACTUALIZACIONES_PUBLICA
```

No uses `setx` ni las guardes en `.env`, un archivo, el repositorio o la
configuración permanente de Windows. Aunque sean públicas, dejarlas fuera de
los registros y de la configuración reduce errores de mezcla entre ambientes.

## Firma de producción: requisito adicional

Las públicas permiten compilar y verificar licencias/actualizaciones; no firman
el ejecutable de Windows. Para distribuir a Rodizio se necesita además el
certificado Authenticode de MOTRAE:

```powershell
$env:MOTREST_FIRMA_HUELLA = '<huella SHA-1 del certificado conectado>'
```

Esa variable hace que `empaquetar.mjs` firme el sidecar del Hub después de
inyectarlo. El instalador NSIS también debe firmarse con `signtool` y sello de
tiempo, o configurar la misma huella como `windows.certificateThumbprint` en
`apps/escritorio/src-tauri/tauri.conf.json` antes de compilar. Sin certificado
se puede hacer una prueba interna, pero no una entrega de producción.
