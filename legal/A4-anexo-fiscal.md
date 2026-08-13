# Anexo Fiscal — Certificado de Sello Digital, timbrado y deslinde

**Anexo del Contrato de Suscripción y Servicio · Versión 1.0 · 12 de agosto de 2026**

> **Nota interna — borrar antes de publicar.**
> Sustituir: `[NOMBRE COMPLETO]`, `[RFC]`.
> La cláusula 4 refleja el estado real descrito en [`docs/SEGURIDAD.md`](../docs/SEGURIDAD.md):
> CN-004 (contraseña junto a la llave) está **aceptado y mitigado con BitLocker**, y CN-033 (los
> `0o600` no restringían nada en Windows) está **resuelto con ACL de NTFS**. Si esa postura cambia,
> actualizar aquí también.
> **Verificar en cada instalación** que BitLocker quedó activo antes de cargar el CSD: el anexo lo
> declara como obligación y firmarlo sin haberlo hecho es incumplimiento propio.

---

## Por qué este anexo va aparte

Porque aquí MotRest toca lo más delicado que un restaurante puede confiarle a un software: **su
firma fiscal**. El Certificado de Sello Digital es lo que permite emitir comprobantes a nombre del
contribuyente ante el SAT. Quien tiene el CSD y su contraseña puede facturar como él.

Eso no se despacha en un párrafo dentro de un contrato general.

---

## 1. El CSD es y sigue siendo del Cliente

El Certificado de Sello Digital, el archivo de llave privada y su contraseña son **propiedad
exclusiva del Cliente**, quien los tramita ante el SAT a su nombre y bajo su responsabilidad.

MOTRAE **no** los tramita, **no** los renueva y **no** los conserva fuera del equipo del Cliente. La
carga del CSD en el sistema es un acto del Cliente.

## 2. Para qué se usa, y para qué no

**Se usa exclusivamente para sellar los comprobantes fiscales del propio Cliente**, emitidos por su
operación registrada en MotRest.

MOTRAE **no** usa el CSD para ningún otro fin, **no** lo copia a sus sistemas, **no** lo transmite a
terceros y **no** puede emitir comprobantes a nombre del Cliente fuera del flujo del software.

## 3. Cómo funciona el timbrado, y por qué así

Una factura mexicana necesita dos firmas: el **sello** del contribuyente, con su CSD, y el **timbre**
de un Proveedor Autorizado de Certificación (PAC), único facultado para certificarla ante el SAT.

MotRest los separa deliberadamente:

- **El sellado ocurre dentro del restaurante, con el CSD local, y no necesita internet.**
- **El timbrado se difiere** y se reintenta hasta lograrlo.

**Por qué importa.** El SAT concede **72 horas** para timbrar un comprobante desde su emisión. Ese
margen es lo que permite que el restaurante **siga cobrando aunque se caiga el internet**: el
comensal se lleva su ticket y la factura se certifica cuando hay conexión.

MotRest avisa al Cliente **a las 24 horas** de un comprobante pendiente, para que quede margen de
resolverlo en horario hábil.

## 4. Dónde se guarda el CSD, dicho con exactitud

El certificado, la llave privada y su contraseña se almacenan **únicamente en el equipo de caja del
establecimiento**, bajo la custodia física del Cliente.

**Cómo se protegen:**

- **No se sincronizan ni viajan por la red del local.** No existe copia en las tabletas del salón ni
  en la pantalla de cocina. La única pieza que sella es el servicio del equipo de caja.
- **Listas de control de acceso (ACL de NTFS)** aplicadas sobre la carpeta del CSD, que cortan la
  herencia de permisos y limitan el acceso al sistema, a los administradores del equipo y a la
  cuenta que ejecuta el servicio.
- **Cifrado de disco (BitLocker) obligatorio en el equipo de caja**, activado por MOTRAE antes de
  cargar el CSD. Es un requisito de puesta en marcha, no una recomendación.
- **Validaciones al cargarlo**, todas antes de escribir nada: que el certificado y la llave sean
  pareja, que el RFC del certificado coincida con el del emisor, que esté vigente, y que su número
  de serie corresponda a un CSD y no a una e.firma.
- **La contraseña nunca se muestra en la interfaz.** Sólo puede consultarse si hay CSD cargado, de
  qué RFC es, su número y los días que le quedan.

> **Limitación declarada.** **La contraseña de la llave se guarda en el mismo equipo que la llave.**
> No es un descuido: el sistema debe poder sellar sin que nadie la teclee cuando el restaurante
> reinicia el equipo un sábado por la noche. Cifrarla con otra llave guardada en el mismo disco sería
> ofuscación disfrazada de seguridad, y MOTRAE prefiere no presentarlo como protección.
>
> **Lo que de verdad protege esa carpeta es el cifrado de disco y el control físico de la caja.** Por
> eso BitLocker es obligatorio.
>
> **Obligaciones del Cliente que derivan de esto:**
> - Mantener el equipo de caja en un lugar de acceso restringido.
> - **Mantener BitLocker activo.** Desactivarlo anula la protección principal del CSD.
> - Operar con una cuenta de usuario estándar y bloqueo de pantalla.
> - No permitir el uso del equipo por personal no autorizado.
> - **Avisar de inmediato a MOTRAE y al SAT ante cualquier sospecha de compromiso**, y tramitar la
>   revocación del CSD si procede.

