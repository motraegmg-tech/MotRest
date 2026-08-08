# Seguridad de MotRest — postura actual y sus límites

Documento honesto sobre qué protege el sistema hoy y qué **todavía no**. Se
actualiza en cada etapa. Estado: **etapa 2 de F1** (identidad y control de accesos).

## Principio rector

El TRD §10 lo dice sin ambigüedad: **el cliente evalúa para la experiencia, el
servidor evalúa para la verdad**. Mientras el Hub no exista (etapa 10), toda la
autorización ocurre en el dispositivo, y eso hay que decirlo claro:

> **Hoy la seguridad de MotRest es de tipo "control interno", no de tipo
> "resistente a un atacante con acceso al equipo".** Sirve para separar
> responsabilidades entre el personal y dejar rastro auditable. No sirve todavía
> para defenderse de alguien que controle físicamente la caja.

## Credenciales

- **Nunca se guarda el secreto.** Solo su derivación **PBKDF2-SHA256** con sal
  aleatoria de 16 bytes, vía WebCrypto.
- **Iteraciones:** 600 000 para contraseñas, 310 000 para PIN. El PIN usa menos
  porque el cambio rápido de usuario ocurre decenas de veces por turno y la
  latencia se nota; es un compromiso consciente.
- **Comparación en tiempo constante**, para no filtrar información por el tiempo
  de respuesta.
- **Espera progresiva:** a partir del cuarto fallo la espera se duplica
  (2 s, 4 s, 8 s…) con tope de 5 minutos.
- **Tope duro de 7 intentos** (decisión de Gonzalo), igual para contraseñas y
  PIN. Al séptimo fallo la credencial queda **bloqueada de forma definitiva**:
  no se levanta con el tiempo, solo un rol con permiso de administración puede
  reactivarla desde el panel de usuarios. Aplica a los tres puntos de entrada:
  pantalla de acceso, cambio rápido de usuario y diálogo de autorización.
  Además de proteger la cuenta, acota el trabajo del verificador —y, cuando
  exista, del backend— frente a un intento de martilleo.

### El límite real de un PIN

Un PIN de 4–6 dígitos tiene entre 10 000 y 1 000 000 de combinaciones. Frente a
alguien que obtenga el archivo de hashes, **ningún algoritmo lo salva**: PBKDF2
solo encarece el ataque, no lo impide. Lo que de verdad protege es la
combinación de:

1. caché cifrada en el dispositivo (pendiente: etapa 4),
2. expiración corta de esa caché (pendiente: etapa 10),
3. **tope de 7 intentos con bloqueo definitivo (ya implementado)** — es la
   defensa más eficaz de las cuatro mientras no exista el Hub: reduce el espacio
   explorable de un millón de combinaciones a siete,
4. el Hub como fuente canónica que revalida todo (pendiente: etapa 10).

El PIN es apropiado para lo que es: **autorizar acciones de piso ante un
testigo**, no para proteger secretos.

## Credenciales iniciales

En producción el propietario se siembra **sin credenciales**. Si no hay una
licencia de Central, el primer arranque genera una contraseña y un PIN únicos
del local, conserva solamente sus hashes y los muestra una sola vez.

Cuando MOTRAE Central da de alta un restaurante, crea además el perfil del
**responsable** como `propietario` y un PIN inicial aleatorio de ocho dígitos.
Central guarda solo el hash dentro de DPAPI; la licencia firmada lo entrega
solamente a la caja, nunca a las tablets. MotRest exige que el responsable lo
cambie en su primer acceso.

El acceso técnico **Gonzalo DJA** es una cuenta distinta, oculta de las listas
de personal y superior al propietario. Su contraseña fuerte se configura en
Central → Llaves y nunca se incrusta como un PIN común en código, instaladores o
licencias de otras sucursales.

**Los usuarios de demostración (Marco y Lucía) existen solo en modo demo.** Sus
credenciales conocidas no se incluyen en un instalador de producción.

