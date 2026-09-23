<script lang="ts">
  /**
   * «Acceso por internet» de un restaurante (1.6.0).
   *
   * Aquí Gonzalo decide cómo vive el local —app, ambas o nube—, su clave para
   * entrar por la web, y ve o cambia la contraseña. Lo pidió así: la contraseña
   * se puede VER siempre desde Central, aunque la haya cambiado el propietario.
   *
   * LA CONTRASEÑA NO SE PINTA HASTA QUE SE PIDE. Vive en DPAPI y se lee al pulsar
   * «Ver»; así no queda en pantalla para quien pase por detrás, ni en un `$state`
   * que se pueda inspeccionar sin haberla pedido.
   */
  import { untrack } from "svelte";
  import { central } from "../lib/central.svelte";
  import type { ClienteMotRest, ModalidadLocal } from "@motrest/dominio";

  const { cliente }: { cliente: ClienteMotRest } = $props();

  const estado = $derived(central.estadoAccesoWeb(cliente.id));
  const inicial = untrack(() => central.estadoAccesoWeb(cliente.id));

  let modalidad = $state<ModalidadLocal>(inicial.modalidad);
  let clave = $state(inicial.clave ?? "");
  let contrasenaVisible = $state<string | null>(null);
  let contrasenaNueva = $state("");
  let escribiendo = $state(false);
  let trabajando = $state(false);
  let error = $state("");
  let avisos = $state<string[]>([]);
  let copiado = $state(false);

  const cambioPendiente = $derived(
    modalidad !== estado.modalidad || (modalidad !== "app" && clave.trim().toUpperCase() !== (estado.clave ?? "")),
  );
  const web = $derived(central.secretos.web_url ?? "");

  const OPCIONES: { valor: ModalidadLocal; titulo: string; detalle: string }[] = [
    { valor: "app", titulo: "App", detalle: "Hub en la computadora del local. Sin acceso por internet." },
    { valor: "ambas", titulo: "Ambas", detalle: "Los datos siguen en su computadora; se entra también por la web mientras esté conectada." },
    { valor: "nube", titulo: "Nube", detalle: "Sin computadora: los datos viven cifrados en la nube de MOTRAE." },
  ];

  async function trabajar(tarea: () => Promise<{ ok: true; avisos?: string[] } | { ok: false; error: string }>) {
    error = "";
    avisos = [];
    trabajando = true;
    try {
      const r = await tarea();
      if (!r.ok) error = r.error;
      else avisos = r.avisos ?? [];
    } finally {
      trabajando = false;
    }
  }

  function aplicar() {
    void trabajar(async () => {
      const r = await central.configurarAccesoWeb(cliente.id, { modalidad, ...(modalidad !== "app" ? { clave } : {}) });
      if (r.ok) {
        clave = central.estadoAccesoWeb(cliente.id).clave ?? clave;
        contrasenaVisible = null;
      }
      return r;
    });
  }

  function sugerir() {
    clave = central.proponerClave(cliente.id);
  }

  function ver() {
    contrasenaVisible = contrasenaVisible ? null : central.verContrasenaWeb(cliente.id);
  }

  async function copiar() {
    const c = central.verContrasenaWeb(cliente.id);
    if (!c) return;
    try {
      await navigator.clipboard.writeText(c);
      copiado = true;
      setTimeout(() => (copiado = false), 1500);
    } catch {
      error = "No se pudo copiar; usa «Ver» y cópiala a mano.";
    }
  }

  function regenerar() {
    void trabajar(async () => {
      const r = await central.regenerarContrasenaWeb(cliente.id);
      if (r.ok) contrasenaVisible = central.verContrasenaWeb(cliente.id);
      return r;
    });
  }

  function fijar() {
    void trabajar(async () => {
      const r = await central.fijarContrasenaWeb(cliente.id, contrasenaNueva);
      if (r.ok) {
        contrasenaNueva = "";
        escribiendo = false;
        contrasenaVisible = central.verContrasenaWeb(cliente.id);
      }
      return r;
    });
  }

  function reenviarAlHub() {
    void trabajar(async () => {
      const r = await central.enviarAccesoWebAlHub(cliente.id);
      return r.ok ? { ok: true, avisos: ["La llave del túnel quedó en el buzón del Hub."] } : r;
    });
  }
</script>

