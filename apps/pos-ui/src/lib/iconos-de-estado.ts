/**
 * Qué icono le toca a cada estado del dominio.
 *
 * ## Por qué está en un solo sitio
 *
 * El estado de una mesa se pinta en cuatro lugares —la mesa del plano, el plano
 * ampliado, el panel de la mesa y la leyenda— y hasta ahora cada uno reescribía
 * su propio `{#if estado === "libre"}`, con redacciones que ya habían empezado
 * a separarse: uno decía «pers.» y otro «comensales». Un mapa compartido evita
 * que el icono repita esa historia.
 *
 * ## Por qué esto importa más que el color
 *
 * Hoy la diferencia entre «ocupada» y «enviada a cocina» es rojo contra
 * naranja. Es el par exacto que un daltonismo rojo-verde no separa, y el que un
 * reflejo en la pantalla de la caja borra primero. Con un icono propio, el
 * estado se lee aunque el color no llegue.
 */
import type { Semaforo } from "@motrest/dominio";
import type { NombreIcono } from "@motrest/ui/iconos";
import type { EstadoMesa } from "./pos.svelte";

export const ICONO_MESA: Record<EstadoMesa, NombreIcono> = {
  libre: "mesa-libre",
  ocupada: "mesa-ocupada",
  // El dominio lo llama «cuenta»; el restaurante lo llama «en cocina», que es
  // lo que de verdad ocurrió: la comanda ya se mandó.
  cuenta: "mesa-cocina",
};

export const ICONO_SEMAFORO: Record<Semaforo, NombreIcono> = {
  normal: "en-tiempo",
  advertencia: "tardando",
  demorado: "demorado",
  listo: "listo",
};