## Restablecer una credencial olvidada

Un mesero olvida su PIN a media tarde y no puede cobrar. Pasa varias veces al
mes y necesita una salida que no obligue a nadie a dejar la caja.

Desde la pantalla de acceso, con el usuario ya elegido, aparece **«Olvidé mi
PIN»**. Para completarlo hacen falta **dos** cosas de quien lo firma, y ninguna
sobra:

1. El permiso **«Autorizar cambio de PIN»** (`admin.credencial.autorizar`), que
   se otorga por usuario y está separado de «Editar usuarios».
2. Un rango **estrictamente mayor** que el del afectado.

El segundo es el que evita una toma de control: sin él, un gerente con permiso
de credenciales podría restablecer la contraseña del dueño y entrar como él.

**Consecuencia deliberada: la credencial del propietario no la restablece
nadie.** Por encima de él no hay rango, así que el botón ni siquiera se le
ofrece. La cambia él mismo desde el menú de usuario, estando dentro — y por eso
esa otra ruta existe.

Restablecer también **borra los intentos fallidos** del afectado: quien olvidó
su PIN suele haberlos gastado tratando de recordarlo, y dejarlo bloqueado
resolvería la mitad del problema.

Queda en la bitácora con `autorizador_id`. Distinguir «cambié mi contraseña» de
«alguien me la restableció» es lo que hace útil esa línea si después aparece un
movimiento raro con esa cuenta.

### Sobre el cambio obligatorio en el primer inicio

Un usuario recién dado de alta nace con la obligación de cambiar su PIN: lo
eligió quien lo registró, así que hay una persona más que lo conoce, y la
bitácora solo significa algo cuando la cuenta es de una sola persona.

El propietario sembrado **ya no** la lleva. La tenía porque su contraseña
inicial circuló fuera del sistema, pero en la práctica lograba lo contrario:
como la obligación solo se levanta al completar el cambio, quien cerraba el
diálogo se lo encontraba en cada inicio, y un aviso que se cierra sin leer no
protege nada.

## El código de rescate: la llave de repuesto del propietario

Restablecer una credencial exige un rango **estrictamente mayor**, y por encima
del propietario no hay nadie. Esa consecuencia era deliberada —evita que un
gerente tome control de la cuenta del dueño— pero dejaba un agujero operativo
serio: si el dueño olvidaba su contraseña y agotaba sus siete intentos, quedaba
fuera de su propio negocio **para siempre**, con años de operación y de
comprobantes fiscales dentro. Un candado sin llave de repuesto no es seguridad,
es una bomba de tiempo.

**Cómo funciona.** El código **no se emite solo**: se pide desde
**Administración → Usuarios**, y solo el propietario lo ve. Se enseña **una
sola vez**, con ~98 bits de entropía:

```
A7K2M-9PQRS-3TVWX-YZ4BC
```

- Se guarda **solo su hash** PBKDF2, con las mismas iteraciones que una
  contraseña. Ni el disco ni el respaldo lo contienen en claro.
- Es de **un solo uso**: al gastarlo se emite otro en el acto, para que un
  código anotado en un papel viejo no siga sirviendo. El nuevo se muestra antes
  de dejar salir de la pantalla.
- Está sujeto a la **misma política de intentos** que todo lo demás.
- Deja un evento `acceso_recuperado` en la bitácora, marcado como **alerta**:
  es el único cambio de credencial que no firma otra persona, así que tiene que
  poder auditarse por sí solo. Si el dueño ve uno que no reconoce, hay que actuar.

**Por qué no es una puerta trasera.** La llave es el código, no la presencia
física ni un identificador adivinable. El alfabeto excluye caracteres ambiguos
(`I`, `L`, `O`, `U`, `0`, `1`) porque va a viajar en papel, y al teclearlo se
corrigen las confusiones clásicas — eso mejora la usabilidad sin reducir la
entropía, que vive en los 20 caracteres elegidos al azar con el generador
criptográfico del entorno.