<div class="acceso">
  <span class="etiqueta">Acceso por internet</span>

  <div class="opciones" role="radiogroup" aria-label="Modalidad del restaurante">
    {#each OPCIONES as o (o.valor)}
      <label class="opcion" class:elegida={modalidad === o.valor}>
        <input type="radio" name="modalidad-{cliente.id}" value={o.valor} bind:group={modalidad} />
        <b>{o.titulo}</b>
        <small>{o.detalle}</small>
      </label>
    {/each}
  </div>

  {#if modalidad !== "app"}
    <label class="clave">
      Clave del restaurante
      <span class="fila">
        <input
          bind:value={clave}
          placeholder="RODIZIO"
          maxlength="20"
          spellcheck="false"
          autocomplete="off"
          oninput={() => (clave = clave.toUpperCase())}
        />
        <button type="button" class="chico" onclick={sugerir}>Sugerir</button>
      </span>
      <small>La teclea el restaurante en «Entra a tu restaurante». No es secreta; la contraseña sí.</small>
    </label>
  {/if}

  {#if cambioPendiente}
    <button type="button" class="primario" onclick={aplicar} disabled={trabajando}>
      {trabajando ? "Aplicando…" : modalidad === "app" ? "Apagar acceso por internet" : "Aplicar"}
    </button>
  {/if}

  {#if estado.configurado && estado.modalidad !== "app"}
    <div class="contrasena">
      <span class="sub">Contraseña web</span>
      <code class="valor">{contrasenaVisible ?? "•••• •••• ••••"}</code>
      <span class="fila">
        <button type="button" class="chico" onclick={ver}>{contrasenaVisible ? "Ocultar" : "Ver"}</button>
        <button type="button" class="chico" onclick={copiar}>{copiado ? "Copiada" : "Copiar"}</button>
        <button type="button" class="chico" onclick={regenerar} disabled={trabajando}>Generar otra</button>
        <button type="button" class="chico" onclick={() => (escribiendo = !escribiendo)}>Escribir una</button>
      </span>
      {#if escribiendo}
        <span class="fila">
          <input bind:value={contrasenaNueva} placeholder="Mínimo 10 caracteres" autocomplete="off" />
          <button type="button" class="chico" onclick={fijar} disabled={trabajando || contrasenaNueva.length < 10}>Guardar</button>
        </span>
      {/if}
      {#if estado.cambiada_por_restaurante_ts}
        <small>
          La cambió el propietario el {new Date(estado.cambiada_por_restaurante_ts).toLocaleString("es-MX")}.
        </small>
      {/if}
      <small>Cambiarla cierra las sesiones web abiertas de este restaurante.</small>
      {#if estado.modalidad === "ambas"}
        <button type="button" class="enlace" onclick={reenviarAlHub} disabled={trabajando}>
          Reenviar la llave del túnel al Hub
        </button>
      {/if}
      {#if web}
        <small>Se entra en <b>{web}</b></small>
      {:else}
        <small>Falta la dirección de la web en <b>Llaves</b> para dársela al restaurante.</small>
      {/if}
    </div>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
  {#each avisos as aviso (aviso)}<p class="aviso">{aviso}</p>{/each}
</div>

<style>
  .acceso {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem 0.7rem;
    border: 1px dashed var(--borde);
    border-radius: var(--r-sm);
  }
  .etiqueta {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .opciones {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
  }
  .opcion {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.45rem 0.5rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--pizarra);
  }
  .opcion input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .opcion.elegida {
    border-color: var(--acento);
    box-shadow: inset 0 0 0 1px var(--acento);
  }
  .opcion small,
  small {
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--gris);
    font-weight: 400;
  }
  .clave {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .fila {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    align-items: center;
  }
  input {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 400;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    color: var(--pizarra);
    background: var(--blanco);
    flex: 1;
    min-width: 8rem;
  }
  .contrasena {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .sub {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .valor {
    font-size: 1rem;
    letter-spacing: 0.04em;
    color: var(--pizarra);
    background: var(--fondo);
    padding: 0.35rem 0.5rem;
    border-radius: var(--r-sm);
    user-select: all;
  }
  button {
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.4rem 0.75rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .primario {
    align-self: flex-start;
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
  }
  .enlace {
    align-self: flex-start;
    border: none;
    padding: 0;
    background: none;
    color: var(--acento);
    text-decoration: underline;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    margin: 0;
    font-size: 0.8rem;
    color: var(--peligro);
  }
  .aviso {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.5;
    color: var(--pizarra);
    background: var(--fondo);
    border-left: 3px solid var(--acento-2);
    border-radius: var(--r-sm);
    padding: 0.45rem 0.6rem;
  }
  @media (max-width: 560px) {
    .opciones {
      grid-template-columns: 1fr;
    }
  }
</style>
