# 00 · Mapa de datos personales de MotRest

**Uso:** interno de MOTRAE. **No se publica.**
**Versión:** 1.0 · **Fecha:** 12 de agosto de 2026 · **Responsable del documento:** Gonzalo (MOTRAE)
**Marco:** Ley Federal de Protección de Datos Personales en Posesión de los Particulares
(DOF 20-mar-2025, en vigor desde el 21-mar-2025).

---

## Por qué existe este documento

Ningún aviso de privacidad ni convenio de tratamiento se puede redactar bien sin saber antes
**qué datos toca el software, dónde acaban y quién responde por ellos**. Este archivo es ese
inventario. Todo lo demás en `legal/` deriva de aquí, y cuando el producto cambie, **esto se
actualiza primero**.

También es la defensa. Ante una inspección de la autoridad, un inventario fechado y honesto
—incluidas las carencias— vale más que un aviso de privacidad impecable que no corresponde con lo
que el sistema hace de verdad.

---

## 1. Las dos figuras, y cuál ocupa MOTRAE en cada caso

La ley distingue al **responsable** (quien decide sobre el tratamiento) del **encargado** (quien
trata datos por cuenta del responsable y siguiendo sus instrucciones). MOTRAE ocupa las dos según
el dato, y confundirlas es el error que hace inservible todo lo demás.

| Conjunto de datos | Dónde vive físicamente | Responsable | Encargado | Documento que lo rige |
|---|---|---|---|---|
| Comensales (nombre, teléfono, correo, domicilio, RFC, notas) | `hub.sqlite`, en el equipo de caja del local | **El restaurante** | MOTRAE | A3 · C1 |
| Reservas | `hub.sqlite` | **El restaurante** | MOTRAE | A3 · C1 |
| Opiniones y encuestas (texto libre) | `hub.sqlite` | **El restaurante** | MOTRAE | A3 · C1 |
| Mensajes de WhatsApp (número + contenido) | `hub.sqlite` · tránsito por la nube | **El restaurante** | MOTRAE | A3 · C4 |
| Lealtad: puntos, monedero, gift cards | `hub.sqlite` | **El restaurante** | MOTRAE | A3 · C1 |
| Empleados: identidad, PIN, permisos | `hub.sqlite` | **El restaurante** | MOTRAE | A3 · C2 |
| Empleados: sueldo, propinas, fichajes, prenómina | `hub.sqlite` | **El restaurante** | MOTRAE | A3 · C2 |
| Bitácora de acciones del personal | `hub.sqlite` (event log inmutable) | **El restaurante** | MOTRAE | A3 · C2 |
| Socios e inversionistas del local | `hub.sqlite` | **El restaurante** | MOTRAE | A3 |
| Datos fiscales del receptor (RFC, régimen, CP) | `hub.sqlite` + CFDI timbrado | **El restaurante** | MOTRAE | A4 |
| Cartera de MOTRAE: contacto, responsable, teléfono, correo, pagos, notas privadas | MotRest Central, equipo de Gonzalo | **MOTRAE** | — | B1 |
| Pulso: `sucursal_id`, versión, **ventas del día**, cuentas, dispositivos | Supabase (`public.pulsos`) | **MOTRAE** | — | A1 · B1 |
| Padrón: tokens de Meta por local | Supabase (`public.sucursales`), cifrados AES-256-GCM por MOTRAE | **MOTRAE** | — | A3 |

**La regla que resume la tabla:** *lo que el restaurante recoge de sus comensales y de su personal
es suyo; MOTRAE sólo lo procesa por encargo. Lo que MOTRAE recoge sobre el restaurante como cliente
suyo es de MOTRAE.*

---

## 2. Inventario por origen

### 2.1 Comensales

