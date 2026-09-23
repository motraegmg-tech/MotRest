-- El buzón de secretos: lo que Central le manda a UN restaurante y a ningún otro.
--
-- PARA QUÉ
--
-- Desde la 1.5.5 cada restaurante factura con su propia llave de FacturAPI y
-- manda sus correos desde su propio Gmail. Esas dos cosas se capturan en Central
-- —Gonzalo elige la organización de una lista y pulsa «Enviar al restaurante»—
-- y tienen que llegar a la caja del local sin que nadie vaya. El único camino
-- entre los dos es esta nube, igual que con las licencias.
--
-- LA DIFERENCIA CON LAS LICENCIAS, y es la razón de que esto sea una tabla
-- aparte: una licencia va FIRMADA pero en claro, porque no es secreta — quien la
-- lea no gana nada. Una llave de FacturAPI sí lo es: con ella se timbra ante el
-- SAT a nombre del restaurante. Así que aquí nada viaja en claro. Central cierra
-- cada secreto en un «sobre» (X25519 + HKDF + AES-GCM,
-- packages/dominio/src/comun/sobre.ts) con la llave pública que el Hub de ese
-- local publicó en su pulso, y solo la privada de ese Hub —que nunca sale de su
-- máquina— lo abre. La nube es cartero: aunque alguien leyera esta base entera,
-- no vería ni una llave. Una base con las llaves de facturación de toda la
-- cartera en claro sería el blanco más rentable de todo MOTRAE.
--
-- También cambia el pulso: lleva la llave pública (para poder cerrarle sobres) y
-- el estado de sus secretos (para que Central enseñe si la llave quedó bien, sin
-- enseñar la llave).

-- ---------------------------------------------------------------------------
-- El buzón
-- ---------------------------------------------------------------------------

create table public.secretos_pendientes (
  id            uuid primary key default gen_random_uuid(),
  sucursal_id   text not null references public.sucursales(sucursal_id) on delete cascade,
  clase         text not null check (clase in ('facturapi', 'gmail')),

  -- El sobre cerrado, tal cual lo deja Central. La nube no sabe abrirlo.
  sobre         jsonb not null,

  depositado_ts timestamptz not null default now(),

  -- TRES MOMENTOS Y NO UNO, por lo mismo que en `licencias_pendientes`:
  --
  --   entregado — el Hub lo recogió.
  --   aplicado  — el Hub lo abrió, PROBÓ la llave contra FacturAPI (o contra
  --               Gmail) y la dejó puesta.
  --
  -- Decir «listo» al depositar sería el fallo de siempre: todo verde en Central
  -- y el restaurante sin poder facturar el día que llega un cliente pidiendo
  -- factura. Una llave recogida que luego no sirve es un caso real —una Live de
  -- una organización sin CSD, una contraseña de Gmail revocada— y se ve aquí.
  entregado_ts  timestamptz,
  aplicado_ts   timestamptz,

  -- Si el Hub lo rechazó, el motivo en palabras de persona. La fila se queda:
  -- es un problema que hay que mirar, no algo que se tape borrándola.
  ultimo_error  text,

  -- UNO VIGENTE POR CLASE Y LOCAL. Mandar otra llave sustituye a la anterior
  -- que aún no se hubiera recogido: dos sobres de FacturAPI esperando al mismo
  -- Hub solo pueden acabar aplicándose en el orden equivocado. Central escribe
  -- con upsert sobre esta pareja (`on_conflict=sucursal_id,clase`).
  unique (sucursal_id, clase),

  -- Los topes, por el motivo de siempre: quien escriba aquí no es de fiar por
  -- estar autenticado. Un sobre de verdad pesa menos de un kilobyte; dieciséis
  -- dan margen de sobra sin dejar que un fallo en bucle llene el disco.
  constraint sobre_con_forma check (
    jsonb_typeof(sobre) = 'object'
    and sobre ->> 'formato' = 'motrest-sobre-v1'
    and pg_column_size(sobre) <= 16384
  ),
  constraint error_acotado check (ultimo_error is null or length(ultimo_error) <= 1000)
);

comment on table public.secretos_pendientes is
  'Secretos cifrados para UN Hub (sobre X25519): la llave de FacturAPI o la contraseña de Gmail de un restaurante, esperando a que su Hub los recoja.';

alter table public.secretos_pendientes enable row level security;

-- El Hub ve SUS sobres y nada más. Aunque viera los del vecino no podría
-- abrirlos, pero ni siquiera saber que el vecino factura es cosa suya.
create policy "un local lee solo sus secretos"
  on public.secretos_pendientes for select
  using (sucursal_id = privado.sucursal_actual());

