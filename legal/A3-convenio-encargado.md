# Convenio de Encargado del Tratamiento de Datos Personales

**Anexo del Contrato de Suscripción y Servicio · Versión 1.0 · 12 de agosto de 2026**

> **Nota interna — borrar antes de publicar.**
> Sustituir: `[NOMBRE COMPLETO]`, `[RFC]`, `[DOMICILIO FISCAL COMPLETO]`.
> **Bloqueante antes de la primera firma:** decidir el punto abierto del Anexo II §3 (cifrado en
> reposo). Firmar «medidas adecuadas» sabiendo que la base de datos y sus respaldos están en claro
> es peor que no firmar nada: es prueba escrita.
> **Bloqueante:** decidir el tratamiento del campo `notas` (alergias) — ver `00-mapa-de-datos.md` §2.1.

---

## Por qué existe este documento

Cuando un restaurante usa MotRest, los datos de sus comensales y de su personal **siguen siendo
responsabilidad del restaurante**. MOTRAE sólo los procesa por encargo suyo. La ley llama a esas dos
figuras **responsable** y **encargado**, y exige que la relación entre ambos conste por escrito.

Este convenio es ese documento. No es una formalidad: bajo la Ley Federal de Protección de Datos
Personales en Posesión de los Particulares (DOF 20-mar-2025), el contrato de encargado es un
**documento de cumplimiento exigible**.

---

## 1. Las partes y su papel

**EL RESPONSABLE:** el Cliente identificado en la Carátula del documento A2 — el restaurante. Es
quien decide qué datos recaba de sus comensales y de su personal, para qué, y quién debe darles su
aviso de privacidad.

**EL ENCARGADO:** `[NOMBRE COMPLETO]`, persona física con actividad empresarial, RFC `[RFC]`, con
domicilio en `[DOMICILIO FISCAL COMPLETO]`, Xalapa, Veracruz, que opera bajo la marca **MOTRAE**.

**La regla que resume todo lo demás:** el Encargado trata los datos **únicamente por cuenta del
Responsable y conforme a sus instrucciones**. No decide sobre ellos, no los usa para fines propios y
no los comparte salvo lo previsto aquí.

## 2. Qué datos y de quién

| Categoría de titular | Datos tratados |
|---|---|
| **Comensales** | Nombre, teléfono, correo, domicilio, datos fiscales (RFC, régimen, CP), preferencias, historial de consumo, saldos de lealtad, reservas, opiniones y comentarios, mensajes de WhatsApp. |
| **Personal del Responsable** | Nombre, puesto, rol y permisos, credenciales de acceso (en forma cifrada e irreversible), fichajes de jornada, sueldo, propinas, prenómina y bitácora de actuaciones en el sistema. |
| **Socios e inversionistas del Responsable** | Nombre, participación y beneficios pactados. |
| **Proveedores del Responsable** | Datos de contacto y fiscales. |

**Datos sensibles.** El sistema **no está destinado a tratar datos personales sensibles**. El
Responsable se obliga a no capturar en los campos de texto libre —notas del comensal, comentarios de
opinión, observaciones— información de salud, origen étnico, creencias, afiliación sindical, opinión
política, preferencia sexual o datos genéticos o biométricos. Si el Responsable lo hiciera, asume las
obligaciones reforzadas que la ley impone para esa categoría.

## 3. Finalidades del tratamiento — cerradas

El Encargado trata los datos **exclusivamente** para:

1. Operar el software MotRest en el establecimiento del Responsable.
2. Prestar el soporte técnico contratado.
3. Realizar y conservar los respaldos de la información.
4. Instalar actualizaciones y corregir defectos.
5. Cumplir instrucciones expresas y documentadas del Responsable.

**Nada más.** El Encargado **no** utiliza los datos para desarrollar productos, entrenar modelos,
elaborar estadísticas comerciales, prospectar, vender ni compartir con terceros no listados en la
cláusula 6.

## 4. Obligaciones del Encargado

1. **Tratar los datos sólo según las instrucciones del Responsable.** Si el Encargado considera que
   una instrucción infringe la ley, se lo hará saber por escrito antes de ejecutarla.
2. **Guardar confidencialidad**, durante la vigencia y de forma indefinida después, y obligar a lo
   mismo a toda persona que intervenga.
3. **Implantar y mantener las medidas de seguridad** administrativas, técnicas y físicas del
   **Anexo II**, adecuadas al tipo de datos y a los riesgos identificados.
4. **Limitar el acceso** a las personas que lo necesiten para prestar el servicio, y dejar registro
   de sus actuaciones en la bitácora inalterable del sistema.
