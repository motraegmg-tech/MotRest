<script lang="ts">
  /**
   * "¿Cómo estuvo todo?", contestado por quien comió.
   *
   * Antes esta pregunta la tecleaba el mesero y por eso casi nunca salía "mal".
   * Aquí la contesta el comensal desde su teléfono, en diez segundos, sin
   * registrarse.
   *
   * Un detalle que decide si se contesta o no: **"bien" se guarda de una vez**.
   * Pedirle un paso más a quien está satisfecho es cómo se pierde la mitad de
   * las respuestas. A quien algo le falló sí se le pregunta qué, porque ese
   * dato es el que sirve para arreglar algo.
   */
  interface Props {
    codigo: string;
  }
  let { codigo }: Props = $props();

  interface Renglon {
    descripcion: string;
    cantidad: number;
    importe: number;
  }
  interface Cuenta {
    renglones: Renglon[];
    total: number;
    ya_opino: boolean;
  }

  const MOTIVOS = [
    { valor: "espera", etiqueta: "Tardó mucho" },
    { valor: "sabor", etiqueta: "El sabor" },
    { valor: "temperatura", etiqueta: "Llegó frío" },
    { valor: "servicio", etiqueta: "La atención" },
    { valor: "limpieza", etiqueta: "La limpieza" },
    { valor: "precio", etiqueta: "El precio" },
  ];

  let cuenta = $state<Cuenta | null>(null);
  let cargando = $state(true);
  let error = $state("");
  let calificacion = $state<"bien" | "regular" | "mal" | null>(null);
  let motivos = $state<string[]>([]);
  let comentario = $state("");
  let listo = $state(false);
  let enviando = $state(false);

  $effect(() => {
    void (async () => {
      try {
        const r = await fetch(`/portal/api/cuenta/${encodeURIComponent(codigo)}`);
        if (!r.ok) {
          error = "Este código ya no es válido. Pídele ayuda a quien te atendió.";
          return;
        }
        cuenta = (await r.json()) as Cuenta;
        if (cuenta.ya_opino) listo = true;
      } catch {
        error = "No hay conexión con el restaurante. Comprueba que estés en su wifi.";
      } finally {
        cargando = false;
      }
    })();
  });

  function pesos(centavos: number): string {
    return (centavos / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  }

  async function enviar(c: "bien" | "regular" | "mal") {
    calificacion = c;
    // Si estuvo bien, no se le pregunta nada más: se guarda y se agradece.
    if (c === "bien") await guardar();
  }

  function alternar(m: string) {
    motivos = motivos.includes(m) ? motivos.filter((x) => x !== m) : [...motivos, m];
  }

  async function guardar() {
    if (!calificacion || enviando) return;
    enviando = true;
    try {
      const r = await fetch("/portal/api/opinion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo, calificacion, motivos, comentario }),
      });
      if (r.ok) listo = true;
      else error = "No se pudo guardar tu respuesta. Inténtalo otra vez.";
    } catch {
      error = "No hay conexión con el restaurante.";
    } finally {
      enviando = false;
    }
  }
</script>

