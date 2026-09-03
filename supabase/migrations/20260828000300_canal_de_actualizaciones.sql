-- El canal de actualizaciones, con una base de datos detrás.
--
-- QUÉ CAMBIA Y QUÉ NO
--
-- No cambia el mecanismo: el manifiesto sigue firmado Ed25519 con la privada de
-- MOTRAE, que no sale de Central, y el Hub lo sigue verificando contra su
-- pública compilada antes de descargar un solo byte. Supabase NO se vuelve parte
-- de confianza, igual que GitHub nunca lo fue: puede dejar de servir una
-- versión, no puede fabricar ninguna.
--
-- Cambia de dónde sale, y eso compra dos cosas que el archivo público no podía
-- dar:
--
--   1. Targeting por local, por nombre. El anillo era un porcentaje con un hash
--      estable del sucursal_id (ADR-26 §5) porque el manifiesto es un archivo
--      público en GitHub y la cartera de MOTRAE no puede estar ahí. En una tabla
--      con RLS sí puede: se dice "Rodizio a la 1.4.0 y el resto se queda", por
--      nombre, sin publicarle a nadie quiénes son los clientes.
--   2. La adopción es una consulta. Qué versión ofrecí y cuál corre cada local
--      salen del mismo sitio, cruzando con pulsos. Hoy son un archivo JSON
--      servido con clave de administración y un cruce a mano en Central.

create table public.versiones (
  version                  text primary key,
  notas                    text not null,
  url                      text not null,
  sha256                   text not null,
  publicado_ts             timestamptz not null default now(),
  obligatoria              boolean not null default false,
  version_minima_soportada text,

  -- La firma Ed25519 sobre el manifiesto. LA AUTORIDAD SIGUE AQUÍ.
  firma                    text not null,

  canal                    text not null default 'estable',

  -- Retirar una versión rota. No la borra: los Hubs que ya la bajaron la
  -- tienen, y borrar la fila solo destruiría la prueba de qué se publicó.
  retirada_ts              timestamptz,
  retirada_motivo          text,

  constraint version_semver check (version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
  constraint minima_semver  check (version_minima_soportada is null
                                    or version_minima_soportada ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
  constraint sha256_hex     check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint url_https      check (url ~ '^https://'),
  constraint canal_conocido check (canal in ('estable', 'beta')),
  -- Las notas las lee el restaurantero. "Se corrigió el reducer de propinas" no
  -- le dice nada; el tope está para que quepan en el diálogo del POS.
  constraint notas_acotadas check (length(notas) between 1 and 2000)
);

comment on table public.versiones is
  'Cada versión publicada, con su manifiesto firmado. Sustituye al motrest.json de GitHub Releases.';

-- ---------------------------------------------------------------------------
-- Quién recibe qué
-- ---------------------------------------------------------------------------

create table public.asignaciones (
  sucursal_id    text primary key references public.sucursales(sucursal_id) on delete cascade,
  canal          text not null default 'estable',

  -- NULL = la última del canal. Con valor = ese local se queda clavado ahí.
  --
  -- Sirve para las dos direcciones: subir a un canario antes que al resto, y
  -- congelar a un local que no puede reiniciarse esta semana.
  version_fijada text references public.versiones(version),

  actualizada_ts timestamptz not null default now(),
  nota           text,

  constraint canal_conocido check (canal in ('estable', 'beta'))
);

comment on table public.asignaciones is
  'A qué versión va cada restaurante. Sustituye al anillo por porcentaje de ADR-26 §5.';

-- ---------------------------------------------------------------------------
-- Qué versión le toca a un local
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER a propósito: resuelve la asignación saltándose RLS, para que
-- la política de versiones pueda apoyarse en ella sin recursión. Es la única
-- forma de que un Hub vea SU versión sin poder listar el catálogo entero.
--
-- Un local sin fila en asignaciones va al canal estable. Que un alta olvidada
-- deje a un restaurante sin actualizaciones sería un fallo silencioso, y de esos
-- ya se corrigió uno: un canal que hay que acordarse de encender es un canal
-- apagado (ADR-26 §4).
create or replace function public.version_ofrecida(p_sucursal text)
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

comment on function public.version_ofrecida(text) is
  'La versión que le toca a un local: la fijada si la tiene, si no la última de su canal.';

-- ---------------------------------------------------------------------------
-- Lo que ve cada quien
-- ---------------------------------------------------------------------------

alter table public.versiones    enable row level security;
alter table public.asignaciones enable row level security;

-- UN LOCAL VE UNA SOLA FILA: la suya.
--
-- No puede enumerar el catálogo, ni descubrir que existe una beta, ni bajarse
-- una versión que no le tocaba. En el manifiesto público esto era imposible —
-- el archivo estaba a la vista de cualquiera y el anillo lo aplicaba el propio
-- Hub sobre sí mismo, por honradez.
create policy "un local ve solo la version que le toca"
  on public.versiones for select
  using (
    public.sucursal_actual() is not null
    and version = public.version_ofrecida(public.sucursal_actual())
  );

create policy "un local ve solo su asignacion"
  on public.asignaciones for select
  using (sucursal_id = public.sucursal_actual());

-- ---------------------------------------------------------------------------
-- La adopción, que antes era un cruce a mano
-- ---------------------------------------------------------------------------

-- Lo que Central pinta: qué le ofrecí a cada local, qué corre de verdad, y
-- cuánto lleva sin moverse. Un Hub comprueba a diario y el restaurante puede
-- aplazar una noche; pasadas 48 horas, quien no subió ya no es alguien que
-- estaba cerrado, es alguien a quien mirar antes de ampliar.
--
-- security_invoker: la vista no presta los permisos de quien la creó. Sin esto
-- una vista es un agujero por debajo de RLS, y aquí dentro está la cartera
-- entera de MOTRAE.
create view public.adopcion
with (security_invoker = true)
as
  select
    s.sucursal_id,
    s.nombre,
    public.version_ofrecida(s.sucursal_id) as version_ofrecida,
    p.version                              as version_instalada,
    p.ts                                   as ultimo_pulso_ts,
    coalesce(a.canal, 'estable')           as canal,
    a.version_fijada,
    (p.version is distinct from public.version_ofrecida(s.sucursal_id)) as rezagado
  from public.sucursales s
  left join public.pulsos       p on p.sucursal_id = s.sucursal_id
  left join public.asignaciones a on a.sucursal_id = s.sucursal_id
  where s.baja_ts is null;

comment on view public.adopcion is
  'Qué versión le tocaba a cada local y cuál corre de verdad. Para Central, no para los Hubs.';