**Un local sin código emitido no tiene rescate.** Es una decisión consciente:
el aviso automático salía en cada instalación y estorbaba más de lo que
ayudaba. La consecuencia se asume con los ojos abiertos — si el propietario
olvida su contraseña sin haber generado un código, no hay forma de volver a
entrar. Generar uno toma diez segundos y es lo primero que conviene hacer al
poner en marcha un local.

**Es por dispositivo.** Las credenciales se guardan localmente en cada terminal,
así que el código que recupera el acceso *aquí* es el que se emitió *aquí*. En
la práctica se recupera en la caja, que es donde está el Hub.

**Lo que NO protege**, dicho sin adornos: a quien tenga acceso físico al disco
de la caja. Esa persona ya puede leer y alterar `hub.sqlite` directamente sin
pasar por aquí. El código de rescate protege del resto —la red, el personal, una
terminal prestada—, no del dueño del hardware.

## Autorización

- **Matriz rol × acción** con tres niveles: `ver`, `operar`, `autorizar`, más un
  **alcance** opcional (porcentaje de descuento, monto de retiro).
- La evaluación devuelve tres veredictos: permitido, denegado y
  **requiere autorización**. El tercero abre el teclado de PIN de un rol
  autorizante.
- Las acciones marcadas como sensibles (cancelar algo ya enviado a cocina,
  descuentos, cortesías, retiros, sellar el corte…) no se pueden ejecutar en
  silencio.

## Jerarquía: prevención de escalada de privilegios

Dos reglas cierran el hueco por el que alguien con permiso de "editar usuarios"
podría darse más poder del que tiene:

**1 · Nadie administra a un igual ni a un superior.** Cada rol tiene un rango
(propietario 100 · gerente 80 · administración 70 · compras y chef 50 ·
cajero 40 · mesero 30 · comensal 10). Para editar permisos, activar, desactivar
o desbloquear a alguien se exige rango **estrictamente mayor**. Consecuencias
deliberadas:

- un gerente no toca a la dirección, ni a otro gerente;
- **nadie edita sus propios permisos**, ni siquiera el propietario;
- los permisos del propietario no los modifica nadie: es el ancla de confianza.

**2 · Solo se delega lo que uno tiene.** Al crear o editar un usuario no se
puede conceder una acción que el administrador no posea, ni a un nivel superior
al suyo, ni con un alcance mayor que el propio (un gerente con tope de 20 % de
descuento no puede otorgar 50 %). Sin esta regla, la primera se sortearía
creando una cuenta nueva con más poder y entrando con ella.

Ambas se aplican en el dominio (`identidad/matriz.ts`) y están cubiertas por
pruebas, además de reflejarse en la interfaz: los botones desaparecen y los
niveles no otorgables aparecen deshabilitados.

## Auditoría

**El event log ES la bitácora** (TRD §10). No hay una tabla de auditoría
paralela que pueda desincronizarse. Cada evento lleva en su sobre:

`empleado_id` · `device_id` · `sucursal_id` · `ts` (reloj del dispositivo) ·
`stream_id` · versión de esquema.

Las cancelaciones autorizadas guardan además el `autorizador_id`. Esto es
exactamente el sustrato que consumirá el Centinela de mermas (C5) en F3.

## El canal entre terminales (etapa 10)

Todo lo que viaja entre las terminales y el Hub va **cifrado con AES-256-GCM**
usando la clave del local, que el Hub genera al instalarse y que se entrega al
emparejar. Cubre ventas, precios, importes de caja y datos del personal.

**Por qué no es TLS.** Un Hub de LAN no tiene nombre de dominio, así que un
certificado real es imposible y uno autofirmado obliga a cada terminal a
saltarse la advertencia roja del navegador — el hábito exacto que no queremos
crear en quien abre la caja. El razonamiento completo está en
`packages/protocolo-sync/src/cifrado.ts`.

**Qué protege**

