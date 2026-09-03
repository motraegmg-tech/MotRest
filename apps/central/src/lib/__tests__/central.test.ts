/**
 * El store de MotRest Central.
 *
 * Lo importante que se prueba aquí es la emisión de licencias, porque es donde
 * se juntan las dos cosas que sostienen todo el modelo: que la licencia solo
 * valga en SU local, y que el acceso de soporte viaje dentro de la firma.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  pesos,
  verificarLicencia,
  verificarCredencial,
  verificarVersion,
} from "@motrest/dominio";
import { crearCentralParaPruebas, StoreCentral } from "../central.svelte";

let central: StoreCentral;
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});


beforeEach(async () => {
  central = crearCentralParaPruebas();
  central.clientes = [];
  central.pulsos = [];
  await central.generarPares();
  await central.guardarConfiguracion({ repositorio: "motrae/motrest" });
});

async function alta(nombre = "Rodizio", sufijo = "Centro") {
  return central.alta({
    nombre, sufijo, contacto: "Dueño", plan: "mensual", cuota: pesos(1_500),
  });
}

describe("dar de alta un restaurante", () => {
  it("propone un identificador legible que se pueda dictar por teléfono", async () => {
    expect((await alta()).cliente!.id).toBe("suc-rodizio-centro");
  });

  it("no admite dos locales con el mismo identificador", async () => {
    await alta();
    const r = await alta();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Ya existe");
  });

  it("sin nombre no se da de alta", async () => {
    expect((await central.alta({ nombre: "  ", contacto: "", plan: "mensual", cuota: pesos(0) })).ok).toBe(false);
  });

  /*
   * Un cliente que se fue sigue siendo historia del negocio, y volver a darlo de
   * alta el día que regrese vale más que la línea que ahorra borrarlo.
   */
  it("dar de baja no borra: desactiva", async () => {
    const id = (await alta()).cliente!.id;
    central.baja(id);
    expect(central.clientes).toHaveLength(1);
    expect(central.activos).toHaveLength(0);
  });

  /* Un local nuevo NO nace con licencia: primero se instala y se ve su id. */
  it("nace sin licencia, a propósito", async () => {
    expect((await alta()).cliente!.licencia).toBeNull();
  });

  it("crea al responsable como propietario y solo entrega su PIN una vez", async () => {
    const creado = await alta();
    const cliente = creado.cliente!;
    const pin = creado.credencialesResponsable!.pin;

    expect(cliente.responsable).toMatchObject({
      id: "usr-gonzalo",
      nombre: "Dueño",
      puesto: "Responsable del restaurante",
    });
    expect(pin).toMatch(/^\d{8}$/);

    const licencia = (await central.emitir(cliente.id)).licencia!;
    expect(licencia.responsable?.provision_id).toBe(cliente.responsable?.provision_id);
    expect(await verificarCredencial(pin, licencia.responsable!.credencial)).toBe(true);
    expect(central.exportar()).not.toContain(licencia.responsable!.credencial.hash);
  });
});

describe("editar la ficha de un local", () => {
  it("corrige contacto, plan y precio, y deja lo demás como estaba", async () => {
    const id = (await alta()).cliente!.id;

    const r = central.editar(id, {
      telefono: "55 1234 5678",
      correo: "rodizio@ejemplo.com",
      plan: "anual",
      cuota: pesos(18_000),
      notas: "Paga por transferencia el día 5",
    });

    expect(r.ok).toBe(true);
    const cliente = central.clientes.find((c) => c.id === id)!;
    expect(cliente).toMatchObject({
      id,
      nombre: "Rodizio",
      telefono: "55 1234 5678",
      correo: "rodizio@ejemplo.com",
      plan: "anual",
      cuota: pesos(18_000),
      notas: "Paga por transferencia el día 5",
    });
  });

  /*
   * El nombre del responsable vive en dos sitios: a quién se le llama y cómo se
   * llama su cuenta de Propietario dentro del restaurante. Mover uno solo es cómo
   * se acaba llamando a alguien que ya no trabaja ahí mientras el POS lo saluda.
   */
  it("renombrar al responsable mueve las dos copias y no toca su acceso", async () => {
    const creado = await alta();
    const id = creado.cliente!.id;
    const pin = creado.credencialesResponsable!.pin;
    const provisionAntes = creado.cliente!.responsable!.provision_id;

    central.editar(id, { contacto: "Ana Gómez" });

    const cliente = central.clientes.find((c) => c.id === id)!;
    expect(cliente.contacto).toBe("Ana Gómez");
    expect(cliente.responsable!.nombre).toBe("Ana Gómez");
    /* Renombrar no es cambiar de responsable: el PIN entregado sigue sirviendo. */
    expect(cliente.responsable!.provision_id).toBe(provisionAntes);
    const licencia = (await central.emitir(id)).licencia!;
    expect(await verificarCredencial(pin, licencia.responsable!.credencial)).toBe(true);
  });

  /*
   * La licencia que ya está pegada en el local lleva dentro, firmados, el nombre
   * y el plan del día en que se emitió. Cambiar la cuota aquí no la cobra.
   */
  it("avisa de que el plan nuevo se aplica al renovar, no ahora", async () => {
    const id = (await alta()).cliente!.id;
    await central.emitir(id);

    const r = central.editar(id, { cuota: pesos(2_000), contacto: "Otro Dueño" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisos).toHaveLength(2);
    expect(r.avisos.join(" ")).toContain("al renovar");
  });

  it("sin licencia emitida todavía no hay nada de qué avisar", async () => {
    const id = (await alta()).cliente!.id;
    const r = central.editar(id, { cuota: pesos(2_000) });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.avisos).toHaveLength(0);
  });

  it("un campo vacío borra el dato en vez de dejar el anterior", async () => {
    const id = (await alta()).cliente!.id;
    central.editar(id, { telefono: "55 1234 5678" });

    central.editar(id, { telefono: "  " });

    expect(central.clientes.find((c) => c.id === id)!.telefono).toBeUndefined();
  });

  it("no admite dejar al local sin nombre ni sin responsable", async () => {
    const id = (await alta()).cliente!.id;

    expect(central.editar(id, { nombre: "   " }).ok).toBe(false);
    expect(central.editar(id, { contacto: "A" }).ok).toBe(false);
    expect(central.editar(id, { cuota: -100 as never }).ok).toBe(false);
    expect(central.clientes.find((c) => c.id === id)!.nombre).toBe("Rodizio");
  });

  it("editar un local que no existe no crea uno nuevo", async () => {
    await alta();
    expect(central.editar("suc-inventado", { nombre: "X" }).ok).toBe(false);
    expect(central.clientes).toHaveLength(1);
  });
});

