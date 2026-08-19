<script lang="ts">
  /**
   * Receta de un platillo — la capa OPCIONAL del ADR-16.
   *
   * Un ingrediente que declara insumo, cantidad y unidad DESCUENTA existencias
   * al enviar el platillo a cocina, y las DEVUELVE si ese platillo se cancela.
   * Uno que solo lleva nombre y costo es puro desglose. Ambos son válidos: el
   * restaurante decide hasta dónde quiere llegar.
   */
  import {
    costoDesdeInsumo,
    costoReceta,
    formatearCantidad,
    ingredienteNuevo,
    pesos,
    recetaNueva,
    type Centavos,
    type Ingrediente,
    type Receta,
    type Unidad,
  } from "@motrest/dominio";
  import { untrack } from "svelte";
  import { mxn } from "../../formato";
  import { inventario } from "../../inventario.svelte";
  import { menu } from "../../menu.svelte";

  interface Props {
    productoId: string;
    nombreProducto: string;
    onCerrar: () => void;
  }
  let { productoId, nombreProducto, onCerrar }: Props = $props();

  const UNIDADES: Unidad[] = ["g", "kg", "ml", "l", "pz", "porcion"];

  // Se toma el valor inicial a propósito: a partir de aquí el borrador es del
  // editor. Quien lo abre lo re-monta con {#key} al cambiar de producto, así que
  // no hay riesgo de quedarse con la receta anterior.
  const guardada = untrack(() => menu.recetaDe(productoId));

  let receta = $state<Receta>(guardada ?? recetaNueva(untrack(() => nombreProducto)));
  // Los costos se editan en pesos y se convierten al guardar.
  let costos = $state<Record<string, string>>(
    Object.fromEntries(
      (guardada?.ingredientes ?? []).map((i) => [i.id, (i.costo / 100).toFixed(2)]),
    ),
  );

  const total = $derived(costoReceta(reconstruir()));
  const producto = $derived(menu.producto(productoId));
  const vinculados = $derived(receta.ingredientes.filter((i) => i.insumo_id).length);

  /**
   * El costo de un ingrediente sale de lo que costó comprar su insumo.
   *
   * Es la mitad que le faltaba al vínculo con el almacén: un ingrediente ya
   * declaraba «200 g de mozzarella» y los descontaba al enviar a cocina, pero su
   * costo se tecleaba aparte. Con las dos cifras desconectadas, subir el precio
   * del queso en el almacén no cambiaba el costo de ninguna pizza y el food cost
   * seguía diciendo lo de hace seis meses.
   *
   * Cuando el cálculo no es posible —sin gramaje, o gramos contra mililitros, que
   * exigiría una densidad— se conserva lo tecleado a mano. Nunca se pone en cero:
   * un cero silencioso convierte un platillo caro en uno que parece regalado.
   */
  function costoDe(ing: Ingrediente): Centavos {
    const automatico = ing.insumo_id
      ? costoDesdeInsumo(ing, inventario.insumo(ing.insumo_id))
      : null;
    return automatico ?? pesos(Number(costos[ing.id] ?? "0") || 0);
  }

  /** ¿Este renglón toma su costo del almacén, en vez de lo tecleado? */
  function vieneDelAlmacen(ing: Ingrediente): boolean {
    return (
      !!ing.insumo_id && costoDesdeInsumo(ing, inventario.insumo(ing.insumo_id)) !== null
    );
  }

  function reconstruir(): Receta {
    return {
      ...receta,
      ingredientes: receta.ingredientes.map((i) => ({ ...i, costo: costoDe(i) })),
    };
  }

  function agregar() {
    receta = { ...receta, ingredientes: [...receta.ingredientes, ingredienteNuevo()] };
  }

  function quitar(id: string) {
    receta = { ...receta, ingredientes: receta.ingredientes.filter((i) => i.id !== id) };
  }

  function cambiar(id: string, campo: keyof Ingrediente, valor: unknown) {
    receta = {
      ...receta,
      ingredientes: receta.ingredientes.map((i) =>
        i.id === id ? { ...i, [campo]: valor } : i,
      ),
    };
  }

  /**
   * Al elegir un insumo del almacén se heredan su nombre y su unidad base: es lo
   * que hace que el descuento cuadre sin conversiones inventadas.
   */
  function elegirInsumo(id: string, insumoId: string) {
    const insumo = inventario.insumo(insumoId);
    receta = {
      ...receta,
      ingredientes: receta.ingredientes.map((i) =>
        i.id !== id
          ? i
          : {
              ...i,
              insumo_id: insumoId || undefined,
              nombre: i.nombre.trim() || insumo?.nombre || "",
              unidad: insumo?.unidad_base ?? i.unidad,
            },
      ),
    };
  }

  function guardar() {
    menu.guardarRecetaDe(productoId, reconstruir());
    onCerrar();
  }
