-- Las funciones auxiliares salen de `public`, porque `public` es la API.
--
-- QUÉ SE ESCAPABA
--
-- Las tres funciones nacieron en `public` y con `SECURITY DEFINER`, que es lo
-- que necesitan para resolver la asignación sin chocar con RLS. Pero todo lo que
-- vive en `public` lo publica PostgREST como RPC, así que quedaban colgadas en
-- `/rest/v1/rpc/…` y las podía llamar cualquiera — incluso sin haber iniciado
-- sesión.
--
-- La grave era `version_ofrecida(p_sucursal)`: **recibe la sucursal como
-- argumento**. Un Hub cualquiera —o un anónimo— podía preguntar por el local del
-- vecino y averiguar qué versión le toca, y de paso confirmar qué
-- `sucursal_id` existen probando. Es exactamente lo que la política de
-- `versiones` impide por la puerta de la tabla, servido por la puerta de al lado.
--
-- POR QUÉ NO BASTABA CON REVOCAR EXECUTE
--
-- Las expresiones de una política RLS se evalúan **con los privilegios de quien
-- hace la consulta**. Si se le quita EXECUTE a `authenticated`, la política deja
-- de poder llamar a la función y la consulta revienta con un error de permisos
-- en vez de devolver cero filas. Hay que sacarlas de la API sin quitarles el
-- permiso, y eso es un esquema aparte.
--
-- Es el mismo patrón que usa el propio Supabase: `auth.uid()` también es
-- `SECURITY DEFINER`, y vive en `auth` justamente porque ese esquema no se
-- publica.

create schema if not exists privado;

comment on schema privado is
  'Funciones auxiliares de las políticas RLS. PostgREST no publica este esquema: nada de aquí es alcanzable por HTTP.';

-- Las políticas y la vista dependen de las funciones viejas, así que hay que
-- soltarlas antes de poder tirarlas.
drop view if exists public.adopcion;
drop trigger if exists pulso_saneado on public.pulsos;

drop policy if exists "un local ve solo su ficha"                 on public.sucursales;
drop policy if exists "un local escribe solo su pulso"            on public.pulsos;
drop policy if exists "un local actualiza solo su pulso"          on public.pulsos;
drop policy if exists "un local lee solo su pulso"                on public.pulsos;
drop policy if exists "un local lee solo sus mensajes"            on public.mensajes_entrantes;
drop policy if exists "un local marca sus mensajes como recogidos" on public.mensajes_entrantes;
drop policy if exists "un local lee solo su renovacion"           on public.licencias_pendientes;
drop policy if exists "un local confirma solo su renovacion"      on public.licencias_pendientes;
drop policy if exists "un local ve solo la version que le toca"   on public.versiones;
drop policy if exists "un local ve solo su asignacion"            on public.asignaciones;

drop function if exists public.sanear_pulso();
drop function if exists public.version_ofrecida(text);
drop function if exists public.sucursal_actual();

-- ---------------------------------------------------------------------------
-- Las mismas tres, ahora fuera del alcance de la API
-- ---------------------------------------------------------------------------

-- La sucursal sale del JWT, NUNCA del cuerpo de la petición. Es la propiedad que
-- el relay conseguía derivando la identidad de la credencial del saludo
-- (apps/relay/src/main.ts:504-527): un local no puede decir que es otro.
create or replace function privado.sucursal_actual()
returns text
language sql
stable
security definer
set search_path = ''
as $funcion$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'sucursal_id',
    ''
  );
$funcion$;

-- Resuelve la asignación saltándose RLS, para que la política de `versiones`
-- pueda apoyarse en ella sin recursión.
--
-- Un local sin fila en `asignaciones` va al canal estable. Que un alta olvidada
-- deje a un restaurante sin actualizaciones sería un fallo silencioso, y de esos
-- ya se corrigió uno: un canal que hay que acordarse de encender es un canal
-- apagado (ADR-26 §4).
create or replace function privado.version_ofrecida(p_sucursal text)
returns text
language sql
stable
security definer
set search_path = ''
as $funcion$
  with asignada as (
    select coalesce(a.canal, 'estable') as canal, a.version_fijada
    from (select p_sucursal as s) x
    left join public.asignaciones a on a.sucursal_id = x.s
  )
  select coalesce(
    (select v.version
       from public.versiones v, asignada
      where v.version = asignada.version_fijada
        and v.retirada_ts is null),
    (select v.version
       from public.versiones v, asignada
      where v.canal = asignada.canal
        and v.retirada_ts is null
      order by v.publicado_ts desc
      limit 1)
  );