| Dato | Categoría | Origen en el código |
|---|---|---|
| `nombre`, `telefono`, `correo` | Identificación y contacto | `packages/dominio/src/clientes/eventos.ts` → `DatosCliente` |
| `domicilio` (calle, número, colonia, CP, ciudad, referencias) | Identificación | `clientes/eventos.ts` → `Domicilio` |
| `fiscal` (RFC, régimen, CP, uso CFDI) | Fiscal | `clientes/eventos.ts` → `DatosReceptor` |
| **`notas`** — documentado como «alergias, preferencias» | ⚠️ **Potencialmente sensible** | `clientes/eventos.ts` |
| Perfil 360°: visitas, gastado, ticket promedio, propinas, días sin venir, favoritos, no-shows | Patrimonial + conductual | `clientes/ficha360.ts` |
| Puntos, monedero, gift cards | Patrimonial | `clientes/lealtad.ts` |
| Reserva: nombre, teléfono, correo, personas, fecha, notas | Identificación | `clientes/reservas.ts` |
| Opinión: calificación, motivos, **comentario libre**, cruce con mesero y con tiempo de espera | Opinión + laboral indirecto | `clientes/opinion.ts` |
| WhatsApp: `contacto` (teléfono) y `texto` (contenido del mensaje) | Comunicación privada | `clientes/mensajeria.ts` |
| Correo: dirección del destinatario, tipo de correo, id del proveedor | Contacto | `clientes/correo.ts` |

> ⚠️ **`notas` y los datos de salud.** El campo está documentado para alergias. Una alergia es un
> dato de salud, y los datos de salud son **sensibles** bajo el art. 3: exigen consentimiento
> **expreso y por escrito**, y las sanciones se duplican cuando están de por medio.
>
> **Decisión pendiente, y va antes de firmar el A3.** Dos salidas:
> **(a)** reetiquetar el campo como *preferencias del comensal* y decir en la interfaz que no se
> capturen datos de salud — el valor operativo (no le pongas cebolla, prefiere mesa del fondo) se
> conserva íntegro y el riesgo desaparece; o
> **(b)** tratarlo como sensible: consentimiento expreso por escrito, mención específica en el aviso
> y medidas reforzadas.
> **Recomendación de MOTRAE: (a).**

### 2.2 Personal del restaurante

| Dato | Categoría | Origen |
|---|---|---|
| `nombre`, `iniciales`, `puesto`, `rol_id`, `permisos`, `activo` | Identificación laboral | `identidad/roles.ts` → `Usuario` |
| PIN y contraseña — **hash PBKDF2-SHA256**, 310 000 / 600 000 iteraciones, con sal | Autenticación | `identidad/credenciales.ts` |
| `sesion_iniciada`, `sesion_cerrada`, `acceso_rechazado`, `autorizacion_otorgada` | **Bitácora de conducta laboral** | `identidad/eventos.ts` |
| Fichajes: entrada, salida, inicio y fin de descanso, con autorizador y motivo | Jornada laboral | `personal/asistencia.ts` |
| `tarifa_hora`, `sueldo_por_dia`, propinas, faltas, descuentos, total de prenómina | **Patrimonial** | `personal/prenomina.ts` |
| Asignación de mesas y turnos | Laboral | `personal/asignaciones.ts` |
| Cruce opinión × mesero | **Evaluación de desempeño** | `clientes/opinion.ts` → `opinionesPorMesero()` |

> **Lo que hay que decirle al personal y hoy nadie le dice.** MotRest no es sólo una caja: registra
> a qué hora entró cada quien, cuánto gana, cuánta propina recibió, cada acción que hizo en el
> sistema y **qué calificación le pusieron los comensales de sus mesas**. Eso es tratamiento de
> datos personales con efectos laborales, y exige aviso de privacidad propio (**C2**).
>
> **MotRest no captura biométricos hoy** — ni huella ni rostro. Si algún día lo hace, cambia de
> categoría: dato sensible, consentimiento expreso y por escrito de cada trabajador, y **prohibido
> condicionar el empleo a otorgarlo**.

### 2.3 Datos que MOTRAE trata como responsable

