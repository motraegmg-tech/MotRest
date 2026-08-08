<script lang="ts">
  /**
   * Alta y edición de un platillo o bebida.
   *
   * Los campos de costo solo se PINTAN si el perfil puede verlos, pero la
   * defensa real no está aquí: el store rechaza guardar un cambio sin permiso, y
   * la vista que alimenta la lista ni siquiera trae el costo. Esta condición es
   * comodidad visual, no la cerradura.
   */
  import {
    calcularImpuesto,
    pesos,
    type BorradorProducto,
    type ProblemaMenu,
  } from "@motrest/dominio";
  import { untrack } from "svelte";
  import { mxn, pct } from "../../formato";
  import { menu } from "../../menu.svelte";

  interface Props {
    /** id del producto a editar; vacío = alta nueva. */
    productoId?: string;
    onCerrar: () => void;
  }
  let { productoId, onCerrar }: Props = $props();

  // Las estaciones las configura el restaurante desde Administración.
  const estaciones = $derived(menu.estaciones);
  const permisos = $derived(menu.permisos);

  // Valor inicial a propósito: de aquí en adelante el borrador es del formulario.
  // Quien lo abre lo re-monta con {#key} al cambiar de producto.
  const existente = untrack(() => (productoId ? menu.producto(productoId) : null));

  // Se capturan en PESOS porque es lo que el usuario escribe; se convierten a
  // centavos exactos al guardar (ADR-12).
  let nombre = $state(existente?.nombre ?? "");
  let categoriaId = $state(existente?.categoria_id ?? menu.categorias[0]?.id ?? "");
  let precioPesos = $state(existente ? (existente.precio / 100).toFixed(2) : "");
  let costoPesos = $state(
    existente?.costo === undefined ? "" : (existente.costo / 100).toFixed(2),
  );
  let impuestoId = $state(existente?.impuesto_id ?? menu.impuestos[0]?.id ?? "");
  let estacionId = $state(existente?.estacion_id ?? "");
  let disponible = $state(existente?.disponible ?? true);
  let foto = $state(existente?.foto ?? "");
  let subiendoFoto = $state(false);
  let problemas = $state<ProblemaMenu[]>([]);

  const precio = $derived(pesos(Number(precioPesos) || 0));
  const costo = $derived(pesos(Number(costoPesos) || 0));
  const perfil = $derived(menu.impuestos.find((i) => i.id === impuestoId));

  /** El recuadro de IVA en vivo: precio 100 → IVA 16 → total 116. */
  const desglose = $derived(
    perfil ? calcularImpuesto(precio, perfil) : null,
  );

  const margen = $derived(precio - costo);
  const foodCost = $derived(precio > 0 ? costo / precio : 0);

  const borrador = $derived<BorradorProducto>({
    nombre,
    categoria_id: categoriaId,
    costo,
    precio,
    impuesto_id: impuestoId,
    disponible,
    ...(estacionId ? { estacion_id: estacionId } : {}),
    ...(foto ? { foto } : {}),
  });

  // Revisión en vivo, pero solo cuando ya hay algo escrito: no tiene sentido
  // regañar por un formulario que apenas se abrió.
  const avisos = $derived(
    nombre.trim().length === 0 && precioPesos === ""
      ? []
      : menu.revisar(borrador, productoId),
  );

  const errores = $derived([...problemas, ...avisos].filter((p) => p.gravedad === "error"));
  const advertencias = $derived(avisos.filter((p) => p.gravedad === "advertencia"));

  /** El costo solo bloquea si el perfil puede verlo; si no, se conserva el previo. */
  function guardar() {
    const conCosto: BorradorProducto = permisos.verCostos
      ? borrador
      : { ...borrador, costo: existente?.costo ?? pesos(0) };

    const r = productoId
      ? menu.actualizarProducto(productoId, conCosto)
      : menu.crearProducto(conCosto);

    problemas = r.problemas;
    if (r.ok) onCerrar();
  }

  async function onFotoSeleccionada(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      subiendoFoto = true;
      const blob = await comprimirFoto(file);
      const res = await fetch("/api/fotos/producto", {
        method: "POST",
        headers: { "Content-Type": "image/webp" },
        body: blob,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Error al subir foto");
      }
      const data = await res.json();
      foto = data.nombre;
    } catch (e) {
      alert(String(e));
    } finally {
      subiendoFoto = false;
      input.value = "";
    }
  }

  function comprimirFoto(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const max = 640;
        if (width > max || height > max) {
          if (width > height) {
            height = Math.round(height * (max / width));
            width = max;
          } else {
            width = Math.round(width * (max / height));
            height = max;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo crear canvas"));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("No se pudo comprimir"))),
          "image/webp",
          0.8
        );
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
</script>

<div class="editor">
  <header>
    <h2>{productoId ? "Editar" : "Nuevo"} producto</h2>
    <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">✕</button>
  </header>

  <div class="campos">
    <div class="fila-nombre-foto">
      <label class="ancho">
        <span>Nombre</span>
        <input bind:value={nombre} placeholder="Pasta al pesto, Limonada…" />
      </label>
      
      <div class="foto-caja">
        <span>Foto</span>
        <label class="foto-btn">
          {#if subiendoFoto}
            <span class="cargando">Subiendo...</span>
          {:else if foto}
            <img src={`/foto/${foto}`} alt="Foto de producto" />
            <div class="foto-hover">Cambiar</div>
          {:else}
            <div class="foto-vacia">+</div>
          {/if}
          <input type="file" accept="image/jpeg, image/png, image/webp" onchange={onFotoSeleccionada} hidden />
        </label>
        {#if foto}
          <button class="quitar-foto" onclick={() => (foto = "")}>Quitar foto</button>
        {/if}
      </div>
    </div>

    <label>
      <span>Categoría</span>
      <select bind:value={categoriaId}>
        {#each menu.categorias as c (c.id)}
          <option value={c.id}>{c.nombre}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Estación de cocina</span>
      <select bind:value={estacionId}>
        <option value="">Sin ruteo</option>
        {#each estaciones as e (e.id)}
          <option value={e.id}>{e.nombre}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Precio de carta</span>
      <div class="moneda">
        <i>$</i>
        <input
          type="number"
          inputmode="decimal"
          step="0.01"
          bind:value={precioPesos}
          placeholder="0.00"
          disabled={productoId !== undefined && !permisos.editarPrecios}
        />
      </div>
    </label>

    <label>
      <span>Impuesto</span>
      <select bind:value={impuestoId}>
        {#each menu.impuestos as i (i.id)}
          <option value={i.id}>{i.nombre}</option>
        {/each}
      </select>
    </label>
  </div>

  <!-- El recuadro de IVA en vivo que pidió Gonzalo -->
  {#if desglose}
    <div class="iva">
      <div><span>Precio</span><b>{mxn(desglose.base)}</b></div>
      <div class="mas">+</div>
      <div>
        <span>IVA ({Math.round((perfil?.tasa_iva ?? 0) * 100)} %)</span>
        <b class="acento">{mxn(desglose.iva)}</b>
      </div>
      {#if desglose.ieps > 0}
        <div class="mas">+</div>
        <div><span>IEPS</span><b class="acento">{mxn(desglose.ieps)}</b></div>
      {/if}
      <div class="mas">=</div>
      <div><span>Total al comensal</span><b class="total">{mxn(desglose.total)}</b></div>
    </div>
  {/if}

  {#if permisos.verCostos}
    <div class="campos">
      <label>
        <span>Costo final del platillo</span>
        <div class="moneda">
          <i>$</i>
          <input type="number" inputmode="decimal" step="0.01" bind:value={costoPesos} placeholder="0.00" />
        </div>
      </label>
      <div class="derivados">
        <div><span>Margen</span><b class:malo={margen < 0}>{mxn(margen as never)}</b></div>
        <div>
          <span>Food cost</span>
          <b class:malo={foodCost > 0.45}>{precio > 0 ? pct(foodCost) : "—"}</b>
        </div>
      </div>
    </div>
    <p class="pista">
      Es el costo <b>final</b> del platillo, no ingrediente por ingrediente. El
      desglose por insumo es opcional y se captura en la receta.
    </p>
  {:else}
    <p class="pista oculto">
      Tu perfil no tiene acceso a los costos. Puedes editar la ficha del producto;
      su costo se conserva sin cambios.
    </p>
  {/if}

  <label class="interruptor">
    <input type="checkbox" bind:checked={disponible} />
    <span>Disponible en la carta</span>
  </label>

  {#each advertencias as aviso (aviso.campo + aviso.mensaje)}
    <p class="advertencia">⚠ {aviso.mensaje}</p>
  {/each}
  {#each errores as error (error.campo + error.mensaje)}
    <p class="error" role="alert">{error.mensaje}</p>
  {/each}

  <div class="botones">
    <button class="secundario" onclick={onCerrar}>Cancelar</button>
    <button class="principal" onclick={guardar} disabled={errores.length > 0}>
      {productoId ? "Guardar cambios" : "Agregar al menú"}
    </button>
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
    align-items: center;
    gap: 1rem;
  }
  h2 {
    flex: 1;
    font-size: 1.15rem;
    font-weight: 600;
  }
  .cerrar {
    font-size: 1.1rem;
    color: var(--gris);
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-sm);
  }
  .cerrar:hover {
    background: var(--fondo);
    color: var(--pizarra);
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .campos label {
    flex: 1;
    min-width: 11rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.92rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  input:disabled {
    background: var(--fondo);
    color: var(--gris);
  }
  .moneda {
    position: relative;
    display: flex;
    align-items: center;
  }
  .moneda i {
    position: absolute;
    left: 0.7rem;
    font-style: normal;
    font-weight: 600;
    color: var(--gris);
  }
  .moneda input {
    padding-left: 1.5rem;
  }
  .iva {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
  }
  .iva > div {
    display: flex;
    flex-direction: column;
  }
  .iva span {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .iva b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
  }
  .iva .acento {
    color: var(--acento);
  }
  .iva .total {
    color: var(--pizarra);
  }
  .iva .mas {
    font-family: var(--font-titulo);
    font-size: 1.1rem;
    color: var(--gris);
    align-self: flex-end;
    padding-bottom: 0.15rem;
  }
  .derivados {
    display: flex;
    gap: 1.25rem;
    align-items: flex-end;
    padding-bottom: 0.15rem;
  }
  .derivados > div {
    display: flex;
    flex-direction: column;
  }
  .derivados span {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .derivados b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
  }
  .derivados b.malo {
    color: var(--peligro);
  }
  .pista {
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .pista.oculto {
    background: var(--fondo);
    border-radius: var(--r-sm);
    padding: 0.6rem 0.75rem;
  }
  .interruptor {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 500;
  }
  .interruptor input {
    width: auto;
    accent-color: var(--acento);
  }
  .advertencia {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--acento-2);
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .principal:disabled {
    opacity: 0.45;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .fila-nombre-foto {
    display: flex;
    gap: 1rem;
    width: 100%;
    align-items: flex-start;
  }
  .foto-caja {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-items: center;
  }
  .foto-caja > span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
    align-self: flex-start;
  }
  .foto-btn {
    width: 4rem;
    height: 4rem;
    border-radius: var(--r-sm);
    border: 1.5px dashed var(--borde);
    background: var(--fondo);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }
  .foto-btn:hover {
    border-color: var(--acento);
  }
  .foto-btn img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .foto-hover {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.5);
    color: white;
    font-size: 0.7rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .foto-btn:hover .foto-hover {
    opacity: 1;
  }
  .foto-vacia {
    font-size: 1.5rem;
    color: var(--gris);
  }
  .cargando {
    font-size: 0.7rem;
    color: var(--gris);
  }
  .quitar-foto {
    font-size: 0.7rem;
    color: var(--peligro);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .quitar-foto:hover {
    text-decoration: underline;
  }
</style>
