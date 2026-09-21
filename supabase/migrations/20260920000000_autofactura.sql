-- ============================================================================
-- PORTAL DE AUTOFACTURA (MotRest 1.5.6)
--
-- El comensal pide su factura desde su teléfono, con el QR del ticket, sin la
-- red del restaurante. El portal (Vercel) NO timbra: deja sus datos fiscales en
-- un sobre cifrado que solo abre el Hub del local, y el Hub timbra con su propia
-- llave de FacturAPI, que nunca sale de la caja. Plan: docs/PLAN-AUTOFACTURA-PORTAL.md
--
-- Quién toca qué:
--   · el portal, con la llave de servicio (desde el servidor de Vercel);
--   · el Hub, como `authenticated`, solo lo de su sucursal;
--   · Central, con la llave de servicio, las claves de cada local.
-- Nadie como `anon`.
-- ============================================================================


-- --- La clave de cada restaurante -------------------------------------------
--
-- Corta y legible («RODIZIO»): se imprime en el ticket y el comensal la teclea
-- cuando el QR no enfoca. NO es el `sucursal_id` —ese es interno y no se
-- enseña—. La asigna Gonzalo en Central (se propone sola a partir del nombre).
--
-- `portal_url` es la dirección del portal para ESTE local. Va aquí y no escrita
-- en el código porque hoy es la dirección gratuita de Vercel y mañana puede ser
-- un dominio propio (decisión de Gonzalo): cambiarla es un ajuste en Central,
-- no una versión nueva.
create table public.claves_de_autofactura (
  clave       text primary key check (clave ~ '^[A-Z0-9-]{3,20}$'),
  sucursal_id text not null unique references public.sucursales(sucursal_id) on delete cascade,
  portal_url  text not null check (portal_url ~ '^https://[^\s/@]+(/[^\s]*)?$' and length(portal_url) <= 200),
  creada_ts   timestamptz not null default now()
);
comment on table public.claves_de_autofactura is
  'La clave corta de cada local para el portal de autofactura, y la dirección del portal. Las escribe Central.';

alter table public.claves_de_autofactura enable row level security;
revoke all on public.claves_de_autofactura from anon, authenticated;
-- El Hub lee SU fila: con ella sabe que el portal está encendido y qué imprimir.
grant select on public.claves_de_autofactura to authenticated;
create policy "el local lee su clave" on public.claves_de_autofactura for select
  using (sucursal_id = privado.sucursal_actual());


-- --- Los tickets que se pueden facturar -------------------------------------
--
-- Lo MÍNIMO para reconocer un ticket: folio, total, cuándo se cobró y el código
-- del QR. Sin platillos ni nombres: quien lea esta tabla no aprende qué cenó
-- nadie. Lo publica el Hub al cobrar y lo borra pasada la vigencia.
create table public.tickets_facturables (
  sucursal_id text not null references public.sucursales(sucursal_id) on delete cascade,
  orden_id    text not null check (length(orden_id) <= 64),
  folio       text not null check (folio ~ '^[0-9A-Z]{8}$'),
  total       bigint not null check (total > 0),
  cerrada_ts  timestamptz not null,
  -- El mismo alfabeto que la firma del enlace de la encuesta (dominio,
  -- `clientes/acceso.ts`): sin 0/O ni 1/I/L, que se confunden al dictarlos.
  codigo      text not null check (codigo ~ '^[2-9A-HJKMNP-TV-Z]{16}$'),
  vence_ts    timestamptz not null,
  -- Con valor por omisión para que el Hub NUNCA lo mande: al volver a publicar
  -- un ticket (la cuenta se reabrió y cambió el total) no puede devolver a
  -- «disponible» uno que el comensal ya pidió. El estado lo mueven el portal
  -- y el trigger, no el Hub.
  estado      text not null default 'disponible' check (estado in ('disponible', 'solicitado', 'facturado')),
  primary key (sucursal_id, orden_id),
  unique (sucursal_id, folio),
  constraint vence_despues_del_cobro check (vence_ts > cerrada_ts)
);
comment on table public.tickets_facturables is
  'Registro mínimo de las cuentas cobradas que se pueden autofacturar. Sin platillos ni nombres.';

alter table public.tickets_facturables enable row level security;
revoke all on public.tickets_facturables from anon, authenticated;
grant select, insert, update, delete on public.tickets_facturables to authenticated;

create policy "el local lee sus tickets" on public.tickets_facturables for select
  using (sucursal_id = privado.sucursal_actual());
create policy "el local inserta sus tickets" on public.tickets_facturables for insert
  with check (sucursal_id = privado.sucursal_actual());
create policy "el local actualiza sus tickets" on public.tickets_facturables for update
  using (sucursal_id = privado.sucursal_actual())
  with check (sucursal_id = privado.sucursal_actual());
create policy "el local borra sus tickets" on public.tickets_facturables for delete
  using (sucursal_id = privado.sucursal_actual());