| Dato | Origen | Nota |
|---|---|---|
| Restaurante: nombre, contacto, **responsable (persona física)**, teléfono, correo, plan, cuota | `organizacion/central.ts` → `ClienteMotRest`; alta en `apps/central/src/paneles/Alta.svelte` | Son datos personales del dueño o encargado, no sólo de la empresa. |
| `pagos[]`, `resultados[]` | `organizacion/central.ts` | Historial comercial. |
| `notas` de MOTRAE — *«nunca las ve el restaurante»* | `organizacion/central.ts` | **Sujetas a derecho de acceso.** Que el cliente no las vea en la pantalla no significa que no pueda pedirlas: si contienen datos personales de una persona física identificable, un ARCO las alcanza. Redactarlas como si fueran a leerse. |
| **Pulso** | `organizacion/central.ts` → `PulsoCliente`; `supabase/migrations/…_padron_y_pulsos.sql` | Ver §3. |

---

## 3. El pulso: lo que sale del restaurante hacia MOTRAE

Cada Hub reporta **al arrancar y cada 24 horas** a la nube. Es la única recolección continua que
MOTRAE hace desde dentro de un local, y hoy **no está declarada en ningún documento que el cliente
haya visto**.

**Lo que viaja:** `sucursal_id`, `ts` (lo pone el servidor, no el local), `version`, **`ventas_dia`**,
`cuentas_dia`, `terminales`, `dispositivos[]` (id recortado, nombre, aprobado, visto), `hub_id`,
`plataforma`, `arranque_automatico`, `respaldo_ts`, conteo de eventos, `problemas[]`.

**Lo que NO viaja:** comandas, clientes, empleados, tokens, contenido de mensajes. La nube
**recorta campo a campo** y guarda **sólo el último pulso por local, sin serie temporal** — decisión
deliberada de [ADR-26](../docs/adr/ADR-26-actualizacion-remota.md) para que la nube nunca se
convierta en el sitio donde vive la operación de toda la cartera.

**Calificación:** `ventas_dia` **no es dato personal** — es información comercial de una empresa.
Pero es información sensible del negocio y su recolección continua tiene que estar **autorizada en
el contrato (A1)**. Recolectar la cifra de venta diaria de un cliente sin habérselo dicho es el tipo
de cosa que, descubierta por accidente, destruye la confianza que sostiene el modelo de cobro por
resultado.

---

## 4. Destinatarios: a quién sale el dato fuera del local

| Destinatario | Qué recibe | Figura | Dónde está en el código |
|---|---|---|---|
| **Google (Gmail SMTP)** | Correo del comensal + contenido del mensaje | Subencargado | `apps/hub/src/smtp.ts` |
| **Resend** | Igual, en modo dominio propio o compartido | Subencargado | `apps/hub/src/correo.ts` |
| **Meta / WhatsApp Cloud API** | Teléfono del comensal + contenido | Subencargado | `supabase/functions/` |
| **PAC (a elegir por el restaurante)** | CFDI con RFC y nombre del receptor | Subencargado del restaurante | `apps/hub/src/fiscal/pac-http.ts` |
| **SAT** | El CFDI timbrado | Obligación legal | `fiscal/representacion.ts` |
| **GitHub** | Nada personal. Sólo descarga de instaladores | Proveedor de infraestructura | `apps/hub/src/actualizaciones.ts` |
| **Supabase** | Padrón, pulso, tránsito de WhatsApp, instaladores | **Subencargado** | `supabase/` |

**Transferencias fuera de México.** Google, Resend, Meta, GitHub y **Supabase** procesan en el
extranjero. Bajo la ley de 2025, el responsable sólo puede transferir o remitir fuera del territorio
nacional cuando el receptor **se obligue a proteger los datos conforme a los principios de la ley**.
Se cubre con la lista nominal de subencargados del **A3** y con la mención en los avisos.

