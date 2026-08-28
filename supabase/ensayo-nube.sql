-- Monta los dos locales de ensayo que necesita `pnpm --filter @motrest/hub ensayo:nube`.
--
-- Se corre A MANO y se deshace al terminar (al final está el desmontaje). No va
-- en `seed.sql` a propósito: eso se carga en cada `db reset` y estos dos locales
-- crean **usuarios de Supabase Auth**, que no es algo que deba aparecer solo.
--
-- Los nombres delatan al dato en cuanto alguien los vea en un panel. Ya pasó una
-- vez que una semilla de demostración viajó a un Hub y su personal de mentira
-- acabó pareciendo personal de verdad.
--
-- POR QUÉ SE CREAN POR SQL Y NO CON EL ALTA DE VERDAD
--
-- El alta de un restaurante real la hace `apps/central/alta-en-la-nube.ts`
-- contra la API de administración, que necesita la llave de servicio. Para un
-- ensayo basta con esto, y el usuario que sale es el mismo.

-- ---------------------------------------------------------------------------
-- Montar
-- ---------------------------------------------------------------------------

do $ensayo$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
begin
  insert into public.sucursales (sucursal_id, nombre) values
    ('suc-ensayo01', 'El de Ensayo'),
    ('suc-ensayo02', 'El Vecino de Ensayo')
  on conflict (sucursal_id) do nothing;

  -- El `sucursal_id` va en `raw_app_meta_data`: es lo único que la base de datos
  -- se cree después sobre quién es este Hub, y el Hub no puede escribirlo.
  --
  -- LAS COLUMNAS DE TOKEN VAN EN CADENA VACÍA, NUNCA EN NULL. GoTrue las lee
  -- como texto, no como texto-que-puede-faltar, y un NULL revienta su consulta
  -- con «Database error querying schema» — un mensaje que no apunta a nada y
  -- cuesta media hora. Cuando el usuario lo crea la API de administración
  -- vienen así; creándolo a mano hay que ponerlas.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated',
     'suc-ensayo01@hubs.motrae.mx',
     extensions.crypt('credencial-de-ensayo-01-no-sirve-fuera', extensions.gen_salt('bf')),
     now(),
     jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'sucursal_id','suc-ensayo01'),
     '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated',
     'suc-ensayo02@hubs.motrae.mx',
     extensions.crypt('credencial-de-ensayo-02-no-sirve-fuera', extensions.gen_salt('bf')),
     now(),
     jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'sucursal_id','suc-ensayo02'),
     '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '')
  on conflict (id) do nothing;

  -- GoTrue necesita la identidad del proveedor `email` para el inicio de sesión
  -- con contraseña. Sin esta fila el usuario existe y no puede entrar.
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
  values
    (gen_random_uuid(), a, 'suc-ensayo01@hubs.motrae.mx', 'email',
     jsonb_build_object('sub', a::text, 'email', 'suc-ensayo01@hubs.motrae.mx', 'email_verified', true),
     now(), now(), now()),
    (gen_random_uuid(), b, 'suc-ensayo02@hubs.motrae.mx', 'email',
     jsonb_build_object('sub', b::text, 'email', 'suc-ensayo02@hubs.motrae.mx', 'email_verified', true),
     now(), now(), now())
  on conflict do nothing;
end;
$ensayo$;

-- ---------------------------------------------------------------------------
-- Desmontar (correr al terminar el ensayo)
-- ---------------------------------------------------------------------------
--
-- Dejarlos puestos no rompe nada —RLS los aísla y no tienen número de WhatsApp—
-- pero salen en Central como dos restaurantes más, y un panel con clientes de
-- mentira deja de ser un panel en el que se confía.
--
--   delete from auth.users     where email like 'suc-ensayo%@hubs.motrae.mx';
--   delete from public.sucursales where sucursal_id like 'suc-ensayo%';
--
-- Las filas de `pulsos`, `mensajes_entrantes` y `licencias_pendientes` se van
-- solas: cuelgan de `sucursales` con `on delete cascade`.
