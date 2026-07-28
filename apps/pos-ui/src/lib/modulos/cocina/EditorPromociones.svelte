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
  let categoriaId = $state<string>("");
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
    productos: [],
    categorias: categoriaId ? [categoriaId] : [],
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
    const donde = p.categorias.length > 0
      ? `en ${menu.categorias.find((c) => c.id === p.categorias[0])?.nombre ?? "?"}`
      : "en toda la carta";
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
    const r = menu.guardarPromocion({ ...borrador, id: uuidv7() });
    aviso = r.ok ? "" : (r.problemas[0]?.mensaje ?? "No se pudo guardar");
    if (r.ok) {
      nombre = "";
      precioPesos = "";
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

      <label>
        <span>Aplica a</span>
        <select bind:value={categoriaId}>
          <option value="">Toda la carta</option>
          {#each menu.categorias as c (c.id)}
            <option value={c.id}>{c.nombre}</option>
          {/each}
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
      <button class="principal" onclick={guardar}>Crear promoción</button>
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
