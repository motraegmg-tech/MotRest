# Contrato de Suscripción y Servicio — MotRest

**Versión 1.0 · 12 de agosto de 2026**

> **Nota interna — borrar antes de publicar.**
> Sustituir: `[NOMBRE COMPLETO]`, `[RFC]`, `[DOMICILIO FISCAL COMPLETO]` y los campos de la Carátula.
> Los tiempos de respuesta de la cláusula 6 son una **propuesta**: Gonzalo debe confirmarlos antes de
> la primera firma. Prometer un tiempo que no se puede sostener es peor que no prometer ninguno.

---

## Carátula

| Campo | Dato |
|---|---|
| **Cliente** | |
| **Razón social / nombre** | |
| **RFC** | |
| **Domicilio del establecimiento** | |
| **Representante** | |
| **Correo y teléfono de contacto** | |
| **Número de establecimientos** | |
| **Plan contratado** | ☐ Base ☐ Pro ☐ Multisucursal |
| **Cuota mensual (MXN, IVA incluido)** | |
| **Cobro por resultado** | ☐ Sí, __ % ☐ No |
| **Fecha de inicio** | |
| **Día de corte** | |

---

## 1. Objeto

MOTRAE presta al Cliente el servicio de suscripción a **MotRest**, que comprende la licencia de uso
del software (documento **A1**), su instalación, mantenimiento, actualización y soporte, en los
términos de este contrato.

## 2. Los planes

| Plan | Cuota mensual | Para quién |
|---|---|---|
| **Base** | $1,490 MXN | Un establecimiento. Punto de venta, cocina, inventario y reportes. |
| **Pro** | $2,990 MXN | Un establecimiento. Todo lo de Base más finanzas, personal, compras e inteligencia operativa. |
| **Multisucursal** | desde $4,990 MXN | Varios establecimientos, con consolidación y comparativa entre sucursales. |

Precios en pesos mexicanos, con IVA incluido, por establecimiento y por mes. El alcance funcional
detallado de cada plan es el del Anexo Técnico vigente al momento de la firma.

**Actualización de precios.** MOTRAE puede actualizar las cuotas una vez cada 12 meses, avisando con
**60 días naturales** de anticipación. Si el Cliente no está conforme, puede terminar el contrato
sin penalización dentro de ese plazo.

## 3. Fase de diagnóstico (opcional)

Cuando se contrate, la **Fase 0 · Diagnóstico DELTA OPS** se factura por separado, entre $15,000 y
$25,000 MXN según el alcance, y produce dos entregables:

1. El diagnóstico operativo del establecimiento.
2. **La línea base de medición**, que es el punto de partida contra el que se calcula cualquier
   cobro por resultado. Sin línea base documentada y firmada por ambas partes, **no puede haber
   cobro por resultado**.

## 4. El cobro por resultado

Esta es la parte del modelo comercial que más conviene dejar cerrada por escrito, porque es donde
más fácilmente surge una discrepancia. Aplica **sólo si se marcó en la Carátula**.

### 4.1 Qué se cobra

Un porcentaje —entre 15 % y 20 %, el pactado en la Carátula— del **ahorro verificado** que el
Cliente obtenga respecto de su línea base, en los conceptos que se hayan acordado: merma, costo de
insumos, o los que se especifiquen en el Anexo de Medición.

### 4.2 Cómo se mide

- Los datos provienen de la operación registrada en MotRest.
- El cálculo se entrega mensualmente en un **Reporte de Resultado**, con el detalle que permita
  reproducir la cifra: línea base, periodo medido, conceptos, volúmenes y precios.
- El reporte se envía dentro de los primeros **10 días naturales** del mes siguiente al medido.

### 4.3 Que MOTRAE mida su propio cobro: cómo se compensa

**MOTRAE reconoce que el software que produce la medición es el mismo por el que cobra.** Eso exige
contrapesos explícitos, y son estos:

1. **El Cliente tiene acceso completo a los datos de origen.** Cualquier cifra del reporte puede
   rastrearse hasta los movimientos que la producen, y el Cliente puede exportarlos.
2. **La línea base no se toca.** Una vez firmada, sólo se modifica por acuerdo escrito de ambas
   partes, y se documenta el motivo.
3. **Derecho de objeción.** El Cliente tiene **15 días naturales** desde que recibe el reporte para
   objetarlo por escrito, señalando qué cifra disputa y por qué. Durante ese plazo, ese cobro no se
   exige.
4. **Resolución.** MOTRAE responde en **10 días hábiles** con el sustento. Si el desacuerdo
   persiste, cualquiera de las partes puede pedir la revisión de un **contador público
   independiente**, cuyo costo se reparte a la mitad y cuya conclusión ambas aceptan.
5. **Tope de prudencia.** Si un mes el cobro por resultado excediera el 50 % de la cuota mensual, se
   revisa conjuntamente antes de facturarlo. Una cifra fuera de escala suele ser un error de
   medición, no un ahorro extraordinario.
