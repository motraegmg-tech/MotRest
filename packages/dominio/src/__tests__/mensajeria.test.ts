/**
 * Las reglas que evitan que Meta tumbe el número del restaurante.
 *
 * No son reglas de transporte: son de negocio, y romperlas se paga con el
 * número limitado o bloqueado — y con él se caen la encuesta, el aviso de "su
 * mesa está lista" y las promociones, todo junto. Un número quemado no se
 * arregla con código, así que estas pruebas son el candado.
 */
import { describe, expect, it } from "vitest";
import { FabricaEventos } from "../evento.js";
import {
  MAX_MARKETING_MENSUAL,
  VENTANA_SERVICIO_MS,
  contactoDe,
  destinatariosDeCampana,
  normalizarContacto,
  pideBaja,
  proyectarContactos,
  puedeEnviar,
  streamMensajeria,
  ventanaAbierta,
  type EventoMensajeria,
} from "../clientes/mensajeria.js";

const CTX = { device_id: "dev-1", empleado_id: "sistema", sucursal_id: "suc-1" };
const STREAM = streamMensajeria("suc-1");
const TEL = "3311223344";
const AHORA = new Date(2026, 6, 24, 21, 0).getTime();
const f = () => new FabricaEventos<EventoMensajeria>(CTX);

function recibido(ts: number): EventoMensajeria {
  const ev = f().crear("mensaje_recibido", STREAM, {
    contacto: TEL, canal: "whatsapp", texto: "hola",
  });
  (ev as { ts: number }).ts = ts;
  return ev;
}

function acepta(ts: number): EventoMensajeria {
  const ev = f().crear("consentimiento_otorgado", STREAM, {
    contacto: TEL, canal: "whatsapp", origen: "portal",
  });
  (ev as { ts: number }).ts = ts;
  return ev;
}

function promoEnviada(ts: number): EventoMensajeria {
  const ev = f().crear("mensaje_enviado", STREAM, {
    contacto: TEL, canal: "whatsapp", proposito: "marketing", plantilla: "promo_martes",
  });
  (ev as { ts: number }).ts = ts;
  return ev;
}

describe("el teléfono se compara sin formato", () => {
  it("da igual cómo lo escriban", () => {
    expect(normalizarContacto("+52 33 1122-3344")).toBe("523311223344");
    expect(normalizarContacto("(33) 1122 3344")).toBe(TEL);
  });
});

// --- La ventana de 24 horas --------------------------------------------------------------

describe("la ventana de servicio", () => {
  it("se abre cuando el comensal escribe", () => {
    const c = contactoDe(proyectarContactos([recibido(AHORA)]), TEL);
    expect(ventanaAbierta(c, AHORA + 60_000)).toBe(true);
  });

  it("se cierra a las 24 horas", () => {
    const c = contactoDe(proyectarContactos([recibido(AHORA)]), TEL);
    expect(ventanaAbierta(c, AHORA + VENTANA_SERVICIO_MS + 1000)).toBe(false);
  });

  /*
   * EL ERROR QUE MÁS RÁPIDO ESCALA A SANCIÓN: contestar con texto libre cuando
   * la ventana ya se cerró.
   */
  it("fuera de la ventana no se puede contestar libremente", () => {
    const c = contactoDe(proyectarContactos([recibido(AHORA)]), TEL);
    const v = puedeEnviar(c, "servicio", AHORA + VENTANA_SERVICIO_MS + 1000);
    expect(v.puede).toBe(false);
  });

  it("a quien nunca escribió no se le contesta nada", () => {
    expect(puedeEnviar(undefined, "servicio", AHORA).puede).toBe(false);
  });
});

// --- Avisos que el comensal espera --------------------------------------------------------