describe("el dinero que entró de verdad", () => {
  /*
   * EMITIR NO ES COBRAR. Antes la única huella de un cobro era el vencimiento de
   * la licencia: renovar de confianza mientras el restaurantero pagaba «la
   * semana que entra» dejaba a Central enseñándolo al corriente, y ese dinero no
   * lo reclamaba nadie nunca.
   */
  it("renovar no cobra: el ingreso real sigue en cero hasta que se anota el pago", async () => {
    const id = (await alta()).cliente!.id;
    await central.emitir(id);

    expect(central.resumen.ingreso_mensual).toBe(pesos(1_500));
    expect(central.resumen.cobrado_mes).toBe(0);

    central.registrarPago(id, { monto: pesos(1_500), metodo: "transferencia" });

    expect(central.resumen.cobrado_mes).toBe(pesos(1_500));
  });

  it("el pago deja constancia de hasta cuándo quedó cubierto el local", async () => {
    const id = (await alta()).cliente!.id;
    const licencia = (await central.emitir(id)).licencia!;

    const r = central.registrarPago(id, { monto: pesos(1_500), metodo: "efectivo" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pago.cubre_hasta_ts).toBe(licencia.vence_ts);
  });

  it("no admite un cobro de cero ni negativo", async () => {
    const id = (await alta()).cliente!.id;
    expect(central.registrarPago(id, { monto: 0 as never, metodo: "efectivo" }).ok).toBe(false);
    expect(central.registrarPago(id, { monto: -500 as never, metodo: "efectivo" }).ok).toBe(false);
  });

  it("un cobro mal anotado se puede borrar", async () => {
    const id = (await alta()).cliente!.id;
    const r = central.registrarPago(id, { monto: pesos(1_500), metodo: "efectivo" });

    central.borrarPago(id, r.ok ? r.pago.id : "");

    expect(central.clientes.find((c) => c.id === id)!.pagos).toHaveLength(0);
  });
});

describe("el cobro por resultado", () => {
  async function conAhorro(verificado = true) {
    const id = (await alta()).cliente!.id;
    const r = central.registrarResultado(id, {
      concepto: "Merma de masa medida durante un mes",
      ahorro: pesos(20_000),
      comision_pct: 15,
      verificado,
    });
    return { id, resultadoId: r.ok ? r.resultado.id : "" };
  }

  it("cobrar la comisión la marca cobrada y la mete en lo que entró", async () => {
    const { id, resultadoId } = await conAhorro();

    const r = central.cobrarResultado(id, resultadoId);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pago.monto).toBe(pesos(3_000));
    expect(central.resumen.cobrado_mes).toBe(pesos(3_000));
    expect(central.clientes.find((c) => c.id === id)!.resultados![0]!.cobrado).toBe(true);
    expect(central.resumen.por_cobrar_resultados).toBe(0);
  });

  /* Un ahorro que el restaurantero no reconoce no es dinero, es una discusión. */
  it("un ahorro sin verificar no se cobra", async () => {
    const { id, resultadoId } = await conAhorro(false);

    const r = central.cobrarResultado(id, resultadoId);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("sin verificar");
    expect(central.resumen.por_cobrar_resultados).toBe(0);

    central.verificarResultado(id, resultadoId);
    expect(central.resumen.por_cobrar_resultados).toBe(pesos(3_000));
  });

  it("la misma comisión no se cobra dos veces", async () => {
    const { id, resultadoId } = await conAhorro();
    central.cobrarResultado(id, resultadoId);

    const otra = central.cobrarResultado(id, resultadoId);

    expect(otra.ok).toBe(false);
    expect(central.clientes.find((c) => c.id === id)!.pagos).toHaveLength(1);
  });

  it("rechaza un resultado sin concepto, sin ahorro o con comisión imposible", async () => {
    const id = (await alta()).cliente!.id;
    const base = { concepto: "Merma medida", ahorro: pesos(1_000), comision_pct: 10 };

    expect(central.registrarResultado(id, { ...base, concepto: "x" }).ok).toBe(false);
    expect(central.registrarResultado(id, { ...base, ahorro: 0 as never }).ok).toBe(false);
    expect(central.registrarResultado(id, { ...base, comision_pct: 0 }).ok).toBe(false);
    expect(central.registrarResultado(id, { ...base, comision_pct: 130 }).ok).toBe(false);
  });
});

