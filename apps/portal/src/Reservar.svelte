<script lang="ts">
  /**
   * Pedir mesa desde el teléfono.
   *
   * Se dice CLARO que es una solicitud y no una mesa apartada. No es letra
   * pequeña: una reserva del portal no bloquea nada hasta que el restaurante la
   * confirma —si lo hiciera, cualquiera con el enlace podría llenar la agenda de
   * un viernes sin pisar el local—. Prometerle al comensal una mesa que no
   * tiene es peor que pedirle que espere la confirmación.
   */
  let nombre = $state("");
  let telefono = $state("");
  let personas = $state("2");
  let fecha = $state(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  let horaTexto = $state("21:00");

  let enviando = $state(false);
  let listo = $state(false);
  let error = $state("");

  async function solicitar() {
    error = "";
    const para_ts = new Date(`${fecha}T${horaTexto}`).getTime();
    if (!Number.isFinite(para_ts)) {
      error = "Revisa el día y la hora.";
      return;
    }

    enviando = true;
    try {
      const r = await fetch("/portal/api/reserva", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nombre,
          telefono,
          personas: Number(personas) || 0,
          para_ts,
        }),
      });
      if (r.ok) listo = true;
      else error = ((await r.json()) as { error?: string }).error ?? "No se pudo enviar.";
    } catch {
      error = "No hay conexión con el restaurante. Comprueba que estés en su wifi.";
    } finally {
      enviando = false;
    }
  }
</script>

{#if listo}
  <section class="tarjeta gracias">
    <h2>Solicitud enviada</h2>
    <p>
      El restaurante la revisa y te confirma. <b>Todavía no hay mesa apartada</b>
      hasta que te avisen.
    </p>
  </section>
{:else}
  <section class="tarjeta">
    <h2>Apartar una mesa</h2>

    <label>
      <span>¿A nombre de quién?</span>
      <input bind:value={nombre} placeholder="Tu nombre" autocomplete="name" />
    </label>

    <label>
      <span>Teléfono</span>
      <input bind:value={telefono} inputmode="tel" autocomplete="tel" placeholder="Para avisarte" />
    </label>

    <div class="fila">
      <label>
        <span>Personas</span>
        <input type="number" min="1" max="40" bind:value={personas} />
      </label>
      <label>
        <span>Día</span>
        <input type="date" bind:value={fecha} />
      </label>
      <label>
        <span>Hora</span>
        <input type="time" bind:value={horaTexto} />
      </label>
    </div>

    {#if error}<p class="mal">{error}</p>{/if}

    <button class="boton" onclick={solicitar} disabled={enviando}>
      {enviando ? "Enviando…" : "Solicitar"}
    </button>

    <p class="aviso">
      Es una <b>solicitud</b>. El restaurante te confirma si hay lugar.
    </p>
  </section>
{/if}

<style>
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: 14px;
    padding: 1.25rem;
  }
  h2 {
    font-size: 1.15rem;
    margin: 0 0 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
  }
  label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
  }
  input {
    padding: 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: 10px;
    font: inherit;
    /* 16px evita que iOS haga zoom al enfocar, que descoloca la página. */
    font-size: 1rem;
    box-sizing: border-box;
    width: 100%;
  }
  .fila {
    display: flex;
    gap: 0.5rem;
  }
  .fila label {
    flex: 1;
  }
  .boton {
    display: block;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.95rem;
    border: none;
    border-radius: 12px;
    background: var(--acento);
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .boton:disabled {
    opacity: 0.6;
  }
  .aviso,
  .mal {
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--gris);
    margin: 0.7rem 0 0;
  }
  .mal {
    color: #e0392b;
  }
  .gracias {
    text-align: center;
  }
  .gracias p {
    color: var(--gris);
    line-height: 1.55;
    margin: 0;
  }
</style>