-- Marcar recogido, aplicado o rechazado es lo único que el Hub puede escribir.
-- No puede depositar: eso lo hace Central con la llave de servicio, que se salta
-- RLS y por eso no necesita política de INSERT.
create policy "un local marca solo sus secretos"
  on public.secretos_pendientes for update
  using (sucursal_id = privado.sucursal_actual())
  with check (sucursal_id = privado.sucursal_actual());

-- Y además, POR COLUMNA. La política dice QUÉ FILAS; esto dice QUÉ CAMPOS.
--
-- Sin esto, un Hub podría reescribir el `sobre` de su propia fila. No abriría
-- nada ajeno, pero sí podría hacer que Central enseñara «aplicada» sobre un
-- sobre que no es el que Central dejó. Lo que el Hub tiene que contestar son
-- tres fechas y un motivo, y eso es exactamente lo que se le deja tocar.
--
-- `anon` no tiene nada que hacer aquí: un Hub siempre llega autenticado.
revoke all on public.secretos_pendientes from anon, authenticated;
grant select on public.secretos_pendientes to authenticated;
grant update (entregado_ts, aplicado_ts, ultimo_error) on public.secretos_pendientes to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: que «Enviar al restaurante» llegue en segundos
-- ---------------------------------------------------------------------------

-- Es el mismo argumento que dejó `licencias_pendientes` en la publicación: un
-- sondeo funcionaría, pero Gonzalo va a pulsar «Enviar» con el responsable al
-- teléfono, y media hora de espera convierte un clic en una segunda llamada.
alter publication supabase_realtime add table public.secretos_pendientes;

-- REPLICA IDENTITY FULL para que el UPDATE viaje entero y Realtime pueda
-- comprobar RLS contra la fila anterior (ver 20260828000500_realtime.sql).
alter table public.secretos_pendientes replica identity full;

-- ---------------------------------------------------------------------------
-- El pulso: la llave pública del Hub y el estado de sus secretos
-- ---------------------------------------------------------------------------

-- LOS NOMBRES SON ÉSTOS Y NO OTROS. El pulso es un upsert de fila entera: si el
-- Hub manda una columna que la tabla no tiene, PostgREST rechaza el parte
-- completo y el local sale en Central como «nunca reportó» mientras vende
-- tranquilamente. Ya pasó con `arranque_automatico`
-- (20260828000900_pulso_arranque_automatico.sql).
alter table public.pulsos
  add column if not exists llave_publica text,
  add column if not exists secretos      jsonb;

comment on column public.pulsos.llave_publica is
  'Pública X25519 del Hub (32 bytes en base64). Con ella Central le cierra sobres que solo ese Hub puede abrir.';
comment on column public.pulsos.secretos is
  'Estado de la llave de FacturAPI y del Gmail del local (EstadoSecretos): configurada, modo, terminación, RFC… Nunca la llave.';

-- Los topes van también como restricción, para quien escriba sin pasar por el
-- trigger. En el camino normal nunca saltan: el trigger de abajo deja el valor
-- dentro de ellos ANTES de que se comprueben.
alter table public.pulsos
  add constraint llave_publica_acotada
    check (llave_publica is null or length(llave_publica) <= 64),
  add constraint secretos_acotados
    check (secretos is null
           or (jsonb_typeof(secretos) = 'object' and pg_column_size(secretos) <= 8192));

-- ---------------------------------------------------------------------------
-- El saneo del pulso, otra vez entero
-- ---------------------------------------------------------------------------

-- POR QUÉ SE REESCRIBE AQUÍ, y no con una restricción que rechace lo malo: una
-- restricción que salta rechaza el pulso ENTERO, que es justo el fallo que el
-- comentario de arriba describe. Un estado de secretos mal formado no puede
-- costar el parte de ventas, versión y terminales. Así que lo que no cuadra se
-- neutraliza —se queda en NULL, o se recorta— y el pulso llega.
--
-- `secretos` se RECONSTRUYE CAMPO A CAMPO, como ya se hacía con `dispositivos`.
-- La razón es más seria que el orden: si una versión del Hub metiera por error
-- la llave dentro de su estado, copiar el objeto entero la dejaría en la nube
-- en claro, que es exactamente lo que el sobre existe para impedir. Aquí solo
-- sobreviven los campos del contrato (EstadoSecretos en
-- packages/dominio/src/organizacion/secretos.ts), y `termina_en` se corta a
-- cuatro caracteres pase lo que pase. Si el contrato gana un campo, hay que
-- añadirlo aquí o no llegará a Central — preferible a que llegue lo que nadie
-- decidió.
--
-- Y DE PASO SE ARREGLA EL `device_id` CORTADO. La migración
-- 20260904155411_device_id_entero.sql subió el tope de 24 a 36, pero reescribió
-- `public.sanear_pulso()`, que desde 20260828000400 ya no la usa nadie: el
-- trigger apunta a `privado.sanear_pulso()`, que seguía cortando a 24.
-- Comprobado en la nube el 19-sep-2026. Esta versión lleva el 36, y la copia
-- huérfana de `public` se tira para que la próxima corrección no vuelva a caer
-- en ella.
create or replace function privado.sanear_pulso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $funcion$
declare
  f jsonb;
  g jsonb;
