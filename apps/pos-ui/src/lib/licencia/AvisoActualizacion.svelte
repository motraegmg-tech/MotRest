<script lang="ts">
  /**
   * «Hay una nueva actualización disponible».
   *
   * ## Se instala cuando el restaurante quiera
   *
   * Antes había una ventana de madrugada —23:00 a 06:00— y el sistema se negaba
   * fuera de ella aunque el restaurante hubiera pulsado «ahora». La intención
   * era buena y el resultado no: MotRest no conoce el horario de ningún local.
   * Uno da desayunos, otro abre solo de noche, y a un lunes con la persiana
   * abajo a las once de la mañana el sistema le decía que no.
   *
   * Decisión de Gonzalo: manda quien está en el local. Aquí ya no se ofrece una
   * lista de horas de madrugada, porque ya no hay ninguna hora prohibida.
   *
   * ## Lo que sustituye a la prohibición: una confirmación
   *
   * Quitar el candado sin poner nada en su lugar sería peor que dejarlo: un
   * reinicio a media cena es real aunque el software ya no lo impida. Así que al
   * pulsar «Actualizar ahora» aparece una segunda pantalla que dice qué versión
   * es, qué trae, y —esto es lo importante— **qué hay abierto en este momento**:
   * el turno de caja y las mesas con cuenta. Con eso delante, decide.
   *
   * Es la única pregunta doble del producto, y se gana el sitio: es lo único que
   * apaga la caja.
   */
  import { advertenciasDeInstalacion, type EleccionActualizacion } from "@motrest/dominio";

  const {
    version,
    notas,
    obligatoria = false,
    turnoAbierto = false,
    mesasAbiertas = 0,
    onDecidir,
  }: {
    version: string;
    notas: string;
    obligatoria?: boolean;
    /** ¿Hay un turno de caja sin cerrar ahora mismo? */
    turnoAbierto?: boolean;
    /** Cuántas mesas tienen cuenta abierta. */
    mesasAbiertas?: number;
    onDecidir: (
      eleccion: EleccionActualizacion,
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
  } = $props();

  let confirmando = $state(false);
  let mandando = $state(false);
  let error = $state("");

  /**
   * Las notas, partidas en lista.
   *
   * Llegan como un solo texto porque así viajan firmadas en el manifiesto —
   * partirlas en el origen obligaría a cambiar la forma de lo que se firma—,
   * pero leerlas de corrido en un párrafo largo es leerlas por encima. Se
   * separan por renglón, y si vienen en uno solo, por punto seguido.
   */
  const mejoras = $derived.by(() => {
    const texto = (notas ?? "").trim();
    if (!texto) return [] as string[];
    const renglones = texto
      .split(/\r?\n+/)
      .map((l) => l.replace(/^[-•·*]\s*/, "").trim())
      .filter(Boolean);
    if (renglones.length > 1) return renglones;
    return texto
      .split(/(?<=\.)\s+/)
      .map((f) => f.trim())
      .filter(Boolean);
  });

  const avisos = $derived(advertenciasDeInstalacion(turnoAbierto, mesasAbiertas));

  /**
   * La decisión no se da por tomada hasta que el Hub la confirma.
   *
   * Quien instala es el Hub, no esta pantalla. Cerrar el diálogo al pulsar y
   * confiar en que llegó es exactamente cómo esto estuvo roto: la elección se
   * quedaba en la terminal y el restaurante creía haber actualizado.
   */
  async function decidir(eleccion: EleccionActualizacion) {
    if (mandando) return;
    mandando = true;
    error = "";
    const resultado = await onDecidir(eleccion);
    if (!resultado.ok) error = resultado.error;
    mandando = false;
  }
</script>

<div class="fondo" role="dialog" aria-modal="true" aria-labelledby="act-titulo">
  <div class="tarjeta">
    <div class="cinta"></div>

    {#if !confirmando}
      <h2 id="act-titulo">Hay una nueva actualización disponible</h2>
      <p class="version">MotRest {version}</p>

      {#if mejoras.length > 0}
        <ul class="mejoras">
          {#each mejoras as mejora (mejora)}
            <li>{mejora}</li>
          {/each}
        </ul>
      {/if}

      {#if error}<p class="error">{error}</p>{/if}

      {#if obligatoria}
        <p class="obligatoria">Esta actualización es necesaria y no se puede posponer.</p>
        <div class="botones">
          <button class="primario" onclick={() => (confirmando = true)}>Instalar</button>
        </div>
      {:else}
        <div class="botones">
          <button class="primario" onclick={() => (confirmando = true)}>Actualizar ahora</button>
          <button disabled={mandando} onclick={() => decidir({ cuando: "mas_tarde" })}>
            Más tarde
          </button>
        </div>
      {/if}
    {:else}
      <!--
        LA SEGUNDA PANTALLA. Repite la versión a propósito: quien llega aquí ya
        no está leyendo, está confirmando, y el número es lo único que no puede
        equivocarse.
      -->
      <h2 id="act-titulo">¿Actualizar ahora a MotRest {version}?</h2>

      {#if mejoras.length > 0}
        <p class="trae">Trae estas mejoras:</p>
        <ul class="mejoras">
          {#each mejoras as mejora (mejora)}
            <li>{mejora}</li>
          {/each}
        </ul>
      {/if}

      <p class="ojo">La instalación reinicia el sistema y tarda un par de minutos.</p>

      <!--
        Lo que hay abierto AHORA MISMO. Es el dato que el software ya no usa para
        prohibir, así que tiene que estar delante de quien decide.
      -->
      {#if avisos.length > 0}
        <ul class="avisos">
          {#each avisos as aviso (aviso.clave)}
            <li>{aviso.texto}</li>
          {/each}
        </ul>
      {/if}

      {#if error}<p class="error">{error}</p>{/if}

      <div class="botones">
        <button class="primario" disabled={mandando} onclick={() => decidir({ cuando: "ahora" })}>
          {mandando ? "Avisando al Hub…" : "Sí, actualizar"}
        </button>
        <button disabled={mandando} onclick={() => (confirmando = false)}>Volver</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .fondo {
    position: fixed;
    inset: 0;
    z-index: var(--z-bloqueo);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(20, 24, 26, 0.55);
  }
  .tarjeta {
    position: relative;
    width: min(30rem, 100%);
    background: var(--blanco);
    border-radius: var(--r-lg);
    padding: 1.8rem 1.6rem 1.5rem;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
    max-height: 90vh;
    overflow-y: auto;
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
    font-size: var(--t-lg);
    font-weight: 700;
    margin-bottom: 0.35rem;
    text-wrap: balance;
  }
  .version {
    font-family: var(--font-titulo);
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--acento-texto);
    margin-bottom: 0.9rem;
  }
  .trae {
    font-size: var(--t-sm);
    font-weight: 600;
    margin: 0.9rem 0 0.4rem;
  }
  .mejoras {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .mejoras li {
    position: relative;
    padding-left: 1.1rem;
    font-size: var(--t-sm);
    line-height: 1.45;
    color: var(--pizarra);
  }
  .mejoras li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--acento);
  }
  .ojo {
    font-size: var(--t-xs);
    color: var(--gris);
    margin-bottom: 0.7rem;
  }
  /*
   * Los avisos van en ámbar y no en rojo. No son un error ni una prohibición:
   * son lo que hay abierto, dicho a tiempo. El rojo diría «no lo hagas», y esa
   * ya no es la decisión del software.
   */
  .avisos {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    background: var(--claro);
    border: 1px solid var(--acento);
    border-radius: var(--r-sm);
  }
  .avisos li {
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--pizarra);
  }
  .obligatoria {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--peligro);
    margin-bottom: 0.8rem;
  }
  .error {
    font-size: var(--t-xs);
    color: var(--peligro);
    margin-bottom: 0.7rem;
  }
  .botones {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .botones button {
    flex: 1 1 auto;
    min-height: var(--toque);
    padding: 0 1rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--pizarra);
    background: var(--blanco);
  }
  .botones button:hover:not(:disabled) {
    border-color: var(--tinta, var(--pizarra));
  }
  .botones .primario {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .botones button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
