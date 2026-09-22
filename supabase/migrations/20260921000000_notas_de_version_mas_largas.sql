-- ============================================================================
-- NOTAS DE VERSIÓN DE HASTA 5000 CARACTERES (21-sep-2026)
--
-- La 1.5.6 trae ocho mejoras y el portal de autofactura: sus notas miden 3735
-- caracteres y la nube las rechazó («La nube no aceptó la versión»), aunque el
-- instalador y el manifiesto firmado ya estaban en GitHub. El tope de 2000 era
-- de cuando una versión traía tres arreglos. Se sube a 5000: sigue acotado
-- —las notas viajan en cada pulso de actualización y se enseñan en la caja—,
-- pero cabe una versión grande sin tener que volver a firmarla.
-- ============================================================================

alter table public.versiones drop constraint notas_acotadas;
alter table public.versiones
  add constraint notas_acotadas check (length(notas) between 1 and 5000);
