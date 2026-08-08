# Entrega para Rodizio

## Archivos

- `MotRest_1.0.3_x64-setup.exe`: actualizar o instalar en la computadora de
  caja de Rodizio.
- `MOTRAE Central_1.0.2_x64-setup.exe`: instalar únicamente en la computadora
  administrativa de MOTRAE, si todavía no tiene esta versión.

## Orden de instalación

1. En la computadora de MOTRAE, abre Central 1.0.2. En **Llaves**, configura
   una contraseña fuerte de soporte si no está configurada; no uses un PIN común
   ni lo guardes en el instalador.
2. En **Restaurantes**, da de alta Rodizio (o abre su ficha existente), usando
   exactamente el identificador que muestra su Hub. El campo **Responsable** crea
   a esa persona como **Propietario**.
3. Pulsa **Emitir licencia**. Central muestra el PIN inicial del responsable una
   sola vez: entrégalo por un canal privado y no lo copies a esta carpeta.
4. En la computadora de Rodizio, cierra MotRest y ejecuta
   `MotRest_1.0.3_x64-setup.exe` sobre la instalación existente. No desinstales
   MotRest ni borres sus datos.
5. Pega la licencia emitida en **Administración → Licencia**. El responsable
   entra con su PIN inicial y MotRest le obliga a cambiarlo al primer acceso.

La cuenta técnica **Gonzalo DJA** queda por encima del propietario, fuera de las
listas de personal y visible en la bitácora. Se accede desde **Acceso de soporte
MOTRAE** con la contraseña configurada en Central.

## Importante

Estos instaladores no están firmados con Authenticode porque no hay un
certificado de firma configurado en esta computadora. Comprueba las huellas
SHA-256 antes de ejecutarlos y firma una versión de distribución antes de
entregarla fuera de MOTRAE.