- Que alguien en el wifi del local lea la operación del restaurante.
- Que inyecte comandas, pagos o cancelaciones falsas: sin la clave, el Hub
  descarta el mensaje sin interpretarlo y corta la conexión tras tres intentos.
- Que altere un mensaje a medio camino.

**Qué NO protege**

- No hay secreto hacia adelante: quien obtenga la clave y hubiera grabado el
  tráfico anterior podría leerlo. Rotarla corta hacia adelante, no hacia atrás.
- La clave es compartida: una terminal enlazada podría hacerse pasar por otra.
  La atribución se apoya en el `empleado_id` del evento y en la revalidación de
  permisos del Hub, no en el cifrado.
- El enlace de emparejamiento **lleva la clave**. Es una credencial: se entrega
  por un canal de confianza y no se publica. La terminal lo borra de la barra de
  direcciones en cuanto lo guarda.

**Autorización de terminales.** La primera de un Hub recién instalado se
autoriza sola —si no, nadie podría autorizar a nadie— y queda anotado. De ahí en
adelante toda alta exige la firma de una terminal ya autorizada. Listar y
autorizar viajan por el canal cifrado, nunca por HTTP.

## El CSD: la firma fiscal del restaurante (F2)

El Certificado de Sello Digital es, en la práctica, la firma del contribuyente:
quien tenga la llave privada puede emitir facturas a nombre del restaurante. Se
trata en consecuencia.

**Dónde vive.** Solo en la caja, en la carpeta de datos del local, restringida a
SYSTEM, a los administradores y al usuario que corre el Hub. No se sincroniza, no
viaja por el canal LAN y no se guarda en ninguna terminal. La única pieza que
sella es el Hub.

**Por qué no puede estar en el navegador.** Además de la razón de seguridad, hay
una técnica que cierra la puerta: WebCrypto no descifra el PKCS#8 protegido con
contraseña en que el SAT entrega el `.key`.

**Corrección importante (CN-033): el `0600` no protegía nada en Windows.** Este
documento decía que los permisos de solo-el-dueño protegían de otro usuario del
mismo equipo. En Linux es cierto; en Windows —la única plataforma donde MotRest
se instala— **`fs.chmod` no toca las ACL de NTFS**: lo único que hace es poner o
quitar el atributo de solo lectura. Los permisos efectivos seguían siendo los que
la carpeta heredara. Era una protección que existía en el comentario y no en el
disco.

Desde agosto de 2026 el Hub aplica ACL de verdad (`permisos.ts`, con `icacls`)
sobre la carpeta del CSD y sobre la del certificado TLS: corta la herencia y deja
dentro a SYSTEM, a los administradores y al usuario que lo ejecuta. El `mode:
0o600` se conserva porque no estorba y sí significa algo fuera de Windows.

**Qué protege eso y qué no.** Protege de otro usuario del mismo equipo y de una
copia descuidada de la carpeta del programa. **No** protege de quien tenga acceso
de administrador a la caja ni de quien se lleve el disco. La contraseña de la
llave se guarda al lado, porque el Hub tiene que poder sellar sin que nadie la
teclee cuando el restaurante reinicia el equipo un sábado por la noche.

Cifrarla con otra llave guardada en el mismo disco sería ofuscación disfrazada
de seguridad. Lo que de verdad protege esa carpeta es el control físico de la
caja y el cifrado de disco del equipo. Queda escrito para que sea una decisión
consciente y no un descuido.

**Acción de instalación (obligatoria en Rodizio):** activar el **cifrado de
disco de Windows (BitLocker)** en la caja antes de cargar el CSD. Es la
mitigación real de que la contraseña viva en el disco: con el disco cifrado,
llevárselo no sirve de nada. La auditoría lo marca como CN-004; no es un bug de
código, es un requisito de puesta en marcha.

