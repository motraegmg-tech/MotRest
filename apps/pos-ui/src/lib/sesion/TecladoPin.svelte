<script lang="ts">
  /** Teclado numérico táctil para PIN. Pensado para pantalla de caja. */
  interface Props {
    valor: string;
    maximo?: number;
    onCambio: (valor: string) => void;
    onAceptar?: () => void;
  }

  let { valor, maximo = 8, onCambio, onAceptar }: Props = $props();

  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  function digitar(d: string) {
    if (valor.length >= maximo) return;
    onCambio(valor + d);
  }

  function borrar() {
    onCambio(valor.slice(0, -1));
  }
</script>

<div class="teclado">
  {#each teclas as tecla (tecla)}
    <button type="button" onclick={() => digitar(tecla)}>{tecla}</button>
  {/each}
  <button type="button" class="aux" onclick={borrar} aria-label="Borrar">←</button>
  <button type="button" onclick={() => digitar("0")}>0</button>
  <button
    type="button"
    class="ok"
    onclick={() => onAceptar?.()}
    disabled={valor.length < 4}
    aria-label="Aceptar"
  >
    ✓
  </button>
</div>

<style>
  .teclado {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.6rem;
    width: 100%;
    max-width: 16rem;
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
  .ok:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
