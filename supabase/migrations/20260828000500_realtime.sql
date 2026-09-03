-- Realtime: el WebSocket que ADR-27 daba por imposible aquí.
--
-- De los cuatro trabajos del relay, SOLO UNO necesita un socket abierto: que un
-- mensaje de WhatsApp llegue al restaurante en segundos, no en el siguiente
-- sondeo. Pulsos, licencias, credenciales y actualizaciones son
-- petición-respuesta corriente y no necesitan nada de esto.
--
-- Dos tablas, y ninguna más:
--
--   mensajes_entrantes   — el comensal escribió y el local tiene que enterarse
--                          ya. Es lo único donde los segundos cuentan.
--   licencias_pendientes — para que «Renovar» siga siendo un clic. Podría ser
--                          un sondeo, pero un local bloqueado esperando media
--                          hora un lunes por la mañana es justo el problema que
--                          el reparto por el relay vino a resolver.
--
-- `pulsos` NO va aquí: nadie escucha un pulso, se consulta cuando Central mira.
-- `versiones` tampoco: el Hub pregunta cada 12 horas y eso está bien, porque
-- una actualización no es urgente y sí conviene que no llegue a las nueve de la
-- noche de un viernes.

alter publication supabase_realtime add table public.mensajes_entrantes;
alter publication supabase_realtime add table public.licencias_pendientes;

-- REPLICA IDENTITY FULL para que la fila vieja viaje entera en los UPDATE.
--
-- Sin esto Postgres solo manda la clave primaria de lo que cambió, y Realtime no
-- puede comprobar RLS contra el registro anterior: el resultado es que un
-- suscriptor deja de recibir eventos que sí le tocaban, en silencio y sin error.
-- Cuesta algo de WAL y a este volumen no se nota.
alter table public.mensajes_entrantes   replica identity full;
alter table public.licencias_pendientes replica identity full;

-- Realtime aplica las políticas de SELECT de cada tabla al repartir, así que el
-- aislamiento es el mismo que por HTTP: un local recibe sus filas y nada más.
-- No hace falta política nueva — hacerlas aquí de otra forma sería tener dos
-- reglas para lo mismo, y un día discreparían.
