-- El manifiesto firmado se guarda TAL CUAL, y las columnas son copias.
--
-- EL FALLO QUE ESTO EVITA, que no habría aparecido hasta el restaurante:
--
-- La firma Ed25519 no cubre una lista de campos, cubre el **JSON canónico del
-- manifiesto entero** menos la propia firma (`contenidoFirmableDe`, en
-- packages/dominio/src/comun/firma.ts). Las claves se ordenan y las que valen
-- `undefined` se descartan.
--
-- Reconstruir el manifiesto desde columnas parecía inofensivo y no lo es. Basta
-- una diferencia para que el texto firmable cambie y la firma deje de cuadrar:
--
--   * `obligatoria` es `not null default false` aquí. Un manifiesto que Central
--     firmó SIN ese campo volvería del Hub con `obligatoria: false` — otro
--     objeto, otra firma, verificación fallida.
--   * `canal` y `retirada_ts` son columnas nuestras y no van en el manifiesto.
--     Colarlas al reconstruir tendría el mismo efecto.
--   * `publicado_ts` es un número de milisegundos en el manifiesto y aquí es
--     `timestamptz`: ida y vuelta puede perder precisión.
--
-- El síntoma habría sido «se publicó MotRest X con una firma que no es de
-- MOTRAE» en la bitácora de cada local, con el canal entero parado y sin una
-- causa evidente. Y no lo habría destapado ninguna prueba del Hub, porque en
-- las pruebas el manifiesto se construye y se firma en memoria.
--
-- Así que la autoridad es la columna `manifiesto`: lo que Central firmó, byte a
-- byte. Las demás existen para que Central pueda consultar, ordenar y poner
-- restricciones — y las CHECK de abajo impiden que se separen del documento.

alter table public.versiones
  add column manifiesto jsonb;

-- Las filas de ensayo que hubiera no tienen documento; se recompone el mínimo
-- para poder marcar la columna como obligatoria. En producción no hay ninguna.
update public.versiones
   set manifiesto = jsonb_strip_nulls(jsonb_build_object(
         'version', version,
         'notas', notas,
         'url', url,
         'sha256', sha256,
         'publicado_ts', (extract(epoch from publicado_ts) * 1000)::bigint,
         'obligatoria', obligatoria,
         'version_minima_soportada', version_minima_soportada,
         'firma', firma
       ))
 where manifiesto is null;

alter table public.versiones
  alter column manifiesto set not null;

-- Las copias no pueden contradecir al documento.
--
-- Sin esto, Central podría enseñar en su panel una versión y servirle al Hub
-- otra: la lista diría 1.4.0 y el manifiesto llevaría la 1.3.9. Con la
-- restricción, una fila incoherente no llega a escribirse.
alter table public.versiones
  add constraint manifiesto_es_de_esta_version
    check (manifiesto ->> 'version' = version),
  add constraint manifiesto_trae_la_misma_huella
    check (manifiesto ->> 'sha256' = sha256),
  add constraint manifiesto_trae_la_misma_url
    check (manifiesto ->> 'url' = url),
  add constraint manifiesto_va_firmado
    check (coalesce(manifiesto ->> 'firma', '') <> '');

comment on column public.versiones.manifiesto is
  'El documento firmado por Central, tal cual. Es la autoridad: las otras columnas son copias para consultar.';
