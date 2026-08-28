-- Datos de ensayo. NUNCA se cargan en el proyecto de producción.
--
-- Los nombres son deliberadamente falsos —"El Vecino", "La de Enfrente"— y no
-- los de clientes reales. Ya pasó una vez que una semilla de demostración viajó
-- al Hub y su personal de mentira acabó pareciendo personal de verdad; aquí el
-- nombre tiene que delatar al dato en cuanto alguien lo vea en un panel.
--
--   corepack pnpm@9.15.0 supabase db reset     (carga esquema + esta semilla)

insert into public.sucursales (sucursal_id, nombre) values
  ('suc-a1b2c3d4', 'El Vecino'),
  ('suc-e5f6a7b8', 'La de Enfrente')
on conflict (sucursal_id) do nothing;

-- El documento firmado va en `manifiesto` y las columnas son copias suyas: es
-- lo que el Hub verifica, y por eso se guarda tal cual. Estas firmas son de
-- mentira y NO verifican -- sirven para probar consultas y politicas, nunca el
-- carril de actualizacion de punta a punta.
insert into public.versiones (version, notas, url, sha256, firma, canal, publicado_ts, manifiesto) values
  ('1.3.5',
   'Version de ensayo: la que se supone instalada en la flota.',
   'https://ejemplo.invalid/instaladores/1.3.5.exe',
   repeat('a', 64), 'firma-de-ensayo-no-verifica', 'estable', now() - interval '10 days',
   jsonb_build_object(
     'version', '1.3.5',
     'notas', 'Version de ensayo: la que se supone instalada en la flota.',
     'url', 'https://ejemplo.invalid/instaladores/1.3.5.exe',
     'sha256', repeat('a', 64),
     'publicado_ts', 1786000000000::bigint,
     'firma', 'firma-de-ensayo-no-verifica')),
  ('1.4.0',
   'Version de ensayo: la beta que solo ve el canario.',
   'https://ejemplo.invalid/instaladores/1.4.0.exe',
   repeat('b', 64), 'firma-de-ensayo-no-verifica', 'beta', now(),
   jsonb_build_object(
     'version', '1.4.0',
     'notas', 'Version de ensayo: la beta que solo ve el canario.',
     'url', 'https://ejemplo.invalid/instaladores/1.4.0.exe',
     'sha256', repeat('b', 64),
     'publicado_ts', 1786900000000::bigint,
     'firma', 'firma-de-ensayo-no-verifica'))
on conflict (version) do nothing;

-- El Vecino hace de canario: se le fija la beta a mano. La de Enfrente no tiene
-- fila, así que cae al canal estable por omisión — que es el caso que hay que
-- poder probar, porque es el de un local recién dado de alta.
insert into public.asignaciones (sucursal_id, canal, version_fijada, nota) values
  ('suc-a1b2c3d4', 'beta', '1.4.0', 'Canario del ensayo')
on conflict (sucursal_id) do update
  set canal = excluded.canal, version_fijada = excluded.version_fijada;
