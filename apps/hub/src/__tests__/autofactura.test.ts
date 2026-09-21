/**
 * El portal de autofactura, del lado del Hub (1.5.6).
 *
 * Contra un registro real y una nube de mentira. Lo que se fija es lo que cuesta
 * dinero o una factura equivocada si falla: que solo se publique lo que se puede
 * facturar, que cada solicitud genere UN comprobante con los datos del
 * comensal, que el Hub se niegue a facturar dos veces la misma venta, y que el
 * comensal se entere de un rechazo —en la nube y por correo, una sola vez—.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import {
  FabricaEventos,
  IVA_16,
  abrirSobre,
  cerrarSobre,
  codigoDeAutofactura,
  generarParDeSobre,
  indexar,
  pesos,
  snapshotTasas,
  uuidv7,
  type Comprobante,
  type EventoBase,
  type EventoComanda,
  type EventoFiscal,
  type ParDeSobre,
} from "@motrest/dominio";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import {
  AutofacturaDelHub,
  type CambiosSolicitud,
  type ClaveDelLocal,
  type FilaSolicitud,
  type FilaTicketFacturable,
  type NubeDeAutofactura,
} from "../fiscal/autofactura.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const SUC = "suc-rodizio";
const CTX = { device_id: "dev-caja", empleado_id: "emp", sucursal_id: SUC };
const SECRETO = "secreto-de-autofactura";
const COBRO = new Date(2026, 8, 19, 21).getTime();
const EMISOR = { rfc: "RPP200101AB1", nombre: "RODIZIO PIZZAS", regimen_fiscal: "601", codigo_postal: "44100" };
const JUAN = {
  rfc: "PELJ800101AB1",
  nombre: "JUAN PEREZ LOPEZ",
  regimen_fiscal: "612",
  codigo_postal: "44650",
  uso_cfdi: "G03",
  correo: "juan@correo.mx",
};

/** Una nube en memoria, con lo mínimo de sus reglas. */
class NubeFalsa implements NubeDeAutofactura {
  clave: ClaveDelLocal | null = { clave: "RODIZIO", portal_url: "https://motrest-factura.vercel.app" };
  tickets = new Map<string, FilaTicketFacturable & { estado: string }>();
  solicitudes = new Map<string, FilaSolicitud & CambiosSolicitud>();

  async miClave() {
    return this.clave;
  }
  async publicarTickets(filas: FilaTicketFacturable[]) {
    for (const f of filas) this.tickets.set(f.orden_id, { ...f, estado: this.tickets.get(f.orden_id)?.estado ?? "disponible" });
    return true;
  }
  async marcarFacturados(ordenes: string[]) {
    for (const o of ordenes) {
      const t = this.tickets.get(o);
      if (t) t.estado = "facturado";
    }
    return true;
  }
  async purgarVencidos() {}
  async solicitudesPendientes() {
    return [...this.solicitudes.values()].filter((s) => !s.resultado);
  }
  async marcarSolicitud(id: string, cambios: CambiosSolicitud) {
    const s = this.solicitudes.get(id);
    if (!s) return false;
    Object.assign(s, cambios);
    return true;
  }
  /** Lo que haría el portal: dejar el sobre. */
  async pedir(orden: string, par: ParDeSobre, datos: object = JUAN): Promise<FilaSolicitud> {
    const fila = { id: uuidv7(), orden_id: orden, sobre: await cerrarSobre(par.publica, JSON.stringify(datos)) };
    this.solicitudes.set(fila.id, fila);
    return fila;
  }
}

let log: LogHub;
let db: TipoDb;
let nube: NubeFalsa;
let par: ParDeSobre;
let facturapi: boolean;
let avisos: { correo: string; folio: string; motivo: string; enlace: string }[];
let generados: number;
let auto: AutofacturaDelHub;
let ahora: number;

/** Cobra una cuenta como lo haría la caja: al registro, y el Hub se entera. */
function cobrar(orden: string, opciones: { socio?: boolean } = {}): void {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden, { orden_id: orden, mesa_id: "m1", abierta_ts: COBRO - 3_600_000 }),
    f.crear("item_agregado", orden, {
      orden_id: orden,
      renglon: {
        id: uuidv7(), producto_id: "p", descripcion: "Pizza", cantidad: 1, precio_unitario: pesos(250),
        costo_unitario: pesos(1), impuesto: snapshotTasas(IVA_16), estado: "entregado",
      },
    }),
    f.crear("pago_registrado", orden, {
      orden_id: orden,
      monto: pesos(290),
      ...(opciones.socio ? { forma: "socio" as const, socio_id: "soc-1" } : { forma: "tarjeta_debito" as const }),
    }),
    { ...f.crear("cuenta_cerrada", orden, { orden_id: orden }), ts: COBRO },
  ];
  log.ingerir(eventos);
  auto.alIngerir(eventos);
}