describe("la licencia se le manda sola al restaurante", () => {
  async function conRelay() {
    await central.guardarConfiguracion({
      repositorio: "r",
      relay_url: "https://relay.test",
      relay_clave_admin: "secreto123",
    });
    return (await alta()).cliente!.id;
  }

  /*
   * ES EL PUNTO DE TODO ESTO. Antes, cada renovación de cada local exigía que
   * alguien estuviera en esa caja pegando un JSON. Un restaurantero operando su
   * punto de venta a base de pegar código es un fallo de producto.
   */
  it("al renovar, la deposita en el relay y avisa de que llegó", async () => {
    const id = await conRelay();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, entregada: true }),
    });

    const r = await central.emitir(id);

    expect(r.ok).toBe(true);
    expect(r.entrega).toBe("entregada");
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("https://relay.test/licencia"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secreto123" }),
      }),
    );
  });

  /* Lo que viaja es la licencia firmada entera, con su firma: el relay no firma nada. */
  it("manda el documento firmado y su destinatario", async () => {
    const id = await conRelay();
    let enviado: { sucursal_id?: string; licencia?: { firma?: string } } = {};
    global.fetch = vi.fn().mockImplementation((_url, opciones) => {
      enviado = JSON.parse(String(opciones.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ entregada: true }) });
    });

    const r = await central.emitir(id);

    expect(enviado.sucursal_id).toBe(id);
    expect(enviado.licencia?.firma).toBe(r.licencia!.firma);
  });

  /* El local está apagado: la recogerá al encender, y hay que decirlo así. */
  it("con el local desconectado dice que queda en espera, no que llegó", async () => {
    const id = await conRelay();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, entregada: false }),
    });

    expect((await central.emitir(id)).entrega).toBe("en_espera");
  });

  /*
   * Si el reparto falla NO se pierde la licencia: está firmada y es válida. Se
   * degrada al camino de siempre —copiar y pegar— y se dice por qué.
   */
  it("si el relay no responde, la licencia sigue siendo válida y se pega a mano", async () => {
    const id = await conRelay();
    global.fetch = vi.fn().mockRejectedValue(new Error("sin red"));

    const r = await central.emitir(id);

    expect(r.ok).toBe(true);
    expect(r.entrega).toBe("a_mano");
    expect(r.motivoEntrega).toContain("relay");
    expect(await verificarLicencia(r.licencia!, id, central.secretos.licencias!.publica)).toBe(true);
    /* Y quedó guardada en la cartera igual que cualquier otra. */
    expect(central.clientes.find((c) => c.id === id)!.licencia).not.toBeNull();
  });

  it("sin relay configurado se comporta como siempre", async () => {
    const id = (await alta()).cliente!.id;
    const r = await central.emitir(id);

    expect(r.entrega).toBe("a_mano");
    expect(r.motivoEntrega).toContain("relay");
  });

  it("un rechazo del relay explica el motivo en vez de tragárselo", async () => {
    const id = await conRelay();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "suc-rodizio-centro no está en el padrón del relay" }),
    });

    const r = await central.emitir(id);

    expect(r.entrega).toBe("a_mano");
    expect(r.motivoEntrega).toContain("padrón");
  });

  it("cortar el servicio también viaja solo", async () => {
    const id = await conRelay();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, entregada: true }),
    });

    const r = await central.cortarServicio(id);

    expect(r.entrega).toBe("entregada");
    expect(r.licencia!.vence_ts).toBeLessThan(Date.now());
  });

  it("trae del relay las renovaciones que nadie ha recogido", async () => {
    await conRelay();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        pendientes: [{ sucursal_id: "suc-rodizio-centro", depositada_ts: 10, conectado: false }],
      }),
    });

    const r = await central.traerLicenciasPendientes();

    expect(r.ok).toBe(true);
    expect(central.licenciasPendientes).toHaveLength(1);
  });
});