5. **Asistir al Responsable** en la atención de solicitudes ARCO y de revocación del consentimiento,
   dentro de los **5 días hábiles** siguientes a que se le requiera, aportando la información y los
   medios técnicos necesarios. Ver cláusula 8.
6. **Notificar al Responsable toda vulneración de seguridad** en cuanto la detecte y, en todo caso,
   dentro de las **24 horas** siguientes. Ver cláusula 9.
7. **No transferir** los datos a terceros distintos de los subencargados listados, salvo mandato de
   autoridad competente, en cuyo caso lo informará al Responsable si la ley se lo permite.
8. **Devolver o suprimir** los datos al terminar la relación, conforme a la cláusula 10.
9. **Permitir y facilitar** al Responsable, o a quien éste designe, la verificación del cumplimiento
   de este convenio, con aviso razonable y sin perturbar la operación.

## 5. Obligaciones del Responsable

1. **Dar su propio aviso de privacidad** a comensales y personal, y obtener los consentimientos que
   correspondan. MOTRAE le entrega plantillas listas (documentos **C1**, **C2** y **C4**), pero
   **la obligación es del Responsable**.
2. **Capturar sólo los datos necesarios** y no introducir datos sensibles en campos de texto libre.
3. **Obtener consentimiento previo** antes de enviar comunicaciones comerciales, y respetar toda
   baja de inmediato, conforme al documento **C4**.
4. **Consultar el Registro Público para Evitar Publicidad (REPEP)** de PROFECO antes de una campaña
   publicitaria, cuando la normativa aplicable lo exija.
5. **Custodiar las credenciales** de su personal y dar de baja los accesos de quien deje de laborar.
6. **Atender las solicitudes ARCO** de sus comensales y de su personal: es el Responsable quien
   responde, con el apoyo técnico del Encargado.
7. **Instruir por escrito** cualquier tratamiento distinto de los de la cláusula 3.

## 6. Subencargados

El Responsable **autoriza** al Encargado a apoyarse en los siguientes proveedores, cada uno para su
función y ninguno para otra:

| Subencargado | Función | Dato que recibe | Ubicación |
|---|---|---|---|
| **Google** (Gmail / SMTP) | Entrega de correo del restaurante | Correo del destinatario y contenido del mensaje | EE. UU. |
| **Resend** | Entrega de correo, en modo dominio propio o compartido | Igual | EE. UU. |
| **Meta Platforms** (WhatsApp Business) | Mensajería con el comensal | Teléfono y contenido del mensaje | EE. UU. |
| **GitHub** | Distribución de actualizaciones | **Ningún dato personal** | EE. UU. |
| **Supabase** | Padrón, pulso de cada local, tránsito de WhatsApp e instaladores | Tokens de Meta cifrados por MOTRAE; el resto en claro | EE. UU. (`us-east-1`) |

**El PAC** que timbra los comprobantes fiscales **lo contrata el Responsable directamente**, y por
tanto es subencargado suyo, no de MOTRAE. Ver documento **A4**.

**Transferencias fuera de México.** Varios subencargados procesan en el extranjero. El Encargado se
obliga a que cada uno asuma compromisos de protección conformes con los principios y deberes de la
ley mexicana.

**Cambios.** El Encargado avisará al Responsable con **30 días naturales** de anticipación antes de
incorporar o sustituir un subencargado. El Responsable puede oponerse por escrito y motivadamente; si
el cambio es indispensable y la objeción se mantiene, cualquiera de las partes puede terminar la
relación sin penalización.

## 7. Dónde viven los datos

**Dentro del establecimiento del Responsable.** MotRest es un sistema de arquitectura local: la base
de datos completa reside en el equipo de caja del propio restaurante, junto con sus respaldos. **No
existe una copia central de la operación en poder de MOTRAE.**

Lo único que sale del establecimiento hacia MOTRAE es el **estado de salud** descrito en la cláusula
11 del documento A1, que no contiene datos personales de comensales ni de empleados.

Es una decisión de arquitectura y es la mejor garantía de este convenio: MOTRAE no puede hacer un uso
indebido de una base de datos que no tiene.

## 8. Derechos ARCO — cómo se atienden

El titular —comensal o empleado— ejerce sus derechos **ante el Responsable**, que es quien debe
responderle dentro de los **20 días hábiles** que marca la ley.

**El Encargado apoya así**, dentro de los 5 días hábiles siguientes a que se le solicite:

