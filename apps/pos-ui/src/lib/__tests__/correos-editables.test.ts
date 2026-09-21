/**
 * Los correos que escribe el restaurante, desde la caja (1.5.6).
 *
 * ## Lo que pidió Gonzalo
 *
 * «Quiero que los correos se puedan editar, que estén las versiones ejemplo,
 * que son las que ya están, y aparte agregarles un botón editar a cada uno […].
 * Además quiero que se puedan agregar qué clase de correos se van a enviar, no
 * solo los que ya están armados, y que estos ya vengan predispuestos».
 *
 * Y una decisión suya: los correos NUEVOS son siempre publicidad. Solo llegan a
 * quien aceptó promociones en su ficha, y siempre llevan su baja.
 *
 * Lo que se prueba aquí es la mitad de la caja: que lo editado se guarde, se
 * publique y sea lo que sale; que «Volver al ejemplo» devuelva el de fábrica;
 * que un correo nuevo no se guarde con huecos ni con un enlace que no sea
 * https; y que en «Mandar correo» solo aparezca —y solo se pueda pedir— para
 * quien aceptó promociones. La otra mitad, que el Hub lo rechace si ya se
 * borró, está en `apps/hub/src/__tests__/solicitudes-de-correo.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARRANQUES_DE_CORREO,
  TOPES_CORREO,
  armarCorreo,
  type BorradorDeCorreo,
  type ConfiguracionCorreo,
  type EventoCorreo,
} from "@motrest/dominio";
import { almacenEnMemoria } from "@motrest/protocolo-sync";
import { CLAVE_CORREO, StoreCorreo, type ConfiguracionPublicable } from "../correo.svelte";
import {
  PARA_DE_EJEMPLO,
  TIPO_EN_BORRADOR,
  borradorDe,
  borradorDelEjemplo,
  configConBorrador,
  datosDeEjemplo,
  opcionesDeCorreo,
} from "../correos-del-comensal";

const REMITENTE = "Rodizio <rodizio.gdl@gmail.com>";
const ANA = "ana@correo.mx";
const AHORA = new Date("2026-09-18T12:00:00").getTime();

/** Un almacén listo para mandar, con quien publica cada cambio. */
async function listo() {
  const store = new StoreCorreo();
  const almacen = almacenEnMemoria();
  await store.hidratar(almacen);
  const publicadas: ConfiguracionPublicable[] = [];
  store.alPublicar((c) => publicadas.push(c));
  store.actualizar({ remitente: REMITENTE, local: "Rodizio" });
  for (const tipo of ["gracias", "cupon"] as const) store.alternar(tipo);
  store.actuarComo("usr-lucia");
  return { store, almacen, publicadas };
}

/** Un arranque con sus huecos llenos, como lo dejaría el restaurantero. */
function eventoLleno(cambios: Partial<BorradorDeCorreo> = {}): BorradorDeCorreo {
  const evento = ARRANQUES_DE_CORREO.find((a) => a.id === "evento")!;
  return {
    ...evento.borrador,
    texto: evento.borrador.texto
      .replace("[día]", "viernes 3 de octubre")
      .replace("[hora]", "las 20:00")
      .replace("[qué habrá esa noche]", "música en vivo y un menú italiano"),
    ...cambios,
  };
}