describe("elegir la fecha de vencimiento", () => {
  /*
   * Lo que se negocia por teléfono: «te doy hasta el viernes», «alineamos tu
   * cobro al día 1». Antes la única fecha posible era «un mes más», así que
   * cualquier acuerdo distinto se quedaba en un apunte fuera del sistema.
   */
  it("emite hasta la fecha que se le pide, no la calculada", async () => {
    const id = (await alta()).cliente!.id;
    const viernes = Date.now() + 5 * 86_400_000;

    const r = await central.emitir(id, { vence_ts: viernes });

    expect(r.ok).toBe(true);
    expect(r.licencia!.vence_ts).toBe(viernes);
    expect(await verificarLicencia(r.licencia!, id, central.secretos.licencias!.publica)).toBe(true);
  });

  it("sin fecha sigue calculando el mes como siempre", async () => {
    const id = (await alta()).cliente!.id;
    const r = await central.emitir(id);

    const dias = (r.licencia!.vence_ts - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(27);
  });

  /*
   * La fecha acaba dentro de un documento firmado por MOTRAE, donde ya no se
   * corrige. Un 2126 por 2026 regalaría un siglo de servicio en silencio.
   */
  it("rechaza un año disparatado en vez de firmarlo", async () => {
    const id = (await alta()).cliente!.id;
    const dentroDeUnSiglo = new Date();
    dentroDeUnSiglo.setFullYear(dentroDeUnSiglo.getFullYear() + 100);

    const r = await central.emitir(id, { vence_ts: dentroDeUnSiglo.getTime() });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("años");
  });

  it("una fecha ya pasada manda a la acción de cortar, no emite", async () => {
    const id = (await alta()).cliente!.id;

    const r = await central.emitir(id, { vence_ts: Date.now() - 86_400_000 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Cortar el servicio");
  });

  it("la fecha elegida queda en el historial de emisiones", async () => {
    const id = (await alta()).cliente!.id;
    const viernes = Date.now() + 5 * 86_400_000;
    await central.emitir(id, { vence_ts: viernes });

    expect(central.clientes.find((c) => c.id === id)!.emisiones!.at(-1)!.vence_ts).toBe(viernes);
  });
});

describe("cortar el servicio", () => {
  /*
   * REGRESIÓN. `bloqueo_inmediato` NO vence una licencia: solo decide si, agotada
   * la gracia, se bloquea sin esperar a que cierre el turno abierto. Cortar
   * emitiendo con la fecha calculada normal alargaba la licencia un mes — lo
   * contrario exacto de lo que dice el botón.
   */
  it("deja la licencia vencida, no la alarga un mes", async () => {
    const id = (await alta()).cliente!.id;
    const antes = (await central.emitir(id)).licencia!;

    const r = await central.cortarServicio(id);

    expect(r.ok).toBe(true);
    expect(r.licencia!.vence_ts).toBeLessThan(Date.now());
    expect(r.licencia!.vence_ts).toBeLessThan(antes.vence_ts);
  });

  /* Con los tres días de siempre, «cortar» dejaría al local operando tres días más. */
  it("no le deja días de gracia", async () => {
    const id = (await alta()).cliente!.id;
    const r = await central.cortarServicio(id);

    expect(r.licencia!.gracia_dias).toBe(0);
    expect(r.licencia!.bloqueo_inmediato).toBe(true);
  });

  /* El Hub tiene que poder comprobar la firma: un corte sin firma válida no bloquea. */
  it("sale firmada y verificable en su local", async () => {
    const id = (await alta()).cliente!.id;
    const r = await central.cortarServicio(id);

    expect(await verificarLicencia(r.licencia!, id, central.secretos.licencias!.publica)).toBe(true);
  });

  it("queda anotado en el historial que fue un corte", async () => {
    const id = (await alta()).cliente!.id;
    await central.cortarServicio(id);

    const emisiones = central.clientes.find((c) => c.id === id)!.emisiones!;
    expect(emisiones.at(-1)!.bloqueo_inmediato).toBe(true);
  });
});

describe("el historial de licencias emitidas", () => {
  /*
   * `cliente.licencia` guarda solo la última, que es justo la que borra la
   * respuesta cuando un restaurantero discute qué se le emitió y cuándo.
   */
  it("guarda todas las emisiones, no solo la última", async () => {
    const id = (await alta()).cliente!.id;
    await central.emitir(id);
    await central.emitir(id);

    const emisiones = central.clientes.find((c) => c.id === id)!.emisiones!;
    expect(emisiones).toHaveLength(2);
    expect(emisiones[1]!.vence_ts).toBeGreaterThan(emisiones[0]!.vence_ts);
  });

  it("cada emisión recuerda la cuota que estaba vigente ese día", async () => {
    const id = (await alta()).cliente!.id;
    await central.emitir(id);
    central.editar(id, { cuota: pesos(2_200) });
    await central.emitir(id);

    const emisiones = central.clientes.find((c) => c.id === id)!.emisiones!;
    expect(emisiones[0]!.cuota).toBe(pesos(1_500));
    expect(emisiones[1]!.cuota).toBe(pesos(2_200));
  });
});

describe("emitir la licencia", () => {
  it("sin secreto de firma no emite nada", async () => {
    central = crearCentralParaPruebas();
    const id = (await alta()).cliente!.id;

    const r = await central.emitir(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("llave privada");
  });

  it("la emitida se verifica en SU local y en ningún otro", async () => {
    const id = (await alta()).cliente!.id;
    const r = await central.emitir(id);

    expect(r.ok).toBe(true);
    expect(await verificarLicencia(r.licencia!, id, central.secretos.licencias!.publica)).toBe(true);
    expect(await verificarLicencia(r.licencia!, "suc-otro", central.secretos.licencias!.publica)).toBe(false);
  });

  it("sale con los tres días de gracia", async () => {
    const id = (await alta()).cliente!.id;
    expect((await central.emitir(id)).licencia!.gracia_dias).toBe(3);
  });

  /*
   * EL ACCESO DE SOPORTE VIAJA DENTRO DE LA FIRMA. Es lo que hace que "Gonz
   * Motrae" exista en ese MotRest y lo que impide que el restaurante se fabrique
   * uno propio: sin la firma de MOTRAE, la licencia no vale.
   */
  it("lleva dentro la credencial de soporte, si está configurada", async () => {
    await central.fijarContrasenaSoporte("una-contrasena-larga-de-motrae");
    const id = (await alta()).cliente!.id;
    const licencia = (await central.emitir(id)).licencia!;

    expect(licencia.soporte).toBeDefined();
    expect(await verificarLicencia(licencia, id, central.secretos.licencias!.publica)).toBe(true);

    // Y el hash es de verdad el de la contraseña que puso Gonzalo.
    expect(
      await verificarCredencial("una-contrasena-larga-de-motrae", {
        empleado_id: "usr-motrae-soporte",
        tipo: "contrasena",
        algoritmo: "PBKDF2-SHA256",
        ...licencia.soporte!,
        creada_ts: licencia.emitida_ts,
      }),
    ).toBe(true);
  });

  /* Renovar cuenta desde el vencimiento anterior: pagar antes no regala días. */
  it("renovar suma sobre lo que quedaba, no sobre hoy", async () => {
    const id = (await alta()).cliente!.id;
    const primera = (await central.emitir(id)).licencia!;
    const segunda = (await central.emitir(id)).licencia!;

    expect(segunda.vence_ts).toBeGreaterThan(primera.vence_ts);
  });
});

describe("la contraseña de soporte", () => {
  /*
   * Esta contraseña abre TODOS los restaurantes. Un mínimo de PIN de caja aquí
   * sería indefendible.
   */
  it("no admite una contraseña corta", async () => {
    const r = await central.fijarContrasenaSoporte("corta123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("TODOS los restaurantes");
  });

  /* De un hash no se recupera la contraseña: ni esta máquina la tiene. */
  it("solo se guarda el hash, nunca la contraseña", async () => {
    await central.fijarContrasenaSoporte("una-contrasena-larga-de-motrae");
    const guardado = JSON.stringify(central.secretos.soporte);

    expect(guardado).not.toContain("una-contrasena-larga");
    expect(central.secretos.soporte!.iteraciones).toBe(600_000);
  });
});

describe("las llaves de Central", () => {
  it("no sobrescribe DPAPI mientras el almacén todavía está cargando", async () => {
    const sinCargar = new StoreCentral(false);

    const r = await sinCargar.generarPares();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("todavía está abriendo");
    expect(sinCargar.secretos.licencias).toBeUndefined();
  });

  it("genera pares distintos y solo expone sus públicas a la interfaz", () => {
    expect(central.secretos.licencias?.publica).toBeTruthy();
    expect(central.secretos.publicacion?.publica).toBeTruthy();
    expect(central.secretos.licencias?.publica).not.toBe(central.secretos.publicacion?.publica);
    expect(JSON.stringify(central.secretos)).not.toContain("privada");
  });

  it("firma publicaciones con un publicado_ts monótono, aunque el reloj no avance", async () => {
    const datos = {
      version: "1.5.0",
      notas: "Arregla un detalle de seguridad.",
      url: "https://github.com/motrae/motrest/releases/download/v1.5.0/MotRest_setup.exe",
      sha256: "a".repeat(64),
      version_minima_soportada: "1.4.2",
    };
    const primero = await central.firmarActualizacion(datos, 1_000);
    const segundo = await central.firmarActualizacion({ ...datos, version: "1.5.1" }, 1_000);

    expect(primero.ok).toBe(true);
    expect(segundo.ok).toBe(true);
    if (!primero.ok || !segundo.ok) return;
    expect(segundo.manifiesto!.publicado_ts).toBeGreaterThan(primero.manifiesto!.publicado_ts);
    expect(
      await verificarVersion(primero.manifiesto!, central.secretos.publicacion!.publica),
    ).toBe(true);
  });

  it("no firma dos manifiestos a la vez con la misma marca de publicación", async () => {
    const datos = {
      version: "1.5.0",
      notas: "Arregla un detalle de seguridad.",
      url: "https://github.com/motrae/motrest/releases/download/v1.5.0/MotRest_setup.exe",
      sha256: "a".repeat(64),
    };

    const [primero, segundo] = await Promise.all([
      central.firmarActualizacion(datos, 1_000),
      central.firmarActualizacion({ ...datos, version: "1.5.1" }, 1_000),
    ]);

    expect([primero.ok, segundo.ok].filter(Boolean)).toHaveLength(1);
    const rechazado = primero.ok ? segundo : primero;
    if (!rechazado.ok) expect(rechazado.error).toContain("en proceso de firma");
  });
});

describe("respaldar la cartera", () => {
  /*
   * Este archivo se manda por correo sin pensarlo. No puede llevar dentro la
   * llave que firma las actualizaciones de todos los restaurantes.
   */
  it("el respaldo NO lleva los secretos", async () => {
    await central.fijarContrasenaSoporte("una-contrasena-larga-de-motrae");
    await alta();

    const json = central.exportar();
    expect(json).toContain("Rodizio");
    expect(json).not.toContain(central.secretos.licencias!.publica);
    expect(json).not.toContain(central.secretos.soporte!.hash);
  });

  it("lo exportado se puede volver a importar", async () => {
    await alta();
    const copia = central.exportar();
    central.clientes = [];

    expect(central.importar(copia).ok).toBe(true);
    expect(central.clientes).toHaveLength(1);
  });

  it("un archivo que no es una cartera se rechaza sin romper nada", async () => {
    await alta();
    expect(central.importar("{{{").ok).toBe(false);
    expect(central.importar('{"otra":"cosa"}').ok).toBe(false);
    expect(central.clientes).toHaveLength(1);
  });
});

describe("los pulsos de los Hubs", () => {
  /* Un Hub que reintentó manda el pulso dos veces: se queda el último. */
  it("solo se guarda el último de cada local", async () => {
    const id = (await alta()).cliente!.id;
    central.recibirPulso({ sucursal_id: id, ts: 1_000, version: "1.3.0" });
    central.recibirPulso({ sucursal_id: id, ts: 2_000, version: "1.4.0" });

    expect(central.pulsos).toHaveLength(1);
    expect(central.pulsoDe(id)!.version).toBe("1.4.0");
  });

  /*
   * El pulso dice cómo está hoy; el historial contesta «¿desde cuándo?». Son dos
   * cosas distintas y por eso se guardan aparte: uno se sustituye entero en cada
   * consulta, el otro solo crece.
   */
  it("además del último, guarda la historia del local", async () => {
    const id = (await alta()).cliente!.id;
    central.recibirPulso({ sucursal_id: id, ts: 1_000, version: "1.3.0" });
    central.recibirPulso({ sucursal_id: id, ts: 2_000, version: "1.4.0" });

    expect(central.pulsos).toHaveLength(1);
    expect(central.historiaDe(id).partes).toBe(2);
    expect(central.historiaDe(id).versiones.map((v) => v.version)).toEqual(["1.4.0", "1.3.0"]);
  });

  /*
   * Central pregunta cada diez minutos y el Hub reporta una vez al día: casi
   * todas las consultas devuelven el mismo parte. Sin deduplicar, una tarde
   * llenaría el historial de copias del último.
   */
  it("consultar cien veces el mismo parte no lo guarda cien veces", async () => {
    const id = (await alta()).cliente!.id;
    for (let i = 0; i < 100; i++) {
      central.recibirPulso({ sucursal_id: id, ts: 1_000, version: "1.3.0" });
    }

    expect(central.historiaDe(id).partes).toBe(1);
  });

  it("la historia viaja en el respaldo de la cartera", async () => {
    const id = (await alta()).cliente!.id;
    central.recibirPulso({ sucursal_id: id, ts: 1_000, version: "1.3.0" });

    const copia = central.exportar();
    central.historial = {};

    expect(central.importar(copia).ok).toBe(true);
    expect(central.historiaDe(id).partes).toBe(1);
  });
});

describe("vigilar el anillo después de publicar", () => {
  const VERSION = {
    version: "1.5.0",
    notas: "Arregla un detalle.",
    url: "https://github.com/motrae/motrest/releases/download/v1.5.0/MotRest_setup.exe",
    sha256: "a".repeat(64),
  };

  it("sin haber publicado nada no inventa un despliegue", () => {
    expect(central.adopcion).toBeNull();
  });

  /*
   * Antes de firmar se veía a quién le iba a tocar; después de firmar, nada. Un
   * anillo que nadie mira es el mismo «publicar y rezar», solo que más despacio.
   */
  it("después de firmar dice quién ya subió y quién se quedó atrás", async () => {
    const rodizio = (await alta("Rodizio")).cliente!.id;
    const fonda = (await alta("La Fonda")).cliente!.id;
    await central.firmarActualizacion(VERSION);

    central.recibirPulso({ sucursal_id: rodizio, ts: 2_000, version: "1.5.0" });
    central.recibirPulso({ sucursal_id: fonda, ts: 2_000, version: "1.4.0" });

    const adopcion = central.adopcion!;
    expect(adopcion.version).toBe("1.5.0");
    expect(adopcion.actualizados.map((c) => c.id)).toEqual([rodizio]);
    expect(adopcion.rezagados[0]).toMatchObject({ version: "1.4.0" });
    expect(adopcion.avance_pct).toBe(50);
  });

  it("con anillo, solo vigila a los que les tocaba", async () => {
    await alta("Rodizio");
    await alta("La Fonda");
    await central.firmarActualizacion({ ...VERSION, anillo: 1 });

    const adopcion = central.adopcion!;
    expect(adopcion.esperados.length).toBeLessThan(central.activos.length);
  });
});

describe("la salud del propio relay", () => {
  /*
   * Si el relay se cae, lo que se veía aquí era «todos los locales llevan horas
   * sin reportar» — que se lee como avería masiva cuando en realidad todos están
   * vendiendo. Saber que el caído es el relay cambia a quién hay que llamar.
   */
  it("trae cuántos Hubs están conectados ahora mismo", async () => {
    await central.guardarConfiguracion({
      repositorio: "r",
      relay_url: "https://relay.test",
      relay_clave_admin: "secreto123",
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ restaurantes: 4, hubs_conectados: 3, pulsos: 4 }),
    });

    expect((await central.traerSaludRelay()).ok).toBe(true);
    expect(central.saludRelay).toMatchObject({ restaurantes: 4, hubs_conectados: 3 });
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("https://relay.test/salud/detalle"),
      expect.objectContaining({ headers: { authorization: "Bearer secreto123" } }),
    );
  });

  it("un relay que no contesta deja el parte en blanco, no en cifras viejas", async () => {
    await central.guardarConfiguracion({
      repositorio: "r",
      relay_url: "https://relay.test",
      relay_clave_admin: "secreto123",
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ restaurantes: 4, hubs_conectados: 3, pulsos: 4 }),
    });
    await central.traerSaludRelay();

    global.fetch = vi.fn().mockRejectedValue(new Error("sin red"));
    expect((await central.traerSaludRelay()).ok).toBe(false);
    expect(central.saludRelay).toBeNull();
  });
});

