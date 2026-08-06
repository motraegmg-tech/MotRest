<script lang="ts">
  /**
   * La pantalla que queda cuando se acaban los tres días de gracia.
   *
   * El software queda inservible: solo esto. Es lo que decidió Gonzalo y es lo
   * que hace que la mensualidad se cobre.
   *
   * TRES DECISIONES DE DISEÑO, Y NINGUNA ES DECORATIVA:
   *
   *   1. **No hay botón de cerrar ni forma de esquivarla.** Cubre la pantalla
   *      entera. Una pantalla de bloqueo con una salida no bloquea nada.
   *
   *   2. **Dice que su información está intacta.** El primer miedo de un
   *      restaurantero al ver esto es "perdí mis ventas". Es falso —no se borra
   *      nada— y callarlo convierte un problema de cobranza en pánico y en una
   *      llamada furiosa. Decirlo cuesta una línea.
   *
   *   3. **Trae el teléfono para pagar, no un correo de soporte.** Lo que el
   *      restaurante necesita en este momento es reactivarse, y cada paso que se
   *      interpone entre el bloqueo y el pago es un día más sin cobrar.
   */
  import { licencia } from "../licencia.svelte";

  const { contacto = "" }: { contacto?: string } = $props();
</script>

<div class="bloqueo" role="alertdialog" aria-modal="true" aria-labelledby="bloqueo-titulo">
  <div class="marca" aria-hidden="true">
    <span class="logo">MOTRAE</span>
    <span class="barra"></span>
  </div>

  <h1 id="bloqueo-titulo">Servicio suspendido</h1>
  <p class="motivo">{licencia.situacion.mensaje}</p>

  <!--
    Lo que más tranquiliza y lo que menos cuesta decir. Sin esta línea, el
    restaurantero asume que perdió su historial.
  -->
  <p class="datos">
    Toda la información de su restaurante está guardada. En cuanto se registre el
    pago, el sistema vuelve exactamente como lo dejó.
  </p>

  {#if contacto}
    <p class="contacto">Para reactivarlo: <b>{contacto}</b></p>
  {/if}

  <p class="pie">MotRest · una plataforma de MOTRAE</p>
</div>

<style>
  /*
   * z-index por encima de todo lo demás de la aplicación (el máximo que se usa
   * en App.svelte es 70, el aviso del reloj). Si algo quedara por encima, sería
   * una rendija por la que se puede seguir operando.
   */
  .bloqueo {
    position: fixed;
    z-index: 9000;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 2rem;
    text-align: center;
    background: var(--negro);
    color: #dfe5e2;
    font-family: var(--font-cuerpo);
  }
  .marca {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 1.6rem;
  }
  .logo {
    font-family: var(--font-titulo);
    font-size: clamp(2.4rem, 8vw, 3.6rem);
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #fff;
  }
  /* El degradado de energía de la marca, en su única aparición de la pantalla. */
  .barra {
    width: clamp(7rem, 22vw, 11rem);
    height: 5px;
    border-radius: var(--r-pill);
    background: linear-gradient(90deg, var(--acento) 0%, var(--peligro) 100%);
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: clamp(1.3rem, 4vw, 1.7rem);
    font-weight: 600;
    color: #fff;
    margin: 0;
  }
  .motivo {
    max-width: 30rem;
    font-size: 0.98rem;
    line-height: 1.6;
    margin: 0;
  }
  .datos {
    max-width: 27rem;
    font-size: 0.86rem;
    line-height: 1.6;
    color: #97a3a9;
    margin: 0.4rem 0 0;
  }
  .contacto {
    margin: 1.4rem 0 0;
    font-size: 0.95rem;
    padding: 0.6rem 1.3rem;
    border: 1.5px solid #2f3a3e;
    border-radius: var(--r-pill);
  }
  .contacto b {
    color: var(--acento);
  }
  .pie {
    position: absolute;
    bottom: 1.6rem;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    color: #55636a;
    margin: 0;
  }
</style>