{#if cargando}
  <section class="tarjeta"><p>Un momento…</p></section>
{:else if error}
  <section class="tarjeta"><p class="mal">{error}</p></section>
{:else if listo}
  <section class="tarjeta gracias">
    <h2>¡Gracias!</h2>
    <p>Tu respuesta ya llegó. Nos ayuda de verdad.</p>
    <a class="boton" href="#/reservar">Apartar mesa para la próxima</a>
  </section>
{:else if cuenta}
  <section class="tarjeta">
    <h2>¿Cómo estuvo todo?</h2>

    <div class="caras">
      <button class="cara bien" class:on={calificacion === "bien"} onclick={() => enviar("bien")}>
        <span class="emo">🙂</span>Bien
      </button>
      <button
        class="cara regular"
        class:on={calificacion === "regular"}
        onclick={() => enviar("regular")}
      >
        <span class="emo">😐</span>Regular
      </button>
      <button class="cara mal" class:on={calificacion === "mal"} onclick={() => enviar("mal")}>
        <span class="emo">🙁</span>Mal
      </button>
    </div>

    {#if calificacion && calificacion !== "bien"}
      <p class="que">¿Qué falló?</p>
      <div class="motivos">
        {#each MOTIVOS as m (m.valor)}
          <button class="motivo" class:on={motivos.includes(m.valor)} onclick={() => alternar(m.valor)}>
            {m.etiqueta}
          </button>
        {/each}
      </div>
      <textarea bind:value={comentario} rows="3" placeholder="Cuéntanos en tus palabras (opcional)"
      ></textarea>
      <button class="boton" onclick={guardar} disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar"}
      </button>
    {/if}
  </section>

  <!-- Su consumo, para que se reconozca. Es lo que ya trae impreso. -->
  <section class="tarjeta consumo">
    <h3>Tu cuenta</h3>
    <ul>
      {#each cuenta.renglones as r (r.descripcion + r.importe)}
        <li>
          <span class="q">{r.cantidad}×</span>
          <span class="n">{r.descripcion}</span>
          <span class="p">{pesos(r.importe)}</span>
        </li>
      {/each}
    </ul>
    <p class="total"><span>Total</span><b>{pesos(cuenta.total)}</b></p>
  </section>
{/if}

<style>
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: 14px;
    padding: 1.25rem;
    margin-bottom: 0.9rem;
  }
  h2 {
    font-size: 1.15rem;
    margin: 0 0 1rem;
    text-align: center;
  }
  h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    margin: 0 0 0.6rem;
  }
  p {
    color: var(--gris);
    line-height: 1.55;
    font-size: 0.95rem;
    margin: 0;
  }
  .mal {
    color: #e0392b;
  }
  /* Botones grandes: se contesta de pie y con una mano. */
  .caras {
    display: flex;
    gap: 0.5rem;
  }
  .cara {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 1.1rem 0.3rem;
    border-radius: 12px;
    border: 2px solid var(--borde);
    background: #fff;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--pizarra);
    cursor: pointer;
  }
  .emo {
    font-size: 1.9rem;
    line-height: 1;
  }
  .cara.bien.on {
    border-color: #57ad30;
  }
  .cara.regular.on {
    border-color: #f2853a;
  }
  .cara.mal.on {
    border-color: #e0392b;
  }
  .que {
    margin: 1.1rem 0 0.5rem;
    font-weight: 600;
    color: var(--pizarra);
    font-size: 0.9rem;
  }
  .motivos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .motivo {
    padding: 0.5rem 0.8rem;
    border-radius: 999px;
    border: 1.5px solid var(--borde);
    background: #fff;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .motivo.on {
    border-color: var(--acento);
    background: #fff6ef;
    color: var(--acento);
    font-weight: 600;
  }
  textarea {
    width: 100%;
    margin-top: 0.7rem;
    padding: 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: 10px;
    font: inherit;
    font-size: 0.95rem;
    box-sizing: border-box;
    resize: vertical;
  }
  .boton {
    display: block;
    width: 100%;
    margin-top: 0.8rem;
    padding: 0.95rem;
    border: none;
    border-radius: 12px;
    background: var(--acento);
    color: #fff;
    text-align: center;
    text-decoration: none;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .boton:disabled {
    opacity: 0.6;
  }
  .gracias {
    text-align: center;
  }
  .consumo ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .consumo li {
    display: flex;
    gap: 0.6rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.9rem;
  }
  .consumo .q {
    color: var(--acento);
    font-weight: 700;
  }
  .consumo .n {
    flex: 1;
  }
  .total {
    display: flex;
    justify-content: space-between;
    margin-top: 0.7rem;
    font-size: 0.95rem;
  }
  .total b {
    font-size: 1.15rem;
    color: var(--pizarra);
  }
</style>
