/**
 * La puerta del comensal.
 *
 * Es el único sitio del Hub al que llega un dispositivo que NO es del
 * restaurante. Lo que hay que probar no es que funcione —eso es lo fácil— sino
 * que NO se pueda forzar: que un código inventado no abra nada, que el enlace
 * de una mesa no abra la de al lado, que nadie califique dos veces la misma
 * cuenta, y que una reserva pedida desde un teléfono no aparte mesa sola.
 */
import { describe, expect, it } from "vitest";
import {
  FabricaEventos,
  codigoDeCuenta,
  pesos,
  snapshotTasas,
  IVA_16,
  uuidv7,
  type EventoBase,
  type EventoComanda,
  type EventoOpinion,
  type RenglonComanda,
} from "@motrest/dominio";
import {
  registrarOpinion,
  solicitarReserva,
  verCuenta,
  type DependenciasPortal,
} from "../portal.js";

const SECRETO = "secreto-derivado-del-local";
const SUC = "suc-rodizio";
const AHORA = new Date(2026, 6, 24, 23, 30).getTime();

function renglon(descripcion: string, precio: number): RenglonComanda {
  return {
    id: uuidv7(),
    producto_id: "prod-x",
    descripcion,
    cantidad: 1,
    precio_unitario: pesos(precio),
    costo_unitario: pesos(30),
    impuesto: snapshotTasas(IVA_16),
    estado: "entregado",
  };
}

/** Una cuenta cobrada, con sus eventos, como la tendría el Hub. */
function cuentaCobrada(cerradaTs = AHORA): { ordenId: string; eventos: EventoComanda[] } {
  const ordenId = uuidv7();
  const f = new FabricaEventos<EventoComanda>({
    device_id: "dev-caja",
    empleado_id: "usr-lucia",
    sucursal_id: SUC,
  });

  const cierre = f.crear("cuenta_cerrada", ordenId, { orden_id: ordenId });
  (cierre as { ts: number }).ts = cerradaTs;

  return {
    ordenId,
    eventos: [
      f.crear("orden_creada", ordenId, {
        orden_id: ordenId,
        mesa_id: "mesa-5",
        abierta_ts: Math.min(cerradaTs, AHORA) - 60 * 60 * 1000,
      }),
      f.crear("item_agregado", ordenId, { orden_id: ordenId, renglon: renglon("Pizza", 249) }),
      f.crear("pago_registrado", ordenId, {
        orden_id: ordenId, monto: pesos(288.84), forma: "efectivo",
      }),
      cierre,
    ],
  };
}

/** Dependencias de mentira: el registro del Hub, en memoria. */
function deps(streams: Record<string, EventoBase[]>): DependenciasPortal & {
  ingeridos: EventoBase[];
} {
  const ingeridos: EventoBase[] = [];
  return {
    leerStream: async (id) => streams[id] ?? [],
    ingerir: (eventos) => ingeridos.push(...eventos),
    secreto: () => SECRETO,
    sucursalId: SUC,
    ahora: () => AHORA,
    ingeridos,
  };
}

// --- Ver su cuenta ------------------------------------------------------------------------

