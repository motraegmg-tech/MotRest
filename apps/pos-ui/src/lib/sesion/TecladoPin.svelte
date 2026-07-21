<script lang="ts">
  /**
   * Teclado numérico para PIN.
   *
   * Funciona con el táctil de la caja Y con el teclado físico: dígitos para
   * capturar, Retroceso para borrar y Enter para aceptar. En una caja con
   * teclado, marcar el PIN a ciegas es mucho más rápido que apuntar a la
   * pantalla.
   */
  interface Props {
    valor: string;
    maximo?: number;
    onCambio: (valor: string) => void;
    onAceptar?: () => void;
    /** Deshabilita la captura mientras se verifica. */
    bloqueado?: boolean;
  }

  let { valor, maximo = 8, onCambio, onAceptar, bloqueado = false }: Props = $props();

  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  function digitar(d: string) {
    if (bloqueado || valor.length >= maximo) return;
    onCambio(valor + d);
  }

  function borrar() {
    if (bloqueado) return;
    onCambio(valor.slice(0, -1));
  }

  function aceptar() {
    if (bloqueado || valor.length < 4) return;
    onAceptar?.();
  }

  // Captura desde el teclado físico. El efecto no lee `valor` al montarse
  // (solo lo leen los manejadores al invocarse), así que se registra una vez.
  $effect(() => {
    function alTeclear(e: KeyboardEvent) {
      const destino = e.target as HTMLElement | null;
      const etiqueta = destino?.tagName;
      // No interferir si el foco está en un campo de texto.
      if (etiqueta === "INPUT" || etiqueta === "TEXTAREA" || destino?.isContentEditable) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        digitar(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        borrar();
      } else if (e.key === "Enter") {
        e.preventDefault();
        aceptar();
      }
    }

    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  });
</script>

<div class="teclado" class:bloqueado>
  {#each teclas as tecla (tecla)}
    <button type="button" disabled={bloqueado} onclick={() => digitar(tecla)}>{tecla}</button>
  {/each}
  <button type="button" class="aux" disabled={bloqueado} onclick={borrar} aria-label="Borrar">
    ←
  </button>
  <button type="button" disabled={bloqueado} onclick={() => digitar("0")}>0</button>
  <button
    type="button"
    class="ok"
    onclick={aceptar}
    disabled={bloqueado || valor.length < 4}
    aria-label="Aceptar"
  >
    ✓
  </button>
</div>

<p class="pista">También puedes marcarlo con el teclado · Enter para aceptar</p>

<style>
  .teclado {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.6rem;
    width: 100%;
    max-width: 16rem;
  }
  .teclado.bloqueado {
    opacity: 0.55;
  }
  button {
    aspect-ratio: 1.6;
    border-radius: var(--r-md);
    border: 1.5px solid var(--borde);
    background: #fff;
    font-family: var(--font-titulo);
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--pizarra);
    transition:
      transform 0.06s ease,
      border-color 0.1s ease;
  }
  button:hover:not(:disabled) {
    border-color: var(--acento);
  }
  button:active:not(:disabled) {
    transform: scale(0.97);
  }
  .aux {
    color: var(--gris);
  }
  .ok {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .pista {
    margin-top: 0.6rem;
    font-size: 0.72rem;
    color: var(--gris);
    text-align: center;
  }
</style>
