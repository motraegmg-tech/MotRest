<script lang="ts">
  /**
   * «A nombre de»: el campo que reconoce al comensal.
   *
   * EL PROBLEMA QUE ESTO RESUELVE
   *
   * Hasta la 1.5.5, apartar una mesa pedía un nombre y un teléfono a mano, y la
   * reserva no se ataba a NADIE. El mismo cliente que reserva cada quince días
   * entraba como «Ramírez», «Familia Ramírez» y «Sra. Ramírez», con el teléfono
   * escrito de tres formas, y la ficha del comensal —que existe justo para
   * saber quién viene— no se enteraba. Gonzalo: «que reservas del comensal y
   * ficha del cliente estén conectadas».
   *
   * Así que el campo dejó de ser un cuadro de texto suelto: es la LISTA DE LAS
   * FICHAS, con buscador por nombre o teléfono, más «+ Nuevo cliente» para dar
   * de alta a quien todavía no tiene. Y sigue aceptando un nombre libre: en la
   * puerta, un viernes, a veces solo hay tiempo para apuntar «mesa de Toño».
   *
   * DOS ESTADOS, uno cada vez:
   *
   *  - LIGADO: ya hay ficha. Se enseña de quién es, con su teléfono, y un botón
   *    para cambiarla. Enseñar el nombre editable en este estado era pedir un
   *    malentendido: cambiarle la letra no cambia la ficha.
   *  - BUSCANDO: un campo de texto y, debajo, las fichas que coinciden. Lo
   *    tecleado vale como nombre aunque no se elija ninguna.
   */
  import type { Cliente, ID } from "@motrest/dominio";
  import { clientes } from "../../clientes.svelte";
  import { revelar } from "../../subir";

  interface Props {
    /** El nombre que va escrito en la reserva. Puede diferir del de la ficha. */
    nombre: string;
    /** La ficha ligada. `undefined` = todavía no se reconoce a nadie. */
    clienteId?: ID;
    etiqueta?: string;
    placeholder?: string;
    /** Al elegir una ficha: el padre copia de ella lo que su formulario tenga. */
    onelegir?: (ficha: Cliente) => void;
    /** «+ Nuevo cliente»: el padre guarda el borrador y viaja al alta. */
    onnuevo: () => void;
  }

  let {
    nombre = $bindable(),
    clienteId = $bindable(),
    etiqueta = "A nombre de",
    placeholder = "Familia Ramírez",
    onelegir,
    onnuevo,
  }: Props = $props();

  /** Cuántas fichas caben antes de pedir que se escriba algo para filtrar. */
  const TOPE = 8;

  const ligada = $derived(clientes.porId(clienteId));

  /*
   * El nombre de la reserva puede no ser el de la ficha, y es legítimo: la mesa
   * la aparta José Pérez «a nombre de la Familia Pérez». Se dice en claro para
   * que nadie crea que el sistema le cambió el nombre a su cliente.
   */
  const nombreDistinto = $derived(
    !!ligada && nombre.trim() !== "" && nombre.trim() !== ligada.nombre.trim(),
  );

  let abierta = $state(false);
  let caja = $state<HTMLDivElement | null>(null);

  const coincidencias = $derived(clientes.buscar(nombre));
  const alaVista = $derived(coincidencias.slice(0, TOPE));

  function elegir(ficha: Cliente) {
    clienteId = ficha.cliente_id;
    nombre = ficha.nombre;
    abierta = false;
    onelegir?.(ficha);
  }

  function soltar() {
    clienteId = undefined;
    abierta = true;
  }

  /*
   * La lista se cierra cuando el foco SALE del campo entero, no en cuanto se
   * pierde: tocar una ficha de la lista pasa por un `focusout` del cuadro de
   * texto, y cerrarla ahí la habría cerrado antes de que el toque llegara.
   */
  function alSalirElFoco(e: FocusEvent) {
    const hacia = e.relatedTarget;
    if (hacia instanceof Node && caja?.contains(hacia)) return;
    abierta = false;
  }

  function alTeclear(e: KeyboardEvent) {
    if (e.key === "Escape" && abierta) {
      e.stopPropagation();
      abierta = false;
    }
  }

  /**
   * Con el ratón, pulsar una ficha NO le quita el foco al cuadro de texto.
   *
   * Sin esto el `focusout` cerraba la lista en el mismo instante del `mousedown`
   * —antes del `click`—, así que el botón desaparecía debajo del dedo y la ficha
   * no se elegía. El `click` sigue llegando con normalidad.
   */
  function noRobarElFoco(e: MouseEvent) {
    e.preventDefault();
  }
