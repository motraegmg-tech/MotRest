/**
 * Los avisos de WhatsApp que salen del Hub.
 *
 * Lo que hay que probar es que NO salga lo que no debe. Un aviso de más se paga
 * con el número del restaurante limitado por Meta, y con él se caen los avisos,
 * la encuesta y las promociones a la vez. Un número quemado no se arregla con
 * código.
 */
import { describe, expect, it } from "vitest";
import { FabricaEventos, type EventoMensajeria } from "@motrest/dominio";
import { Avisos, avisoMesaLista, avisoReservaConfirmada, type Aviso } from "../avisos.js";

const CTX = { device_id: "dev-hub", empleado_id: "sistema", sucursal_id: "suc-1" };
const TEL = "3311223344";
const AHORA = new Date(2026, 6, 24, 21, 0).getTime();
const DIA = 24 * 60 * 60 * 1000;

function escribio(ts: number): EventoMensajeria {
  const ev = new FabricaEventos<EventoMensajeria>(CTX).crear("mensaje_recibido", "m", {
    contacto: TEL, canal: "whatsapp", texto: "hola",
  });
  (ev as { ts: number }).ts = ts;
  return ev;
}

/** Un relay de mentira, para ver qué se le pidió mandar. */
function relay(conectado = true) {
  const enviados: Aviso[] = [];
  return {
    enviados,
    conectado: () => conectado,
    enviar: (a: Aviso) => enviados.push(a),
    desconectar: () => (conectado = false),
    reconectar: () => (conectado = true),
  };
}

function avisos(
  r: ReturnType<typeof relay>,
  eventos: EventoMensajeria[] = [],
  ahora = AHORA,
): Avisos {
  return new Avisos(r, () => eventos, () => {}, () => ahora);
}

describe("avisar que la mesa está lista", () => {
  /*
   * Es el caso que justifica todo WhatsApp: quien espera de pie se fue a dar
   * una vuelta, y hay que alcanzarlo. El Hub no puede hacerlo solo.
   */
  it("sale aunque el comensal nunca haya escrito, con plantilla", () => {
    const r = relay();
    const res = avisos(r).mandar(avisoMesaLista(TEL, "Ramírez", "Rodizio"));

    expect(res.enviado).toBe(true);
    expect(r.enviados[0]!.plantilla?.nombre).toBe("mesa_lista");
    expect(r.enviados[0]!.plantilla?.variables).toEqual(["Ramírez", "Rodizio"]);
  });

  it("la confirmación de reserva dice el día y la hora", () => {
    const r = relay();
    avisos(r).mandar(avisoReservaConfirmada(TEL, "Ramírez", AHORA));
    const vars = r.enviados[0]!.plantilla?.variables ?? [];
    expect(vars[0]).toBe("Ramírez");
    expect(vars[1]).toContain("julio");
  });
});

describe("lo que NO se manda", () => {
  /*
   * EL ERROR QUE MÁS RÁPIDO ESCALA A SANCIÓN: texto libre fuera de la ventana
   * de 24 h. Se prefiere no mandar nada antes que mandarlo "a ver si pasa".
   */
  it("un aviso sin plantilla, fuera de la ventana, no sale", () => {
    const r = relay();
    const res = avisos(r).mandar({
      contacto: TEL, proposito: "aviso_operativo", texto: "Su mesa está lista",
    });

    expect(res.enviado).toBe(false);
    expect(res.razon).toContain("plantilla");
    expect(r.enviados).toEqual([]);
  });

  it("dentro de la ventana, el texto libre sí sale", () => {
    const r = relay();
    const res = avisos(r, [escribio(AHORA - 60_000)]).mandar({
      contacto: TEL, proposito: "aviso_operativo", texto: "Su mesa está lista",
    });
    expect(res.enviado).toBe(true);
  });

  it("una promoción a quien no la pidió no sale", () => {
    const r = relay();
    const res = avisos(r, [escribio(AHORA - 60_000)]).mandar({
      contacto: TEL, proposito: "marketing", texto: "2x1 hoy",
    });
    expect(res.enviado).toBe(false);
    expect(r.enviados).toEqual([]);
  });
});

describe("cuando no hay relay", () => {
  it("el aviso se guarda y el restaurante sigue operando", () => {
    const r = relay(false);
    const a = avisos(r);
    const res = a.mandar(avisoMesaLista(TEL, "Ramírez", "Rodizio"));

    expect(res.enviado).toBe(false);
    expect(a.pendientes).toBe(1);
  });

  it("al volver el enlace, sale lo pendiente", () => {
    const r = relay(false);
    const a = avisos(r);
    a.mandar(avisoMesaLista(TEL, "Ramírez", "Rodizio"));

    r.reconectar();
    expect(a.alReconectar()).toEqual({ enviados: 1, caducados: 0 });
    expect(r.enviados).toHaveLength(1);
    expect(a.pendientes).toBe(0);
  });

  /*
   * "Su mesa está lista" de hace dos horas no es un aviso tardío: es una
   * molestia que provoca bajas, y las bajas queman el número.
   */
  it("lo que ya no tiene sentido se descarta en vez de mandarse", () => {
    const r = relay(false);
    let reloj = AHORA;
    const a = new Avisos(r, () => [], () => {}, () => reloj);

    a.mandar(avisoMesaLista(TEL, "Ramírez", "Rodizio"));
    reloj = AHORA + 2 * 60 * 60 * 1000; // dos horas después
    r.reconectar();

    expect(a.alReconectar()).toEqual({ enviados: 0, caducados: 1 });
    expect(r.enviados).toEqual([]);
  });

  /*
   * Una cola sin tope convierte una caída de tres días en una avalancha de
   * mensajes viejos el día que vuelve internet.
   */
  it("la cola tiene tope y descarta lo más viejo", () => {
    const r = relay(false);
    const a = avisos(r);
    for (let i = 0; i < 250; i++) a.mandar(avisoMesaLista(TEL, `Cliente ${i}`, "Rodizio"));
    expect(a.pendientes).toBe(200);
  });
});

describe("por qué no se mandó", () => {
  /*
   * "No aceptó promociones" es un dato de negocio; "no hay relay" es un
   * problema de infraestructura. Confundirlos hace perseguir el fallo
   * equivocado un viernes a las nueve de la noche.
   */
  it("distingue el motivo de negocio del de infraestructura", () => {
    const sinRelay = avisos(relay(false)).mandar(avisoMesaLista(TEL, "R", "Rodizio"));
    expect(sinRelay.razon).toContain("relay");

    const sinPermiso = avisos(relay(), [escribio(AHORA - 60_000)]).mandar({
      contacto: TEL, proposito: "marketing", texto: "promo",
    });
    expect(sinPermiso.razon).toContain("promociones");
  });
});

describe("el reloj de la ventana", () => {
  it("a las 25 horas ya hace falta plantilla", () => {
    const r = relay();
    const res = avisos(r, [escribio(AHORA - DIA - 3_600_000)]).mandar({
      contacto: TEL, proposito: "aviso_operativo", texto: "libre",
    });
    expect(res.enviado).toBe(false);
  });
});
