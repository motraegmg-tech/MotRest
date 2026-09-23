-- ============================================================================
-- `publicar_documento_nube` pasa a SECURITY INVOKER (1.6.0)
--
-- Nació como SECURITY DEFINER comprobando la sucursal por dentro. Funcionaba,
-- pero el asesor de seguridad tenía razón: una función que se salta RLS y que
-- cualquier usuario autenticado puede llamar depende de que su comprobación
-- interna no tenga un descuido. Con políticas explícitas, la frontera es la
-- misma que en el resto de las tablas, y la función solo añade la regla de
-- «gana la versión mayor».
-- ============================================================================

grant insert (sucursal_id, llave, version, sobre), update (version, sobre, actualizado_ts) on public.documentos_nube to authenticated;

create policy "la web de un local en nube agrega sus documentos" on public.documentos_nube for insert
  with check (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));
create policy "la web de un local en nube cambia sus documentos" on public.documentos_nube for update
  using (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'))
  with check (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));

create or replace function public.publicar_documento_nube(p_llave text, p_version bigint, p_sobre text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sucursal text := privado.sucursal_web_actual();
  v_filas int;
begin
  if v_sucursal is null then
    raise exception 'sin sucursal web';
  end if;
  insert into public.documentos_nube as d (sucursal_id, llave, version, sobre)
  values (v_sucursal, p_llave, p_version, p_sobre)
  on conflict (sucursal_id, llave) do update
     set version = excluded.version, sobre = excluded.sobre, actualizado_ts = now()
   where d.version < excluded.version;
  get diagnostics v_filas = row_count;
  return v_filas > 0;
end;
$$;