| Derecho | Qué hace MOTRAE |
|---|---|
| **Acceso** | Extrae y entrega la información del titular en formato legible. |
| **Rectificación** | Corrige los datos indicados por el Responsable. |
| **Cancelación** | Suprime los datos personales del titular de la base activa **y de los respaldos**, conservando el hecho económico —la venta, el comprobante fiscal— que el Código Fiscal obliga a guardar cinco años. |
| **Oposición** | Marca al titular para que quede excluido del tratamiento indicado, incluidas las comunicaciones comerciales. |
| **Revocación del consentimiento** | Registra la revocación y corta de inmediato el envío de comunicaciones comerciales. |

**Un límite técnico que se declara con franqueza.** MotRest conserva un registro de hechos que sólo
admite añadir, nunca alterar: es lo que hace confiable la auditoría del negocio. La supresión se
ejecuta mediante un mecanismo que **elimina los datos personales del titular y de todas sus
proyecciones y respaldos**, dejando intacto el hecho económico despersonalizado. Es la forma de
atender el derecho de cancelación sin destruir la contabilidad del Responsable ni su capacidad de
responder ante el SAT.

## 9. Vulneraciones de seguridad

Si el Encargado detecta una vulneración que afecte los datos tratados por cuenta del Responsable:

1. **Avisa al Responsable de inmediato y, como máximo, en 24 horas**, por correo y por teléfono.
2. Le informa: qué ocurrió, cuándo, qué datos y cuántos titulares están afectados, qué consecuencias
   son previsibles y qué medidas está tomando.
3. Le entrega lo que necesite para notificar a los titulares afectados. **La notificación al titular
   corresponde al Responsable**, porque es quien tiene la relación con él.
4. Documenta el incidente, sus causas y las medidas correctivas, y entrega ese informe al
   Responsable.

La ley obliga a comunicar de forma **inmediata** al titular las vulneraciones que afecten de manera
significativa sus derechos patrimoniales o morales, para que pueda tomar medidas. Ambas partes se
obligan a actuar con esa urgencia.

## 10. Al terminar la relación

Dentro de los **5 días hábiles** siguientes a la terminación, o antes si el Responsable lo pide:

1. El Encargado **entrega** al Responsable la totalidad de la información, en formato legible y
   utilizable.
2. Dentro de los **30 días naturales** siguientes a la entrega, el Encargado **suprime** los datos
   de sus sistemas y de los de sus subencargados, y lo confirma por escrito.
3. **Excepción:** lo que el Encargado deba conservar por obligación legal —fiscal o contable— queda
   bloqueado y se usa sólo para cumplirla.

Los datos que residan en el equipo del propio Responsable **permanecen en su poder**: son suyos y
MOTRAE no los retira.

## 11. Responsabilidad

Cada parte responde por el incumplimiento de sus propias obligaciones.

El Encargado responde frente al Responsable por los daños que le cause por incumplir este convenio o
por actuar fuera de sus instrucciones. **El límite de responsabilidad de la cláusula 15 del documento
A1 no aplica a las obligaciones de este convenio.**

El Responsable responde por la licitud de los datos que recaba, por haber informado a los titulares y
por haber obtenido los consentimientos necesarios.

## 12. Vigencia

Este convenio está vigente mientras lo esté el Contrato de Suscripción y Servicio, y en lo relativo a
confidencialidad, supresión y responsabilidad, sobrevive a su terminación.

---

# Anexo I · Detalle del tratamiento

| Concepto | Contenido |
|---|---|
| **Naturaleza** | Recolección, almacenamiento, uso, transmisión y supresión, por medios electrónicos. |
| **Finalidad** | Operación del software, soporte, respaldo y actualización. |
| **Duración** | La del contrato, más los plazos de supresión de la cláusula 10. |
| **Ubicación principal** | Equipo de caja del establecimiento del Responsable. |
| **Copias** | Respaldos automáticos locales, con rotación. |
| **Salidas al exterior** | Correo (Google / Resend), WhatsApp (Meta, vía la nube de MOTRAE en Supabase), timbrado (PAC del Responsable), estado de salud (la misma nube). |

# Anexo II · Medidas de seguridad

## 1. Administrativas

- Acceso limitado al personal de MOTRAE que lo requiera para el soporte.
- Obligación de confidencialidad, vigente de forma indefinida.
- Bitácora de auditoría **inalterable**: toda actuación de la cuenta de mantenimiento queda
  registrada y **no puede borrarse ni modificarse, tampoco por MOTRAE**.
- Procedimiento documentado de atención de derechos ARCO (documento D3) y de gestión de
  vulneraciones (documento D2).
- Política de retención documentada (documento D4).

## 2. Técnicas

- **Credenciales**: PIN y contraseñas protegidos con PBKDF2-SHA256 y sal por credencial —310 000
  iteraciones para PIN, 600 000 para contraseña—. **Son irreversibles: ni MOTRAE puede recuperarlas.**
  Bloqueo automático tras siete intentos fallidos.