</script>

<div class="selector" bind:this={caja} onfocusout={alSalirElFoco}>
  {#if ligada}
    <!--
      La ficha reconocida. Lleva `use:revelar` porque este bloque aparece
      también al VOLVER del alta de comensal, y entonces puede quedar fuera de
      cuadro: la regla de la casa es que nada que se abra se quede sin verse.
    -->
    <div class="ligada" use:revelar>
      <span class="etiqueta">{etiqueta}</span>
      <div class="chip">
        <div class="quien">
          <b>{ligada.nombre}</b>
          <span class="tenue">
            {ligada.telefono ?? "sin teléfono en su ficha"}
            {#if !ligada.activo} · ficha dada de baja{/if}
          </span>
          {#if nombreDistinto}
            <span class="tenue">La reserva sale a nombre de «{nombre.trim()}»</span>
          {/if}
        </div>
        <button class="cambiar" onclick={soltar}>Cambiar</button>
      </div>
    </div>
  {:else}
    <label>
      <span class="etiqueta">{etiqueta}</span>
      <input
        bind:value={nombre}
        {placeholder}
        onfocus={() => (abierta = true)}
        oninput={() => (abierta = true)}
        onkeydown={alTeclear}
      />
    </label>

    {#if abierta}
      <div class="lista" use:revelar>
        {#if clientes.activos.length === 0}
          <p class="nota">
            Todavía no hay fichas de comensales. Se puede anotar el nombre a mano,
            o dar de alta al cliente para reconocerlo la próxima vez.
          </p>
        {:else if alaVista.length === 0}
          <p class="nota">
            Ninguna ficha coincide con «{nombre.trim()}». Se guardará con ese
            nombre, o se puede dar de alta al cliente.
          </p>
        {:else}
          <ul>
            {#each alaVista as c (c.cliente_id)}
              <li>
                <button class="ficha" onmousedown={noRobarElFoco} onclick={() => elegir(c)}>
                  <b>{c.nombre}</b>
                  <span class="tenue">{c.telefono ?? c.correo ?? "sin contacto"}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if coincidencias.length > alaVista.length}
            <p class="nota">
              Y {coincidencias.length - alaVista.length} más. Escribe el nombre o
              el teléfono para encontrarlo.
            </p>
          {/if}
        {/if}
        <button class="nuevo" onmousedown={noRobarElFoco} onclick={onnuevo}>+ Nuevo cliente</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  /*
   * El campo ocupa su renglón entero dentro de un `.campos`: la lista de fichas
   * se despliega debajo, y con el campo a media fila los nombres no caben.
   */
  .selector {
    flex: 1 1 100%;
    min-width: 12rem;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .etiqueta {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
  }
  input {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: var(--blanco);
    width: 100%;
  }
  input:focus {
    outline: none;
    border-color: var(--acento);
  }
  /*
   * La lista se dibuja FLOTANDO y no en el flujo: empujar los demás campos
   * hacia abajo cada vez que alguien toca «A nombre de» movía el día, la hora y
   * la mesa debajo del dedo.
   */
  .lista {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: var(--z-dialogo);
    margin-top: 0.25rem;
    padding: 0.4rem;
    background: var(--superficie);
    border: 1.5px solid var(--borde-tarjeta);
    border-radius: var(--r-md);
    box-shadow: var(--sombra-lg);
    max-height: 17rem;
    overflow-y: auto;
  }
  .lista ul {
    list-style: none;
  }
  .ficha,
  .nuevo {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.5rem 0.6rem;
    min-height: var(--toque);
    border-radius: var(--r-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-size: 0.88rem;
  }
  .ficha:hover,
  .ficha:focus-visible {
    background: var(--fondo);
  }
  .nuevo {
    margin-top: 0.2rem;
    border-top: 1px solid var(--borde);
    border-radius: 0 0 var(--r-sm) var(--r-sm);
    color: var(--acento-texto);
    font-weight: 700;
    align-items: center;
    flex-direction: row;
  }
  .nuevo:hover,
  .nuevo:focus-visible {
    background: var(--claro);
  }
  .tenue {
    font-size: 0.8rem;
    color: var(--gris);
  }
  /* La ficha ya reconocida: se lee de un golpe quién es. */
  .chip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--acento) 7%, var(--blanco));
  }
  .quien {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .quien b {
    font-size: 0.92rem;
  }
  .cambiar {
    padding: 0.35rem 0.7rem;
    min-height: var(--toque);
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .nota {
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.45;
    padding: 0.4rem 0.6rem;
  }
</style>
