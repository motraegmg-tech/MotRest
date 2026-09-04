-- Faltaba una columna del pulso, y por una sola se perdía el parte entero.
--
-- El Hub manda `arranque_automatico` —si está configurado para levantarse solo
-- al encender el equipo— y la tabla no la tenía. PostgREST rechaza el upsert
-- completo cuando una columna no existe, así que el local no reportaba NADA: ni
-- versión, ni terminales, ni ventas. En el panel salía «nunca reportó», que es
-- indistinguible de un restaurante caído.
--
-- Se descubrió en el primer local que conectó de verdad. Las otras doce columnas
-- de `PulsoCliente` sí estaban; esta se quedó fuera al escribir el esquema.
--
-- ES EL DATO DE UN PROBLEMA CONOCIDO, no un detalle de configuración: un Hub que
-- no arranca solo deja el restaurante sin sistema la mañana en que alguien
-- reinicia la caja y nadie se acuerda de abrir MotRest a mano. Por eso el propio
-- Hub lo pone también en `problemas`, y por eso conviene poder consultarlo
-- directamente en vez de buscar una cadena de texto dentro de un arreglo.

alter table public.pulsos
  add column if not exists arranque_automatico boolean;

comment on column public.pulsos.arranque_automatico is
  'Si el Hub del local está configurado para levantarse solo al encender el equipo.';
