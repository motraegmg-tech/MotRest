# D1 · Política de Seguridad de Datos Personales

**Uso:** interno de MOTRAE. **No se publica**, pero se exhibe ante una inspección o ante un cliente
que lo solicite.
**Versión 1.0 · 12 de agosto de 2026 · Aprueba:** Gonzalo (MOTRAE)

---

## 1. Objeto y alcance

La ley obliga a todo responsable y a todo encargado a establecer y mantener medidas de seguridad
**administrativas, técnicas y físicas** que protejan los datos personales contra daño, pérdida,
alteración, destrucción, uso, acceso o tratamiento no autorizado, adecuadas al tipo de dato y a los
riesgos identificados.

Esta política es el documento de gobierno de esas medidas. Aplica a:

- Los datos que MOTRAE trata **como responsable**: prospectos, clientes y sus personas de contacto.
- Los datos que MOTRAE trata **como encargado** por cuenta de cada restaurante.
- Todo el personal, colaborador o proveedor de MOTRAE que intervenga en el tratamiento.

**El detalle técnico vive en [`docs/SEGURIDAD.md`](../docs/SEGURIDAD.md)**, que es el documento
vivo de postura de seguridad del producto y se actualiza en cada etapa de desarrollo. Esta política
no lo duplica: lo gobierna.

## 2. Responsable de seguridad

Mientras MOTRAE opere como persona física, **Gonzalo concentra las funciones** de responsable de
seguridad y de atención de derechos ARCO.

Sus funciones:
- Mantener el inventario de datos ([`00-mapa-de-datos.md`](00-mapa-de-datos.md)).
- Aprobar y revisar las medidas de seguridad.
- Atender las solicitudes ARCO (procedimiento **D3**).
- Conducir la respuesta a vulneraciones (procedimiento **D2**).
- Revisar esta política **al menos una vez al año** y cada vez que el producto cambie de forma
  sustancial.

**Riesgo asumido y declarado:** la concentración de funciones en una sola persona es un punto único
de fallo. Se mitiga con la documentación de los procedimientos —para que sean ejecutables por otra
persona— y se resolverá con la incorporación de personal.

## 3. Principios de tratamiento

Toda decisión sobre datos se toma contra estos principios:

| Principio | Cómo se aplica en MotRest |
|---|---|
| **Licitud** | Sólo se recaba lo necesario para operar el restaurante, y con aviso previo. |
| **Consentimiento** | Lo necesario no lo requiere; lo voluntario —marketing— exige un sí previo y demostrable. |
| **Información** | Aviso de privacidad en tres modalidades, según la superficie de contacto. |
| **Calidad** | Los datos se pueden corregir desde el propio sistema. |
| **Finalidad** | Finalidades cerradas en el convenio A3. Un uso nuevo exige instrucción escrita. |
| **Lealtad** | Nada se recaba con engaño ni de forma oculta. El pulso se declara en el contrato. |
| **Proporcionalidad** | Política de retención con plazos por tipo de dato (**D4**). |
| **Responsabilidad** | Estos documentos, y la bitácora inalterable que los respalda. |

**Regla de minimización, aplicada al producto:** si una función nueva puede resolverse sin pedir un
dato personal, se resuelve sin pedirlo. El portal del comensal es el ejemplo: da acceso a la cuenta
con un enlace firmado, **sin registro, sin contraseña y sin pedir el teléfono**.

## 4. Medidas administrativas

1. **Acceso mínimo.** Sólo accede a los datos de un cliente quien esté atendiendo una incidencia
   suya.
2. **Confidencialidad.** Obligación indefinida para todo el que intervenga.
3. **La cuenta de mantenimiento de MOTRAE se usa exclusivamente para soporte.** Su uso queda
   registrado en la bitácora del establecimiento, que **no se puede alterar**. Ver
   [`docs/SOPORTE-Y-ACCESO-REMOTO.md`](../docs/SOPORTE-Y-ACCESO-REMOTO.md).
4. **Secretos nunca al repositorio.** Convención permanente de MOTRAE.
5. **Procedimientos documentados** para ARCO (D3), vulneraciones (D2) y retención (D4).
6. **Revisión anual** de esta política y del inventario de datos.

## 5. Medidas técnicas y físicas

Se describen en el **Anexo II del documento A3** y, con todo el detalle de ingeniería, en
[`docs/SEGURIDAD.md`](../docs/SEGURIDAD.md).

**Requisitos obligatorios de puesta en marcha de cada instalación** — se verifican y se anotan:

- [ ] **BitLocker activo** en el equipo de caja **antes** de cargar el CSD.
- [ ] Cuenta de Windows del restaurante **estándar**, no administradora.
- [ ] Bloqueo de pantalla activado.
- [ ] Código de rescate del propietario **generado** y entregado. *(Un local sin código emitido no
      tiene rescate: si el propietario olvida su contraseña, queda fuera de su propio negocio.)*
- [ ] Aviso de privacidad del restaurante publicado y el corto impreso en el ticket.
- [ ] Aviso de privacidad laboral entregado al personal, con acuse.

## 6. Análisis de riesgo

Riesgos identificados sobre los datos personales tratados, y su tratamiento:

| Riesgo | Probabilidad | Impacto | Tratamiento |
|---|---|---|---|
| Robo del equipo de caja | Media | Alto | **Mitigado** — BitLocker obligatorio |
| Acceso administrativo indebido al equipo encendido | Baja | Alto | **Aceptado con mitigación** — cuenta estándar, bloqueo de pantalla, ACL, bitácora |
| Compromiso del CSD | Baja | **Muy alto** | Mitigado — ACL, BitLocker, no se sincroniza; obligación de aviso inmediato al SAT |
| Fuga por respaldo mal manejado | Media | Alto | Respaldo cifrado con clave de licencia; permanece en el equipo |
| Suplantación de terminal en la red del local | Baja | Medio | **Abierto** — clave compartida; atribución por credencial de empleado |
| Compromiso del padrón del relay (tokens de Meta) | Baja | **Muy alto** | Cifrado AES-256-GCM, escritura atómica, llave en el entorno |
| Envío de marketing sin consentimiento | **Alta** | Medio | **Abierto** — falta la ruta de baja; se prohíbe habilitar campañas hasta cerrarlo (C4 §12) |
| Imposibilidad de atender un derecho de cancelación | **Alta** | Medio | **Abierto** — falta el mecanismo de supresión (D3 §5) |
| Pérdida de datos del cliente | Baja | Alto | Respaldos automáticos diarios con rotación |

**Los tres riesgos marcados como abiertos con probabilidad alta son los que gobiernan la prioridad
de desarrollo.** No son teóricos: dos de ellos se materializan la primera vez que un restaurante
lance una campaña o un comensal pida que le borren sus datos.

## 7. Formación

Toda persona que se incorpore a MOTRAE y vaya a tener acceso a datos de clientes recibe, antes de
ese acceso: esta política, el documento A3, y los procedimientos D2 y D3. Se deja constancia.

## 8. Proveedores

Antes de incorporar un subencargado nuevo se verifica que ofrezca garantías suficientes, se
documenta en el A3 §6 y se avisa a los clientes con 30 días de anticipación.

## 9. Auditoría y mejora

- Revisión anual de esta política.
- Revisión del inventario de datos **antes** de cada cambio de producto que toque datos personales.
- Todo incidente genera un informe y, si procede, una medida correctiva incorporada aquí.
- La postura técnica se revisa y se publica en `docs/SEGURIDAD.md` en cada etapa de desarrollo.

## 10. Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 12-ago-2026 | Versión inicial. |