describe("el comensal abre su cuenta", () => {
  it("ve lo que consumió y su total", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });
    const r = await verCuenta(await codigoDeCuenta(ordenId, SECRETO), d, []);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.renglones.map((x) => x.descripcion)).toEqual(["Pizza"]);
    expect(r.datos.total).toBeGreaterThan(0);
    expect(r.datos.ya_opino).toBe(false);
  });

  /*
   * Lo que se devuelve es lo que ya trae impreso en su ticket, ni un dato más.
   * Ni costos, ni márgenes, ni quién lo atendió.
   */
  it("no se le entrega nada del negocio", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });
    const r = await verCuenta(await codigoDeCuenta(ordenId, SECRETO), d, []);

    if (!r.ok) throw new Error("debía abrir");
    const crudo = JSON.stringify(r.datos);
    expect(crudo).not.toContain("costo");
    expect(crudo).not.toContain("mesero");
    expect(crudo).not.toContain("usr-lucia");
  });

  it("un código inventado no abre nada", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });
    const r = await verCuenta(`${ordenId}~AAAAAAAAAAAAAAAA`, d, []);
    expect(r.ok).toBe(false);
  });

  /* Tener el enlace de tu mesa no puede dar el de la de al lado. */
  it("el enlace de una cuenta no abre otra", async () => {
    const mia = cuentaCobrada();
    const ajena = cuentaCobrada();
    const d = deps({ [mia.ordenId]: mia.eventos, [ajena.ordenId]: ajena.eventos });

    // La firma de la mía, pegada al orden_id de la ajena.
    const codigoMio = await codigoDeCuenta(mia.ordenId, SECRETO);
    const firma = codigoMio.split("~")[1];
    const r = await verCuenta(`${ajena.ordenId}~${firma}`, d, []);
    expect(r.ok).toBe(false);
  });

  /* El QR se entrega al pedir la cuenta, antes de pasar la tarjeta. */
  it("una cuenta todavía abierta ya se puede consultar desde el QR impreso", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const sinCerrar = eventos.filter((e) => e.tipo !== "cuenta_cerrada");
    const d = deps({ [ordenId]: sinCerrar });
    const r = await verCuenta(await codigoDeCuenta(ordenId, SECRETO), d, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.cerrada_ts).toBeUndefined();
  });

  /* Un enlace vivo para siempre es una puerta que nadie vuelve a mirar. */
  it("un enlace de hace una semana ya no sirve", async () => {
    const hace7dias = AHORA - 7 * 24 * 60 * 60 * 1000;
    const { ordenId, eventos } = cuentaCobrada(hace7dias);
    const d = deps({ [ordenId]: eventos });
    const r = await verCuenta(await codigoDeCuenta(ordenId, SECRETO), d, []);
    expect(r.ok).toBe(false);
  });

  /*
   * El mismo error para un código malo y para uno caducado: decirle a quien
   * prueba que "ese existía pero venció" le confirma que va por buen camino.
   */
  it("no distingue entre inválido y caducado", async () => {
    const viejo = cuentaCobrada(AHORA - 30 * 24 * 60 * 60 * 1000);
    const d = deps({ [viejo.ordenId]: viejo.eventos });

    const caducado = await verCuenta(await codigoDeCuenta(viejo.ordenId, SECRETO), d, []);
    const invalido = await verCuenta(`${uuidv7()}~AAAAAAAAAAAAAAAA`, d, []);

    if (caducado.ok || invalido.ok) throw new Error("ninguno debía abrir");
    expect(caducado.error).toBe(invalido.error);
    expect(caducado.codigo).toBe(invalido.codigo);
  });
});

// --- Calificar ----------------------------------------------------------------------------

describe("la encuesta la contesta quien comió", () => {
  it("registra la opinión a nombre del comensal, no del mesero", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });

    const r = await registrarOpinion(
      await codigoDeCuenta(ordenId, SECRETO),
      { calificacion: "mal", motivos: ["espera"], comentario: "Tardó mucho" },
      d,
      [],
    );

    expect(r.ok).toBe(true);
    const ev = d.ingeridos[0] as unknown as Record<string, unknown>;
    expect(ev.tipo).toBe("opinion_registrada");
    // El punto entero del cambio: se distingue en la bitácora.
    expect(ev.empleado_id).toBe("comensal");
    expect(ev.device_id).toBe("portal");
    expect(ev.calificacion).toBe("mal");
  });

  /*
   * Sin esto, quien tenga el enlace puede mandar cien opiniones y torcer el
   * promedio del mesero que le tocó.
   */
  it("una cuenta se califica una sola vez", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });
    const previa = [{ orden_id: ordenId } as unknown as EventoOpinion];

    const r = await registrarOpinion(
      await codigoDeCuenta(ordenId, SECRETO),
      { calificacion: "bien" },
      d,
      previa,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe(409);
    expect(d.ingeridos).toEqual([]);
  });

  it("una calificación buena no arrastra motivos de queja", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });

    await registrarOpinion(
      await codigoDeCuenta(ordenId, SECRETO),
      { calificacion: "bien", motivos: ["espera", "sabor"] },
      d,
      [],
    );
    expect((d.ingeridos[0] as unknown as { motivos: string[] }).motivos).toEqual([]);
  });

  it("una calificación que no existe se rechaza", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });
    const r = await registrarOpinion(
      await codigoDeCuenta(ordenId, SECRETO),
      { calificacion: "excelente" as never },
      d,
      [],
    );
    expect(r.ok).toBe(false);
    expect(d.ingeridos).toEqual([]);
  });

  it("sin código válido no se registra nada", async () => {
    const d = deps({});
    const r = await registrarOpinion("basura", { calificacion: "bien" }, d, []);
    expect(r.ok).toBe(false);
    expect(d.ingeridos).toEqual([]);
  });
});