describe("rotar la contraseña de soporte", () => {
  /*
   * La contraseña va firmada DENTRO de la licencia: cambiarla aquí no cambia
   * nada en ningún restaurante hasta reemitir. Antes había que reemitir a ciegas
   * y confiar en que no faltaba ninguno.
   */
  it("dice qué locales siguen aceptando la contraseña anterior", async () => {
    const id = (await alta()).cliente!.id;
    await central.emitir(id);
    expect(central.localesConSoportePendiente).toHaveLength(0);

    await central.fijarContrasenaSoporte("una-contrasena-larga-de-motrae");

    expect(central.localesConSoportePendiente.map((c) => c.id)).toEqual([id]);

    await central.emitir(id);
    expect(central.localesConSoportePendiente).toHaveLength(0);
  });

  it("sin contraseña de soporte configurada no señala a nadie", async () => {
    await alta();
    expect(central.localesConSoportePendiente).toHaveLength(0);
  });
});

describe("el respaldo que sobrevive a esta computadora", () => {
  /*
   * El respaldo DPAPI solo abre en este mismo perfil de Windows. Si la máquina
   * se pierde, con ella se va la llave que firma licencias y actualizaciones de
   * TODOS los restaurantes, y no se puede regenerar.
   */
  it("se cierra con contraseña y se vuelve a abrir en otra Central", async () => {
    const publicaOriginal = central.secretos.licencias!.publica;
    const r = await central.respaldoPortatil("una-contrasena-larga-de-motrae");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const otra = crearCentralParaPruebas();
    expect(otra.configurado).toBe(false);

    const restaurado = await otra.restaurarPortatil(r.respaldo, "una-contrasena-larga-de-motrae");

    expect(restaurado.ok).toBe(true);
    expect(otra.configurado).toBe(true);
    expect(otra.secretos.licencias!.publica).toBe(publicaOriginal);
  });

  it("el archivo no lleva ninguna privada legible", async () => {
    const r = await central.respaldoPortatil("una-contrasena-larga-de-motrae");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.respaldo).not.toContain("privada");
    expect(r.respaldo).not.toContain(central.secretos.licencias!.publica);
  });

  it("con la contraseña equivocada no restaura nada", async () => {
    const r = await central.respaldoPortatil("una-contrasena-larga-de-motrae");
    if (!r.ok) return;

    const otra = crearCentralParaPruebas();
    const fallo = await otra.restaurarPortatil(r.respaldo, "otra-contrasena-larguisima");

    expect(fallo.ok).toBe(false);
    expect(otra.configurado).toBe(false);
  });

  it("una contraseña corta no protege la firma de toda la cartera", async () => {
    const r = await central.respaldoPortatil("corta");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("16");
  });

  /*
   * Anotar la fecha antes de cerrar el cofre haría que Central dijera
   * «respaldado hoy» después de un intento fallido: la peor forma posible de
   * perder unas llaves.
   */
  it("un respaldo que falló no cuenta como respaldo hecho", async () => {
    expect(central.respaldoAlDia).toBe(false);

    await central.respaldoPortatil("corta");
    expect(central.respaldoAlDia).toBe(false);

    await central.respaldoPortatil("una-contrasena-larga-de-motrae");
    expect(central.respaldoAlDia).toBe(true);
  });

  it("un archivo que no es un respaldo se rechaza sin romper las llaves", async () => {
    expect((await central.restaurarPortatil("{{{", "una-contrasena-larga-de-motrae")).ok).toBe(false);
    expect(central.configurado).toBe(true);
  });
});

