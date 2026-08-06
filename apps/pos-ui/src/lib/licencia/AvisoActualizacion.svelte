<script lang="ts">
  /**
   * «Hay una nueva actualización disponible».
   *
   * Las tres opciones que pidió Gonzalo: **ahora**, **más tarde** o **a una hora
   * en específico**. Y si elige posponerla, el aviso se queda puesto en la barra
   * lateral — aquí solo se cierra el diálogo.
   *
   * POR QUÉ LAS HORAS QUE SE OFRECEN SON DE MADRUGADA. Porque son las únicas a
   * las que un restaurante puede permitirse un reinicio. Poner un selector de 24
   * horas invita a elegir las 14:00, que es plena comida, y el sistema tendría
   * que negarse después de haberlo ofrecido. Se ofrece solo lo que sí se puede.
   */
  import type { EleccionActualizacion } from "@motrest/dominio";

  const {
    version,
    notas,
    obligatoria = false,
    onDecidir,
  }: {
    version: string;
    notas: string;
    obligatoria?: boolean;
    onDecidir: (eleccion: EleccionActualizacion) => void;
  } = $props();

  /** Horas de cierre típicas. Nada dentro del servicio. */
  const HORAS = [23, 0, 1, 2, 3, 4, 5, 6];
  let eligiendoHora = $state(false);
</script>

<div class="fondo" role="dialog" aria-modal="true" aria-labelledby="act-titulo">
  <div class="tarjeta">
    <div class="cinta"></div>

    <h2 id="act-titulo">Hay una nueva actualización disponible</h2>
    <p class="version">MotRest {version}</p>

    {#if notas}
      <p class="notas">{notas}</p>
    {/if}

    <!--
      Se dice ANTES de que elija, no después. Quien pulsa "instalar ahora" a
      media cena tiene que saber que eso reinicia la caja; enterarse al
      reiniciarse es enterarse tarde.
    -->
    <p class="ojo">
      La instalación reinicia el sistema. Nunca se hace con un turno de caja
      abierto: si lo hay, se esperará a que cierre.
    </p>

    {#if obligatoria}
      <p class="obligatoria">
        Esta actualización es necesaria y no se puede posponer.
      </p>
      <div class="botones">
        <button class="primario" onclick={() => onDecidir({ cuando: "ahora" })}>
          Instalar
        </button>
      </div>
    {:else if eligiendoHora}
      <p class="pregunta">¿A qué hora?</p>
      <div class="horas">
        {#each HORAS as hora (hora)}
          <button onclick={() => onDecidir({ cuando: "a_las", hora })}>
            {String(hora).padStart(2, "0")}:00
          </button>
        {/each}
      </div>
      <button class="volver" onclick={() => (eligiendoHora = false)}>Volver</button>
    {:else}
      <div class="botones">
        <button class="primario" onclick={() => onDecidir({ cuando: "ahora" })}>
          Actualizar ahora
        </button>
        <button onclick={() => onDecidir({ cuando: "mas_tarde" })}>Más tarde</button>
        <button onclick={() => (eligiendoHora = true)}>A una hora…</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .fondo {
    position: fixed;
    z-index: 80;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(20, 24, 26, 0.55);
  }
  .tarjeta {
    width: min(28rem, 100%);
    background: var(--blanco);
    border-radius: var(--r-lg);
    padding: 1.6rem 1.5rem 1.4rem;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
    position: relative;
  }
  .cinta {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--acento) 0%, var(--peligro) 100%);
  }
  h2 {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    color: var(--pizarra);
    margin: 0.3rem 0 0.2rem;
  }
  .version {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--acento);
    margin: 0 0 0.8rem;
  }
  .notas {
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--pizarra);
    margin: 0 0 0.9rem;
  }
  .ojo {
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--gris);
    background: var(--fondo);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.7rem;
    margin: 0 0 1.1rem;
  }
  .obligatoria {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--peligro);
    margin: 0 0 1rem;
  }
  .pregunta {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--pizarra);
    margin: 0 0 0.6rem;
  }
  .botones {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .horas {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
    margin-bottom: 0.7rem;
  }
  button {
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    /* Alto de dedo: esto se toca en una tablet, no con un ratón. */
    min-height: 2.75rem;
    padding: 0 0.9rem;
    border-radius: var(--r-sm);
    border: 1.5px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  button:hover {
    border-color: var(--acento);
  }
  .primario {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
    flex: 1;
  }
  .volver {
    width: 100%;
    border: none;
    color: var(--gris);
    min-height: 2.2rem;
  }
</style>
