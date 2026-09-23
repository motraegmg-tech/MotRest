-- ============================================================================
-- MOTREST EN LA WEB (1.6.0)
--
-- «Entra a tu restaurante»: clave + contraseña desde un navegador, y después el
-- «¿Quién eres?» de siempre. Tres modalidades, que se eligen en Central:
--
--   app   — como siempre; nada de esto le aplica.
--   ambas — los datos viven en el Hub del local; la web llega a él por un canal
--           broadcast PRIVADO de Realtime (`tunel:<sucursal>`).
--   nube  — no hay Hub; los datos viven aquí, en `eventos_nube` y
--           `documentos_nube`, CIFRADOS con una llave que esta base no tiene.
--
-- Quién toca qué:
--   · Central, con la llave de servicio: da de alta el acceso y la contraseña.
--   · La Edge Function `entrar-restaurante`: la entrada, con freno de intentos.
--   · La Edge Function `cambiar-contrasena-web`: el cambio desde el restaurante.
--   · El usuario web (`app_metadata.sucursal_web`): solo lo de su sucursal.
--   · El Hub (`app_metadata.sucursal_id`): su canal del túnel y la versión de
--     su acceso, para cortar sesiones cuando cambia la contraseña.
--
-- EL USUARIO WEB NO LLEVA `sucursal_id` A PROPÓSITO. Todas las políticas de los
-- Hubs se apoyan en `privado.sucursal_actual()`, que lee ese campo; si el
-- usuario web lo llevara, heredaría permisos de Hub —publicar el pulso,
-- confirmar licencias, leer el buzón— sin que nadie lo decidiera.
-- Plan: docs/PLAN-MOTREST-WEB.md · ADR-29.
-- ============================================================================


-- --- La identidad web ---------------------------------------------------------

create or replace function privado.sucursal_web_actual()
returns text
language sql
stable
security definer
set search_path = ''
as $funcion$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'sucursal_web',
    ''
  );
$funcion$;

grant execute on function privado.sucursal_web_actual() to authenticated, service_role;


-- --- El acceso de cada restaurante ------------------------------------------------

create table public.accesos_web (
  sucursal_id  text primary key references public.sucursales(sucursal_id) on delete cascade,

  -- La clave corta con que se presenta («RODIZIO»). No es secreta.
  clave        text not null unique check (clave ~ '^[A-Z0-9-]{3,20}$'),

  modalidad    text not null check (modalidad in ('ambas', 'nube')),

  -- El usuario de Supabase Auth del restaurante (`web-<sucursal>@web.motrae.mx`).
  usuario_id   uuid not null unique,

  -- La clave remota ENVUELTA con la contraseña (cofre PBKDF2 + AES-GCM). Esta
  -- base no puede abrirla: solo quien teclea la contraseña.
  envoltura    jsonb not null,

  -- Sube con cada cambio de contraseña. El Hub la escucha y corta las sesiones
  -- web abiertas cuando sube.
  version      int not null default 1 check (version >= 1),

  -- Apagado = nadie entra y el Hub cierra el túnel, aunque la fila siga.
  activo       boolean not null default true,

  -- Cuando el PROPIETARIO cambia la contraseña desde su restaurante, se la deja
  -- a Central sellada con la pública de su buzón (X25519). Supabase la
  -- transporta y no puede leerla.
  contrasena_para_central       jsonb,
  cambiada_por_restaurante_ts   timestamptz,

  actualizado_ts timestamptz not null default now(),

  constraint envoltura_con_forma check (
    jsonb_typeof(envoltura) = 'object'
    and envoltura ->> 'formato' = 'motrest-cofre-v1'
    and pg_column_size(envoltura) <= 4096
  ),
  constraint sobre_para_central_con_forma check (
    contrasena_para_central is null or (
      jsonb_typeof(contrasena_para_central) = 'object'
      and contrasena_para_central ->> 'formato' = 'motrest-sobre-v1'
      and pg_column_size(contrasena_para_central) <= 4096
    )
  )
);

comment on table public.accesos_web is
  'El acceso por internet de cada restaurante: su clave, su modalidad y la clave remota envuelta con su contraseña. La escriben Central y las Edge Functions.';

alter table public.accesos_web enable row level security;
revoke all on public.accesos_web from anon, authenticated;

-- El navegador lee SU fila (sin el sobre para Central: no le sirve de nada).
grant select (sucursal_id, clave, modalidad, envoltura, version, activo) on public.accesos_web to authenticated;
create policy "la web lee su acceso" on public.accesos_web for select
  using (sucursal_id = privado.sucursal_web_actual());