</script>

<div class="editor">
  <header>
    <div>
      <h2>Receta · {nombreProducto}</h2>
      <p class="sub">
        Opcional. Solo los ingredientes con insumo del almacén mueven
        existencias: se descuentan al enviar a cocina y vuelven si el platillo se
        cancela.
      </p>
    </div>
    <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">✕</button>
  </header>

  {#if receta.ingredientes.length === 0}
    <p class="vacio">
      Este platillo no tiene receta: se costea con el costo final que capturaste
      en su ficha.
    </p>
  {:else}
    <div class="tabla">
      <div class="cab">
        <span>Ingrediente</span>
        <span>Insumo del almacén</span>
        <span class="num">Cantidad</span>
        <span>Unidad</span>
        <span class="num">Costo</span>
        <span></span>
      </div>
      {#each receta.ingredientes as ing (ing.id)}
        <div class="fila" class:suelto={!ing.insumo_id}>
          <input
            value={ing.nombre}
            oninput={(e) => cambiar(ing.id, "nombre", e.currentTarget.value)}
            placeholder="Masa, salsa, queso…"
          />
          <select
            value={ing.insumo_id ?? ""}
            onchange={(e) => elegirInsumo(ing.id, e.currentTarget.value)}
          >
            <option value="">Sin vincular</option>
            {#each inventario.insumos as insumo (insumo.id)}
              <option value={insumo.id}>{insumo.nombre}</option>
            {/each}
          </select>
          <input
            class="num"
            type="number"
            inputmode="decimal"
            value={ing.cantidad ?? ""}
            oninput={(e) => cambiar(ing.id, "cantidad", Number(e.currentTarget.value) || undefined)}
            placeholder="—"
          />
          <select
            value={ing.unidad ?? ""}
            onchange={(e) => cambiar(ing.id, "unidad", e.currentTarget.value || undefined)}
          >
            <option value="">—</option>
            {#each UNIDADES as u (u)}
              <option value={u}>{u}</option>
            {/each}
          </select>
          <!--
            Si el ingrediente está vinculado al almacén y trae gramaje, el costo
            lo pone el sistema y el campo deja de ser editable: dos cifras para
            lo mismo acaban siempre en dos cifras distintas.
          -->
          {#if vieneDelAlmacen(ing)}
            <div class="calculado" title="Sale del costo del insumo en el almacén">
              {mxn(costoDe(ing))}
              <small>del almacén</small>
            </div>
          {:else}
            <div class="moneda">
              <i>$</i>
              <input
                class="num"
                type="number"
                inputmode="decimal"
                step="0.01"
                value={costos[ing.id] ?? ""}
                oninput={(e) => (costos = { ...costos, [ing.id]: e.currentTarget.value })}
                placeholder="0.00"
              />
            </div>
          {/if}
          <button class="quitar" onclick={() => quitar(ing.id)} aria-label="Quitar ingrediente">
            ✕
          </button>
        </div>
      {/each}
    </div>

    <div class="resumen">
      <span>{vinculados} de {receta.ingredientes.length} descuentan del almacén</span>
      {#if vinculados > 0}
        <span class="consumo">
          Por platillo se van:
          {receta.ingredientes
            .filter((i) => i.insumo_id && i.cantidad && i.unidad)
            .map((i) => `${formatearCantidad(i.cantidad!, i.unidad!)} de ${i.nombre || "—"}`)
            .join(" · ")}
        </span>
      {/if}
      <div class="totales">
        <span>Costo de la receta</span>
        <b>{mxn(total)}</b>
      </div>
      {#if producto?.costo !== undefined}
        <div class="totales">
          <span>Costo capturado en la ficha</span>
          <b class:difiere={producto.costo !== total}>{mxn(producto.costo)}</b>
        </div>
      {/if}
    </div>

    {#if producto?.costo !== undefined && producto.costo !== total}
      <p class="nota">
        La receta y la ficha no coinciden. Manda el costo de la <b>ficha</b> para
        el margen; la receta sirve para el desglose y el descuento de insumos.
      </p>
    {/if}
  {/if}

  <div class="botones">
    <button class="agregar" onclick={agregar}>+ Ingrediente</button>
    <div class="espacio"></div>
    <button class="secundario" onclick={onCerrar}>Cancelar</button>
    <button class="principal" onclick={guardar}>Guardar receta</button>
  </div>
</div>

<style>
  .editor {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  header > div:first-child {
    flex: 1;
  }
  h2 {
    font-size: 1.15rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.2rem;
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.45;
  }
  .cerrar {
    font-size: 1.1rem;
    color: var(--gris);
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-sm);
  }
  .cerrar:hover {
    background: var(--fondo);
  }
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
    background: var(--fondo);
    border-radius: var(--r-md);
    padding: 0.85rem 1rem;
    line-height: 1.5;
  }
  .tabla {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    overflow-x: auto;
  }
  .cab,
  .fila {
    display: grid;
    grid-template-columns: 1.6fr 1.4fr 5.5rem 4.5rem 6.5rem 2rem;
    gap: 0.4rem;
    align-items: center;
    min-width: 40rem;
  }
  .cab span {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .cab .num {
    text-align: right;
  }
  .fila.suelto input,
  .fila.suelto select {
    border-style: dashed;
  }
  input,
  select {
    padding: 0.45rem 0.55rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.86rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  input.num {
    text-align: right;
  }
  .moneda {
    position: relative;
    display: flex;
    align-items: center;
  }
  .moneda i {
    position: absolute;
    left: 0.5rem;
    font-style: normal;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--gris);
  }
  .moneda input {
    padding-left: 1.25rem;
  }
  /* El costo que pone el almacén: se lee, no se teclea. */
  .calculado {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    padding: 0.3rem 0.5rem;
    border: 1.5px dashed var(--borde);
    border-radius: var(--r-sm);
    background: var(--fondo);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--pizarra);
    line-height: 1.15;
  }
  .calculado small {
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--acento);
  }
  .consumo {
    flex-basis: 100%;
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.45;
  }
  .quitar {
    color: var(--gris);
    font-size: 0.95rem;
    padding: 0.35rem;
    border-radius: var(--r-sm);
  }
  .quitar:hover {
    background: #fdeae8;
    color: var(--peligro);
  }
  .resumen {
    display: flex;
    align-items: flex-end;
    gap: 1.5rem;
    flex-wrap: wrap;
    border-top: 1px solid var(--borde);
    padding-top: 0.75rem;
  }
  .resumen > span {
    flex: 1;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .totales {
    display: flex;
    flex-direction: column;
  }
  .totales span {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .totales b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
  }
  .totales b.difiere {
    color: var(--acento-2);
  }
  .nota {
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .espacio {
    flex: 1;
  }
  .agregar {
    border: 1.5px dashed var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--gris);
  }
  .agregar:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
</style>
