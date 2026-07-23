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

## Credenciales sembradas

El usuario propietario **Gonzalo DJA** se siembra con su contraseña ya
derivada. En el repositorio vive **únicamente el par sal + hash**; el texto
plano nunca se escribió en ningún archivo del proyecto.

Aun así, el hash de una contraseña *conocida* es un artefacto sensible: quien
tenga el repositorio y sepa cuál es la contraseña puede confirmarlo. Por eso:

- el usuario nace con `debe_cambiar_credencial: true`, y
- la aplicación **exige cambiarla en el primer inicio de sesión**, sin permitir
  saltarse el paso.

**Los PIN de los usuarios de demostración (Marco y Lucía) son de juguete** y
están documentados en el código. Deben eliminarse antes de cualquier instalación
real; hoy existen solo para poder probar el flujo de autorización.

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

## Lo que todavía NO está protegido

| Riesgo | Estado | Se resuelve en |
|---|---|---|
| Un usuario con acceso al navegador puede manipular el estado en memoria | Mitigado | El Hub revalida permisos y rechaza lo que no corresponde |
| Los datos no están cifrados en reposo | **Abierto** | SQLCipher en el Hub y en móviles (F2) |
| Sin secreto hacia adelante en el canal | **Abierto** | Intercambio de claves por sesión (F2) |
| Una terminal enlazada puede suplantar a otra en el canal | **Abierto** | Clave por terminal en vez de clave del local (F2) |
| Rotar la clave del local exige reinstalar el Hub | **Abierto** | Etapa 12 (rotación desde la interfaz) |
| Los PIN de demostración están en el código | **Abierto por diseño** | Antes del primer piloto real |
| Sin expiración de sesión por inactividad | **Abierto** | F2 (por perfil de dispositivo) |
| Sin MFA para perfiles administrativos | **Abierto** | F2 (Supabase Auth) |

## Convenciones permanentes

- **Secretos y llaves nunca al repositorio** (convención MOTRAE, TRD §10).
- Las contraseñas no se registran en la bitácora ni en mensajes de error.
- Los mensajes de acceso fallido no revelan si el usuario existe.