/** Lo que haría la cola de timbrado con el comprobante que generó el Hub. */
function resolver(cfdi_id: string, como: "timbrado" | "rechazado"): void {
  const f = new FabricaEventos<EventoFiscal>(CTX);
  log.ingerir([
    como === "timbrado"
      ? f.crear("cfdi_timbrado", `fiscal:${SUC}`, {
          cfdi_id, uuid: "11111111-2222-3333-4444-555555555555", fecha_timbrado: "2026-09-20T10:00:00", pac: "FacturAPI",
          sello_cfd: "a", sello_sat: "b", no_certificado_sat: "1",
        })
      : f.crear("cfdi_rechazado", `fiscal:${SUC}`, {
          cfdi_id, codigo: "400", motivo: "El código postal del receptor no coincide con su constancia",
        }),
  ] as EventoBase[]);
}

function generadosDe(orden: string) {
  return (log.porTipo("cfdi_generado", 0, 1000) as unknown as { cfdi_id: string; orden_id: string; comprobante: Comprobante; correo_receptor?: string }[])
    .filter((e) => e.orden_id === orden);
}

/** Espera a que termine lo que se encadenó en serie. */
async function calma(): Promise<void> {
  await auto.sincronizar();
}

beforeEach(async () => {
  log = new LogHub(":memory:");
  db = new DatabaseSync(":memory:");
  nube = new NubeFalsa();
  par = await generarParDeSobre();
  facturapi = true;
  avisos = [];
  generados = 0;
  ahora = COBRO + 3_600_000;
  auto = new AutofacturaDelHub({
    db,
    log,
    nube: () => nube,
    secreto: () => SECRETO,
    abrir: (sobre) => abrirSobre(sobre, par),
    facturapiActiva: () => facturapi,
    emisor: () => EMISOR,
    catalogo: () => indexar({ productos: [], categorias: [], impuestos: [IVA_16] }),
    enGlobal: () => false,
    sucursal: () => SUC,
    hub_id: "hub-rodizio",
    inyectar: (eventos) => void log.ingerir(eventos),
    alGenerar: () => (generados += 1),
    avisarRechazo: async (correo, datos) => void avisos.push({ correo, ...datos }),
    anotar: () => {},
    ahora: () => ahora,
  });
});

describe("Publicar lo que se puede facturar", () => {
  it("una cuenta cobrada sube con su folio, su total y el código del QR", async () => {
    cobrar("ord-1");
    await calma();

    const t = nube.tickets.get("ord-1")!;
    expect(t).toBeDefined();
    expect(t.codigo).toBe(await codigoDeAutofactura("ord-1", SECRETO));
    expect(t.vence_ts - t.cerrada_ts).toBe(72 * 3_600_000);
  });

  it("el consumo de un socio no se ofrece: no fue una venta", async () => {
    cobrar("ord-socio", { socio: true });
    await calma();
    expect(nube.tickets.has("ord-socio")).toBe(false);
  });

  it("sin clave en Central, o sin FacturAPI, no se publica nada y la caja no imprime QR", async () => {
    nube.clave = null;
    cobrar("ord-1");
    await calma();
    expect(nube.tickets.size).toBe(0);
    expect(auto.estado()).toBeNull();

    nube.clave = { clave: "RODIZIO", portal_url: "https://motrest-factura.vercel.app" };
    facturapi = false;
    await calma();
    expect(nube.tickets.size).toBe(0);
    expect(auto.estado()).toBeNull();
  });

  it("lo que se factura en la caja se marca «facturado» en la nube", async () => {
    cobrar("ord-1");
    await calma();
    log.ingerir([
      new FabricaEventos<EventoFiscal>(CTX).crear("cfdi_generado", `fiscal:${SUC}`, {
        cfdi_id: "cfdi-caja", orden_id: "ord-1", serie: "A", folio: "1", comprobante: { total: pesos(290) } as Comprobante,
      }),
    ] as EventoBase[]);
    await calma();
    expect(nube.tickets.get("ord-1")!.estado).toBe("facturado");
  });
});

