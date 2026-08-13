# D3 · Procedimiento de atención de derechos ARCO

**Uso:** interno de MOTRAE, y de referencia para el restaurante.
**Versión 1.0 · 12 de agosto de 2026**

---

## 1. Quién responde a quién

| Solicita | Le responde | MOTRAE hace |
|---|---|---|
| Un **comensal** de un restaurante | **El restaurante** | Apoya técnicamente en 5 días hábiles |
| Un **empleado** de un restaurante | **El restaurante** | Apoya técnicamente en 5 días hábiles |
| Un **cliente o prospecto** de MOTRAE | **MOTRAE** | Responde directamente |

**No confundir esto es la mitad del procedimiento.** Si a MOTRAE le llega la solicitud de un
comensal, no la contesta: la reencamina al restaurante responsable dentro de las 48 horas, y avisa
al solicitante de a quién debe dirigirse.

## 2. Los plazos

| Etapa | Plazo |
|---|---|
| Acuse de recibo | 3 días hábiles |
| Requerimiento si la solicitud está incompleta | 5 días hábiles desde su recepción |
| Plazo del titular para completarla | 10 días hábiles |
| **Respuesta** | **20 días hábiles** desde la solicitud completa |
| Ejecución, si procede | 15 días hábiles desde la respuesta |
| Apoyo de MOTRAE al restaurante | 5 días hábiles desde que se le pide |

**El plazo corre desde la recepción, no desde que alguien lo ve.** El buzón de privacidad se revisa
cada día hábil.

## 3. Qué debe traer una solicitud

1. Nombre del titular y un medio para responderle.
2. **Copia de identificación oficial.** Si actúa un representante, además el documento que acredite
   la representación.
3. Qué derecho ejerce y sobre qué datos.
4. Si es rectificación: la corrección exacta y el documento que la sustente.

**El trámite es gratuito.** Sólo pueden repercutirse gastos justificados de envío o de reproducción,
y hay que informarlos antes.

## 4. Cómo se atiende cada derecho

### Acceso

Se entrega al titular la información que se tiene sobre él, en formato legible, junto con las
finalidades del tratamiento.

**En MotRest:** exportación de la ficha del cliente o del expediente del empleado — datos de
contacto, historial de consumo, reservas, opiniones, saldos, y en el caso del personal sus fichajes,
percepciones y bitácora.

### Rectificación

Se corrigen los datos inexactos o incompletos.

**En MotRest:** edición directa desde la ficha. Queda registrada en la bitácora, que es lo correcto:
la corrección es un hecho del negocio.

### Cancelación

Se suprimen los datos personales cuando ya no son necesarios. Ver §5, que es donde está la
dificultad real.

### Oposición

Se marca al titular para excluirlo del tratamiento indicado. El caso más frecuente, con diferencia,
es la oposición a recibir comunicaciones comerciales: se resuelve con la lista de exclusión del
documento **C4**.

### Revocación del consentimiento

Se registra y **se corta de inmediato** el envío de comunicaciones comerciales. Sin excepciones y
sin «un último mensaje».

## 5. La cancelación sobre un registro que sólo admite añadir

**Este es el punto difícil y conviene entenderlo antes de prometer nada.**

MotRest guarda la operación como un registro de hechos que **sólo admite añadir, nunca alterar**. Es
lo que hace confiable la auditoría: una bitácora que se puede editar no prueba nada. Pero choca de
frente con el derecho de cancelación, que exige que un dato desaparezca.

**Hoy el sistema no lo resuelve.** La ficha del cliente se da de baja, no se borra
(`cliente_desactivado`), y eso **no satisface** el derecho de cancelación.

### El diseño que hay que implantar

**Principio:** se suprime **el dato personal**, se conserva **el hecho económico**.

Una venta de $480 el 3 de julio a las 21:40 tiene que sobrevivir —el SAT obliga a conservarla cinco
años— pero no tiene por qué seguir diciendo quién la hizo, ni con qué teléfono, ni qué opinó
después.

**Cómo:**

1. **Un hecho de supresión** (`datos_personales_suprimidos`) que identifica al titular y la fecha.
   Se añade, no borra: el registro sigue siendo íntegro y queda constancia de que se atendió el
   derecho.
2. **La reproyección omite los campos personales** de ese titular al reconstruir el estado. El
   nombre, el teléfono, el correo, el domicilio y los comentarios dejan de aparecer en cualquier
   pantalla, reporte o exportación.
3. **Sobreescritura del contenido personal** en los registros almacenados, de modo que no sea
   recuperable leyendo el archivo por debajo de la aplicación. Sin esto, los dos pasos anteriores
   son una cortina.
4. **Barrido de los respaldos.** Son varias copias con rotación. **Suprimir sólo en la base activa
   no es suprimir.** El siguiente respaldo debe nacer ya sin el dato, y los anteriores deben
   procesarse o caducar dentro de un plazo declarado al titular.
5. **Lo que se conserva y por qué:** el importe, la fecha, los productos y el comprobante fiscal si
   lo hubo. Al titular se le explica exactamente esto en la respuesta.

### Qué decirle al titular mientras no exista

**La verdad, y con una fecha.** Que su solicitud se atiende suprimiendo sus datos de contacto y su
expediente comercial, que la información fiscal debe conservarse cinco años por mandato legal, y —si
el barrido de respaldos aún no está automatizado— qué se hizo manualmente y cuándo se completará.

Prometer una supresión total que no ocurrió es peor que explicar un límite real.

## 6. Cuándo se puede negar

- El solicitante no acredita su identidad, o el representante su representación.
- Los datos no obran en la base.
- Se lesionan derechos de un tercero.
- Lo impide una disposición legal o una resolución de autoridad — **el caso más frecuente: el
  comprobante fiscal, que se conserva cinco años**.
- La rectificación o cancelación es improcedente conforme a la ley.

**Siempre se explica el motivo por escrito**, y se informa al titular de que puede acudir a la
autoridad.

## 7. Registro de solicitudes

Se lleva un registro con: fecha de recepción, titular, derecho ejercido, si se acreditó la
identidad, fechas de acuse y de respuesta, resultado, y —si se negó— el motivo.

**Es la prueba de que se cumplió.** Sin registro, un plazo atendido y un plazo incumplido se ven
igual.

## 8. Buzón

| | |
|---|---|
| **MOTRAE** | privacidad@motrest.mx · 228 353 6911 |
| **Restaurante** | El que figure en su propio aviso de privacidad (documento C1) |

## 9. Estado de implantación

| Capacidad | Estado |
|---|---|
| Exportar la ficha de un cliente | ⚠️ Parcial — existe la ficha 360°, falta la exportación formal |
| Rectificar datos | ✅ Desde la interfaz |
| Marcar oposición a comunicaciones | 🔴 Falta la lista de exclusión (C4) |
| **Suprimir datos personales** | 🔴 **No existe.** Sólo baja lógica |
| **Barrido de respaldos** | 🔴 **No existe** |
| Registro de solicitudes | 🔴 Manual, en hoja de cálculo |

**Mientras la supresión no exista, cada solicitud de cancelación se atiende manualmente y se
documenta paso a paso.** Es sostenible con un cliente; no lo es con veinte.