- **Firma criptográfica Ed25519** de licencias y de paquetes de actualización, verificada localmente.
  Ninguna versión no emitida por MOTRAE puede instalarse.
- **Cifrado AES-256-GCM** de los tokens de Meta antes de escribirlos en la nube: los cifra MOTRAE,
  y el proveedor los almacena sin poder leerlos.
- **Almacén protegido del sistema operativo (DPAPI)** para las llaves privadas del panel de
  administración de MOTRAE.
- **Cifrado AES-256-GCM del canal entre las terminales y el equipo de caja**, con la clave del
  establecimiento. Cubre ventas, precios, importes de caja y datos del personal, e impide que
  alguien en la red del local lea la operación o inyecte movimientos falsos.
- **Conexión al servicio de MOTRAE exclusivamente por `wss://`**, verificado antes de abrir el canal.
- **Listas de control de acceso (ACL de NTFS)** sobre las carpetas que contienen secretos, que
  cortan la herencia y limitan el acceso al sistema, a los administradores y a la cuenta que ejecuta
  el servicio.
- **Matriz de rol por acción** con prevención de escalada de privilegios: nadie administra a un
  igual o superior, y nadie puede otorgar un permiso que no posea.
- **Identidad derivada de credencial**: la identidad de cada establecimiento se deduce de su
  credencial de autenticación, nunca de lo que el propio equipo declare.
- **Portal del comensal de alcance mínimo**: enlace firmado con HMAC-SHA256 sobre secreto derivado
  por HKDF, que abre **una sola cuenta** y caduca; sin registro ni credenciales del comensal.
- **Registro de hechos que sólo admite añadir**, lo que hace detectable cualquier manipulación.

## 3. Físicas

- El equipo que aloja la base de datos **está en el establecimiento del Responsable y bajo su
  custodia física**. El Responsable se obliga a mantenerlo en un lugar de acceso restringido.
- **Cifrado de disco (BitLocker) activado en el equipo de caja.** Es un **requisito obligatorio de
  puesta en marcha** que MOTRAE aplica en la instalación y que el Responsable se obliga a mantener
  activo. Es la mitigación real del robo del equipo o del disco.
- El equipo de caja **no está expuesto a internet**: no tiene puertos abiertos ni dirección pública.
  Todas sus comunicaciones son salientes.
- La cuenta con la que opera el restaurante debe ser **estándar**, con bloqueo de pantalla activo.
- Los respaldos se conservan en el mismo equipo, con rotación automática.

## 4. Limitaciones declaradas — y qué se hace con ellas

MOTRAE prefiere declarar sus límites a afirmar medidas que no existen. Un convenio que promete
protecciones inexistentes no protege a nadie y sí acredita el incumplimiento.

**4.1 · La base de datos no está cifrada por la aplicación.**
El archivo del establecimiento y sus respaldos no llevan cifrado propio. Quien obtenga acceso de
administrador al equipo, con la sesión abierta, puede leer su contenido.

- **Mitigación vigente y suficiente frente al escenario principal:** el cifrado de disco BitLocker
  del §3. Con el disco cifrado, llevárselo no sirve de nada.
- **Lo que no cubre:** a quien ya tenga acceso administrativo al equipo encendido. Frente a eso
  operan la custodia física del Responsable, la cuenta estándar y el bloqueo de pantalla.
- **Compromiso de MOTRAE:** añadir cifrado a nivel de aplicación sobre la base de datos y sus
  respaldos. **Fecha comprometida: `[FECHA]`.**

**4.2 · El canal entre terminales usa una clave compartida por establecimiento.**
El tráfico va cifrado, pero la clave es común a las terminales del local, de modo que el canal por
sí solo no distingue una terminal de otra. **La atribución de cada acción a una persona no se apoya
en el cifrado**, sino en la credencial del empleado y en la revalidación de permisos que hace el
equipo de caja, que sí son individuales.

- **Compromiso de MOTRAE:** clave por terminal. **Fecha comprometida: `[FECHA]`.**

**4.3 · Sin segundo factor de autenticación ni expiración de sesión por inactividad.**
Compensado con el bloqueo definitivo tras siete intentos fallidos, el bloqueo de pantalla del
equipo y la bitácora inalterable.

- **Compromiso de MOTRAE:** ambos, en la fase siguiente del producto.

---

## Firmas

| **Por el Encargado (MOTRAE)** | **Por el Responsable (el Cliente)** |
|---|---|
| | |
| `[NOMBRE COMPLETO]` | Nombre: |
| RFC `[RFC]` | Cargo: |
| Fecha: | Fecha: |
