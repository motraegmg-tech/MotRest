-- ============================================================================
-- Los eventos en nube SOLO entran por `empujar_eventos_nube` (1.6.0)
--
-- Pasa a SECURITY DEFINER, con la sucursal y la modalidad comprobadas por
-- dentro. Es a propósito que sea la ÚNICA puerta: es la que toma el candado que
-- mantiene el orden de `seq`. Una inserción directa se lo saltaría, y con él la
-- garantía de que ningún dispositivo se pierde un evento.
-- ============================================================================

create or replace function public.empujar_eventos_nube(p_eventos jsonb)
returns table (id text, seq bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sucursal text := privado.sucursal_web_actual();
begin
  if v_sucursal is null or not privado.web_en_modalidad('nube') then
    raise exception 'sin acceso en modalidad nube';
  end if;
  if jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) > 500 then
    raise exception 'lote inválido';
  end if;

  perform pg_advisory_xact_lock(hashtext('eventos_nube:' || v_sucursal));

  insert into public.eventos_nube (sucursal_id, id, device_id, sobre)
  select v_sucursal, left(e ->> 'id', 64), left(e ->> 'device_id', 64), e ->> 'sobre'
    from jsonb_array_elements(p_eventos) e
  on conflict (sucursal_id, id) do nothing;

  return query
    select n.id, n.seq
      from public.eventos_nube n
     where n.sucursal_id = v_sucursal
       and n.id in (select e ->> 'id' from jsonb_array_elements(p_eventos) e);
end;
$$;
revoke execute on function public.empujar_eventos_nube(jsonb) from public, anon;
grant execute on function public.empujar_eventos_nube(jsonb) to authenticated;