-- El Hub lee la suya para saber la versión y si sigue activo.
create policy "el hub lee el acceso de su local" on public.accesos_web for select
  using (sucursal_id = privado.sucursal_actual());

alter publication supabase_realtime add table public.accesos_web;
alter table public.accesos_web replica identity full;


-- ¿Esta sesión web puede usar la modalidad pedida? Saltándose RLS, para que las
-- políticas de otras tablas se apoyen en ella sin recursión.
create or replace function privado.web_en_modalidad(p_modalidad text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $funcion$
  select exists (
    select 1 from public.accesos_web a
     where a.sucursal_id = privado.sucursal_web_actual()
       and a.activo
       and a.modalidad = p_modalidad
  );
$funcion$;

grant execute on function privado.web_en_modalidad(text) to authenticated, service_role;


-- --- Freno a quien adivina contraseñas ----------------------------------------------
--
-- Mismo patrón que `intentos_factura`: un contador por clave (quien ataca a un
-- restaurante desde muchas redes) y otro por red (quien prueba muchas claves).
create table public.intentos_entrada (
  llave      text primary key check (length(llave) <= 120),
  fallos     int not null,
  ultimo_ts  timestamptz not null default now()
);
comment on table public.intentos_entrada is
  'Fallos recientes de «Entra a tu restaurante», por clave y por red.';

alter table public.intentos_entrada enable row level security;
revoke all on public.intentos_entrada from anon, authenticated;

create or replace function public.registrar_fallo_entrada(p_clave text, p_ip text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.intentos_entrada as i (llave, fallos)
  values (left('clave:' || p_clave, 120), 1)
  on conflict (llave) do update set
    fallos = case when now() > i.ultimo_ts + interval '1 hour' then 1 else i.fallos + 1 end,
    ultimo_ts = now();

  insert into public.intentos_entrada as i (llave, fallos)
  values (left('ip:' || p_ip, 120), 1)
  on conflict (llave) do update set
    fallos = case when now() > i.ultimo_ts + interval '1 hour' then 1 else i.fallos + 1 end,
    ultimo_ts = now();
$$;
revoke execute on function public.registrar_fallo_entrada(text, text) from public, anon, authenticated;
grant execute on function public.registrar_fallo_entrada(text, text) to service_role;

-- Cerrar las sesiones del usuario web al cambiar la contraseña o apagar el
-- acceso. Los pases ya emitidos caducan solos en una hora como mucho; lo que se
-- corta aquí es que se renueven.
create or replace function public.cerrar_sesiones_web(p_usuario uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_usuario;
$$;
revoke execute on function public.cerrar_sesiones_web(uuid) from public, anon, authenticated;
grant execute on function public.cerrar_sesiones_web(uuid) to service_role;


-- --- El túnel (modalidad «ambas») ----------------------------------------------------
--
-- Canal broadcast PRIVADO `tunel:<sucursal>`. Entran el Hub de ese local y la
-- sesión web de ese local si su acceso está activo en «ambas». Nadie más: ni
-- otro restaurante, ni un usuario anónimo.
--
-- Lo que viaja ya va cifrado de extremo a extremo con la clave remota; esto es
-- la segunda cerradura, no la primera.
create policy "tunel: escuchan el hub y la web de su local"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      realtime.topic() = 'tunel:' || privado.sucursal_actual()
      or (realtime.topic() = 'tunel:' || privado.sucursal_web_actual() and privado.web_en_modalidad('ambas'))
    )
  );

create policy "tunel: hablan el hub y la web de su local"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (
      realtime.topic() = 'tunel:' || privado.sucursal_actual()
      or (realtime.topic() = 'tunel:' || privado.sucursal_web_actual() and privado.web_en_modalidad('ambas'))
    )
  );


-- --- Los datos en la nube (modalidad «nube») ------------------------------------------
--
-- El log de eventos, como el `eventos` del SQLite del Hub. En claro solo lo que
-- hace falta para ordenar y no duplicar; el evento entero va en `sobre`, cifrado
-- con la llave de datos que sale de la clave remota. Esta base no puede leer ni
-- una venta.
create table public.eventos_nube (
  seq          bigint generated always as identity primary key,
  sucursal_id  text not null references public.sucursales(sucursal_id) on delete cascade,
  id           text not null check (length(id) between 1 and 64),
  device_id    text not null check (length(device_id) between 1 and 64),
  sobre        text not null check (length(sobre) <= 262144),
  creado_ts    timestamptz not null default now(),
  unique (sucursal_id, id)
);
create index eventos_nube_por_sucursal on public.eventos_nube (sucursal_id, seq);

comment on table public.eventos_nube is
  'El log de eventos de un restaurante en modalidad nube, cifrado de extremo a extremo.';

