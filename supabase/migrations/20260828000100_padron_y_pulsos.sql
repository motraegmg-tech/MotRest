-- El padrón y el parte de vida de cada restaurante.
--
-- Sustituye a los dos archivos cifrados del volumen de Fly
-- (apps/relay/src/inquilinos.ts y apps/relay/src/pulsos.ts). Lo que allí eran
-- invariantes sostenidas a mano en TypeScript, aquí las sostiene el motor: quién
-- puede leer qué fila, y que dos locales no reclamen el mismo número de WhatsApp.
--
-- LO QUE NO CAMBIA: el token de Meta se guarda CIFRADO POR MOTRAE
-- (AES-256-GCM), con la llave únicamente en el entorno de la Edge Function.
-- Supabase guarda texto cifrado, igual que el volumen de Fly guardaba texto
-- cifrado. Esa era la objeción de ADR-27 a poner el padrón en la base de datos
-- de nadie más, y se conserva.

-- ---------------------------------------------------------------------------
-- De quién es esta petición
-- ---------------------------------------------------------------------------

-- La sucursal sale del JWT, NUNCA del cuerpo de la petición.
--
-- Es la misma propiedad que el relay conseguía a mano derivando la identidad de
-- la credencial del saludo (apps/relay/src/main.ts:504-527): un local no puede
-- decir que es otro. La diferencia es que `app_metadata` lo firma Supabase Auth
-- y el Hub no puede escribirlo — ni por error ni a propósito.
create or replace function public.sucursal_actual()
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

comment on function public.sucursal_actual() is
  'La sucursal del JWT que hace la petición. NULL si no es el Hub de un local.';

-- ---------------------------------------------------------------------------
-- El padrón
-- ---------------------------------------------------------------------------

create table public.sucursales (
  sucursal_id  text primary key,
  nombre       text not null,
  alta_ts      timestamptz not null default now(),
  baja_ts      timestamptz,

  -- El identificador que Meta le da al número del restaurante.
  --
  -- NULL es normal y frecuente: un local se da de alta antes de conectar su
  -- WhatsApp y puede operar meses solo con el portal. Postgres permite varios
  -- NULL en un índice único, que es justo lo que hace falta.
  --
  -- UNIQUE es la regla que el relay comprobaba en `publicarWhatsApp` con el
  -- resultado "ajeno": reclamar el número de otro local es quedarse con sus
  -- mensajes entrantes. Aquí no hay forma de escribirlo mal.
  wa_phone_number_id text unique,

  -- Sobre AES-256-GCM. La llave vive en el entorno de la Edge Function, no aquí.
  wa_token_cifrado   text,
  wa_nombre          text,

  constraint sucursal_id_con_forma check (sucursal_id ~ '^suc-[a-z0-9]{4,32}$'),
  constraint nombre_no_vacio       check (length(nombre) between 1 and 120)
);

comment on table public.sucursales is
  'El padrón: quién es cliente de MOTRAE. Sin operación del local — ni comandas, ni ventas, ni clientes.';

alter table public.sucursales enable row level security;

-- El Hub ve SU ficha y nada más. Ni la lista, ni el conteo, ni el nombre del
-- vecino: la cartera de MOTRAE no se le enseña a un restaurante.
create policy "un local ve solo su ficha"
  on public.sucursales for select
  using (sucursal_id = public.sucursal_actual());

-- ---------------------------------------------------------------------------
-- El parte de vida
-- ---------------------------------------------------------------------------

-- SOLO EL ÚLTIMO PULSO DE CADA LOCAL, y por eso la clave primaria es la
-- sucursal: no es una serie temporal. Lo que hay que contestar es «¿cómo está
-- hoy Rodizio?», no «¿cómo estuvo el martes». Guardar el histórico convertiría
-- esto en el sitio donde vive la operación de toda la cartera (TRD R3).
create table public.pulsos (
  sucursal_id  text primary key references public.sucursales(sucursal_id) on delete cascade,

  -- LA HORA LA PONE EL SERVIDOR. El reloj de un local puede estar en cualquier
  -- año, y un pulso fechado en 2019 desordena el panel entero.
  ts           timestamptz not null default now(),

  version      text not null,
  ventas_dia   bigint,
  cuentas_dia  integer,
  terminales   integer,
  dispositivos jsonb not null default '[]'::jsonb,
  problemas    jsonb not null default '[]'::jsonb,
  hub_id       text,
  plataforma   text,
  respaldo_ts  timestamptz,
  eventos      bigint,

  -- Los mismos topes que `sanearPulso` (apps/relay/src/pulsos.ts) aplica campo a
  -- campo. Se repiten aquí a propósito: un Hub autenticado no es un Hub de
  -- fiar, y si algún día alguien escribe en esta tabla sin pasar por la función,
  -- los topes tienen que seguir puestos. Una versión con un fallo podría mandar
  -- megas de texto en bucle y llenar el disco de todos los restaurantes.
  constraint version_acotada      check (length(version) between 1 and 32),
  constraint problemas_acotados   check (jsonb_typeof(problemas) = 'array'
                                          and jsonb_array_length(problemas) <= 10),
  constraint dispositivos_acotados check (jsonb_typeof(dispositivos) = 'array'
                                          and jsonb_array_length(dispositivos) <= 40),
  constraint hub_id_acotado       check (hub_id is null or length(hub_id) <= 64),
  constraint plataforma_acotada   check (plataforma is null or length(plataforma) <= 32),
  constraint cifras_no_negativas  check (coalesce(ventas_dia, 0) >= 0
                                          and coalesce(cuentas_dia, 0) >= 0
                                          and coalesce(terminales, 0) >= 0
                                          and coalesce(eventos, 0) >= 0)
);

comment on table public.pulsos is
  'El último parte de cada local: qué versión corre y cuándo dio señales. Uno por sucursal, no serie temporal.';

alter table public.pulsos enable row level security;

create policy "un local escribe solo su pulso"
  on public.pulsos for insert
  with check (sucursal_id = public.sucursal_actual());

create policy "un local actualiza solo su pulso"
  on public.pulsos for update
  using (sucursal_id = public.sucursal_actual())
  with check (sucursal_id = public.sucursal_actual());

create policy "un local lee solo su pulso"
  on public.pulsos for select
  using (sucursal_id = public.sucursal_actual());

-- ---------------------------------------------------------------------------
-- El pulso se sanea aquí dentro, no en quien lo manda
-- ---------------------------------------------------------------------------

-- Esto es `sanearPulso` (apps/relay/src/pulsos.ts) mudado al motor, y es lo que
-- permite que el Hub haga `upsert` directo sin una Edge Function en medio.
--
-- DOS COSAS QUE EL HUB NO PUEDE DECIDIR:
--
--   1. **La hora.** La pone el servidor siempre, se mande lo que se mande. El
--      reloj de un local puede estar en cualquier año, y un pulso fechado en
--      2019 —o en 2030— desordena el panel de MOTRAE entero (ADR-26 §6).
--   2. **Qué campos sobreviven.** El inventario de terminales se reconstruye
--      campo a campo en vez de copiarse: un `token` de emparejamiento colado
--      ahí dentro sería la credencial con la que cualquiera sincroniza contra
--      el Hub de ese local. Copiar el objeto entero dejaría entrar cualquier
--      cosa que el Hub añadiera hoy o en tres versiones, persistida y servida
--      sin que nadie lo hubiera decidido.
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

create trigger pulso_saneado
  before insert or update on public.pulsos
  for each row execute function public.sanear_pulso();
