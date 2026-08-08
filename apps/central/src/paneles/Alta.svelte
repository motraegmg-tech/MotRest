<script lang="ts">
  /**
   * Dar de alta un restaurante nuevo.
   *
   * EL IDENTIFICADOR SE PROPONE, NO SE IMPONE. Se genera a partir del nombre
   * (`suc-nombre-del-restaurante-centro`) porque así se puede dictar por teléfono en un
   * soporte, pero se deja editar: si el Hub del local ya generó el suyo al
   * instalarse, hay que poner ESE o la licencia no verificará ahí.
   *
   * Ese es el error más frustrante del alta, porque no se descubre hasta que uno
   * ya está en el restaurante con el archivo pegado y no pasa nada.
   */
  import { central, type CredencialesResponsableIniciales } from "../lib/central.svelte";
  import { pesos, type Plan } from "@motrest/dominio";
  import { idDeSucursal } from "@motrest/dominio";

  const {
    onCerrar,
    onCreado,
  }: {
    onCerrar: () => void;
    onCreado: (id: string, credenciales: CredencialesResponsableIniciales) => void;
  } = $props();

  let nombre = $state("");
  let sufijo = $state("");
  let contacto = $state("");
  let telefono = $state("");
  let correo = $state("");
  let plan = $state<Plan>("mensual");
  let cuota = $state(1500);
  let idManual = $state("");
  let error = $state("");
  let guardando = $state(false);

  const idPropuesto = $derived(idManual.trim() || idDeSucursal(nombre, sufijo));

  async function guardar(evento: Event) {
    evento.preventDefault();
    if (guardando) return;
    guardando = true;
    error = "";

    try {
      const r = await central.alta({
        nombre,
        sufijo,
        contacto,
        telefono,
        correo,
        plan,
        cuota: pesos(cuota),
        id: idManual.trim() || undefined,
      });

      if (!r.ok) {
        error = r.error;
        return;
      }
      onCreado(r.cliente.id, r.credencialesResponsable);
    } finally {
      guardando = false;
    }
  }
</script>

<div class="fondo" role="dialog" aria-modal="true" aria-labelledby="alta-titulo">
  <form class="tarjeta" onsubmit={guardar}>
    <h2 id="alta-titulo">Alta de restaurante</h2>

    <label>
      Nombre del restaurante
      <input bind:value={nombre} placeholder="Nombre de tu restaurante" required />
    </label>

    <label>
      Sucursal <em>(opcional)</em>
      <input bind:value={sufijo} placeholder="Sucursal o ubicación" />
    </label>

    <label>
      Identificador del local
      <input
        bind:value={idManual}
        placeholder={idPropuesto === "suc-" ? "Ej. suc-nombre-del-restaurante" : idPropuesto}
      />
      <!--
        Se avisa aquí y no en un manual: es el dato que hace que la licencia
        funcione o no, y se decide en este momento.
      -->
      <small>
        {#if idPropuesto === "suc-"}
          Se genera con el nombre y la sucursal. Si el Hub ya se instaló, copie el
          código que muestra en <b>Servicio suspendido</b> o <b>Administración → Hub</b>.
        {:else}
          Quedará <code>{idPropuesto}</code>. Si el Hub ya se instaló, use su código
          exactamente igual; si no coincide, la licencia no servirá en ese equipo.
        {/if}
      </small>
    </label>

    <div class="dos">
      <label>
        Plan
        <select bind:value={plan}>
          <option value="mensual">Mensual</option>
          <option value="anual">Anual</option>
          <option value="prueba">Prueba</option>
        </select>
      </label>
      <label>
        Cuota en pesos
        <input type="number" bind:value={cuota} min="0" step="50" />
      </label>
    </div>

    <label>
      Responsable del restaurante
      <input bind:value={contacto} placeholder="Nombre de quien tendrá el control total" required />
      <small>Se crea como <b>Propietario</b>: es el rango más alto del restaurante.</small>
    </label>

    <div class="dos">
      <label>
        Teléfono
        <input bind:value={telefono} placeholder="Ej. 55 1234 5678" />
      </label>
      <label>
        Correo
        <input bind:value={correo} type="email" placeholder="correo@ejemplo.com" />
      </label>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <p class="nota">
      La licencia <b>no</b> se emite ahora: primero se instala y se comprueba el
      identificador. Después se emite desde la ficha del local.
    </p>

    <div class="botones">
      <button type="button" class="cancelar" onclick={onCerrar} disabled={guardando}>Cancelar</button>
      <button type="submit" class="primario" disabled={guardando}>
        {guardando ? "Creando acceso…" : "Dar de alta"}
      </button>
    </div>
  </form>
</div>

<style>
  .fondo {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(20, 24, 26, 0.5);
    overflow-y: auto;
  }
  .tarjeta {
    width: min(30rem, 100%);
    background: var(--blanco);
    border-radius: var(--r-lg);
    padding: 1.5rem;
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  h2 {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    margin: 0 0 0.3rem;
    color: var(--pizarra);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  label em {
    font-style: normal;
    font-weight: 400;
    color: var(--gris);
  }
  input,
  select {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 400;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
  }
  input:focus,
  select:focus {
    outline: 2px solid var(--acento);
    outline-offset: -1px;
  }
  small {
    font-size: 0.73rem;
    font-weight: 400;
    line-height: 1.5;
    color: var(--gris);
  }
  small code {
    color: var(--acento);
  }
  .dos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .error {
    font-size: 0.82rem;
    color: var(--peligro);
    margin: 0;
  }
  .nota {
    font-size: 0.76rem;
    line-height: 1.55;
    color: var(--gris);
    background: var(--fondo);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.7rem;
    margin: 0.3rem 0 0;
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.4rem;
  }
  button {
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    padding: 0.55rem 1.1rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .primario {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
  }
  .cancelar {
    border: none;
    color: var(--gris);
  }
</style>
