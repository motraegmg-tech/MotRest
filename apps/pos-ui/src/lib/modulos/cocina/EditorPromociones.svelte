<script lang="ts">
  /**
   * Alta y baja de promociones: «2×1 los martes», «−20 % de 6 a 8».
   *
   * Se muestra en todo momento la frase completa de lo que se está creando
   * («2×1 en Pizzas · los martes · de 18 a 20 h»), porque una promoción mal
   * configurada no se descubre al guardarla: se descubre en el corte, cuando ya
   * regaló producto toda la noche.
   */
  import { describirPromocion, estaVigente, pesos, uuidv7, type Promocion } from "@motrest/dominio";
  import { mxn } from "../../formato";
  import { menu } from "../../menu.svelte";

  interface Props {
    onCerrar: () => void;
  }
  let { onCerrar }: Props = $props();

  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  let nombre = $state("");
  let tipo = $state<Promocion["tipo"]>("nxm");
  let categoriasElegidas = $state<string[]>([]);
  let productosElegidos = $state<string[]>([]);
  let buscarProducto = $state("");
  let editandoId = $state<string | null>(null);
  let lleva = $state("2");
  let paga = $state("1");
  let porcentaje = $state("20");
  let precioPesos = $state("");
  let dias = $state<number[]>([]);
  let conHorario = $state(false);
  let desdeHora = $state("18");
  let hastaHora = $state("20");
  let aviso = $state("");

  const permisos = $derived(menu.permisos);
  const promociones = $derived(menu.promociones);

  /** El borrador tal como quedaría guardado, para poder describirlo en vivo. */
  const borrador = $derived<Promocion>({
    id: "borrador",
    nombre: nombre.trim() || "Sin nombre",
    tipo,
    productos: [...productosElegidos],
    categorias: [...categoriasElegidas],
    vigencia: {
      dias: dias.length > 0 ? [...dias].sort() : undefined,
      desde_hora: conHorario ? Number(desdeHora) : undefined,
      hasta_hora: conHorario ? Number(hastaHora) : undefined,
    },
    activa: true,
    lleva: Number(lleva),
    paga: Number(paga),
    fraccion: Number(porcentaje) / 100,
    precio: pesos(Number(precioPesos) || 0),
  });

  function frase(p: Promocion): string {
    const alcances = [
      ...p.categorias.map((id) => menu.categorias.find((c) => c.id === id)?.nombre ?? "?"),
      ...p.productos.map((id) => menu.index.productos.get(id)?.nombre ?? "?"),
    ];
    const donde = alcances.length > 0 ? `en ${alcances.join(", ")}` : "en toda la carta";
    const cuando = p.vigencia.dias?.length
      ? ` · ${p.vigencia.dias.map((d) => DIAS[d]).join(", ")}`
      : "";
    const horario = p.vigencia.desde_hora !== undefined
      ? ` · de ${p.vigencia.desde_hora}:00 a ${p.vigencia.hasta_hora}:00`
      : "";
    return `${describirPromocion(p)} ${donde}${cuando}${horario}`;
  }

  function alternarDia(d: number) {
    dias = dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d];
  }

  function alternarCategoria(id: string) {
    categoriasElegidas = categoriasElegidas.includes(id)
      ? categoriasElegidas.filter((x) => x !== id)
      : [...categoriasElegidas, id];
  }

  function alternarProducto(id: string) {
    productosElegidos = productosElegidos.includes(id)
      ? productosElegidos.filter((x) => x !== id)
      : [...productosElegidos, id];
  }

  const productosFiltrados = $derived(
    [...menu.index.productos.values()]
      .filter((p) => p.nombre.toLocaleLowerCase("es").includes(buscarProducto.trim().toLocaleLowerCase("es")))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
  );

  function limpiarFormulario() {
    nombre = "";
    tipo = "nxm";
    categoriasElegidas = [];
    productosElegidos = [];
    buscarProducto = "";
    lleva = "2";
    paga = "1";
    porcentaje = "20";
    precioPesos = "";
    dias = [];
    conHorario = false;
    desdeHora = "18";
    hastaHora = "20";
    editandoId = null;
    aviso = "";
  }

  function editar(p: Promocion) {
    nombre = p.nombre;
    tipo = p.tipo;
    categoriasElegidas = [...p.categorias];
    productosElegidos = [...p.productos];
    lleva = String(p.lleva ?? 2);
    paga = String(p.paga ?? 1);
    porcentaje = String(Math.round((p.fraccion ?? 0.2) * 100));
    precioPesos = p.precio ? String(p.precio / 100) : "";
    dias = [...(p.vigencia.dias ?? [])];
    conHorario = p.vigencia.desde_hora !== undefined;
    desdeHora = String(p.vigencia.desde_hora ?? 18);
    hastaHora = String(p.vigencia.hasta_hora ?? 20);
    editandoId = p.id;
    aviso = "";
  }

  function guardar() {
    if (nombre.trim().length < 3) {
      aviso = "Ponle un nombre reconocible: es lo que verá el mesero en la cuenta.";
      return;
    }
    if (tipo === "nxm" && Number(lleva) <= Number(paga)) {
      aviso = "En un 2×1, los que se llevan tienen que ser más que los que se pagan.";
      return;
    }
    if (tipo === "precio_fijo" && Number(precioPesos) <= 0) {
      aviso = "Captura el precio especial.";
      return;
    }
    const r = menu.guardarPromocion({ ...borrador, id: editandoId ?? uuidv7() });
    aviso = r.ok ? "" : (r.problemas[0]?.mensaje ?? "No se pudo guardar");
    if (r.ok) {
      limpiarFormulario();
    }
  }

  function alternarActiva(p: Promocion) {
    menu.guardarPromocion({ ...p, activa: !p.activa });
  }
