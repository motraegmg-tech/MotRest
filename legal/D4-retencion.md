# D4 · Política de retención y supresión

**Uso:** interno de MOTRAE, y base de los plazos publicados en los avisos de privacidad.
**Versión 1.0 · 12 de agosto de 2026**

---

## 1. El principio

Un dato se conserva **mientras sirva para la finalidad que justificó recogerlo**, o mientras la ley
obligue a guardarlo. Después se suprime o se anonimiza.

Guardar «por si acaso» no es una finalidad. Es acumular riesgo: cada mes extra de conservación es un
mes más de exposición ante un robo del equipo, y un mes más de datos que habría que suprimir el día
que alguien ejerza su derecho.

## 2. Los plazos

### Datos del comensal — responsabilidad del restaurante, ejecución en el sistema

| Dato | Plazo | Por qué |
|---|---|---|
| **Reserva** (nombre, teléfono, correo, notas) | **12 meses** desde la fecha de la reserva | Pasada la visita, sólo sirve para historial |
| **Opinión y comentario libre** | **24 meses** | Sirve para ver tendencias de un ciclo completo; más allá no informa nada |
| **Mensajes de WhatsApp** (número y contenido) | **12 meses** | Es correspondencia privada; se guarda lo mínimo |
| **Correos enviados** (registro de envío) | **12 meses** | Prueba de entrega y de consentimiento |
| **Ficha del comensal** (contacto, historial, preferencias) | **36 meses sin visita**, después se suprime | Tras tres años sin volver, ya no es cliente |
| **Saldos de lealtad y monedero** | Mientras tengan saldo, más **12 meses** | Es dinero suyo: no se borra con saldo |
| **Consentimiento y baja de marketing** | **Indefinido** | La baja **debe sobrevivir** a la supresión de la ficha, o se le volvería a escribir |
| **Ticket** (copia) | Lo configurado: 3, 6, 12 o 24 meses | Configurable por el local |
| **Comprobante fiscal (CFDI)** | **5 años** | Código Fiscal de la Federación, art. 30 |

> **La excepción que parece contradictoria y no lo es.** Cuando se suprime la ficha de un comensal,
> **su baja de marketing se conserva**, reducida a lo mínimo indispensable para reconocerla. Borrar
> la baja junto con la ficha haría que la siguiente vez que dejara su correo volviera a recibir
> promociones que ya había rechazado. Esto se explica en el aviso de privacidad.

### Datos del personal — responsabilidad del restaurante

| Dato | Plazo | Por qué |
|---|---|---|
| Identificación, rol y permisos | Mientras dure la relación de trabajo | Finalidad |
| **Credenciales** (PIN, contraseña) | Se **cancelan de inmediato** al terminar la relación | Control de acceso |
| Registros de jornada y asistencia | **5 años** tras terminar la relación | Obligación laboral y fiscal |
| Nómina, propinas y prenómina | **5 años** tras terminar la relación | Obligación laboral y fiscal |
| **Bitácora de operaciones** | Se conserva como parte de la contabilidad | Auditoría del negocio y prueba |
| Calificaciones de servicio por persona | **24 meses** | Acompañamiento, no expediente permanente |

### Datos de MOTRAE sobre sus clientes

| Dato | Plazo |
|---|---|
| Prospecto que no contrata | **24 meses** desde el último contacto |
| Cliente activo | Durante la relación |
| Cliente que se va | **5 años** tras el fin de la relación, por obligación fiscal |
| Notas internas de seguimiento | Se suprimen al terminar la relación |
| Candidatos a vacantes | **12 meses** |
| **Pulso** (estado de salud) | Sólo el último por local. **Sin histórico** |
| Registro de solicitudes ARCO | **5 años** — es la prueba del cumplimiento |
| Expedientes de incidentes de seguridad | **5 años** — es la prueba de diligencia |

## 3. Qué se hace al vencer el plazo

Tres salidas, en este orden de preferencia:

1. **Anonimizar.** Se quitan los identificadores y se conserva el dato agregado. Es lo preferible
   cuando la información sigue teniendo valor estadístico: «los viernes se venden 340 pizzas» no
   necesita saber quién las pidió.
2. **Suprimir**, conforme al mecanismo del documento **D3 §5**.
3. **Bloquear**, cuando la ley obliga a conservar: el dato queda inaccesible para la operación y sólo
   se usa para cumplir esa obligación. Es el caso del comprobante fiscal.

## 4. Los respaldos

**Un dato suprimido que sigue en un respaldo no está suprimido.**

- Los respaldos se generan a diario, con rotación.
- Al ejecutar una supresión, **el siguiente respaldo debe nacer ya sin el dato**.
- Los respaldos anteriores se procesan o se dejan caducar dentro del plazo de rotación, y **ese
  plazo se le declara al titular** en la respuesta a su solicitud.
- Al terminar el contrato con un cliente, los respaldos que MOTRAE conserve se suprimen dentro de los
  **30 días naturales** siguientes a la entrega de los datos (documento A3 §10).

## 5. Estado de implantación

| Purga | Estado |
|---|---|
| Ticket (`MESES_RETENCION`) | ✅ Implantado y configurable |
| Comprobantes fiscales (5 años) | ✅ Se conservan; sin purga automática, y es correcto |
| Pulso (sólo el último) | ✅ Implantado por diseño |
| **Reservas** | 🔴 Sin purga |
| **Opiniones** | 🔴 Sin purga |
| **Mensajes de WhatsApp** | 🔴 Sin purga |
| **Ficha del comensal inactivo** | 🔴 Sin purga |
| **Credenciales al cesar** | ⚠️ Se desactiva el usuario; verificar que la credencial quede inutilizable |
| **Barrido de respaldos** | 🔴 Sin implantar |

**Lo que hay que construir:** una tarea periódica en el equipo del local que aplique estos plazos,
emita el hecho de supresión correspondiente y deje constancia en la bitácora de cuántos registros
purgó y de qué tipo. Sin esa constancia, no hay forma de probar que la política se cumple.

## 6. Revisión

Anual, junto con la política D1, y cada vez que cambie una obligación legal de conservación.
