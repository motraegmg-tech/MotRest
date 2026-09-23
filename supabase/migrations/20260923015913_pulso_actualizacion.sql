-- El pulso cuenta si el local tiene una actualización esperando.
--
-- El 22-sep-2026 la nube le servía la 1.5.6 a Rodizio y la caja seguía en la
-- 1.5.3; Tortas Fc, en la 1.5.5. Todo lo de MOTRAE estaba en verde —asignación,
-- RLS, manifiesto firmado, descarga con su SHA-256— y aun así no había forma de
-- saber desde Central si esas cajas NO VEÍAN la versión o la VEÍAN y el
-- restaurante la iba posponiendo. El Hub no instala solo: espera a que alguien
-- elija «ahora» o una hora. Ese estado solo vivía dentro de la caja.
--
-- `actualizacion` es un objeto:
--   · NULL           → Hub anterior a este campo: no sabe contarlo.
--   · {}             → al día, nada pendiente.
--   · {pendiente,…}  → vio esa versión y no la ha instalado. Lleva desde cuándo,
--                      qué eligió el restaurante y, si falló, por qué.
--
-- ESTA MIGRACIÓN VA ANTES QUE CUALQUIER HUB QUE MANDE EL CAMPO. El pulso es un
-- upsert de fila entera: una columna que la tabla no tiene tumba el parte
-- completo (ver 20260828000900_pulso_arranque_automatico.sql).

alter table public.pulsos
  add column if not exists actualizacion jsonb;

comment on column public.pulsos.actualizacion is
  'Actualización vista y sin instalar (ActualizacionReportada): pendiente, vista_ts, eleccion, hora, aplazada_hasta, error, error_ts. NULL = Hub que no lo reporta; {} = al día.';

alter table public.pulsos
  add constraint actualizacion_acotada
    check (actualizacion is null
           or (jsonb_typeof(actualizacion) = 'object' and pg_column_size(actualizacion) <= 2048));

-- ---------------------------------------------------------------------------
-- El saneo del pulso, con su bloque nuevo
-- ---------------------------------------------------------------------------

-- Igual que `secretos`: se reconstruye campo a campo y lo que no cuadra se
-- neutraliza en vez de rechazar el pulso. Todo lo anterior a `actualizacion`
-- es idéntico a 20260919090000_buzon_de_secretos.sql.
create or replace function privado.sanear_pulso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $funcion$
declare
  f jsonb;
  g jsonb;
  a jsonb;
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

  -- Sin `pendiente` válido, lo demás no describe nada: queda `{}`, «al día».
  if new.actualizacion is not null then
    if jsonb_typeof(new.actualizacion) <> 'object' then
      new.actualizacion := null;
    else
      a := new.actualizacion;
      if coalesce(a ->> 'pendiente', '') !~ '^[0-9]+[.][0-9]+[.][0-9]+$'
         or length(a ->> 'pendiente') > 32 then
        new.actualizacion := '{}'::jsonb;
      else
        new.actualizacion := jsonb_strip_nulls(jsonb_build_object(
          'pendiente',      a ->> 'pendiente',
          'vista_ts',       case when jsonb_typeof(a -> 'vista_ts') = 'number'
                                 then a -> 'vista_ts' end,
          'eleccion',       case when a ->> 'eleccion' in ('ahora', 'mas_tarde', 'a_las')
                                 then a ->> 'eleccion' end,
          'hora',           case when jsonb_typeof(a -> 'hora') = 'number'
                                 then a -> 'hora' end,
          'aplazada_hasta', case when jsonb_typeof(a -> 'aplazada_hasta') = 'number'
                                 then a -> 'aplazada_hasta' end,
          'error',          left(a ->> 'error', 300),
          'error_ts',       case when jsonb_typeof(a -> 'error_ts') = 'number'
                                 then a -> 'error_ts' end
        ));
      end if;
    end if;
  end if;

  return new;
end;
$funcion$;

revoke all on function privado.sanear_pulso() from public;
