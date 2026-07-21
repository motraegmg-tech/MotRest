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
- **Bloqueo progresivo:** a partir del tercer fallo la espera se duplica
  (2 s, 4 s, 8 s…) con tope de 5 minutos.

### El límite real de un PIN

Un PIN de 4–6 dígitos tiene entre 10 000 y 1 000 000 de combinaciones. Frente a
alguien que obtenga el archivo de hashes, **ningún algoritmo lo salva**: PBKDF2
solo encarece el ataque, no lo impide. Lo que de verdad protege es la
combinación de:

1. caché cifrada en el dispositivo (pendiente: etapa 4),
2. expiración corta de esa caché (pendiente: etapa 10),
3. bloqueo por intentos (**ya implementado**),
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

## Auditoría

**El event log ES la bitácora** (TRD §10). No hay una tabla de auditoría
paralela que pueda desincronizarse. Cada evento lleva en su sobre:

`empleado_id` · `device_id` · `sucursal_id` · `ts` (reloj del dispositivo) ·
`stream_id` · versión de esquema.

Las cancelaciones autorizadas guardan además el `autorizador_id`. Esto es
exactamente el sustrato que consumirá el Centinela de mermas (C5) en F3.

## Lo que todavía NO está protegido

| Riesgo | Estado | Se resuelve en |
|---|---|---|
| Un usuario con acceso al navegador puede manipular el estado en memoria | **Abierto** | Etapa 10 (el Hub revalida todo) |
| Los datos no están cifrados en reposo | **Abierto** | Etapa 4 (persistencia) y etapa 10 (SQLCipher en móviles) |
| No hay canal cifrado entre dispositivos | No aplica aún | Etapa 10 (WebSocket TLS con fingerprint pineado) |
| Los PIN de demostración están en el código | **Abierto por diseño** | Antes del primer piloto real |
| Sin expiración de sesión por inactividad | **Abierto** | Etapa 3 (por perfil de dispositivo) |
| Sin MFA para perfiles administrativos | **Abierto** | F2 (Supabase Auth) |

## Convenciones permanentes

- **Secretos y llaves nunca al repositorio** (convención MOTRAE, TRD §10).
- Las contraseñas no se registran en la bitácora ni en mensajes de error.
- Los mensajes de acceso fallido no revelan si el usuario existe.
