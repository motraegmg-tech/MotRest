<script lang="ts">
  /**
   * Corregir la ficha de un restaurante que ya está dado de alta.
   *
   * EL IDENTIFICADOR SE VE PERO NO SE TOCA. Es el `sucursal_id` que va firmado
   * dentro de la licencia y que el Hub del local compara con el suyo: cambiarlo
   * aquí no renombraría al restaurante, lo dejaría sin licencia válida y sin
   * ninguna pista de por qué. Se muestra igualmente porque es el dato que se
   * dicta por teléfono en cada soporte.
   *
   * LO QUE SE CAMBIA AQUÍ NO VIAJA SOLO. El nombre del responsable y el plan
   * viven dentro de la licencia firmada, y la que ya está pegada en el local
   * lleva los valores del día en que se emitió. Por eso el aviso de «se aplica al
   * renovar» está en la pantalla y no en un manual: es la diferencia entre
   * cambiar la cuota y cobrarla.
   */
  import { untrack } from "svelte";
  import { central } from "../lib/central.svelte";
  import { aPesos, pesos, type ClienteMotRest, type Plan } from "@motrest/dominio";

  const {
    cliente,
    onCerrar,
    onGuardado,
  }: {
    cliente: ClienteMotRest;
    onCerrar: () => void;
    onGuardado: (avisos: string[]) => void;
  } = $props();

  /*
   * Una foto del local al abrir, no un espejo.
   *
   * Si los campos siguieran a la ficha, un pulso que llegara mientras se escribe
   * borraría lo tecleado a media frase. El formulario se abre con lo que hay y
   * lo que gana es lo que se guarda; para volver a lo anterior está Cancelar.
   */
  const inicial = untrack(() => cliente);

  let nombre = $state(inicial.nombre);
  let contacto = $state(inicial.responsable?.nombre || inicial.contacto);
  let telefono = $state(inicial.telefono ?? "");
  let correo = $state(inicial.correo ?? "");
  let plan = $state<Plan>(inicial.plan);
  let cuota = $state(aPesos(inicial.cuota));
  let notas = $state(inicial.notas ?? "");
  let error = $state("");

  /*
   * La clave del relay no se rellena con la guardada: no se puede leer.
   * Vacío significa «dejar la que haya», y escribir algo la sustituye. Es la
   * misma regla que con cualquier contraseña, y evita el accidente de que abrir
   * la ficha para corregir el teléfono borre el enlace del local.
   */
  let claveRelay = $state("");
  const tieneEnlace = $derived(central.tieneEnlaceRelay(cliente.id));

  async function guardar(evento: Event) {
    evento.preventDefault();
    error = "";

    const r = central.editar(cliente.id, {
      nombre,
      contacto,
      telefono,
      correo,
      plan,
      cuota: pesos(cuota),
      notas,
    });

    if (!r.ok) {
      error = r.error;
      return;
    }

    if (claveRelay.trim()) {
      const enlace = await central.fijarClaveRelay(cliente.id, claveRelay);
      if (!enlace.ok) {
        error = enlace.error;
        return;
      }
    }
    onGuardado(r.avisos);
  }
</script>

<div class="fondo" role="dialog" aria-modal="true" aria-labelledby="editar-titulo">
  <form class="tarjeta" onsubmit={guardar}>
    <h2 id="editar-titulo">Datos del restaurante</h2>
    <p class="id">
      Identificador <code>{cliente.id}</code>
      <em>No se puede cambiar: va dentro de la licencia firmada.</em>
    </p>

    <label>
      Nombre del restaurante
      <input bind:value={nombre} required />
    </label>

    <label>
      Responsable
      <input bind:value={contacto} placeholder="Nombre de quien tiene el control total" required />
      <small>
        Renombra su cuenta de <b>Propietario</b>. No cambia su PIN ni su acceso;
        llega al local con la próxima licencia que emita.
      </small>
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
        Precio del plan, en pesos
        <input type="number" bind:value={cuota} min="0" step="50" />
      </label>
    </div>

    {#if cliente.licencia && (plan !== cliente.plan || pesos(cuota) !== cliente.cuota)}
      <p class="ojo">
        La licencia que está en el local conserva su vencimiento. El precio y el
        plan nuevos se aplican <b>al renovar</b>.
      </p>
    {/if}

    <label>
      Clave del relay de este local
      <input
        bind:value={claveRelay}
        spellcheck="false"
        autocomplete="off"
        placeholder={tieneEnlace ? "Ya está puesta — escriba solo para sustituirla" : "La que emitió «padron alta» para este restaurante"}
      />
      <small>
        {#if tieneEnlace}
          Este local reporta su estado a MOTRAE. Se le entrega <b>al emitir su próxima licencia</b>.
        {:else}
          Sin esto su Hub no reporta, y el local aparece en «Hoy» como que no lo vemos aunque
          esté vendiendo. Es de este restaurante y de ningún otro.
        {/if}
      </small>
    </label>

    <label>
      Notas de MOTRAE <em>(nunca las ve el restaurante)</em>
      <textarea bind:value={notas} rows="3" placeholder="Cómo cobra, con quién hablar, qué equipo tiene…"></textarea>
    </label>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="botones">
      <button type="button" class="cancelar" onclick={onCerrar}>Cancelar</button>
      <button type="submit" class="primario">Guardar</button>
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
    margin: 0;
    color: var(--pizarra);
  }
  .id {
    margin: 0 0 0.2rem;
    font-size: 0.76rem;
    color: var(--gris);
  }
  .id code {
    color: var(--pizarra);
    font-weight: 600;
  }
  .id em {
    display: block;
    font-style: normal;
    margin-top: 0.15rem;
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
  select,
  textarea {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 400;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    resize: vertical;
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: 2px solid var(--acento);
    outline-offset: -1px;
  }
  small {
    font-size: 0.73rem;
    font-weight: 400;
    line-height: 1.5;
    color: var(--gris);
  }
  .dos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .ojo {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.55;
    color: var(--pizarra);
    background: var(--fondo);
    border-left: 3px solid var(--acento-2);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.7rem;
  }
  .error {
    font-size: 0.82rem;
    color: var(--peligro);
    margin: 0;
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
