# MotRest 1.0.4 - Rodizio

Instalador para actualizar MotRest en la computadora de Rodizio.

## Qué corrige esta versión

- El Hub arranca en segundo plano, sin abrir PowerShell, CMD ni una ventana
  negra con registros.
- La configuración de arranque automático que ya existía se actualiza en el
  primer inicio de esta versión.
- Conserva los datos, la licencia y la configuración del restaurante.

## Instalación

1. Cierra MotRest si esta abierto.
2. Ejecuta `MotRest_1.0.4_x64-setup.exe`.
3. Abre MotRest normalmente al terminar. No pide permisos de administrador.

Si Windows muestra una advertencia de editor desconocido, es porque el
instalador aun no cuenta con firma Authenticode comercial. Comprueba el hash de
`SHA256SUMS.txt` antes de instalar.