describe("Atender una solicitud", () => {
  it("genera UN comprobante a nombre del comensal, con su correo, y queda en proceso", async () => {
    cobrar("ord-1");
    await calma();
    const fila = await nube.pedir("ord-1", par);

    await auto.recibir(fila);
    await calma(); // la misma solicitud también llega por el barrido

    const g = generadosDe("ord-1");
    expect(g).toHaveLength(1);
    expect(g[0]!.comprobante.receptor).toMatchObject({ rfc: JUAN.rfc, nombre: JUAN.nombre, codigo_postal: "44650" });
    expect(g[0]!.correo_receptor).toBe("juan@correo.mx");
    expect(generados).toBe(1);
    expect(nube.solicitudes.get(fila.id)!.entregado_ts).toBeDefined();
    expect(nube.solicitudes.get(fila.id)!.resultado).toBeUndefined();
  });

  it("al timbrarse, contesta en la nube con el folio fiscal", async () => {
    cobrar("ord-1");
    await calma();
    const fila = await nube.pedir("ord-1", par);
    await auto.recibir(fila);

    resolver(generadosDe("ord-1")[0]!.cfdi_id, "timbrado");
    await calma();

    expect(nube.solicitudes.get(fila.id)).toMatchObject({
      resultado: "timbrada",
      uuid_cfdi: "11111111-2222-3333-4444-555555555555",
    });
    expect(avisos).toHaveLength(0);
  });

  it("si el SAT la rechaza, lo dice con el motivo y avisa por correo UNA vez, con el enlace para corregir", async () => {
    cobrar("ord-1");
    await calma();
    const fila = await nube.pedir("ord-1", par);
    await auto.recibir(fila);

    resolver(generadosDe("ord-1")[0]!.cfdi_id, "rechazado");
    await calma();
    await calma();

    expect(nube.solicitudes.get(fila.id)).toMatchObject({
      resultado: "rechazada",
      error: "El código postal del receptor no coincide con su constancia",
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.correo).toBe("juan@correo.mx");
    expect(avisos[0]!.enlace).toContain("https://motrest-factura.vercel.app/r/RODIZIO/");
    expect(avisos[0]!.enlace).toContain(`t=${await codigoDeAutofactura("ord-1", SECRETO)}`);
  });

  it("corregida y pedida otra vez, sale un comprobante nuevo", async () => {
    cobrar("ord-1");
    await calma();
    await auto.recibir(await nube.pedir("ord-1", par));
    resolver(generadosDe("ord-1")[0]!.cfdi_id, "rechazado");
    await calma();

    await auto.recibir(await nube.pedir("ord-1", par, { ...JUAN, codigo_postal: "44100" }));
    const g = generadosDe("ord-1");
    expect(g).toHaveLength(2);
    expect(g[1]!.comprobante.receptor.codigo_postal).toBe("44100");
  });

  it("si la venta ya tiene factura de la caja, se niega: una venta, un comprobante", async () => {
    cobrar("ord-1");
    log.ingerir([
      new FabricaEventos<EventoFiscal>(CTX).crear("cfdi_generado", `fiscal:${SUC}`, {
        cfdi_id: "cfdi-caja", orden_id: "ord-1", serie: "A", folio: "1", comprobante: { total: pesos(290) } as Comprobante,
      }),
    ] as EventoBase[]);
    const fila = await nube.pedir("ord-1", par);
    await auto.recibir(fila);

    expect(generadosDe("ord-1")).toHaveLength(1); // solo el de la caja
    expect(nube.solicitudes.get(fila.id)).toMatchObject({ resultado: "rechazada", error: "Ese ticket ya tiene su factura." });
  });

  it("un sobre que no se puede abrir se rechaza sin tumbar nada", async () => {
    cobrar("ord-1");
    const otroPar = await generarParDeSobre();
    const fila = await nube.pedir("ord-1", otroPar);
    await auto.recibir(fila);
    expect(nube.solicitudes.get(fila.id)!.resultado).toBe("rechazada");
    expect(avisos).toHaveLength(0); // sin sobre abierto no hay correo a quién avisar
  });

  it("datos que el SAT rechazaría ni siquiera llegan a la cola", async () => {
    cobrar("ord-1");
    const fila = await nube.pedir("ord-1", par, { ...JUAN, rfc: "MALO" });
    await auto.recibir(fila);
    expect(generadosDe("ord-1")).toHaveLength(0);
    expect(nube.solicitudes.get(fila.id)!.resultado).toBe("rechazada");
  });

  it("pasadas las 72 horas, se niega", async () => {
    cobrar("ord-1");
    ahora = COBRO + 73 * 3_600_000;
    const fila = await nube.pedir("ord-1", par);
    await auto.recibir(fila);
    expect(nube.solicitudes.get(fila.id)!.error).toMatch(/72 horas/);
  });
});
