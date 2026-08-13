# D2 · Procedimiento de vulneraciones de seguridad

**Uso:** interno de MOTRAE. **Versión 1.0 · 12 de agosto de 2026**

---

## Por qué existe, y por qué se escribe antes de necesitarlo

La ley obliga a comunicar **de forma inmediata** al titular las vulneraciones de seguridad que
afecten de manera significativa sus derechos patrimoniales o morales, para que pueda tomar medidas.
Y la vulneración con ánimo de lucro tiene **pena de prisión de tres meses a tres años**; el
tratamiento engañoso con lucro indebido, de seis meses a cinco años, con penas duplicadas cuando hay
datos sensibles de por medio.

Un procedimiento improvisado a las once de la noche de un viernes no cumple ninguno de esos plazos.
Este documento existe para que la primera hora esté decidida de antemano.

---

## 1. Qué cuenta como vulneración

Cualquiera de estas, ocurra en MOTRAE o en el equipo de un cliente:

- **Pérdida o destrucción** no autorizada de datos.
- **Robo, extravío o copia** no autorizada — incluido el robo del equipo de caja o de un respaldo.
- **Uso, acceso o tratamiento** no autorizado, por alguien de dentro o de fuera.
- **Daño, alteración o modificación** no autorizada.
- Compromiso del **CSD** o de sus credenciales.
- Compromiso del **padrón del relay** (contiene tokens de Meta de todos los locales).
- Compromiso de las **llaves privadas de firma** de MOTRAE.
- Envío masivo indebido desde el dominio compartido.

**En la duda, se activa el procedimiento.** Cerrarlo después como falsa alarma cuesta una hora;
abrirlo tarde cuesta el plazo legal.

## 2. Los tiempos

| Momento | Qué ocurre |
|---|---|
| **T + 0** | Detección. Se registra hora, quién detecta y qué se observó. |
| **T + 1 h** | **Contención.** Cortar el acceso, rotar credenciales, aislar el sistema afectado. |
| **T + 24 h** | **Notificación al cliente afectado**, por correo y por teléfono. Obligación del convenio A3. |
| **T + 72 h** | Informe preliminar de causas y alcance, entregado al cliente. |
| **T + 15 días** | Informe final con medidas correctivas implantadas. |

**La notificación al titular** —comensal o empleado— **la hace el restaurante**, porque es quien
tiene la relación con él y es el responsable. MOTRAE le entrega todo lo que necesite para hacerla,
y con la urgencia que la ley marca: inmediata.

## 3. Los cuatro pasos

### Paso 1 · Contener (primera hora)

**Antes que investigar. Antes que avisar.** Una vulneración que sigue abierta se agranda mientras se
documenta.

- Cortar el acceso comprometido.
- Rotar credenciales, llaves o tokens afectados.
- Si es el **CSD**: avisar al cliente en el acto para que tramite su revocación ante el SAT. Un CSD
  comprometido permite facturar a nombre del contribuyente.
- Si es el **padrón del relay**: rotar la llave de cifrado y las credenciales de todos los locales.
- Si es una **llave privada de firma**: generar par nuevo, compilar y reemitir. Ver
  [`ADR-25`](../docs/adr/ADR-25-firmas-ed25519-y-migracion.md).
- **No borrar rastros.** Los registros son la prueba de qué ocurrió y hasta dónde llegó.

### Paso 2 · Evaluar

Responder por escrito, aunque sea con incertidumbre:

1. ¿Qué ocurrió y cuándo? ¿Sigue abierto?
2. ¿Qué datos y de qué categorías de titulares?
3. ¿Hay **datos sensibles**? Si los hay, las sanciones se duplican y la urgencia sube.
4. ¿Cuántos titulares, aproximadamente?
5. ¿Qué consecuencias son previsibles para ellos? Suplantación, fraude, exposición de su consumo.
6. ¿Afecta a un cliente, a varios o a todos?

**El criterio para notificar:** si la vulneración afecta **de forma significativa los derechos
patrimoniales o morales** de los titulares, se notifica. En la duda, se notifica.

### Paso 3 · Notificar

**Al cliente afectado, dentro de 24 horas**, por correo **y** por teléfono. Nunca sólo por correo:
un correo a las tres de la mañana no es un aviso.

Contenido mínimo:

- Qué ocurrió y cuándo.
- Qué datos están comprometidos.
- Qué consecuencias son previsibles para los titulares.
- Qué está haciendo MOTRAE.
- **Qué debe hacer el cliente**, en pasos concretos.
- Quién es el contacto de MOTRAE para este incidente, con teléfono directo.

**A la autoridad**, cuando la normativa lo requiera: Secretaría Anticorrupción y Buen Gobierno.

**Lo que no se hace:** minimizar, esperar a tener el diagnóstico completo, ni redactar el aviso para
proteger a MOTRAE. Un aviso tardío o edulcorado convierte un incidente técnico en un problema de
credibilidad, y la credibilidad es el único activo que sostiene el acceso de soporte y el modelo de
cobro por resultado.

### Paso 4 · Corregir y aprender

- Implantar la medida que impide la repetición.
- Actualizar [`docs/SEGURIDAD.md`](../docs/SEGURIDAD.md), esta política y el inventario de datos.
- Entregar el informe final al cliente.
- **Conservar el expediente completo.** Es la prueba de diligencia.

## 4. Registro de incidentes

Se lleva un registro con: fecha y hora de detección, quién detecta, descripción, datos y titulares
afectados, clientes afectados, medidas de contención, fecha de notificación, causa raíz, medida
correctiva y fecha de cierre.

**Se registran también los incidentes que no requirieron notificación**, y la razón por la que se
decidió no notificar. Esa decisión es la que hay que poder justificar después.

## 5. Contactos

| | |
|---|---|
| **Responsable de la respuesta** | Gonzalo — 228 353 6911 · motrae.gmg@gmail.com |
| **Autoridad de protección de datos** | Secretaría Anticorrupción y Buen Gobierno |
| **SAT** (compromiso de CSD) | Portal del SAT — revocación de certificados |
| **Meta** (compromiso del padrón) | Soporte de WhatsApp Business Platform |

## 6. Plantilla de notificación al cliente

> **Asunto: Incidente de seguridad que afecta a su información — acción requerida**
>
> Estimado/a [nombre]:
>
> Le escribimos para informarle de un incidente de seguridad detectado el [fecha] a las [hora], que
> afecta información de su restaurante.
>
> **Qué ocurrió:** [descripción, sin tecnicismos]
>
> **Qué información está afectada:** [categorías y volumen aproximado]
>
> **Qué consecuencias puede tener para las personas afectadas:** [previsibles]
>
> **Qué hemos hecho ya:** [medidas de contención, con hora]
>
> **Qué necesitamos que usted haga:** [pasos concretos, numerados]
>
> **Su obligación como responsable:** conforme a la Ley Federal de Protección de Datos Personales en
> Posesión de los Particulares, corresponde a usted notificar a las personas afectadas. Adjuntamos un
> modelo de aviso y quedamos a su disposición para prepararlo con usted.
>
> Le entregaremos un informe preliminar de causas dentro de las próximas 72 horas.
>
> Para cualquier cosa, a cualquier hora: **228 353 6911**.
>
> Gonzalo — MOTRAE