> **Supabase es el subencargado nuevo, y hay que nombrarlo.** El proyecto está en
> `us-east-1` (Virginia, EE. UU.); no existe región en México. Ahí viven el padrón, el pulso de cada
> local y el tránsito de los mensajes de WhatsApp. **Los tokens de Meta van cifrados por MOTRAE con
> AES-256-GCM antes de escribirse**, así que Supabase los almacena sin poder leerlos — pero el resto
> de los campos sí los ve, y por eso es subencargado y no un mero proveedor de infraestructura como
> GitHub.
>
> Antes esta fila decía «Relay de MOTRAE», un servidor propio. Ese servidor **nunca llegó a
> desplegarse**: el dominio no se registró y la aplicación no tenía máquinas. Ningún dato de ningún
> restaurante pasó jamás por él, así que no hubo tratamiento que declarar en ese periodo.

---

## 5. Retención

| Dato | Hoy | Lo que debe ser | Fundamento |
|---|---|---|---|
| Comprobantes fiscales y contabilidad | Sin purga | **5 años** | CFF art. 30 |
| Ticket (copia impresa/digital) | `MESES_RETENCION = [3, 6, 12, 24]`, por defecto 3 (`apps/pos-ui/src/lib/local.svelte.ts`) | Se conserva | Configurable por el local |
| Opiniones con comentario libre | **Sin política** | Propuesta: 24 meses | Principio de proporcionalidad |
| Reservas (nombre + teléfono) | **Sin política** | Propuesta: 12 meses tras la fecha | Principio de finalidad |
| Mensajes de WhatsApp | **Sin política** | Propuesta: 12 meses | Principio de finalidad |
| Ficha del comensal | Baja lógica, **nunca se borra** | Supresión real a petición; purga a los 36 meses sin visita | Derecho de cancelación |
| Bitácora del personal | Sin purga (event log append-only) | Se conserva: es la auditoría | Interés legítimo + prueba |
| Pulso | Sólo el último, sin histórico | Correcto | — |

Detalle en **D4 · Política de retención**.

---

## 6. Medidas de seguridad existentes

Lo que se declare en el **A3** tiene que ser esto y no una lista de deseos.

**Implantado:**
- Contraseñas y PIN con **PBKDF2-SHA256** (310 000 iteraciones para PIN, 600 000 para contraseña),
  con sal por credencial. Bloqueo a los 7 intentos fallidos.
- **Ed25519** para firmar licencias y manifiestos de actualización; verificación **offline**.
- **DPAPI** de Windows para las llaves privadas en MotRest Central.
- **AES-256-GCM** para los tokens de Meta en el padrón. Los cifra MOTRAE antes de escribirlos:
  Supabase guarda texto cifrado y no tiene la llave.
- **AES-256-GCM en el canal entre terminales y Hub**, con la clave del local. **No es TLS**, y la
  razón está en `packages/protocolo-sync/src/cifrado.ts`: un Hub de LAN no tiene nombre de dominio,
  y un certificado autofirmado obligaría a saltarse la advertencia roja del navegador en cada caja.
- Sólo `https://` hacia la nube, comprobado antes de abrir sesión.
- **ACL de NTFS** (`icacls`) sobre las carpetas con secretos: cortan la herencia y dejan dentro a
  SYSTEM, administradores y la cuenta que ejecuta el Hub. Resuelto en CN-033 — antes el `0o600` no
  restringía a nadie en Windows.
- **BitLocker obligatorio en la caja** como acción de puesta en marcha, antes de cargar el CSD.
- **Matriz rol × acción** con prevención de escalada: nadie administra a un igual o superior, y
  nadie delega lo que no tiene.
- **Event log append-only**: la bitácora no se puede alterar ni borrar, ni siquiera por MOTRAE.
- Identidad del Hub derivada de su credencial, **nunca de lo que el propio Hub declare**.
- Portal del comensal con enlace firmado HMAC-SHA256 + HKDF, de alcance **una sola cuenta**.

