-- El identificador de una terminal llegaba cortado por la mitad.
--
-- `sanear_pulso` recortaba `device_id` a 24 caracteres y un UUID mide 36, así
-- que en el panel se leía `01a069ec-aae6-7ced-b1f8-`: parece un identificador
-- completo y no lo es. Nadie se da cuenta hasta que lo copia.
--
-- NO ERA COSMÉTICO. El soporte identifica una terminal por ese número — el lío
-- de los PIN «inválidos» se diagnosticó comparando el `device_id` que veía el
-- Hub con el que traía la tableta, y con el recorte los dos se ven iguales
-- hasta el carácter 24 aunque sean equipos distintos. Un identificador truncado
-- a media cadena no sirve para lo único que sirve un identificador.
--
-- El tope sigue existiendo, porque un Hub autenticado no es un Hub de fiar: 36
-- es exactamente lo que mide un UUID, ni un carácter más. Lo que cambia es que
-- ahora el tope deja pasar el dato entero en vez de mutilarlo.
--
-- El resto de la función se reescribe igual porque `create or replace` la
-- sustituye completa; la única diferencia con la versión anterior es el 36.

create or replace function public.sanear_pulso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $funcion$
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

  return new;
end;
$funcion$;