alter table public.eventos_nube enable row level security;
revoke all on public.eventos_nube from anon, authenticated;
grant select, insert (sucursal_id, id, device_id, sobre) on public.eventos_nube to authenticated;

create policy "la web de un local en nube lee sus eventos" on public.eventos_nube for select
  using (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));
create policy "la web de un local en nube agrega sus eventos" on public.eventos_nube for insert
  with check (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));
-- Sin UPDATE ni DELETE: el log solo crece, igual que en el Hub.

alter publication supabase_realtime add table public.eventos_nube;

-- Empujar varios eventos y saber el `seq` de cada uno en un solo viaje. Los que
-- ya estaban (reintento del outbox) devuelven su `seq` original.
-- SECURITY INVOKER: las políticas de arriba se aplican tal cual.
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
revoke execute on function public.empujar_eventos_nube(jsonb) from public, anon;
grant execute on function public.empujar_eventos_nube(jsonb) to authenticated;


-- Lo que en el Hub no son eventos: catálogos (menú, plano, impresoras),
-- credenciales del personal, terminales. Un documento por llave; gana la
-- versión mayor, como gana en el Hub.
create table public.documentos_nube (
  sucursal_id    text not null references public.sucursales(sucursal_id) on delete cascade,
  llave          text not null check (llave ~ '^[a-z0-9_:.-]{1,80}$'),
  version        bigint not null,
  sobre          text not null check (length(sobre) <= 2097152),
  actualizado_ts timestamptz not null default now(),
  primary key (sucursal_id, llave)
);

comment on table public.documentos_nube is
  'Catálogos y estado de un restaurante en modalidad nube (cifrados). Gana la versión mayor.';

alter table public.documentos_nube enable row level security;
revoke all on public.documentos_nube from anon, authenticated;
grant select on public.documentos_nube to authenticated;

create policy "la web de un local en nube lee sus documentos" on public.documentos_nube for select
  using (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));

alter publication supabase_realtime add table public.documentos_nube;
alter table public.documentos_nube replica identity full;

-- Publicar un documento. Solo pisa si la versión es mayor: dos tabletas que
-- guardan el menú a la vez acaban con el mismo, el más nuevo.
create or replace function public.publicar_documento_nube(p_llave text, p_version bigint, p_sobre text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sucursal text := privado.sucursal_web_actual();
  v_filas int;
begin
  if v_sucursal is null or not privado.web_en_modalidad('nube') then
    raise exception 'sin acceso en modalidad nube';
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
revoke execute on function public.publicar_documento_nube(text, bigint, text) from public, anon;
grant execute on function public.publicar_documento_nube(text, bigint, text) to authenticated;


-- Fotos de producto en modalidad nube: bucket privado, una carpeta por local.
insert into storage.buckets (id, name, public, file_size_limit)
values ('fotos_nube', 'fotos_nube', false, 2097152)
on conflict (id) do nothing;

create policy "la web en nube lee sus fotos" on storage.objects for select to authenticated
  using (bucket_id = 'fotos_nube'
         and (storage.foldername(name))[1] = privado.sucursal_web_actual()
         and privado.web_en_modalidad('nube'));
create policy "la web en nube sube sus fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos_nube'
              and (storage.foldername(name))[1] = privado.sucursal_web_actual()
              and privado.web_en_modalidad('nube'));
create policy "la web en nube cambia sus fotos" on storage.objects for update to authenticated
  using (bucket_id = 'fotos_nube'
         and (storage.foldername(name))[1] = privado.sucursal_web_actual()
         and privado.web_en_modalidad('nube'));


-- --- Lo que un restaurante en nube hace en lugar del Hub ----------------------------

-- Su licencia: la lee y la verifica el navegador con la pública de MOTRAE.
create policy "la web en nube lee su licencia" on public.licencias_pendientes for select
  using (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));

-- Su pulso: lo sube el dispositivo que cierra la caja, para que Central lo vea
-- igual que a un local con Hub. El trigger `sanear_pulso` sigue poniendo la hora.
create policy "la web en nube escribe su pulso" on public.pulsos for insert
  with check (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));
create policy "la web en nube actualiza su pulso" on public.pulsos for update
  using (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'))
  with check (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));
create policy "la web en nube lee su pulso" on public.pulsos for select
  using (sucursal_id = privado.sucursal_web_actual() and privado.web_en_modalidad('nube'));


-- --- El buzón de secretos gana la clase del acceso web ------------------------------
alter table public.secretos_pendientes drop constraint if exists secretos_pendientes_clase_check;
alter table public.secretos_pendientes
  add constraint secretos_pendientes_clase_check check (clase in ('facturapi', 'gmail', 'acceso_web'));
