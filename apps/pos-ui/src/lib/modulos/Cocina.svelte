<script lang="ts">
  /**
   * M2 · Cocina. Dos secciones: el tablero de producción y el menú.
   *
   * El menú vive aquí y no en Administración a propósito: quien conoce de qué
   * está hecho un platillo es la cocina. Los permisos hacen el resto — el chef
   * edita recetas, el mesero solo las consulta, y los costos únicamente los ve
   * quien tiene `fin.costo.ver`.
   */
  import { rutas } from "../nav/rutas.svelte";
  import { sesion } from "../sesion/sesion.svelte";
  import Menu from "./cocina/Menu.svelte";
  import Tablero from "./cocina/Tablero.svelte";

  const seccion = $derived(rutas.actual.seccion);
  const puedeVerTablero = $derived(sesion.puedeVer("cocina.comanda.ver"));

  /**
   * Un mesero no tiene acceso al tablero, pero sí a las recetas: entra
   * directamente al menú en vez de toparse con un "sin acceso".
   */
  const vista = $derived(
    seccion === "menu" || !puedeVerTablero ? "menu" : "tablero",
  );
</script>

{#if vista === "menu"}
  <Menu />
{:else}
  <Tablero />
{/if}