$funcion$;

-- `sanearPulso` (apps/relay/src/pulsos.ts) mudado al motor. Es lo que permite
-- que el Hub haga `upsert` directo sin una Edge Function en medio.
--
-- DOS COSAS QUE EL HUB NO PUEDE DECIDIR:
--
--   1. La hora. La pone el servidor siempre, se mande lo que se mande. El reloj
--      de un local puede estar en cualquier año, y un pulso fechado en 2019
--      desordena el panel de MOTRAE entero (ADR-26 §6).
--   2. Qué campos sobreviven. El inventario de terminales se reconstruye campo a
--      campo en vez de copiarse: un `token` de emparejamiento colado ahí dentro
--      sería la credencial con la que cualquiera sincroniza contra el Hub de ese
--      local.
create or replace function privado.sanear_pulso()
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
               'device_id', left(d ->> 'device_id', 24),
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

-- USAGE sobre el esquema y EXECUTE sobre las funciones: hace falta para que las
-- políticas puedan llamarlas. No abre nada, porque PostgREST no publica
-- `privado` y por HTTP no hay forma de llegar.
grant usage on schema privado to anon, authenticated, service_role;
grant execute on function privado.sucursal_actual()        to anon, authenticated, service_role;
grant execute on function privado.version_ofrecida(text)   to anon, authenticated, service_role;

-- El trigger, en cambio, no lo llama nadie: lo dispara la tabla.
revoke all on function privado.sanear_pulso() from public;

-- ---------------------------------------------------------------------------
-- Y todo lo que dependía de ellas, otra vez en pie
-- ---------------------------------------------------------------------------

create trigger pulso_saneado
  before insert or update on public.pulsos
  for each row execute function privado.sanear_pulso();

create policy "un local ve solo su ficha"
  on public.sucursales for select
  using (sucursal_id = privado.sucursal_actual());

create policy "un local escribe solo su pulso"
  on public.pulsos for insert
  with check (sucursal_id = privado.sucursal_actual());

create policy "un local actualiza solo su pulso"
  on public.pulsos for update
  using (sucursal_id = privado.sucursal_actual())
  with check (sucursal_id = privado.sucursal_actual());

create policy "un local lee solo su pulso"
  on public.pulsos for select
  using (sucursal_id = privado.sucursal_actual());

create policy "un local lee solo sus mensajes"
  on public.mensajes_entrantes for select
  using (sucursal_id = privado.sucursal_actual());

create policy "un local marca sus mensajes como recogidos"
  on public.mensajes_entrantes for update
  using (sucursal_id = privado.sucursal_actual())
  with check (sucursal_id = privado.sucursal_actual());

create policy "un local lee solo su renovacion"
  on public.licencias_pendientes for select
  using (sucursal_id = privado.sucursal_actual());

create policy "un local confirma solo su renovacion"
  on public.licencias_pendientes for update
  using (sucursal_id = privado.sucursal_actual())
  with check (sucursal_id = privado.sucursal_actual());

create policy "un local ve solo la version que le toca"
  on public.versiones for select
  using (
    privado.sucursal_actual() is not null
    and version = privado.version_ofrecida(privado.sucursal_actual())
  );

create policy "un local ve solo su asignacion"
  on public.asignaciones for select
  using (sucursal_id = privado.sucursal_actual());

create view public.adopcion
with (security_invoker = true)
as
  select
    s.sucursal_id,
    s.nombre,
    privado.version_ofrecida(s.sucursal_id) as version_ofrecida,
    p.version                               as version_instalada,
    p.ts                                    as ultimo_pulso_ts,
    coalesce(a.canal, 'estable')            as canal,
    a.version_fijada,
    (p.version is distinct from privado.version_ofrecida(s.sucursal_id)) as rezagado
  from public.sucursales s
  left join public.pulsos       p on p.sucursal_id = s.sucursal_id
  left join public.asignaciones a on a.sucursal_id = s.sucursal_id
  where s.baja_ts is null;

comment on view public.adopcion is
  'Que version le tocaba a cada local y cual corre de verdad. Para Central, no para los Hubs.';