// --- Reservar -----------------------------------------------------------------------------

describe("una reserva pedida desde un teléfono", () => {
  const manana = AHORA + 24 * 60 * 60 * 1000;

  /*
   * EL CANDADO. Si apartara mesa sola, cualquiera con el enlace podría bloquear
   * el salón entero de un viernes sin haber pisado nunca el restaurante.
   */
  it("llega SOLICITADA, no apartada", () => {
    const d = deps({});
    const r = solicitarReserva({ nombre: "Familia Ramírez", personas: 4, para_ts: manana }, d);

    expect(r.ok).toBe(true);
    const ev = d.ingeridos[0] as unknown as Record<string, unknown>;
    expect(ev.tipo).toBe("reserva_creada");
    expect(ev.origen).toBe("comensal");
    // Sin mesa: la casa decide cuál, si es que la acepta.
    expect(ev.mesa_id).toBeUndefined();
  });

  it("no acepta una fecha que ya pasó", () => {
    const d = deps({});
    const r = solicitarReserva(
      { nombre: "Ramírez", personas: 2, para_ts: AHORA - 60_000 },
      d,
    );
    expect(r.ok).toBe(false);
    expect(d.ingeridos).toEqual([]);
  });

  /* Más de tres meses adelante no es una reserva, es ruido en la agenda. */
  it("no acepta reservas a un año vista", () => {
    const d = deps({});
    const r = solicitarReserva(
      { nombre: "Ramírez", personas: 2, para_ts: AHORA + 400 * 24 * 60 * 60 * 1000 },
      d,
    );
    expect(r.ok).toBe(false);
  });

  it("exige nombre y un número de personas razonable", () => {
    const d = deps({});
    expect(solicitarReserva({ nombre: "", personas: 2, para_ts: manana }, d).ok).toBe(false);
    expect(solicitarReserva({ nombre: "Ana", personas: 0, para_ts: manana }, d).ok).toBe(false);
    expect(solicitarReserva({ nombre: "Ana", personas: 500, para_ts: manana }, d).ok).toBe(false);
    expect(d.ingeridos).toEqual([]);
  });

  /**
   * El nombre solo se medía, no se filtraba: pasaba cualquier carácter.
   *
   * Ese nombre acaba en el asunto del correo de confirmación, y en el correo un
   * salto de línea abre una cabecera nueva. `Ana\r\nBcc: …` le manda una copia
   * del correo del restaurante a quien lo escribió desde el QR de la mesa.
   *
   * Se limpia aquí, en la entrada, y no solo al mandar: el nombre también se
   * imprime en el ticket de la reserva y se enseña en la agenda, y un salto de
   * línea guardado en el log de eventos ya no se quita nunca.
   */
  it("aplana el nombre en vez de guardarlo con saltos de línea", () => {
    const d = deps({});
    const r = solicitarReserva(
      { nombre: "Ana\r\nBcc: quien-sea@ejemplo.com", personas: 2, para_ts: manana },
      d,
    );

    expect(r.ok).toBe(true);
    const ev = d.ingeridos[0] as unknown as Record<string, unknown>;
    expect(ev.nombre).toBe("Ana Bcc: quien-sea@ejemplo.com");
    expect(String(ev.nombre)).not.toMatch(/[\r\n]/);
  });

  /* Un nombre que solo son caracteres de control no es un nombre. */
  it("no acepta un nombre hecho solo de saltos de línea", () => {
    const d = deps({});
    expect(solicitarReserva({ nombre: "\r\n\r\n", personas: 2, para_ts: manana }, d).ok).toBe(false);
    expect(d.ingeridos).toEqual([]);
  });

  /* Un comentario de diez mil caracteres es un intento de llenar el disco. */
  it("recorta lo que el comensal escribe", async () => {
    const { ordenId, eventos } = cuentaCobrada();
    const d = deps({ [ordenId]: eventos });
    await registrarOpinion(
      await codigoDeCuenta(ordenId, SECRETO),
      { calificacion: "mal", comentario: "x".repeat(5000) },
      d,
      [],
    );
    const ev = d.ingeridos[0] as unknown as { comentario: string };
    expect(ev.comentario.length).toBe(500);
  });
});