describe("anillos de despliegue", () => {
  it("asigna un orden de despliegue estable", async () => {
    const id1 = (await alta("Local 1")).cliente!.id;
    const id2 = (await alta("Local 2")).cliente!.id;
    const orden = central.ordenDeDespliegue;

    expect(orden).toHaveLength(2);
    // El orden depende de los IDs pero es determinista
    const orden2 = central.ordenDeDespliegue;
    expect(orden.map(o => o.cliente.id)).toEqual(orden2.map(o => o.cliente.id));
  });

  it("calcula correctamente quién entra en cada anillo", async () => {
    await alta("Local 1");
    await alta("Local 2");
    
    // Con 100% todos entran
    const alcanzados = central.localesEnElAnillo(100);
    expect(alcanzados).toHaveLength(2);

    // Con anillo no definido, es como 100% pero la UI avisa
    const sinAnillo = central.localesEnElAnillo(undefined);
    expect(sinAnillo).toHaveLength(2);
  });
});

describe("traerPulsos", () => {
  it("falla si no hay configuración del relay", async () => {
    const r = await central.traerPulsos();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Falta la dirección");
  });

  it("llama al fetch con autorización y actualiza los pulsos", async () => {
    await central.guardarConfiguracion({
      repositorio: "r",
      relay_url: "https://relay.test",
      relay_clave_admin: "secreto123"
    });

    const id = (await alta()).cliente!.id;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        pulsos: [{ sucursal_id: id, ts: 9999, version: "2.0.0" }]
      })
    });

    const r = await central.traerPulsos();
    expect(r.ok).toBe(true);
    expect(central.ultimaConsultaPulsos).not.toBeNull();
    expect(central.errorPulsos).toBe("");
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("https://relay.test/pulsos"),
      expect.objectContaining({
        headers: { authorization: "Bearer secreto123" }
      })
    );

    expect(central.pulsoDe(id)!.version).toBe("2.0.0");
  });

  /*
   * El sondeo automático corre en paralelo con el botón de refrescar. Dos
   * consultas a la vez traen exactamente lo mismo: la segunda solo gasta.
   */
  it("no consulta el relay dos veces a la vez", async () => {
    await central.guardarConfiguracion({
      repositorio: "r",
      relay_url: "https://relay.test",
      relay_clave_admin: "secreto123",
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pulsos: [] }),
    });

    const [primera, segunda] = await Promise.all([
      central.traerPulsos(),
      central.traerPulsos(),
    ]);

    expect([primera.ok, segunda.ok].filter(Boolean)).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  /* Un relay caído tiene que verse en la pantalla, no quedarse en un `return`. */
  it("un fallo del relay queda a la vista y no borra la última consulta buena", async () => {
    await central.guardarConfiguracion({
      repositorio: "r",
      relay_url: "https://relay.test",
      relay_clave_admin: "secreto123",
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const r = await central.traerPulsos();

    expect(r.ok).toBe(false);
    expect(central.errorPulsos).toContain("500");
    expect(central.consultandoPulsos).toBe(false);
  });
});