6. **Nunca se cobra sobre una estimación.** Sólo sobre ahorro efectivamente ocurrido y verificable
   en los registros.

### 4.4 Cuándo no se cobra

- Si no hay línea base firmada.
- Si el ahorro se debe a causas ajenas al software: cierre de operaciones, cambio de carta, caída de
  precios de mercado o reducción del volumen de venta.
- Si el Cliente no dio de alta la información necesaria (recetas, costos, mermas) durante el periodo
  medido.

## 5. Facturación y pago

- **Periodicidad:** mensual, por adelantado, con corte el día indicado en la Carátula.
- **El cobro por resultado** se factura **por mes vencido**, junto con la cuota del mes siguiente y
  una vez transcurrido el plazo de objeción.
- **Forma de pago:** transferencia electrónica o el medio que se acuerde por escrito.
- **Comprobante fiscal:** MOTRAE emite CFDI por cada pago recibido.
- **Falta de pago:** aplica el régimen de la cláusula 7 del documento A1 — tres días de gracia y
  suspensión al cuarto. **Sin cargo por reconexión.**

## 6. Soporte

> **Pendiente de confirmación por Gonzalo antes de la primera firma.**

| | Base | Pro | Multisucursal |
|---|---|---|---|
| **Canales** | Correo y WhatsApp | Correo, WhatsApp y teléfono | Correo, WhatsApp y teléfono |
| **Horario** | L–V, 9:00–18:00 | L–D, 9:00–22:00 | L–D, 9:00–22:00 |
| **Incidencia crítica** (no se puede vender ni cobrar) | 4 h hábiles | 2 h | 1 h |
| **Incidencia mayor** (una función clave caída) | 1 día hábil | 8 h | 4 h |
| **Consulta o mejora** | 3 días hábiles | 2 días hábiles | 1 día hábil |

**Qué son estos tiempos.** Son tiempos de **primera respuesta con un responsable asignado**, no de
solución. Un tiempo de solución garantizado sobre fallos que pueden depender del hardware del
Cliente, de su internet o de un tercero no sería creíble y MOTRAE prefiere no ofrecerlo.

**Fuera de horario**, MOTRAE atiende incidencias críticas por el canal de emergencia que se
proporcione al Cliente, con el mejor esfuerzo.

**No cubre el soporte:** fallos de hardware, de red o de suministro eléctrico del Cliente;
configuraciones hechas por terceros; capacitación de personal nuevo más allá de la incluida en la
implantación; ni la operación cotidiana del establecimiento.

## 7. Implantación

- MOTRAE instala, configura y capacita al equipo del Cliente al inicio de la relación.
- El Cliente designa **una persona responsable** del sistema dentro del establecimiento, que será el
  interlocutor con MOTRAE.
- El Cliente proporciona el hardware, la red y el acceso al local en los horarios convenidos.

## 8. Vigencia, renovación y terminación

- **Vigencia inicial:** un mes, renovable automáticamente por periodos iguales.
- **Terminación por el Cliente:** con aviso por escrito con **30 días naturales** de anticipación.
  **Sin penalización ni cláusula de permanencia.**
- **Terminación por MOTRAE:** con aviso de **60 días naturales**, salvo incumplimiento grave del
  Cliente o las conductas de la cláusula 5 del documento A1.
- **Al terminar:** MOTRAE entrega al Cliente toda su información dentro de los **5 días hábiles**
  siguientes a la solicitud, conforme a la cláusula 8 del documento A1, y suprime los datos conforme
  al documento A3.

**Sin permanencia forzosa, y es deliberado.** El modelo comercial de MOTRAE se sostiene en que el
software le ahorre dinero al Cliente, no en atarlo. Un cliente que se queda porque no puede irse es
un cliente que ya se fue.

## 9. Documentos que forman parte de este contrato

| | Documento |
|---|---|
| **A1** | Contrato de Licencia de Usuario Final |
| **A3** | Convenio de Encargado del Tratamiento de Datos Personales |
| **A4** | Anexo Fiscal — CSD, timbrado y deslinde |
| | Anexo Técnico del plan contratado |
| | Anexo de Medición y Línea Base, si aplica el cobro por resultado |

En caso de contradicción prevalece este contrato en lo comercial y el A3 en materia de datos
personales.

## 10. Ley aplicable y jurisdicción

Leyes de los Estados Unidos Mexicanos. Tribunales competentes de la ciudad de **Xalapa, Veracruz**.

---

## Firmas

| **Por MOTRAE** | **Por el Cliente** |
|---|---|
| | |
| `[NOMBRE COMPLETO]` | Nombre: |
| Persona física con actividad empresarial | Cargo: |
| RFC `[RFC]` | RFC: |
| Fecha: | Fecha: |
