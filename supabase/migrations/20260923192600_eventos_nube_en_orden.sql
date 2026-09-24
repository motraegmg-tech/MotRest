-- ============================================================================
-- Los eventos de un restaurante en nube, en orden estricto (1.6.0)
--
-- EL PROBLEMA. `seq` sale de una secuencia, y en Postgres dos inserciones a la
-- vez pueden CONFIRMARSE en orden distinto al de su número: la 105 visible antes
-- que la 104. Un dispositivo que pide «desde la 105» se salta la 104 para
-- siempre. En el Hub no pasa porque SQLite escribe de uno en uno.
--
-- EL ARREGLO. Un candado por restaurante durante la inserción
-- (`pg_advisory_xact_lock`): dentro de un local, cada lote toma su número y se
-- confirma antes de que el siguiente empiece. Entre restaurantes no hay espera.
--
-- NOTA: esta versión quitó por error el permiso de insertar que la función, aún
-- SECURITY INVOKER, necesitaba. La corrige la migración siguiente
-- (`eventos_nube_solo_por_la_funcion`), aplicada once segundos después y antes
-- de que existiera ningún cliente del modo nube.
-- ============================================================================

create or replace function public.empujar_eventos_nube(p_eventos jsonb)
returns table (id text, seq bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sucursal text := privado.sucursal_web_actual();
begin
  if v_sucursal is null then
    raise exception 'sin sucursal web';
  end if;
  if jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) > 500 then
    raise exception 'lote inválido';
  end if;

  perform pg_advisory_xact_lock(hashtext('eventos_nube:' || v_sucursal));

  insert into public.eventos_nube (sucursal_id, id, device_id, sobre)
  select v_sucursal, e ->> 'id', e ->> 'device_id', e ->> 'sobre'
    from jsonb_array_elements(p_eventos) e
  on conflict (sucursal_id, id) do nothing;

  return query
    select n.id, n.seq
      from public.eventos_nube n
     where n.sucursal_id = v_sucursal
       and n.id in (select e ->> 'id' from jsonb_array_elements(p_eventos) e);
end;
$$;

revoke insert on public.eventos_nube from authenticated;
drop policy if exists "la web de un local en nube agrega sus eventos" on public.eventos_nube;