**Abierto, y reconocido en [`docs/SEGURIDAD.md`](../docs/SEGURIDAD.md):**
- 🔴 **`hub.sqlite` y sus respaldos rotativos no están cifrados por la aplicación.** Ahí están
  nombres, teléfonos, correos, domicilios, RFC, sueldos y propinas. **BitLocker cubre el robo del
  disco**, que es el escenario principal; no cubre a quien tenga acceso administrativo al equipo
  encendido. SQLCipher es la salida pendiente, y la decisión va antes de firmar el A3.
- 🟠 **La contraseña del CSD se guarda junto a la llave** (CN-004, **aceptado**). El Hub tiene que
  poder sellar sin que nadie la teclee tras un reinicio. Mitigado con BitLocker y ACL.
- 🟠 Sin MFA. Sin expiración de sesión por inactividad.
- 🟠 **Clave del local compartida entre terminales**: el canal por sí solo no distingue una terminal
  de otra. La atribución se apoya en el `empleado_id` y en la revalidación del Hub, no en el cifrado.
- 🟠 Sin secreto hacia adelante en el canal.
- 🟠 Instalación en `currentUser` (CN-037, **aceptado**): el instalador no pide administrador, a
  cambio de que el ejecutable viva en una carpeta escribible por esa cuenta. La firma Authenticode
  del Hub hace detectable un reemplazo.

---

## 7. Brechas de cumplimiento abiertas

| # | Brecha | Impacto | Se cierra en |
|---|---|---|---|
| 1 | No hay aviso de privacidad publicado | **Bloquea la verificación de empresa en Meta** → sin WhatsApp para toda la cartera | **B1**, ya |
| 2 | El enlace de baja del correo de marketing **no existe en producción** | Marketing sin salida; incumple LFPDPPP y las reglas de remitente masivo de Gmail | **C4** + §5.1 del plan |
| 3 | Sin ruta técnica para el derecho de cancelación sobre un log append-only | 20 días para responder y hoy no se puede | **D3** + §5.2 |
| 4 | Sin contrato ni convenio de encargado con el restaurante | El acceso de soporte rango 120 queda sin sustento | **A1–A3** |
| 5 | Datos sin cifrar en reposo | Ver §6 | Decisión previa al **A3** |
| 6 | `notas` = alergias sin tratamiento de dato sensible | Multa al doble | Decisión de §2.1 |
| 7 | Sin política de retención del comensal | Principio de proporcionalidad | **D4** |
| 8 | El pulso no está declarado | Confianza + base contractual | **A1** |
| 9 | `docs/SOPORTE-Y-ACCESO-REMOTO.md` está citado en el código y no existe | El código promete un documento inexistente | **Etapa 4** |
| 10 | El portal del comensal sólo abre desde el wifi del local | Un aviso o una baja servidos ahí **no cumplen** disponibilidad permanente | Publicar en `motrest.mx` |

---

## 8. Prerrequisitos de infraestructura

Dos cosas que no son redacción y sin las cuales los documentos no pueden publicarse:

1. **El dominio `motrest.mx` tiene que existir y estar bajo control de MOTRAE.** El código ya
   depende de él: `DOMINIO_MOTRAE = "avisos.motrest.mx"` en `clientes/correo.ts`. Ahí van a vivir
   el aviso integral, los avisos por local (`/p/<local>`) y la ruta de baja. La web corporativa
   `www.motrae.com` **no sirve** para esto: el aviso de privacidad de MotRest debe estar donde el
   comensal pueda relacionarlo con lo que tiene enfrente.
2. **SPF, DKIM y DMARC publicados en `motrest.mx`.** Al conservar el dominio compartido, MOTRAE es
   remitente masivo ante Google y Yahoo, y sus reglas caen sobre MOTRAE, no sobre el restaurante.

---

## 9. Mantenimiento

Este archivo se actualiza **antes** que el código cuando una función nueva toque datos personales.
Regla práctica: si un cambio añade un campo a un evento del `event log`, o abre una salida de red
nueva, **pasa por aquí primero**.

Documentos que dependen de este: `A1`, `A2`, `A3`, `A4`, `B1`, `C1`, `C2`, `C3`, `C4`, `D1`–`D4`.