**Qué se comprueba al cargarlo**, todo antes de escribir nada en el disco:
certificado y llave son pareja, el RFC del CSD coincide con el del emisor, el
certificado está vigente y su número de serie tiene los 20 dígitos del Anexo 20
—lo que distingue un CSD de una e.firma, que no sirve para facturar—. Cada
comprobación existe porque su ausencia produce el mismo error opaco del PAC,
"sello inválido", horas después y con el comensal esperando.

**Qué se puede consultar desde la interfaz:** si hay CSD, de qué RFC es, su
número de certificado y cuántos días le quedan. Nunca la llave ni la contraseña.

## Lo que todavía NO está protegido

| Riesgo | Estado | Se resuelve en |
|---|---|---|
| Un usuario con acceso al navegador puede manipular el estado en memoria | Mitigado | El Hub revalida permisos y rechaza lo que no corresponde |
| Los datos no están cifrados en reposo | **Abierto** | SQLCipher en el Hub y en móviles (F2) |
| Sin secreto hacia adelante en el canal | **Abierto** | Intercambio de claves por sesión (F2) |
| Una terminal enlazada puede suplantar a otra en el canal | **Abierto** | Clave por terminal en vez de clave del local (F2) |
| Rotar la clave del local exige reinstalar el Hub | **Abierto** | Etapa 12 (rotación desde la interfaz) |
| Los usuarios de demostración están en el código | **Resuelto (CN-003)** | Solo se siembran fuera del build de producción; el instalador real arranca solo con el propietario |
| `/salud` exponía detalle por la red | **Resuelto (CN-005)** | Por la red responde lo mínimo; el detalle solo a 127.0.0.1 |
| El modo abierto podía quedar puesto sin avisar | **Resuelto (CN-006)** | Cartel de arranque imposible de ignorar si está activo |
| Sin expiración de sesión por inactividad | **Abierto** | F2 (por perfil de dispositivo) |
| Sin MFA para perfiles administrativos | **Abierto** | F2 (Supabase Auth) |
| La contraseña del CSD se guarda junto a la llave | **Aceptado (CN-004)** | Sellar sin intervención lo exige; se mitiga con BitLocker en la caja (ver arriba) |
| Los `0o600` no restringían a nadie en Windows | **Resuelto (CN-033)** | ACL de NTFS con `icacls` sobre las carpetas con secretos (`permisos.ts`) |
| MotRest se instala **por usuario**, no para toda la máquina | **Aceptado (CN-037)** | Ver abajo |

### El compromiso de instalar «solo para este usuario» (CN-037)

Los dos instaladores usan `installMode: "currentUser"`. Es una decisión, no un
descuido, y tiene dos caras:

**Lo que gana.** El instalador **no pide administrador**. Un restaurantero puede
instalar MotRest él solo, sin llamar a nadie y sin que MOTRAE tenga que entrar a
la máquina. Para un producto que se vende a locales que no tienen sistemas, eso
es la diferencia entre instalarse y no instalarse. También significa que MotRest
no corre con privilegios de máquina: si algo se compromete, se compromete dentro
de una cuenta.

**Lo que cuesta.** El programa queda bajo `%LOCALAPPDATA%`, una carpeta donde
**ese usuario puede escribir**. Es decir, un proceso corriendo con la cuenta del
restaurante puede reemplazar el ejecutable del Hub. La firma Authenticode del
sidecar (ver `FIRMA-DEL-INSTALADOR.md`) es lo que hace ese cambio detectable, y
por eso el Hub se firma aparte del instalador.

**Lo que lo cierra en la práctica**, y está en la guía de instalación: que la
cuenta con la que opera el restaurante sea **estándar**, con BitLocker activo y
bloqueo de pantalla. Un atacante que ya tiene esa cuenta tiene la caja; lo que
esto evita es que la tenga cualquiera que pase por el mostrador.

## Convenciones permanentes

- **Secretos y llaves nunca al repositorio** (convención MOTRAE, TRD §10).
- Las contraseñas no se registran en la bitácora ni en mensajes de error.
- Los mensajes de acceso fallido no revelan si el usuario existe.
