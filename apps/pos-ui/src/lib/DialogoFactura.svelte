<script lang="ts">
  /**
   * Captura de datos fiscales del comensal para emitir el CFDI.
   *
   * CFDI 4.0 exige que el nombre y el código postal coincidan EXACTAMENTE con la
   * Constancia de Situación Fiscal; si no, el SAT rechaza. Por eso se avisa aquí
   * en vez de dejar que falle al timbrar.
   */
  import {
    RECEPTOR_PUBLICO_GENERAL,
    REGIMENES_FISCALES,
    USOS_CFDI,
    problemaRfc,
    type DatosReceptor,
    type EstadoComanda,
  } from "@motrest/dominio";
  import { fiscal } from "./fiscal.svelte";

  interface Props {
    comanda: EstadoComanda;
    onCerrar: () => void;
  }
  let { comanda, onCerrar }: Props = $props();

  let receptor = $state<DatosReceptor>({
    rfc: "",
    nombre: "",
    regimen_fiscal: "612",
    codigo_postal: "",
    uso_cfdi: "G03",
  });
  let error = $state("");
  let problemas = $state<string[]>([]);
  let emitido = $state<{ serie: string; folio: string } | null>(null);

  function emitir(datos: DatosReceptor) {
    error = "";
    problemas = [];

    if (datos.rfc !== RECEPTOR_PUBLICO_GENERAL.rfc) {
      const malRfc = problemaRfc(datos.rfc);
      if (malRfc) {
        error = malRfc;
        return;
      }
    }

    const r = fiscal.facturar(comanda, { ...datos, rfc: datos.rfc.trim().toUpperCase() });
    if (!r.ok) {
      error = r.error ?? "No se pudo emitir el comprobante";
      problemas = (r.problemas ?? []).map((p) => p.mensaje);
      return;
    }
    emitido = { serie: r.registro!.serie, folio: r.registro!.folio };
  }
</script>

<div class="velo" role="presentation" onclick={onCerrar}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Emitir factura">
  {#if emitido}
    <div class="listo">
      <p class="folio">{emitido.serie}-{emitido.folio}</p>
      <h2>Comprobante generado</h2>
      <p class="nota">
        Quedó guardado y en cola. Se timbrará ante el SAT en cuanto haya un PAC
        conectado; lo puedes seguir en Finanzas.
      </p>
      <button class="principal" onclick={onCerrar}>Cerrar</button>
    </div>
  {:else}
    <header>
      <h2>Emitir factura</h2>
      <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">×</button>
    </header>

    {#if !fiscal.emisorCompleto}
      <p class="bloqueo" role="alert">
        Faltan los datos fiscales del restaurante. Complétalos en
        <b>Finanzas → Facturación</b> antes de emitir.
      </p>
    {:else}
      <div class="campos">
        <label>
          <span>RFC del cliente</span>
          <input bind:value={receptor.rfc} placeholder="GODE561231GR8" maxlength="13" />
        </label>
        <label class="ancho">
          <span>Nombre o razón social (exacto, como en su constancia)</span>
          <input bind:value={receptor.nombre} placeholder="JUAN PEREZ LOPEZ" />
        </label>
        <label>
          <span>Código postal</span>
          <input bind:value={receptor.codigo_postal} placeholder="44650" maxlength="5" />
        </label>
        <label>
          <span>Régimen fiscal</span>
          <select bind:value={receptor.regimen_fiscal}>
            {#each REGIMENES_FISCALES as r (r.clave)}
              <option value={r.clave}>{r.clave} · {r.descripcion}</option>
            {/each}
          </select>
        </label>
        <label class="ancho">
          <span>Uso del CFDI</span>
          <select bind:value={receptor.uso_cfdi}>
            {#each USOS_CFDI as u (u.clave)}
              <option value={u.clave}>{u.clave} · {u.descripcion}</option>
            {/each}
          </select>
        </label>
      </div>

      <p class="advertencia">
        El nombre y el código postal deben coincidir exactamente con la Constancia
        de Situación Fiscal del cliente, o el SAT rechazará el comprobante.
      </p>

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#each problemas as problema (problema)}
        <p class="error">{problema}</p>
      {/each}

      <div class="botones">
        <button class="secundario" onclick={() => emitir({ ...RECEPTOR_PUBLICO_GENERAL })}>
          Público en general
        </button>
        <button class="principal" onclick={() => emitir(receptor)}>Emitir factura</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 32;
  }
  .panel {
    position: fixed;
    z-index: 33;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    width: min(32rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    overflow-y: auto;
    padding: 1.25rem 1.4rem 1.4rem;
    box-shadow: var(--sombra-lg);
  }
  header {
    display: flex;
    align-items: center;
    margin-bottom: 0.85rem;
  }
  h2 {
    flex: 1;
    font-size: 1.2rem;
    font-weight: 600;
  }
  .cerrar {
    font-size: 1.5rem;
    color: var(--gris);
    line-height: 1;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .campos label {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--gris);
  }
  .campos input,
  .campos select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
  }
  .campos input:focus,
  .campos select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .advertencia {
    margin-top: 0.75rem;
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .bloqueo {
    background: #fdeae8;
    border: 1px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.8rem 1rem;
    font-size: 0.86rem;
    line-height: 1.5;
  }
  .error {
    margin-top: 0.5rem;
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.7rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .listo {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 0;
  }
  .listo .folio {
    font-family: var(--font-titulo);
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--acento);
  }
  .listo .nota {
    font-size: 0.86rem;
    color: var(--gris);
    max-width: 22rem;
    line-height: 1.5;
  }
  .listo .principal {
    margin-top: 0.5rem;
  }
</style>
