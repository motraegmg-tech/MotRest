# El acceso de soporte de MOTRAE

**Documento de transparencia.** Se entrega al cliente junto con el contrato y se puede compartir con
quien lo pida. Es el documento que `packages/dominio/src/identidad/soporte.ts` cita como sustento de
que este acceso «va en el contrato».

**Versión 1.0 · agosto de 2026**

---

## Qué es

Cada instalación de MotRest **con licencia de soporte vigente** incluye una cuenta técnica del
proveedor, identificada como **«Gonzalo DJA»** y ofrecida en la pantalla de acceso como **«Acceso de
soporte MOTRAE»**.

Sirve para que MOTRAE entre a resolver un problema sin pedirle su contraseña a nadie del
restaurante. Sin ella, «no me funciona la pantalla de cocina» un viernes a las nueve de la noche se
resuelve por teléfono, pidiéndole al gerente que lea menús en voz alta.

Lo tiene cualquier proveedor de software administrado. **La diferencia no está en que exista, sino
en si se puede auditar y si el cliente lo sabe.** Este documento existe para lo segundo.

---

## Qué puede hacer, sin adornos

**Todo.** La cuenta tiene todos los permisos del sistema, en su nivel máximo. Puede ver ventas,
cortes de caja, inventario, clientes, personal, sueldos y configuración fiscal, y puede ejecutar
cualquier operación del sistema.

No se documenta un alcance menor porque no lo tiene, y describirlo de otro modo sería falso. Un
acceso de soporte que sólo pudiera ver la mitad no serviría para resolver la otra mitad de las
incidencias.

**Lo que lo hace aceptable no es un permiso recortado, sino estas cinco cosas:**

### 1 · La credencial no está en el código

Viaja **dentro de la licencia firmada** con la llave privada de MOTRAE, y la elige Gonzalo en
MotRest Central. Consecuencias:

- Nadie que lea el repositorio del producto puede entrar.
- Nadie que edite un archivo del equipo puede fabricarse una cuenta con estos poderes: **sin la firma
  de MOTRAE, la licencia no vale.**
- Cada local puede tener su propia credencial de soporte.

### 2 · Existe sólo mientras la licencia lo diga

La cuenta **no se guarda como un alta de usuario**. Se arma en memoria a partir de la licencia cada
vez que arranca el sistema.

Esto significa que **retirar el acceso es retirar una línea de la licencia**: se reemite sin la
credencial de soporte y la cuenta deja de existir en la siguiente lectura. No queda residuo, no
sobrevive en la base de datos y no aparece en ninguna exportación de personal.

### 3 · Todo queda registrado y nadie puede borrarlo

Cada acción realizada con esta cuenta queda anotada en la bitácora del restaurante **con el nombre
«Gonzalo DJA»**.

La bitácora es el registro de hechos del sistema, que **sólo admite añadir**. No hay una tabla de
auditoría paralela que se pueda editar. **Ni MOTRAE puede tapar sus propios pasos.**

Que la cuenta esté oculta en las **listas de personal** no la oculta en la **bitácora**: el filtrado
ocurre en las pantallas, nunca en la auditoría. Es una distinción deliberada.

### 4 · Está por encima del propietario, y eso también protege al restaurante

Su rango (120) es superior al del propietario (100). Como en MotRest nadie administra a un rango
mayor que el suyo, **el restaurante no puede desactivar esta cuenta, ni cambiarle permisos, ni
borrarla**.

Suena a desventaja para el cliente y funciona al revés: impide que un empleado molesto —o alguien
que haya tomado una terminal— deje al local sin vía de auxilio la noche que algo se rompe.

### 5 · Es la única que puede entrar a un local bloqueado

Si al vencer la licencia nadie pudiera entrar, tampoco podría entrar quien va a reactivarla **ni
quien va a sacar los datos del restaurante para entregárselos**. Un bloqueo del que ni el proveedor
puede salir no es un bloqueo: es un ladrillo.

---

## Detalles de diseño que no son casualidad

- **El hash de la credencial sólo llega al equipo de caja**, nunca a las tabletas del salón. A una
  tableta no le sirve, y sí sería material para intentar adivinar con calma la contraseña.
- **No aparece entre los roles que pueden autorizar una operación.** Es el escondite que se olvida:
  un rol que asoma en el diálogo de «pide autorización a…» delata su existencia a cualquier mesero.
- **La credencial es una contraseña fuerte**, no un PIN de cuatro dígitos, y se protege con la misma
  derivación criptográfica que el resto.
- **La llave privada con la que se firman las licencias** vive cifrada con el almacén protegido del
  sistema operativo en el equipo de MOTRAE, con respaldo separado.

---

## Los compromisos de MOTRAE

Están en la cláusula 9 del contrato de licencia y se repiten aquí:

1. **Se usa exclusivamente para el soporte contratado.** Cualquier otro uso es incumplimiento del
   contrato y del convenio de tratamiento de datos.
2. **No se usa para extraer, copiar ni analizar la información del cliente** con fines propios.
3. **Se avisa antes de entrar** siempre que sea posible. En una urgencia se entra y se informa
   después, el mismo día.
4. **El cliente puede pedir el reporte de accesos** de esta cuenta cuando quiera. MOTRAE se lo
   entrega dentro de los 5 días hábiles siguientes.
5. **El cliente puede pedir que se retire el acceso.** MOTRAE reemite la licencia sin la credencial.
   Consecuencia que hay que aceptar por escrito: a partir de ese momento el soporte remoto deja de
   ser posible y toda incidencia se atiende por teléfono o presencialmente.

---

## Cómo comprobarlo usted mismo

No hace falta creerle a este documento:

1. **Abra la bitácora** y filtre por «Gonzalo DJA». Ahí está todo lo que MOTRAE ha hecho en su
   sistema, con fecha y hora.
2. **Intente borrar una línea.** No se puede. Es el mismo mecanismo que impide que un empleado borre
   una cancelación suya.
3. **Pida el reporte de accesos** por escrito y contrástelo con lo que ve en su bitácora.

Si alguna vez encuentra en la bitácora una actuación de esta cuenta que MOTRAE no le haya informado,
tiene un incumplimiento documentado y las consecuencias contractuales que correspondan.

---

## Documentos relacionados

- [`legal/A1-eula.md`](../legal/A1-eula.md) — cláusula 9, el compromiso contractual.
- [`legal/A3-convenio-encargado.md`](../legal/A3-convenio-encargado.md) — las obligaciones de MOTRAE
  como encargado del tratamiento.
- [`docs/adr/ADR-24-licencia-y-soporte.md`](adr/ADR-24-licencia-y-soporte.md) — la decisión técnica y
  su razonamiento.
- [`docs/SEGURIDAD.md`](SEGURIDAD.md) — la postura de seguridad completa del producto.