describe("publicar una version en la nube", () => {
  it("la llave de servicio NUNCA sale en la vista publica de secretos", async () => {
    await central.guardarConfiguracion({
      repositorio: "motrae/motrest",
      nube_url: "https://ejemplo.supabase.co",
      nube_servicio: "llave-de-servicio-que-se-salta-todo",
    });

    /*
     * `central.secretos` se lee sin desproteger nada, y esta llave se salta
     * TODAS las políticas RLS: quien la tenga lee el padrón entero de MOTRAE.
     * La dirección sí puede verse —la interfaz necesita saber si ya hay algo
     * configurado—, la llave no.
     */
    expect(central.secretos.nube_url).toBe("https://ejemplo.supabase.co");
    expect(JSON.stringify(central.secretos)).not.toContain("llave-de-servicio");
  });

  it("no acepta una nube en http, que dejaria la llave en claro", async () => {
    const resultado = await central.guardarConfiguracion({
      repositorio: "motrae/motrest",
      nube_url: "http://ejemplo.supabase.co",
    });
    expect(resultado.ok).toBe(false);
  });

  it("manda el manifiesto TAL CUAL, no reconstruido desde columnas", async () => {
    await central.guardarConfiguracion({
      repositorio: "motrae/motrest",
      nube_url: "https://ejemplo.supabase.co",
      nube_servicio: "llave",
    });

    const cuerpos: string[] = [];
    global.fetch = vi.fn(async (_u: unknown, opciones: { body?: string } = {}) => {
      cuerpos.push(String(opciones.body));
      return { ok: true, text: async () => "" } as Response;
    }) as unknown as typeof fetch;

    const manifiesto = {
      version: "1.4.0",
      notas: "Los cortes salen mas rapido.",
      url: "https://ejemplo.supabase.co/storage/v1/object/instaladores/1.4.0.exe",
      sha256: "a".repeat(64),
      publicado_ts: 1_786_048_000_000,
      firma: "la-firma-de-motrae",
    };

    const resultado = await central.publicarEnLaNube(manifiesto, { canal: "beta" });
    expect(resultado.ok).toBe(true);

    /*
     * La firma cubre el JSON canónico entero. Si la nube guardara columnas y el
     * Hub rearmara el documento, cualquier diferencia de forma lo invalidaría —
     * y el síntoma sería "una firma que no es de MOTRAE" en cada local, con el
     * canal parado y sin causa aparente.
     */
    const enviado = JSON.parse(cuerpos[0]!);
    expect(enviado.manifiesto).toEqual(manifiesto);
  });

  it("sin locales elegidos publica la version pero no se la ofrece a nadie", async () => {
    await central.guardarConfiguracion({
      repositorio: "motrae/motrest",
      nube_url: "https://ejemplo.supabase.co",
      nube_servicio: "llave",
    });

    const rutas: string[] = [];
    global.fetch = vi.fn(async (u: unknown) => {
      rutas.push(String(u));
      return { ok: true, text: async () => "" } as Response;
    }) as unknown as typeof fetch;

    await central.publicarEnLaNube(
      {
        version: "1.4.0", notas: "n", url: "https://x.supabase.co/a.exe",
        sha256: "b".repeat(64), publicado_ts: 1, firma: "f",
      },
      { canal: "estable" },
    );

    // Publicar y asignar son dos decisiones. Juntarlas es como se acaba mandando
    // una version a toda la flota por un clic de mas.
    expect(rutas.some((r) => r.includes("/versiones"))).toBe(true);
    expect(rutas.some((r) => r.includes("/asignaciones"))).toBe(false);
  });
});