begin
  new.ts := now();

  new.problemas := coalesce((
    select jsonb_agg(left(valor, 200))
    from (
      select jsonb_array_elements_text(
               case when jsonb_typeof(new.problemas) = 'array'
                    then new.problemas else '[]'::jsonb end
             ) as valor
      limit 10
    ) as recortados
    where length(valor) > 0
  ), '[]'::jsonb);

  new.dispositivos := coalesce((
    select jsonb_agg(
             jsonb_strip_nulls(jsonb_build_object(
               'device_id', left(d ->> 'device_id', 36),
               'nombre',    left(d ->> 'nombre', 48),
               'aprobado',  (d ->> 'aprobado') is not distinct from 'true',
               'visto_ts',  greatest(coalesce((d ->> 'visto_ts')::numeric, 0), 0)
             ))
           )
    from (
      select jsonb_array_elements(
               case when jsonb_typeof(new.dispositivos) = 'array'
                    then new.dispositivos else '[]'::jsonb end
             ) as d
      limit 40
    ) as recortados
    where jsonb_typeof(d) = 'object' and coalesce(d ->> 'device_id', '') <> ''
  ), '[]'::jsonb);

  -- Base64 de 32 bytes son 44 caracteres. Lo que no tenga esa pinta se queda en
  -- NULL: Central lo lee como «este Hub no sabe recibir llaves» y lo dice, en
  -- vez de cerrar un sobre para una llave que no abrirá nadie.
  if new.llave_publica is not null
     and (length(new.llave_publica) > 64
          or new.llave_publica !~ '^[A-Za-z0-9+/_=-]+$') then
    new.llave_publica := null;
  end if;

  if new.secretos is not null then
    if jsonb_typeof(new.secretos) <> 'object' then
      new.secretos := null;
    else
      f := case when jsonb_typeof(new.secretos -> 'facturapi') = 'object'
                then new.secretos -> 'facturapi' end;
      g := case when jsonb_typeof(new.secretos -> 'gmail') = 'object'
                then new.secretos -> 'gmail' end;

      new.secretos := jsonb_strip_nulls(jsonb_build_object(
        'facturapi', case when f is not null then jsonb_build_object(
          'configurada',     case when jsonb_typeof(f -> 'configurada') = 'boolean'
                                  then f -> 'configurada' end,
          'modo',            case when f ->> 'modo' in ('pruebas', 'produccion')
                                  then f ->> 'modo' end,
          'termina_en',      left(f ->> 'termina_en', 4),
          'origen',          case when f ->> 'origen' in ('central', 'local')
                                  then f ->> 'origen' end,
          'actualizado_ts',  case when jsonb_typeof(f -> 'actualizado_ts') = 'number'
                                  then f -> 'actualizado_ts' end,
          'organizacion_id', left(f ->> 'organizacion_id', 64),
          'razon_social',    left(f ->> 'razon_social', 200),
          'rfc',             left(f ->> 'rfc', 13),
          'csd_vence',       left(f ->> 'csd_vence', 40),
          'lista',           case when jsonb_typeof(f -> 'lista') = 'boolean'
                                  then f -> 'lista' end,
          'pendientes',      (
            select jsonb_agg(left(valor, 200))
            from (
              select jsonb_array_elements_text(
                       case when jsonb_typeof(f -> 'pendientes') = 'array'
                            then f -> 'pendientes' else '[]'::jsonb end
                     ) as valor
              limit 10
            ) as recortados
            where length(valor) > 0
          ),
          'error',           left(f ->> 'error', 300)
        ) end,
        'gmail', case when g is not null then jsonb_build_object(
          'configurada',     case when jsonb_typeof(g -> 'configurada') = 'boolean'
                                  then g -> 'configurada' end,
          'termina_en',      left(g ->> 'termina_en', 4),
          'origen',          case when g ->> 'origen' in ('central', 'local')
                                  then g ->> 'origen' end,
          'actualizado_ts',  case when jsonb_typeof(g -> 'actualizado_ts') = 'number'
                                  then g -> 'actualizado_ts' end,
          'remitente',       left(g ->> 'remitente', 254),
          'error',           left(g ->> 'error', 300)
        ) end
      ));
    end if;
  end if;

  return new;
end;
$funcion$;

-- El trigger no lo llama nadie a mano: lo dispara la tabla.
revoke all on function privado.sanear_pulso() from public;

drop function if exists public.sanear_pulso();
