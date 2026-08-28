-- Los dos buzones: lo que Meta manda hacia el local, y lo que MOTRAE le renueva.
--
-- Ambos sustituyen a estructuras que en Fly vivían EN MEMORIA o en un archivo, y
-- los dos mejoran al mudarse: el índice de mensajes ya vistos sobrevive al
-- reinicio, y el buzón de licencias deja de ser un JSON que había que recordar
-- montar en el volumen correcto.

-- ---------------------------------------------------------------------------
-- Mensajes entrantes de WhatsApp
-- ---------------------------------------------------------------------------

create table public.mensajes_entrantes (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id text not null references public.sucursales(sucursal_id) on delete cascade,

  -- EL ÍNDICE QUE EVITA PROCESAR DOS VECES UN REINTENTO DE META.
  --
  -- Meta reintenta si el webhook tarda en contestar, y un reintento es el mismo
  -- mensaje otra vez. En el relay esto era `YaVistos`, un Map en memoria: un
  -- despliegue lo vaciaba y los reintentos de ese rato entraban por duplicado.
  -- Aquí es una restricción del motor y sobrevive a todo. El identificador de
  -- Meta (`wamid.…`) es único en todo Meta, así que la unicidad es global y no
  -- por sucursal — más estricta, y correcta.
  externo_id  text not null unique,

  contacto    text not null,
  texto       text not null,
  ts          timestamptz not null default now(),

  -- Cuándo se lo llevó el Hub. NULL = el local estaba apagado cuando llegó.
  entregado_ts timestamptz,

  constraint texto_acotado    check (length(texto) <= 4096),
  constraint contacto_acotado check (length(contacto) between 1 and 32)
);

comment on table public.mensajes_entrantes is
  'Lo que un comensal escribió por WhatsApp, esperando a que su restaurante lo recoja.';

create index mensajes_sin_entregar
  on public.mensajes_entrantes (sucursal_id, ts)
  where entregado_ts is null;

alter table public.mensajes_entrantes enable row level security;

create policy "un local lee solo sus mensajes"
  on public.mensajes_entrantes for select
  using (sucursal_id = public.sucursal_actual());

-- Marcar como recogido es lo único que el Hub puede escribir aquí. No puede
-- inventarse un mensaje entrante: eso solo lo hace la Edge Function del webhook,
-- después de comprobar la firma de Meta sobre el cuerpo crudo.
create policy "un local marca sus mensajes como recogidos"
  on public.mensajes_entrantes for update
  using (sucursal_id = public.sucursal_actual())
  with check (sucursal_id = public.sucursal_actual());

-- ---------------------------------------------------------------------------
-- El buzón de renovaciones
-- ---------------------------------------------------------------------------

-- LO QUE CONVIERTE «RENOVAR» EN UN CLIC en vez de una visita al restaurante.
--
-- Y aun así, desde aquí NO se puede fabricar ninguna licencia: el documento va
-- firmado con la privada Ed25519 de MOTRAE, que no sale de Central, y el Hub lo
-- verifica contra su pública compilada antes de escribir nada. Esta tabla es un
-- cartero: puede no entregar, no puede falsificar. Lo peor que puede hacer quien
-- consiga escribir aquí es entregar licencias que MOTRAE ya había firmado.
create table public.licencias_pendientes (
  sucursal_id   text primary key references public.sucursales(sucursal_id) on delete cascade,
  licencia      jsonb not null,
  depositada_ts timestamptz not null default now(),

  intentos      integer not null default 0,
  entregada_ts  timestamptz,

  -- SE VACÍA SOLO CON ESTO, y solo si el Hub dijo que sí.
  --
  -- «Entregada» significa «se le mandó», no «la instaló»: el enlace puede
  -- caerse justo en medio. Una renovación dada por buena sin estarlo es un
  -- restaurante bloqueado un lunes por la mañana, así que son dos columnas
  -- distintas y Central enseña la diferencia.
  confirmada_ts timestamptz,

  -- Si la rechazó —firma que no verifica, licencia de otro local— se queda
  -- pendiente y queda escrito el motivo. Es un problema que hay que mirar, no
  -- algo que se pueda tapar borrando la fila y dejando al local sin renovar.
  ultimo_error  text,

  constraint licencia_acotada check (pg_column_size(licencia) <= 65536)
);

comment on table public.licencias_pendientes is
  'Renovaciones firmadas por MOTRAE esperando a que su restaurante las recoja.';

alter table public.licencias_pendientes enable row level security;

create policy "un local lee solo su renovacion"
  on public.licencias_pendientes for select
  using (sucursal_id = public.sucursal_actual());

create policy "un local confirma solo su renovacion"
  on public.licencias_pendientes for update
  using (sucursal_id = public.sucursal_actual())
  with check (sucursal_id = public.sucursal_actual());