</script>

<div class="editor">
  <header>
    <h2>Promociones</h2>
    <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">✕</button>
  </header>

  {#if !permisos.editarProductos}
    <p class="nota">Tu perfil puede consultar las promociones, pero no cambiarlas.</p>
  {:else}
    <div class="campos">
      <label class="ancho">
        <span>Nombre (lo verá el mesero)</span>
        <input bind:value={nombre} placeholder="Martes de 2×1 en pizzas" />
      </label>

      <label>
        <span>Tipo</span>
        <select bind:value={tipo}>
          <option value="nxm">Lleva N, paga M (2×1)</option>
          <option value="porcentaje">Descuento en por ciento</option>
          <option value="precio_fijo">Precio especial</option>
        </select>
      </label>

      {#if tipo === "nxm"}
        <label>
          <span>Se lleva</span>
          <input type="number" min="2" bind:value={lleva} />
        </label>
        <label>
          <span>Paga</span>
          <input type="number" min="1" bind:value={paga} />
        </label>
      {:else if tipo === "porcentaje"}
        <label>
          <span>Descuento (%)</span>
          <input type="number" min="1" max="100" bind:value={porcentaje} />
        </label>
      {:else}
        <label>
          <span>Precio especial</span>
          <input type="number" min="0" step="0.01" bind:value={precioPesos} placeholder="199.00" />
        </label>
      {/if}
    </div>

    <section class="alcance">
      <div>
        <span class="rotulo">Categorías</span>
        <div class="selecciones">
          {#each menu.categorias as c (c.id)}
            <button
              type="button"
              class="opcion"
              class:on={categoriasElegidas.includes(c.id)}
              onclick={() => alternarCategoria(c.id)}
            >
              {c.nombre}
            </button>
          {/each}
        </div>
      </div>
      <div>
        <label class="buscador">
          <span class="rotulo">Productos específicos</span>
          <input bind:value={buscarProducto} placeholder="Buscar alimento o bebida" />
        </label>
        <div class="productos">
          {#each productosFiltrados as p (p.id)}
            <button
              type="button"
              class="opcion"
              class:on={productosElegidos.includes(p.id)}
              onclick={() => alternarProducto(p.id)}
            >
              {p.nombre}
            </button>
          {/each}
        </div>
      </div>
      {#if categoriasElegidas.length === 0 && productosElegidos.length === 0}
        <p class="tenue">Sin selección, aplica a toda la carta.</p>
      {:else}
        <p class="tenue">
          Puedes mezclar categorías completas con productos sueltos; un producto repetido
          por su categoría solo recibe el descuento una vez.
        </p>
      {/if}
    </section>

    <div class="cuando">
      <span class="rotulo">Días</span>
      <div class="dias">
        {#each DIAS as d, i (d)}
          <button class="dia" class:on={dias.includes(i)} onclick={() => alternarDia(i)}>
            {d}
          </button>
        {/each}
        {#if dias.length === 0}<span class="tenue">todos los días</span>{/if}
      </div>
    </div>

    <div class="cuando">
      <label class="check">
        <input type="checkbox" bind:checked={conHorario} />
        <span>Solo a ciertas horas</span>
      </label>
      {#if conHorario}
        <div class="horas">
          de <input type="number" min="0" max="23" bind:value={desdeHora} />
          a <input type="number" min="0" max="23" bind:value={hastaHora} />
          <!-- De 22 a 2 es lo que de verdad pide un local de noche. -->
          <span class="tenue">
            {Number(desdeHora) > Number(hastaHora) ? "cruza la medianoche" : "hora local"}
          </span>
        </div>
      {/if}
    </div>

    <p class="vista-previa">
      Quedaría así: <b>{frase(borrador)}</b>
      {#if tipo === "precio_fijo" && Number(precioPesos) > 0}
        · {mxn(pesos(Number(precioPesos)))} por pieza
      {/if}
    </p>

    {#if aviso}<p class="error" role="alert">{aviso}</p>{/if}

    <div class="acciones">
      <button class="principal" onclick={guardar}>
        {editandoId ? "Guardar cambios" : "Crear promoción"}
      </button>
      {#if editandoId}
        <button onclick={limpiarFormulario}>Cancelar edición</button>
      {/if}
    </div>
  {/if}

  {#if promociones.length > 0}
    <ul class="lista">
      {#each promociones as p (p.id)}
        <li class:apagada={!p.activa}>
          <div class="datos">
            <b>{p.nombre}</b>
            <span class="detalle">{frase(p)}</span>
          </div>
          {#if estaVigente(p, Date.now())}
            <span class="ahora">vigente ahora</span>
          {/if}
          {#if permisos.editarProductos}
            <button class="mini" onclick={() => editar(p)}>Editar</button>
            <button class="mini" onclick={() => alternarActiva(p)}>
              {p.activa ? "Apagar" : "Encender"}
            </button>
            <button class="mini x" onclick={() => menu.borrarPromocion(p.id)}>Eliminar</button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="nota">
      Todavía no hay promociones. Mientras no haya ninguna, el POS cobra la carta tal cual.
    </p>
  {/if}
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
    min-width: 9rem;
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
  .cuando {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .alcance {
    display: grid;
    gap: 0.8rem;
    padding: 0.85rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--fondo);
  }
  .selecciones,
  .productos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.35rem;
  }
  .productos {
    max-height: 9rem;
    overflow-y: auto;
  }
  .opcion {
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    background: #fff;
    font-size: 0.78rem;
  }
  .opcion.on {
    border-color: var(--acento);
    background: var(--claro);
    color: var(--acento);
    font-weight: 700;
  }
  .buscador {
    display: grid;
    gap: 0.3rem;
  }
  .buscador input {
    max-width: 24rem;
  }
  .rotulo {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .dias {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .dia {
    padding: 0.35rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.8rem;
    background: #fff;
    cursor: pointer;
  }
  .dia.on {
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 12%, transparent);
    color: var(--acento);
    font-weight: 700;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .check input {
    width: auto;
  }
  .horas {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .horas input {
    width: 4rem;
  }
  .tenue {
    color: var(--gris);
    font-size: 0.8rem;
  }
  .vista-previa {
    padding: 0.6rem 0.75rem;
    border-radius: var(--r-sm);
    background: var(--fondo);
    font-size: 0.88rem;
  }
  .error {
    color: var(--peligro);
    font-size: 0.85rem;
  }
  .nota {
    color: var(--gris);
    font-size: 0.85rem;
  }
  .acciones {
    display: flex;
    justify-content: flex-end;
  }
  .principal {
    padding: 0.6rem 1.1rem;
    border-radius: var(--r-sm);
    background: var(--acento);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .lista {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-top: 1px solid var(--borde);
    padding-top: 0.85rem;
  }
  .lista li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
  }
  .lista li.apagada {
    opacity: 0.55;
  }
  .datos {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .detalle {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .ahora {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--acento);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .mini {
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.78rem;
    background: #fff;
    cursor: pointer;
  }
  .mini.x {
    color: var(--peligro);
  }
</style>
