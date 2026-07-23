<script lang="ts">
  /**
   * Pide el PIN de un rol autorizante para firmar una acción sensible.
   * Es el flujo real del restaurante: el mesero pide, el gerente firma, y
   * la firma queda en la bitácora con nombre, dispositivo y hora.
   */
  import { MAX_INTENTOS, ROLES, etiquetaAccion, type Accion, type RolId } from "@motrest/dominio";
  import { sesion } from "./sesion.svelte";
  import TecladoPin from "./TecladoPin.svelte";

  interface Props {
    accion: Accion;
    razon: string;
    rolesAutorizantes: RolId[];
    contexto?: string;
    onAutorizado: (autorizadorId: string) => void;
    onCancelar: () => void;
  }

  let { accion, razon, rolesAutorizantes, contexto, onAutorizado, onCancelar }: Props = $props();

  let pin = $state("");
  let error = $state("");
  let verificando = $state(false);

  async function firmar() {
    if (verificando) return;
    verificando = true;
    error = "";
    const r = await sesion.autorizar(accion, pin, contexto);
    verificando = false;
    if (r.ok && r.autorizador_id) {
      onAutorizado(r.autorizador_id);
    } else {
      error = r.error ?? "No se pudo autorizar";
      pin = "";
    }
  }
</script>

<div
  class="velo"
  role="button"
  tabindex="-1"
  onclick={onCancelar}
  onkeydown={(e) => e.key === "Escape" && onCancelar()}
></div>

<div class="dialogo" role="dialog" aria-modal="true" aria-label="Autorización requerida">
  <h2>Autorización requerida</h2>
  <p class="accion">{etiquetaAccion(accion)}</p>
  <p class="razon">{razon}</p>

  <p class="quien">
    Puede autorizar:
    {#each rolesAutorizantes as rol, i (rol)}
      <b>{ROLES[rol].nombre}</b>{i < rolesAutorizantes.length - 1 ? " · " : ""}
    {/each}
  </p>

  <!-- Un punto naranja por dígito, sin anunciar cuántos faltan. Igual que en el acceso. -->
  <div class="puntos" aria-hidden="true">
    {#each Array(pin.length) as _, i (i)}
      <span class="punto"></span>
    {/each}
    {#if pin.length === 0}
      <span class="punto-guia"></span>
    {/if}
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if sesion.restantesAutorizacion < MAX_INTENTOS && sesion.restantesAutorizacion > 0}
    <p class="restantes">
      {sesion.restantesAutorizacion === 1
        ? "Queda 1 intento"
        : `Quedan ${sesion.restantesAutorizacion} intentos`}
    </p>
  {/if}

  <TecladoPin valor={pin} onCambio={(v) => (pin = v)} onAceptar={firmar} bloqueado={verificando} />

  <button class="cancelar" onclick={onCancelar}>Cancelar</button>
</div>

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 40;
    border: none;
  }
  .dialogo {
    position: fixed;
    z-index: 41;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    padding: 1.75rem;
    width: min(22rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    text-align: center;
  }
  h2 {
    font-size: 1.2rem;
    font-weight: 600;
  }
  .accion {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--acento);
  }
  .razon {
    font-size: 0.85rem;
    color: var(--gris);
  }
  .quien {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .quien b {
    color: var(--pizarra);
  }
  .puntos {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.4rem 0;
    min-height: 0.8rem;
  }
  .punto {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: var(--acento);
    box-shadow: 0 0 8px color-mix(in srgb, var(--acento) 60%, transparent);
    animation: aparecer 0.12s ease-out;
  }
  .punto-guia {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    border: 1.5px solid var(--borde);
  }
  @keyframes aparecer {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .punto {
      animation: none;
    }
  }
  .error {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .restantes {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--acento-2);
  }
  .cancelar {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gris);
    text-decoration: underline;
  }
</style>