## 5. El modo de respaldo en que el PAC sella

MotRest admite, como respaldo configurable, que el sellado lo realice el PAC en lugar del equipo
local. **Ese modo está desactivado por omisión y es deliberado**: activarlo significa entregar la
firma fiscal del Cliente a un tercero.

**Su activación requiere autorización expresa y por escrito del Cliente.** MOTRAE no lo activa por
iniciativa propia en ningún caso, ni siquiera para resolver una incidencia.

## 6. El PAC lo contrata el Cliente

- El Cliente **elige y contrata directamente** a su Proveedor Autorizado de Certificación, y le paga.
- MOTRAE **no** revende timbres, **no** intermedia el contrato y **no** percibe comisión del PAC.
- MotRest no está atado a ningún PAC: el Cliente puede cambiar de proveedor sin migrar su sistema.
- **MOTRAE recomienda contratar un PAC que ofrezca consulta de CFDI ya timbrados**, porque es lo que
  permite recuperar automáticamente una factura cuando la conexión se corta justo después del
  timbrado.

**MOTRAE no responde** por la disponibilidad del PAC, por su tarifa, por el agotamiento del saldo de
timbres del Cliente ni por errores atribuibles al proveedor.

## 7. Qué garantiza MOTRAE y qué no

**MOTRAE sí responde por:**

- Que el software selle correctamente los comprobantes con el CSD cargado.
- Que ningún comprobante emitido se pierda: la cola de timbrado se conserva en disco y sobrevive a
  un corte de luz.
- Que un comprobante no se duplique ni se timbre dos veces.
- Que el Cliente sea avisado de los comprobantes pendientes y de los rechazados.

**MOTRAE no responde por:**

- **La exactitud de los datos capturados por el Cliente**: RFC, razón social, régimen fiscal, uso de
  CFDI, claves de producto y servicio, precios e impuestos. El sistema calcula sobre lo que se
  captura.
- La correcta clasificación fiscal de los productos del Cliente.
- Comprobantes rechazados por el SAT o por el PAC debido a un CSD vencido, revocado o restringido.
- **La restricción o cancelación del CSD por parte del SAT**, que responde a la situación fiscal del
  Cliente y es ajena a MOTRAE.
- Multas, recargos, actualizaciones o cualquier consecuencia fiscal derivada de la operación del
  Cliente.

## 8. MOTRAE no es asesor fiscal ni contable

Se repite aquí porque es donde más importa: **MotRest es una herramienta de emisión, no un servicio
de asesoría fiscal.**

- MOTRAE no interpreta disposiciones fiscales ni emite opiniones sobre ellas.
- MOTRAE no sustituye al contador del Cliente.
- **Se recomienda expresamente que el contador del Cliente valide la configuración fiscal del sistema
  antes de emitir el primer comprobante**, y que revise periódicamente los catálogos.

## 9. Cancelación de comprobantes

MotRest permite solicitar la cancelación de un CFDI conforme a las reglas vigentes del SAT, incluidos
los motivos de cancelación y, cuando corresponda, la sustitución por un comprobante nuevo.

**La decisión de cancelar y su justificación fiscal son del Cliente.** El sistema ejecuta la
solicitud; no valora si procede.

## 10. Conservación

- El Cliente debe **conservar cinco años** sus comprobantes fiscales y su contabilidad, conforme al
  artículo 30 del Código Fiscal de la Federación.
- MotRest conserva el **XML timbrado**, que es el documento fiscal con valor probatorio —no una
  representación impresa ni los campos sueltos.
- Los respaldos automáticos del sistema apoyan esa conservación, pero **la obligación es del
  Cliente**. MOTRAE recomienda que además mantenga una copia fuera del establecimiento.
- Como referencia de buenas prácticas de integridad, disponibilidad y control de acceso sobre la
  información conservada, se toma la **NOM-151-SCFI-2016**.

**Al terminar el contrato**, el Cliente conserva íntegra su información fiscal: reside en su propio
equipo y MOTRAE no la retira. Ver cláusula 8 del documento A1.

## 11. Datos personales en los comprobantes

Los datos del receptor de una factura —nombre, RFC, régimen, código postal— son datos personales
cuando el receptor es persona física. Su tratamiento se rige por el **documento A3**, con una
precisión: **el derecho de cancelación no alcanza a un comprobante fiscal ya emitido**, porque su
conservación es una obligación legal del Cliente durante cinco años.

---

## Aceptación

| **Por MOTRAE** | **Por el Cliente** |
|---|---|
| | |
| `[NOMBRE COMPLETO]` | Nombre: |
| RFC `[RFC]` | Cargo: |
| Fecha: | Fecha: |

**Modo de sellado elegido:** ☐ Local (recomendado, por omisión) ☐ PAC como respaldo *(requiere firma
adicional del Cliente en esta casilla:* ______ *)*
