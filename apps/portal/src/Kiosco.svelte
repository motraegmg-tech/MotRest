<script lang="ts">
  /**
   * El kiosco de autoservicio (F4).
   *
   * La misma aplicación que el portal, en otro modo: se abre a pantalla completa
   * en una tablet montada a la entrada. Comparte el origen con el Hub, así que
   * funciona sin internet mientras la tablet vea la red del local.
   *
   * TRES COSAS QUE NO SE PARECEN AL POS:
   *
   *   - **Todo es enorme.** Lo usa alguien de pie, sin haberlo visto nunca y con
   *     gente detrás en la fila. Un botón de tamaño normal aquí es un botón que
   *     se falla.
   *   - **Se reinicia solo.** Quien se distrae y se va deja su pedido en
   *     pantalla; el siguiente no debe encontrarse el carrito del anterior.
   *   - **Nunca se reinicia pagando.** Quitarle a alguien un pedido ya pagado es
   *     el peor fallo que puede tener esta máquina.
   */
  import {
    deCentavos,
    folioDeKiosco,
    kioscoEnReposo,
    porInactividad,
    puedeMandarACocina,
    segundosParaReiniciar,
    type EstadoKiosco,
    type Modalidad,
  } from "@motrest/dominio";

  interface Platillo {
    id: string;
    nombre: string;
    precio: number;
    categoria: string;
  }

  let estado = $state<EstadoKiosco>(kioscoEnReposo());
  let carta = $state<Platillo[]>([]);
  let carrito = $state<{ platillo: Platillo; cantidad: number }[]>([]);
  let categoria = $state("");
  let ahora = $state(Date.now());
  let error = $state("");

  const total = $derived(carrito.reduce((s, x) => s + x.platillo.precio * x.cantidad, 0));
  const articulos = $derived(carrito.reduce((s, x) => s + x.cantidad, 0));
  const categorias = $derived([...new Set(carta.map((p) => p.categoria))]);
  const visibles = $derived(carta.filter((p) => !categoria || p.categoria === categoria));

  const aviso = $derived(porInactividad(estado, ahora) === "avisar");
  const segundos = $derived(segundosParaReiniciar(estado, ahora));

  /** Cualquier toque reinicia la cuenta atrás. */
  function tocar(paso: EstadoKiosco["paso"] = estado.paso) {
    estado = { ...estado, paso, ultimo_toque_ts: Date.now() };
  }

  function reiniciar() {
    carrito = [];
    categoria = "";
    error = "";
    estado = kioscoEnReposo();
  }

  function agregar(platillo: Platillo) {
    const dentro = carrito.find((x) => x.platillo.id === platillo.id);
    carrito = dentro
      ? carrito.map((x) => (x.platillo.id === platillo.id ? { ...x, cantidad: x.cantidad + 1 } : x))
      : [...carrito, { platillo, cantidad: 1 }];
    tocar();
  }

  function quitar(id: string) {
    carrito = carrito
      .map((x) => (x.platillo.id === id ? { ...x, cantidad: x.cantidad - 1 } : x))
      .filter((x) => x.cantidad > 0);
    tocar();
  }

  function elegirModalidad(modalidad: Modalidad) {
    estado = { ...estado, modalidad, paso: "carta", ultimo_toque_ts: Date.now() };
  }

  async function pagar() {
    error = "";
    const importe = deCentavos(total);
    const permiso = puedeMandarACocina(
      estado,
      { articulos, subtotal: importe, total: importe },
      true,
    );
    if (!permiso.puede) {
      error = permiso.razon ?? "No se puede mandar el pedido";
      return;
    }

    try {
      const respuesta = await fetch("/kiosco/pedido", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modalidad: estado.modalidad,
          renglones: carrito.map((x) => ({ producto_id: x.platillo.id, cantidad: x.cantidad })),
        }),
      });
      const cuerpo = (await respuesta.json()) as { consecutivo?: number; error?: string };
      if (!respuesta.ok) {
        error = cuerpo.error ?? "No se pudo registrar el pedido";
        return;
      }
      estado = {
        ...estado,
        paso: "listo",
        folio: folioDeKiosco(cuerpo.consecutivo ?? 0),
        ultimo_toque_ts: Date.now(),
      };
    } catch {
      /*
       * Si el Hub no contesta, NO se enseña un folio. Un número de recogida sin
       * pedido detrás manda al comensal a esperar una comida que nadie está
       * haciendo, y eso se descubre veinte minutos después.
       */
      error = "No se pudo enviar el pedido. Pásele a la caja, por favor.";
    }
  }

  $effect(() => {
    const reloj = setInterval(() => {
      ahora = Date.now();
      if (porInactividad(estado, Date.now()) === "reiniciar") reiniciar();
    }, 1000);
    return () => clearInterval(reloj);
  });

  $effect(() => {
    void (async () => {
      try {
        const r = await fetch("/kiosco/carta");
        if (r.ok) carta = (await r.json()) as Platillo[];
      } catch {
        // Sin carta el kiosco no sirve, pero la pantalla de reposo sí se ve y
        // eso ya le dice al restaurante que la tablet está viva.
      }
    })();
  });

  const mxn = (centavos: number) =>
    (centavos / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
</script>

<div class="kiosco">
  {#if estado.paso === "reposo"}
    <button class="atraccion" onclick={() => tocar("modalidad")}>
      <span class="marca">Rodizio</span>
      <span class="invita">Toque para ordenar</span>
    </button>
  {:else if estado.paso === "modalidad"}
    <h2>¿Cómo va a ser?</h2>
    <div class="opciones">
      <button onclick={() => elegirModalidad("comer_aqui")}>Para comer aquí</button>
      <button onclick={() => elegirModalidad("para_llevar")}>Para llevar</button>
    </div>
  {:else if estado.paso === "listo"}
    <div class="listo">
      <span class="etiqueta">Su número</span>
      <span class="folio">{estado.folio}</span>
      <p>Lo llamamos cuando esté. Gracias.</p>
      <button class="otro" onclick={reiniciar}>Ordenar otra vez</button>
    </div>
  {:else}
    <div class="pedido">
      <div class="carta">
        <div class="filtros">
          <button class:on={!categoria} onclick={() => { categoria = ""; tocar(); }}>Todo</button>
          {#each categorias as c (c)}
            <button class:on={categoria === c} onclick={() => { categoria = c; tocar(); }}>{c}</button>
          {/each}
        </div>

        <div class="platillos">
          {#each visibles as p (p.id)}
            <button class="platillo" onclick={() => agregar(p)}>
              <span class="nombre">{p.nombre}</span>
              <span class="precio">{mxn(p.precio)}</span>
            </button>
          {/each}
          {#if visibles.length === 0}
            <p class="sin-carta">La carta todavía no está cargada.</p>
          {/if}
        </div>
      </div>

      <aside class="cuenta">
        <h3>Su pedido</h3>

        {#if carrito.length === 0}
          <p class="vacio">Toque un platillo para agregarlo.</p>
        {:else}
          <ul>
            {#each carrito as x (x.platillo.id)}
              <li>
                <span class="cant">{x.cantidad}</span>
                <span class="nom">{x.platillo.nombre}</span>
                <span class="imp">{mxn(x.platillo.precio * x.cantidad)}</span>
                <button class="menos" onclick={() => quitar(x.platillo.id)} aria-label="Quitar uno">
                  −
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="total">
          <span>Total</span>
          <b>{mxn(total)}</b>
        </div>

        {#if error}
          <p class="error" role="alert">{error}</p>
        {/if}

        <button class="pagar" disabled={articulos === 0} onclick={() => { tocar("pago"); void pagar(); }}>
          {estado.paso === "pago" ? "Cobrando…" : "Pagar"}
        </button>
        <button class="cancelar" onclick={reiniciar}>Cancelar</button>
      </aside>
    </div>
  {/if}

  <!--
    La cuenta atrás no se esconde: quien sigue ahí pensando tiene que poder
    detenerla, y para eso necesita verla.
  -->
  {#if aviso}
    <button class="sigue-ahi" onclick={() => tocar()}>
      ¿Sigue ahí? Su pedido se borrará en {segundos} s — toque para continuar
    </button>
  {/if}
</div>

<style>
  .kiosco {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--fondo, #f7f8f7);
    /* Nada de selección de texto ni menús largos: es un mueble, no un navegador. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  button {
    font: inherit;
    cursor: pointer;
    border: none;
    background: none;
    color: inherit;
  }
  .atraccion {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    background: #14181a;
    color: #fff;
  }
  .marca {
    font-family: var(--font-titulo, sans-serif);
    font-size: clamp(3rem, 12vw, 6rem);
    font-weight: 700;
  }
  .invita {
    font-size: clamp(1.1rem, 3vw, 1.6rem);
    color: var(--acento, #f2853a);
    animation: respira 2.6s ease-in-out infinite;
  }
  @keyframes respira {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  @media (prefers-reduced-motion: reduce) {
    .invita { animation: none; }
  }
  h2 {
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    text-align: center;
    margin: 3rem 0 2rem;
    color: var(--pizarra, #1c2321);
  }
  .opciones {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    padding: 0 2rem;
  }
  .opciones button {
    /* Alto de dedo, con margen: esto se toca de pie y con prisa. */
    min-height: 9rem;
    font-size: clamp(1.1rem, 3vw, 1.6rem);
    font-weight: 600;
    border-radius: 1.25rem;
    background: #fff;
    border: 2px solid var(--borde, #e3e7e5);
    color: var(--pizarra, #1c2321);
  }
  .opciones button:active {
    border-color: var(--acento, #f2853a);
  }
  .pedido {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 22rem;
    min-height: 0;
  }
  .carta {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 1rem;
  }
  .filtros {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 0.75rem;
  }
  .filtros button {
    flex: none;
    min-height: 3rem;
    padding: 0 1.2rem;
    border-radius: 999px;
    background: #fff;
    border: 1.5px solid var(--borde, #e3e7e5);
    font-size: 1rem;
    font-weight: 600;
  }
  .filtros button.on {
    background: var(--acento, #f2853a);
    border-color: var(--acento, #f2853a);
    color: #fff;
  }
  .platillos {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.75rem;
    align-content: start;
  }
  .platillo {
    min-height: 6.5rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1rem;
    border-radius: 1rem;
    background: #fff;
    border: 1.5px solid var(--borde, #e3e7e5);
    text-align: left;
  }
  .platillo:active {
    border-color: var(--acento, #f2853a);
  }
  .nombre {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--pizarra, #1c2321);
  }
  .precio {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--acento, #f2853a);
  }
  .sin-carta {
    grid-column: 1 / -1;
    color: var(--gris, #6f7b81);
  }
  .cuenta {
    display: flex;
    flex-direction: column;
    background: #fff;
    border-left: 1px solid var(--borde, #e3e7e5);
    padding: 1.25rem;
    min-height: 0;
  }
  h3 {
    font-size: 1.1rem;
    margin: 0 0 0.9rem;
    color: var(--pizarra, #1c2321);
  }
  .cuenta ul {
    flex: 1;
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  .cuenta li {
    display: grid;
    grid-template-columns: 1.8rem 1fr auto 2.5rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--borde, #e3e7e5);
    font-size: 0.98rem;
  }
  .cant {
    font-weight: 700;
    color: var(--acento, #f2853a);
  }
  .imp {
    font-variant-numeric: tabular-nums;
  }
  .menos {
    min-height: 2.5rem;
    font-size: 1.4rem;
    color: var(--gris, #6f7b81);
  }
  .vacio {
    flex: 1;
    color: var(--gris, #6f7b81);
  }
  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 1rem 0;
    font-size: 1.05rem;
  }
  .total b {
    font-size: 1.6rem;
    color: var(--pizarra, #1c2321);
  }
  .pagar {
    min-height: 4rem;
    border-radius: 1rem;
    background: var(--acento, #f2853a);
    color: #fff;
    font-size: 1.2rem;
    font-weight: 700;
  }
  .pagar:disabled {
    background: var(--borde, #e3e7e5);
    color: var(--gris, #6f7b81);
  }
  .cancelar {
    min-height: 3rem;
    margin-top: 0.5rem;
    color: var(--gris, #6f7b81);
    font-size: 0.95rem;
  }
  .error {
    color: #e0392b;
    font-size: 0.9rem;
    line-height: 1.45;
    margin: 0 0 0.6rem;
  }
  .listo {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    text-align: center;
  }
  .etiqueta {
    font-size: 1.1rem;
    color: var(--gris, #6f7b81);
  }
  .folio {
    font-family: var(--font-titulo, sans-serif);
    font-size: clamp(5rem, 22vw, 11rem);
    font-weight: 700;
    line-height: 1;
    color: var(--acento, #f2853a);
  }
  .otro {
    margin-top: 2rem;
    min-height: 3.5rem;
    padding: 0 2rem;
    border-radius: 999px;
    border: 1.5px solid var(--borde, #e3e7e5);
    font-size: 1rem;
    font-weight: 600;
  }
  .sigue-ahi {
    position: fixed;
    left: 50%;
    bottom: 1.5rem;
    transform: translateX(-50%);
    min-height: 3.5rem;
    padding: 0 1.5rem;
    border-radius: 999px;
    background: #14181a;
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    box-shadow: 0 18px 40px rgba(20, 24, 26, 0.25);
  }

  @media (max-width: 820px) {
    .pedido {
      grid-template-columns: 1fr;
    }
    .cuenta {
      border-left: none;
      border-top: 1px solid var(--borde, #e3e7e5);
      max-height: 45vh;
    }
  }
</style>