describe("avisos operativos", () => {
  it("su mesa está lista se puede mandar aunque no haya escrito, con plantilla", () => {
    const v = puedeEnviar(undefined, "aviso_operativo", AHORA);
    expect(v).toEqual({ puede: true, exigePlantilla: true });
  });

  it("dentro de la ventana no hace falta plantilla", () => {
    const c = contactoDe(proyectarContactos([recibido(AHORA)]), TEL);
    expect(puedeEnviar(c, "aviso_operativo", AHORA + 60_000)).toEqual({
      puede: true, exigePlantilla: false,
    });
  });
});

// --- Marketing: lo que quema el número ----------------------------------------------------

describe("promociones", () => {
  it("sin consentimiento, no se manda nada", () => {
    const c = contactoDe(proyectarContactos([recibido(AHORA)]), TEL);
    expect(puedeEnviar(c, "marketing", AHORA).puede).toBe(false);
  });

  it("con consentimiento, sí", () => {
    const c = contactoDe(proyectarContactos([acepta(AHORA)]), TEL);
    expect(puedeEnviar(c, "marketing", AHORA + 1000).puede).toBe(true);
  });

  /* La baja se honra SIEMPRE. No hay estado del que no se pueda salir. */
  it("la baja corta el marketing de inmediato", () => {
    const baja = f().crear("consentimiento_retirado", STREAM, {
      contacto: TEL, canal: "whatsapp", motivo: "BAJA",
    });
    const c = contactoDe(proyectarContactos([acepta(AHORA), baja]), TEL);
    expect(c!.acepta_marketing).toBe(false);
    expect(puedeEnviar(c, "marketing", AHORA + 1000).puede).toBe(false);
  });

  it("volver a aceptar después de la baja funciona", () => {
    const baja = f().crear("consentimiento_retirado", STREAM, {
      contacto: TEL, canal: "whatsapp", motivo: "BAJA",
    });
    const c = contactoDe(proyectarContactos([acepta(AHORA), baja, acepta(AHORA + 2000)]), TEL);
    expect(c!.acepta_marketing).toBe(true);
  });

  /* Saturar provoca bajas y reportes, y los reportes tumban el número. */
  it("hay un tope de promociones al mes", () => {
    const promos = Array.from({ length: MAX_MARKETING_MENSUAL }, (_, i) =>
      promoEnviada(AHORA - i * 86_400_000),
    );
    const c = contactoDe(proyectarContactos([acepta(AHORA - 40 * 86_400_000), ...promos]), TEL);
    expect(puedeEnviar(c, "marketing", AHORA).puede).toBe(false);
  });

  it("las promociones viejas dejan de contar", () => {
    const viejas = Array.from({ length: MAX_MARKETING_MENSUAL }, () =>
      promoEnviada(AHORA - 60 * 86_400_000),
    );
    const c = contactoDe(proyectarContactos([acepta(AHORA - 90 * 86_400_000), ...viejas]), TEL);
    expect(puedeEnviar(c, "marketing", AHORA).puede).toBe(true);
  });

  it("una campaña solo sale a quien de verdad se le puede mandar", () => {
    const otro = f().crear("mensaje_recibido", STREAM, {
      contacto: "3399887766", canal: "whatsapp", texto: "hola",
    });
    const contactos = proyectarContactos([acepta(AHORA), otro]);
    const destinos = destinatariosDeCampana(contactos, AHORA + 1000);
    expect(destinos.map((d) => d.contacto)).toEqual([TEL]);
  });
});

// --- Entender la baja ---------------------------------------------------------------------

describe("reconocer que alguien quiere salir", () => {
  it("entiende las formas en que la gente lo escribe", () => {
    for (const texto of ["BAJA", "baja", "Stop", "cancelar", "SALIR", "unsubscribe", "baja por favor"]) {
      expect(pideBaja(texto)).toBe(true);
    }
  });

  /* No entenderlo convierte una queja en un reporte a Meta. */
  it("no confunde una conversación normal con una baja", () => {
    for (const texto of ["hola", "quiero reservar", "estuvo muy rica la pizza"]) {
      expect(pideBaja(texto)).toBe(false);
    }
  });
});
