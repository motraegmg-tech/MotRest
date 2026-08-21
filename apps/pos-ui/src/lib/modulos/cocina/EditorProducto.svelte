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
    costoDesdeInsumo,
    formatearCantidad,
    ingredienteNuevo,
    perfilDelProducto,
    pesos,
    recetaNueva,
    sumar,
    type BorradorProducto,
    type Centavos,
    type Ingrediente,
    type PerfilImpuesto,
    type ProblemaMenu,
    type Receta,
  } from "@motrest/dominio";
  import { untrack } from "svelte";
  import { mxn, pct } from "../../formato";
  import { inventario } from "../../inventario.svelte";
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

  /*
   * «PRECIO DE CARTA» ES LO QUE PAGA EL COMENSAL, IMPUESTO INCLUIDO.
   *
   * Antes este campo era la BASE gravable, así que poner una pizza a 100 pesos
   * obligaba a teclear 86.21 y comprobar a mano que el recuadro de abajo diera
   * 100 — un cálculo que ningún restaurantero tiene por qué hacer, y que en la
   * práctica acababa en precios como 116.00 en la carta. Ahora se teclea la
   * cifra cerrada y el software despeja la base al guardar (`baseParaTotal`).
   *
   * Lo GUARDADO no cambia: el producto sigue almacenando su base, que es lo que
   * el ticket, el corte y el CFDI necesitan. Lo que cambia es por dónde entra.
   */
  let precioPesos = $state(
    existente ? (untrack(() => totalDelExistente()) / 100).toFixed(2) : "",
  );
  let costoPesos = $state(
    existente?.costo === undefined ? "" : (existente.costo / 100).toFixed(2),
  );
  let impuestoId = $state(existente?.impuesto_id ?? menu.impuestos[0]?.id ?? "");
  let estacionId = $state(existente?.estacion_id ?? "");
  let disponible = $state(existente?.disponible ?? true);
  let foto = $state(existente?.foto ?? "");
  let subiendoFoto = $state(false);
  let problemas = $state<ProblemaMenu[]>([]);

  /**
   * Lo que hoy paga el comensal por el producto que se está editando.
   *
   * Un producto capturado antes de este cambio guarda su BASE gravable, así que
   * hay que sumarle el impuesto para poder enseñarlo como precio de carta. Al
   * guardarlo, pasará a almacenar el total —y el total al comensal no cambia—.
   */
  function totalDelExistente(): number {
    if (!existente) return 0;
    const perfilPrevio = menu.impuestos.find(
      (i: PerfilImpuesto) => i.id === existente.impuesto_id,
    );
    if (!perfilPrevio) return existente.precio;
    return calcularImpuesto(
      existente.precio,
      perfilDelProducto(perfilPrevio, existente.precio_incluye_impuesto),
    ).total;
  }

  /**
   * Lo tecleado ES lo que se guarda: la cifra cerrada de la carta.
   *
   * El producto se marca como «precio con impuesto incluido» y el desglose lo
   * hace el sistema al leerlo. Se probó lo contrario —guardar la base despejando
   * hacia atrás— y no sirve: no existe base entera en centavos cuyo IVA del 16 %
   * sume exactamente 99.00, 128.00 ni 7.00, y esos son precios de carta
   * normales. Ver `Producto.precio_incluye_impuesto`.
   */
  const precio = $derived(pesos(Number(precioPesos) || 0));
  const costo = $derived(pesos(Number(costoPesos) || 0));
  const perfilCarta = $derived(menu.impuestos.find((i) => i.id === impuestoId));
  const perfil = $derived(perfilCarta ? perfilDelProducto(perfilCarta, true) : undefined);

  /** El recuadro en vivo: de dónde salen los 100 pesos que se tecleó arriba. */
  const desglose = $derived(perfil ? calcularImpuesto(precio, perfil) : null);

  /*
   * Margen y food cost se miden contra la BASE, no contra el precio de carta:
   * el IVA se recauda para el SAT, no es ingreso del restaurante. Compararlos
   * contra el total haría que cada platillo pareciera un 16 % más rentable.
   */
  const baseGravable = $derived(desglose?.base ?? precio);
  const margen = $derived(baseGravable - costo);
  const foodCost = $derived(baseGravable > 0 ? costo / baseGravable : 0);

  const borrador = $derived<BorradorProducto>({
    nombre,
    categoria_id: categoriaId,
    costo,
    precio,
    impuesto_id: impuestoId,
    precio_incluye_impuesto: true,
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

  // --- Insumos que consume el platillo ------------------------------------------------

  /*
   * QUÉ SE LLEVA DEL ALMACÉN CADA VEZ QUE SE VENDE, aquí mismo.
   *
   * Antes esto vivía en una pantalla aparte a la que se llegaba con «+ Receta»
   * DESPUÉS de haber dado de alta el platillo. El resultado práctico era que casi
   * ningún producto la tenía: quien captura la carta captura treinta platillos
   * seguidos y no vuelve. Y sin ella el inventario no se mueve solo, que es lo
   * único que hace útil llevar inventario.
   *
   * Al ponerlo en el alta, declarar «200 g de masa» es un renglón más del
   * formulario, como el precio. Sigue siendo OPCIONAL (ADR-16): un platillo sin
   * insumos se vende exactamente igual.
   */
  const recetaGuardada = untrack(() => (productoId ? menu.recetaDe(productoId) : null));
  let receta = $state<Receta>(
    recetaGuardada ?? recetaNueva(untrack(() => existente?.nombre ?? "")),
  );

  const insumosDisponibles = $derived(inventario.insumos);

  /** Solo los renglones que de verdad apuntan a un insumo del almacén. */
  const vinculados = $derived(
    receta.ingredientes.filter((i) => i.insumo_id && i.cantidad && i.cantidad > 0),
  );

  /**
   * Lo que cuestan los insumos declarados, al precio al que se compraron.
   *
   * Es una PISTA junto al costo tecleado, no un reemplazo: ADR-16 dice que el
   * costo que manda es el que captura el administrador. Pero tenerlo al lado es
   * lo que delata un costo que se quedó en el del año pasado.
   */
  const costoInsumos = $derived<Centavos>(
    sumar(
      ...vinculados.map(
        (i) => costoDesdeInsumo(i, inventario.insumo(i.insumo_id!)) ?? pesos(0),
      ),
    ),
  );

  function agregarInsumo() {
    receta = { ...receta, ingredientes: [...receta.ingredientes, ingredienteNuevo()] };
  }

  function quitarInsumo(id: string) {
    receta = { ...receta, ingredientes: receta.ingredientes.filter((i) => i.id !== id) };
  }

  function cambiarIngrediente(id: string, cambios: Partial<Ingrediente>) {
    receta = {
      ...receta,
      ingredientes: receta.ingredientes.map((i) => (i.id === id ? { ...i, ...cambios } : i)),
    };
  }

  /**
   * Al elegir el insumo se heredan su nombre y su UNIDAD BASE.
   *
   * La unidad no se pregunta a propósito. Si el almacén lleva la masa en gramos
   * y aquí alguien escribiera «0.2 kg», habría que convertir — y la conversión
   * entre sistemas distintos (gramos contra mililitros) no existe sin una
   * densidad que el software no puede inventar. Heredándola, el descuento cuadra
   * siempre y hay un campo menos que equivocar.
   */
  function elegirInsumo(id: string, insumoId: string) {
    const insumo = inventario.insumo(insumoId);
    cambiarIngrediente(id, {
      insumo_id: insumoId || undefined,
      nombre: insumo?.nombre ?? "",
      unidad: insumo?.unidad_base,
    });
  }

  /** La receta lista para guardar: sin renglones a medio llenar y con su costo. */
  function recetaParaGuardar(): Receta {
    return {
      ...receta,
      nombre: nombre.trim() || receta.nombre,
      ingredientes: vinculados.map((i) => ({
        ...i,
        costo: costoDesdeInsumo(i, inventario.insumo(i.insumo_id!)) ?? i.costo,
      })),
    };
  }

  /** El costo solo bloquea si el perfil puede verlo; si no, se conserva el previo. */
  function guardar() {
    const conCosto: BorradorProducto = permisos.verCostos
      ? borrador
      : { ...borrador, costo: existente?.costo ?? pesos(0) };

    const r = productoId
      ? menu.actualizarProducto(productoId, conCosto)
      : menu.crearProducto(conCosto);

    problemas = r.problemas;
    if (!r.ok) return;

    /*
     * La receta se guarda DESPUÉS y contra el id definitivo. En un alta ese id
     * no existe hasta que el producto está creado, y por eso `crearProducto` lo
     * devuelve: sin él, los insumos que se acababan de capturar se perdían al
     * cerrar el formulario.
     */
    const id = productoId ?? r.id;
    if (id && permisos.editarRecetas) menu.guardarRecetaDe(id, recetaParaGuardar());

    onCerrar();
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
      <small class="ayuda">Lo que paga el comensal, con impuesto incluido.</small>
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

  <!--
    El recuadro en vivo. Ahora se lee al revés que antes y esa es la gracia: el
    «Total al comensal» coincide siempre con el precio de carta que se tecleó, y
    lo que el recuadro enseña es de dónde sale — cuánto de esos 100 pesos es del
    restaurante y cuánto es del SAT.
  -->
  {#if desglose}
    <div class="iva">
      <div><span>Precio sin impuesto</span><b>{mxn(desglose.base)}</b></div>
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
      desglose por insumo se captura abajo y es opcional. El margen y el food
      cost se miden contra el precio <b>sin impuesto</b>: el IVA se recauda para
      el SAT y no es ingreso del restaurante.
    </p>
  {:else}
    <p class="pista oculto">
      Tu perfil no tiene acceso a los costos. Puedes editar la ficha del producto;
      su costo se conserva sin cambios.
    </p>
  {/if}

  <!--
    INSUMOS QUE CONSUME. La parte que hace que el inventario se mueva solo.

    Cada renglón dice cuánto se va del almacén por CADA unidad vendida. Al
    mandar el platillo a cocina se descuenta, y si se cancela vuelve. Un platillo
    sin insumos se vende igual: esto es opcional (ADR-16).
  -->
  {#if permisos.editarRecetas}
    <section class="insumos">
      <div class="cab-insumos">
        <h3>Insumos que consume</h3>
        <span class="opcional">opcional</span>
      </div>
      <p class="pista">
        Lo que se va del almacén cada vez que se vende <b>una</b> unidad. Se
        descuenta solo al enviar a cocina, y vuelve si el platillo se cancela.
      </p>

      {#if insumosDisponibles.length === 0}
        <p class="sin-insumos">
          Todavía no hay insumos dados de alta. Se capturan en
          <b>Administración → Insumos</b>, y desde aquí se enlazan.
        </p>
      {:else}
        {#each receta.ingredientes as ing (ing.id)}
          {@const insumo = ing.insumo_id ? inventario.insumo(ing.insumo_id) : undefined}
          <div class="fila-insumo">
            <select
              value={ing.insumo_id ?? ""}
              onchange={(e) => elegirInsumo(ing.id, e.currentTarget.value)}
              aria-label="Insumo del almacén"
            >
              <option value="">Elige un insumo…</option>
              {#each insumosDisponibles as opcion (opcion.id)}
                <option value={opcion.id}>{opcion.nombre}</option>
              {/each}
            </select>
            <input
              class="cant"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              value={ing.cantidad ?? ""}
              oninput={(e) =>
                cambiarIngrediente(ing.id, {
                  cantidad: Number(e.currentTarget.value) || undefined,
                })}
              placeholder="0"
              aria-label="Cantidad por unidad vendida"
            />
            <!--
              La unidad la pone el insumo, no se teclea: capturar «0.2 kg» sobre
              un almacén que lleva gramos obligaría a una conversión, y entre
              sistemas distintos esa conversión no existe sin una densidad.
            -->
            <span class="unidad">{insumo?.unidad_base ?? "—"}</span>
            <span class="costo-insumo">
              {insumo && ing.cantidad
                ? mxn(costoDesdeInsumo(ing, insumo) ?? pesos(0))
                : "—"}
            </span>
            <button
              class="quitar"
              onclick={() => quitarInsumo(ing.id)}
              aria-label="Quitar insumo"
            >
              ✕
            </button>
          </div>
        {/each}

        <button class="agregar-insumo" onclick={agregarInsumo}>+ Insumo</button>

        {#if vinculados.length > 0}
          <div class="resumen-insumos">
            <span>
              Por unidad se van:
              {vinculados
                .map((i) => {
                  const u = inventario.insumo(i.insumo_id!);
                  return u
                    ? `${formatearCantidad(i.cantidad!, u.unidad_base)} de ${u.nombre}`
                    : "";
                })
                .filter(Boolean)
                .join(" · ")}
            </span>
            {#if permisos.verCostos}
              <!--
                El costo de los insumos, al lado del costo tecleado. No lo
                reemplaza —ADR-16: manda el que captura el administrador— pero es
                lo que delata un costo que se quedó en el del año pasado.
              -->
              <div class="cotejo">
                <span>Suman a costo de almacén</span>
                <b class:difiere={costoInsumos !== costo}>{mxn(costoInsumos)}</b>
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </section>
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
  .ayuda {
    display: block;
    margin-top: 0.2rem;
    font-size: 0.72rem;
    color: var(--gris);
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
  /* --- Insumos que consume el platillo --- */
  .insumos {
    border-top: 1px solid var(--borde);
    padding-top: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cab-insumos {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .cab-insumos h3 {
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
  }
  .opcional {
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.45rem;
  }
  .sin-insumos {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.5;
    background: var(--fondo);
    border-radius: var(--r-sm);
    padding: 0.7rem 0.8rem;
  }
  .fila-insumo {
    display: grid;
    grid-template-columns: 1fr 5.5rem 3rem 5rem 2rem;
    gap: 0.4rem;
    align-items: center;
  }
  .fila-insumo select,
  .fila-insumo input {
    padding: 0.45rem 0.55rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.86rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  .fila-insumo select:focus,
  .fila-insumo input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .fila-insumo input.cant {
    text-align: right;
  }
  .unidad {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
  }
  .costo-insumo {
    font-size: 0.82rem;
    font-weight: 600;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--pizarra);
  }
  .quitar {
    color: var(--gris);
    font-size: 0.95rem;
    padding: 0.3rem;
    border-radius: var(--r-sm);
  }
  .quitar:hover {
    background: #fdeae8;
    color: var(--peligro);
  }
  .agregar-insumo {
    align-self: flex-start;
    border: 1.5px dashed var(--borde);
    border-radius: var(--r-md);
    padding: 0.5rem 0.9rem;
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--gris);
  }
  .agregar-insumo:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .resumen-insumos {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.45;
  }
  .cotejo {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex: none;
  }
  .cotejo span {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .cotejo b {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    color: var(--pizarra);
  }
  .cotejo b.difiere {
    color: var(--acento-2);
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
