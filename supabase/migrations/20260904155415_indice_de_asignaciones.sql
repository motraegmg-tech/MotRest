-- La clave ajena de `asignaciones` no tenía índice que la cubriera.
--
-- Lo señaló el linter de Supabase. Sin índice, borrar o actualizar una fila de
-- `versiones` obliga a Postgres a recorrer `asignaciones` entera para comprobar
-- que nadie la apunta.
--
-- Hoy no se nota: hay tres locales y un puñado de versiones. Se pone ahora
-- porque el momento en que sí se notaría es el peor posible — retirar una
-- versión con la flota entera asignada, que es justo lo que se hace cuando una
-- actualización salió mal y hay prisa.

create index if not exists asignaciones_version_fijada_idx
  on public.asignaciones (version_fijada);