describe("editar uno de los seis", () => {
  it("se abre con TODO escrito: el ejemplo, no campos vacíos", async () => {
    const { store } = await listo();
    const b = borradorDe("reserva_confirmada", store.config)!;
    expect(b.asunto).toBe("Su reserva en {{local}} quedó confirmada");
    expect(b.titulo).toBe("{{local}}");
    expect(b.texto).toContain("Su reserva en {{local}} quedó confirmada.");
  });

  it("guarda solo lo que cambió, lo publica, y es lo que sale", async () => {
    const { store, almacen, publicadas } = await listo();
    const antes = publicadas.length;

    const b = borradorDe("gracias", store.config)!;
    const r = store.guardarPlantilla("gracias", {
      ...b,
      asunto: "Gracias, {{nombre}}",
      texto: "Fue un gusto tenerlo en {{local}}.\n\nVuelva pronto.",
    });
    expect(r.ok).toBe(true);

    // El título se quedó como el ejemplo: no se escribe una copia.
    expect(store.config.plantillas?.gracias).toEqual({
      texto: "Fue un gusto tenerlo en {{local}}.\n\nVuelva pronto.",
    });
    // El asunto, donde siempre: un Hub de la 1.5.5 también lo lee ahí.
    expect(store.config.asuntos?.gracias).toBe("Gracias, {{nombre}}");

    // Viaja: una publicación más, con versión mayor y con la plantilla dentro.
    expect(publicadas).toHaveLength(antes + 1);
    const ultima = publicadas.at(-1)!;
    expect(ultima.version).toBeGreaterThan(publicadas[antes - 1]!.version);
    expect(ultima.plantillas?.gracias?.texto).toContain("Fue un gusto");

    // Y queda en el disco de la terminal.
    const guardada = await almacen.estado.cargar<ConfiguracionCorreo>(CLAVE_CORREO);
    expect(guardada?.plantillas?.gracias?.texto).toContain("Fue un gusto");

    const c = armarCorreo("gracias", ANA, store.config, { nombre: "Ana" });
    expect(c.asunto).toBe("Gracias, Ana");
    expect(c.html).toContain("Fue un gusto tenerlo en <b>Rodizio</b>.");
    expect(c.html).not.toContain("Lo esperamos pronto");
  });

  it("«Volver al ejemplo» y guardar deja el de fábrica, sin copia congelada", async () => {
    const { store } = await listo();
    store.guardarPlantilla("gracias", {
      asunto: "Gracias, {{nombre}}",
      titulo: "¡Gracias!",
      texto: "Otro texto.",
    });
    expect(store.config.plantillas?.gracias).toBeDefined();

    const r = store.guardarPlantilla("gracias", borradorDelEjemplo("gracias"));
    expect(r.ok).toBe(true);
    expect(store.config.plantillas?.gracias).toBeUndefined();
    expect(store.config.asuntos?.gracias).toBeUndefined();

    const c = armarCorreo("gracias", ANA, store.config, { nombre: "Ana" });
    expect(c.asunto).toBe("Gracias por su visita a Rodizio");
    expect(c.html).toContain("Gracias por venir a <b>Rodizio</b>. Lo esperamos pronto.");
  });

  it("no guarda un dato que no aplica, ni un texto de más: y no toca nada", async () => {
    const { store, publicadas } = await listo();
    const version = store.config.version;
    const antes = publicadas.length;

    const r = store.guardarPlantilla("gracias", {
      asunto: "Su reserva del {{cuando}}",
      titulo: "",
      texto: "a".repeat(TOPES_CORREO.texto + 1),
    });
    expect(r.ok).toBe(false);
    expect(r.problemas?.map((p) => p.campo)).toEqual(["asunto", "texto"]);
    expect(store.config.version).toBe(version);
    expect(publicadas).toHaveLength(antes);
  });

  /*
   * El cupón de fábrica pide el mensaje al mandarlo. Si el restaurante lo deja
   * escrito, ya no: exigirlo frenaría un envío por un texto que no sale.
   */
  it("un cupón que el restaurante dejó escrito ya no pide mensaje al mandarlo", async () => {
    const { store } = await listo();
    const sinEscribir = store.solicitar("cupon", ANA, {}, { acepta_marketing: true });
    expect(sinEscribir).toEqual({ ok: false, error: "Escribe el mensaje antes de mandarlo" });

    store.guardarPlantilla("cupon", {
      ...borradorDe("cupon", store.config)!,
      texto: "Esta semana, 2×1 en pizzas medianas.",
    });
    expect(store.solicitar("cupon", ANA, {}, { acepta_marketing: true }).ok).toBe(true);
  });
});