-- --- El buzón de solicitudes -------------------------------------------------
--
-- Igual que `secretos_pendientes`: el portal deposita, el Hub recoge y marca.
create table public.solicitudes_de_factura (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  text not null,
  orden_id     text not null,
  sobre        jsonb not null,
  creado_ts    timestamptz not null default now(),
  entregado_ts timestamptz,
  resuelto_ts  timestamptz,
  resultado    text check (resultado in ('timbrada', 'rechazada')),
  uuid_cfdi    text,
  error        text,
  foreign key (sucursal_id, orden_id)
    references public.tickets_facturables(sucursal_id, orden_id) on delete cascade,
  constraint sobre_con_forma check (
    jsonb_typeof(sobre) = 'object'
    and sobre ->> 'formato' = 'motrest-sobre-v1'
    and pg_column_size(sobre) <= 16384
  ),
  constraint error_acotado check (error is null or length(error) <= 1000),
  constraint uuid_cfdi_acotado check (uuid_cfdi is null or length(uuid_cfdi) <= 36)
);
comment on table public.solicitudes_de_factura is
  'Buzón donde el portal deja los datos fiscales del comensal en un sobre cifrado para que su Hub los recoja y timbre.';

-- UN TICKET, UNA SOLICITUD VIVA. La base misma impide la segunda, aunque dos
-- envíos lleguen a la vez. Una rechazada no cuenta: el comensal corrige y pide
-- otra vez.
create unique index solicitudes_de_factura_activa_idx
  on public.solicitudes_de_factura (sucursal_id, orden_id)
  where resultado is distinct from 'rechazada';

-- Lo que el Hub busca al volver la red: lo suyo que nadie ha resuelto.
create index solicitudes_de_factura_pendientes_idx
  on public.solicitudes_de_factura (sucursal_id, creado_ts)
  where resultado is null;

alter table public.solicitudes_de_factura enable row level security;
revoke all on public.solicitudes_de_factura from anon, authenticated;
grant select on public.solicitudes_de_factura to authenticated;
grant update (entregado_ts, resuelto_ts, resultado, uuid_cfdi, error)
  on public.solicitudes_de_factura to authenticated;

create policy "el local lee sus solicitudes" on public.solicitudes_de_factura for select
  using (sucursal_id = privado.sucursal_actual());
create policy "el local actualiza sus solicitudes" on public.solicitudes_de_factura for update
  using (sucursal_id = privado.sucursal_actual())
  with check (sucursal_id = privado.sucursal_actual());

alter publication supabase_realtime add table public.solicitudes_de_factura;
alter table public.solicitudes_de_factura replica identity full;


-- --- El ticket sigue a su solicitud ------------------------------------------
--
-- El Hub solo escribe el resultado; el estado del ticket lo pone la base. Así
-- un ticket rechazado nunca se queda atorado en «solicitado»: vuelve a estar
-- disponible y el comensal puede corregir su RFC dentro de las 72 horas.
--
-- En `privado`, como las demás funciones internas: fuera de la API pública.
create or replace function privado.ticket_sigue_a_su_solicitud()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.resultado = 'rechazada' then
    update public.tickets_facturables
       set estado = 'disponible'
     where sucursal_id = new.sucursal_id and orden_id = new.orden_id;
  elsif new.resultado = 'timbrada' then
    update public.tickets_facturables
       set estado = 'facturado'
     where sucursal_id = new.sucursal_id and orden_id = new.orden_id;
  end if;
  return new;
end;
$$;
revoke execute on function privado.ticket_sigue_a_su_solicitud() from public, anon, authenticated;

create trigger ticket_sigue_a_su_solicitud
  after update of resultado on public.solicitudes_de_factura
  for each row
  when (old.resultado is distinct from new.resultado)
  execute function privado.ticket_sigue_a_su_solicitud();


-- --- El límite de intentos ---------------------------------------------------
--
-- Dos contadores: por ticket (clave+folio, desde cualquier red) y por red (desde
-- cualquier ticket). Solo el primero no basta —quien cambia de folio nunca se
-- topa con él— y solo el segundo tampoco —quien cambia de red, igual—.
create table public.intentos_factura (
  llave      text primary key check (length(llave) <= 120),
  fallos     int not null,
  ultimo_ts  timestamptz not null default now()
);
comment on table public.intentos_factura is
  'Fallos recientes del portal de autofactura, por ticket y por red, para frenar a quien adivina folios.';

alter table public.intentos_factura enable row level security;
revoke all on public.intentos_factura from anon, authenticated;

-- Suma un fallo en los dos contadores en un solo paso. Pasada la hora de
-- castigo el contador vuelve a empezar desde 1 (no desde 0: este fallo cuenta).
-- En `public` porque el portal la llama por la API; solo con la llave de servicio.
create or replace function public.registrar_fallo_autofactura(p_clave text, p_folio text, p_ip text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.intentos_factura as i (llave, fallos)
  values (left('ticket:' || p_clave || ':' || p_folio, 120), 1)
  on conflict (llave) do update set
    fallos = case when now() > i.ultimo_ts + interval '1 hour' then 1 else i.fallos + 1 end,
    ultimo_ts = now();

  insert into public.intentos_factura as i (llave, fallos)
  values (left('ip:' || p_ip, 120), 1)
  on conflict (llave) do update set
    fallos = case when now() > i.ultimo_ts + interval '1 hour' then 1 else i.fallos + 1 end,
    ultimo_ts = now();
$$;
revoke execute on function public.registrar_fallo_autofactura(text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_fallo_autofactura(text, text, text) to service_role;
