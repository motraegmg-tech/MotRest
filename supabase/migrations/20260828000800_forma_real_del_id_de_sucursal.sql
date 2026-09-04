-- La restricción del `sucursal_id` rechazaba a los locales que ya existen.
--
-- Estaba escrita como `^suc-[a-z0-9]{4,32}$` mirando el ejemplo de la
-- documentación (`suc-a1b2c3d4`), que es solo uno de los dos formatos que se
-- usan de verdad:
--
--   * El Hub, al instalarse sin licencia, genera `suc-<8 hex>` — y ese sí cuadra.
--   * **Central genera un slug con guiones**: `idDeSucursal("Rodizio", "Centro")`
--     da `suc-rodizio-centro`. Con guión. Ese NO cuadraba.
--   * Y hay al menos un local con mayúsculas, escrito a mano al emitir su
--     licencia: `suc-Rest-Pureba`.
--
-- El id no es un detalle interno: se escribe en `<datos>/sucursal.txt`, viaja
-- **dentro de la licencia firmada** y se dicta por teléfono en un soporte. No se
-- puede cambiar sin reemitir. Así que la base de datos tiene que aceptar lo que
-- hay en el campo, no al revés — una restricción que deja fuera a un
-- restaurante existente no es rigor, es dejarlo sin sistema.

alter table public.sucursales drop constraint if exists sucursal_id_con_forma;

alter table public.sucursales
  add constraint sucursal_id_con_forma
  check (sucursal_id ~ '^suc-[A-Za-z0-9-]{1,60}$');

comment on column public.sucursales.sucursal_id is
  'El id que el local escribe en sucursal.txt y que viaja en su licencia firmada. Lo genera el Hub (suc-<hex>) o Central (slug con guiones).';