describe("un correo nuevo", () => {
  /*
   * Nace de un ejemplo YA ESCRITO, pero lo que va entre corchetes lo sabe solo
   * el restaurante: un «el [día] a las [hora]» que llega a la clientela es peor
   * que no mandar nada.
   */
  it("no se guarda con los huecos del ejemplo sin llenar", async () => {
    const { store } = await listo();
    const evento = ARRANQUES_DE_CORREO.find((a) => a.id === "evento")!;
    const r = store.crearPropio(evento.borrador, evento.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("corchetes");
    expect(store.propios).toHaveLength(0);
  });

  it("lleno, se crea encendido, con su nombre y de qué ejemplo salió", async () => {
    const { store, publicadas } = await listo();
    const r = store.crearPropio(eventoLleno(), "evento");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.tipo).toMatch(/^propio:/);
    const [creado] = store.propios;
    expect(creado).toMatchObject({ tipo: r.tipo, nombre: "Evento especial", activo: true, arranque: "evento" });
    // Sin campos vacíos guardados: un botón en blanco no es un botón.
    expect("boton" in creado!).toBe(false);
    expect("enlace" in creado!).toBe(false);
    expect(publicadas.at(-1)!.propios).toHaveLength(1);
    expect(store.catalogo.at(-1)!.etiqueta).toBe("Evento especial");
  });

  it("el enlace de su botón solo puede ser https", async () => {
    const { store } = await listo();
    const conHttp = store.crearPropio(eventoLleno({ boton: "Apartar", enlace: "http://rodizio.mx/noche" }));
    expect(conHttp.ok).toBe(false);
    if (!conHttp.ok) expect(conHttp.error).toContain("https://");

    const conJs = store.crearPropio(eventoLleno({ boton: "Apartar", enlace: "javascript:alert(1)" }));
    expect(conJs.ok).toBe(false);

    const bien = store.crearPropio(eventoLleno({ boton: "Apartar", enlace: "https://rodizio.mx/noche" }));
    expect(bien.ok).toBe(true);
    expect(store.propios).toHaveLength(1);
  });

  it(`caben ${TOPES_CORREO.propios}, y ni uno más`, async () => {
    const { store } = await listo();
    for (let i = 0; i < TOPES_CORREO.propios; i++) {
      expect(store.crearPropio(eventoLleno({ nombre: `Evento ${i}` })).ok).toBe(true);
    }
    expect(store.cabeOtro).toBe(false);
    const r = store.crearPropio(eventoLleno({ nombre: "Uno más" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("borra uno");
  });

  it("editarlo conserva si estaba apagado; apagarlo y encenderlo viaja igual", async () => {
    const { store } = await listo();
    const r = store.crearPropio(eventoLleno());
    if (!r.ok) throw new Error(r.error);

    store.alternar(r.tipo);
    expect(store.encendido(r.tipo)).toBe(false);

    const g = store.guardarPropio(r.tipo, { ...borradorDe(r.tipo, store.config)!, nombre: "Noche italiana" });
    expect(g.ok).toBe(true);
    expect(store.propios[0]).toMatchObject({ nombre: "Noche italiana", activo: false });
  });

  it("otra terminal lo recibe con la configuración, igual que los seis editados", async () => {
    const { store } = await listo();
    const r = store.crearPropio(eventoLleno());
    if (!r.ok) throw new Error(r.error);
    store.guardarPlantilla("gracias", { ...borradorDe("gracias", store.config)!, texto: "¡Gracias!" });

    const tableta = new StoreCorreo();
    expect(tableta.fusionar(store.paraPublicar)).toBe(true);
    expect(tableta.propios.map((p) => p.tipo)).toEqual([r.tipo]);
    expect(tableta.config.plantillas?.gracias?.texto).toBe("¡Gracias!");
  });
});

/**
 * LA REGLA DE GONZALO: los correos nuevos solo le llegan a quien aceptó
 * promociones. En la ficha, ni se ofrecen a quien no; y si una pantalla vieja
 * lo pidiera igual, la misma puerta del dominio lo frena antes de anotarlo.
 */
describe("mandar un correo nuevo desde la ficha", () => {
  async function conEvento() {
    const listoYa = await listo();
    const r = listoYa.store.crearPropio(eventoLleno());
    if (!r.ok) throw new Error(r.error);
    return { ...listoYa, tipo: r.tipo };
  }

  it("a quien no aceptó promociones se le enseña en gris, con su motivo, y no se puede mandar", async () => {
    const { store, tipo } = await conEvento();

    const sinPermiso = opcionesDeCorreo(store.config, { correo: ANA, aceptaPromociones: false, ahora: AHORA });
    expect(sinPermiso.find((o) => o.def.tipo === tipo)).toMatchObject({
      puede: false,
      razon: "Esta persona no aceptó recibir promociones",
    });
    // Los seis de siempre, más el suyo.
    expect(sinPermiso).toHaveLength(7);

    const conPermiso = opcionesDeCorreo(store.config, { correo: ANA, aceptaPromociones: true, ahora: AHORA });
    const opcion = conPermiso.find((o) => o.def.tipo === tipo);
    expect(opcion).toMatchObject({ puede: true });
    expect(opcion!.def.etiqueta).toBe("Evento especial");
    expect(opcion!.def.clase).toBe("marketing");
  });

  it("apagado deja de ofrecerse", async () => {
    const { store, tipo } = await conEvento();
    store.alternar(tipo);
    const opciones = opcionesDeCorreo(store.config, { correo: ANA, aceptaPromociones: true, ahora: AHORA });
    expect(opciones.map((o) => o.def.tipo)).not.toContain(tipo);
  });

  it("sin permiso no se pide; con permiso se anota con su tipo, a nombre de quien lo pidió", async () => {
    const { store, almacen, tipo } = await conEvento();

    const sin = store.solicitar(tipo, ANA, { nombre: "Ana" }, { cliente_id: "cli-ana", acepta_marketing: false });
    expect(sin).toEqual({ ok: false, error: "Esta persona no aceptó recibir promociones" });

    const con = store.solicitar(tipo, ANA, { nombre: "Ana" }, { cliente_id: "cli-ana", acepta_marketing: true });
    expect(con.ok).toBe(true);

    const eventos = (await almacen.eventos.leerTodos()) as EventoCorreo[];
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: "correo_solicitado",
      clase_correo: tipo,
      acepta_marketing: true,
      empleado_id: "usr-lucia",
    });
  });

  it("lo que se arma lleva siempre la baja", async () => {
    const { store, tipo } = await conEvento();
    const c = armarCorreo(tipo, ANA, store.config, { nombre: "Ana" });
    expect(c.html).toContain("música en vivo y un menú italiano");
    expect(c.html).toContain("responda <b>BAJA</b>");
    expect(c.texto).toContain("responda BAJA");
  });

  it("la «Promoción del día» pide su mensaje cada vez", async () => {
    const { store } = await listo();
    const promo = ARRANQUES_DE_CORREO.find((a) => a.id === "promocion-del-dia")!;
    const r = store.crearPropio(promo.borrador, promo.id);
    if (!r.ok) throw new Error(r.error);

    expect(store.solicitar(r.tipo, ANA, {}, { acepta_marketing: true })).toEqual({
      ok: false,
      error: "Escribe el mensaje antes de mandarlo",
    });
    expect(store.solicitar(r.tipo, ANA, { mensaje: "Lasaña al 2×1" }, { acepta_marketing: true }).ok).toBe(true);
  });

  it("borrado, deja de ofrecerse y ya no se puede pedir", async () => {
    const { store, tipo } = await conEvento();
    store.borrarPropio(tipo);

    expect(store.propios).toHaveLength(0);
    const opciones = opcionesDeCorreo(store.config, { correo: ANA, aceptaPromociones: true, ahora: AHORA });
    expect(opciones.map((o) => o.def.tipo)).not.toContain(tipo);

    const r = store.solicitar(tipo, ANA, {}, { acepta_marketing: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ya no existe");
  });
});

/**
 * LA VISTA PREVIA DEL EDITOR sale de `armarCorreo` con la configuración como
 * quedaría: lo que se ve mientras se escribe es lo que va a llegar.
 */
describe("la vista previa del editor", () => {
  it("enseña lo que se está escribiendo de uno de los seis, sin guardarlo", async () => {
    const { store } = await listo();
    const borrador = { ...borradorDe("gracias", store.config)!, texto: "Nos vemos pronto, {{nombre}}." };
    const previa = configConBorrador(store.config, "gracias", borrador);

    const c = armarCorreo("gracias", PARA_DE_EJEMPLO, previa, datosDeEjemplo("gracias"));
    expect(c.html).toContain("Nos vemos pronto, Ana Ruiz.");
    // Nada se guardó.
    expect(store.config.plantillas?.gracias).toBeUndefined();
  });

  it("enseña un correo nuevo antes de crearlo, con su baja", async () => {
    const { store } = await listo();
    const previa = configConBorrador(store.config, TIPO_EN_BORRADOR, eventoLleno());
    const c = armarCorreo(TIPO_EN_BORRADOR, PARA_DE_EJEMPLO, previa, datosDeEjemplo(TIPO_EN_BORRADOR));
    expect(c.html).toContain("Lo invitamos a una noche especial");
    expect(c.html).toContain("responda <b>BAJA</b>");
    expect(store.propios).toHaveLength(0);
  });

  it("la promoción del día se ve con un mensaje de ejemplo, no vacía", () => {
    expect(datosDeEjemplo(TIPO_EN_BORRADOR).mensaje).toBeTruthy();
  });
});

/*
 * El cable, contra los archivos de verdad: la pantalla sigue la regla de Gonzalo
 * de llevar la vista a lo que se abre fuera de cuadro, y el envío pide mensaje
 * según la plantilla y no según la clase.
 */
describe("las pantallas", () => {
  const pantalla = readFileSync(new URL("../modulos/clientes/Correos.svelte", import.meta.url), "utf8");
  const envio = readFileSync(new URL("../EnvioCorreo.svelte", import.meta.url), "utf8");

  it("«Correos al comensal» usa subir.ts y no un scroll a mano", () => {
    expect(pantalla).toContain('from "../../subir"');
    expect(pantalla).toContain("subirAlPrincipio(dialogoEditor)");
    expect(pantalla).toMatch(/use:revelar/);
    expect(pantalla).not.toMatch(/\.scrollTo\(|scrollIntoView\(/);
  });

  it("cada uno de los seis tiene «Editar» y los nuevos se crean con «+ Nuevo correo»", () => {
    expect(pantalla).toContain("onclick={() => editar(d.tipo)}");
    expect(pantalla).toContain("+ Nuevo correo");
    expect(pantalla).toContain("Volver al ejemplo");
  });

  it("el envío pide mensaje cuando la plantilla lo lleva", () => {
    expect(envio).toContain("pideMensaje(tipo, correo.config)");
  });
});
