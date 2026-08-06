/**
 * El kiosco de autoservicio.
 *
 * Lo que hay que probar es lo que pasa cuando NADIE VIGILA LA PANTALLA. En el
 * salón hay un mesero que corrige un error; aquí no hay nadie, así que el kiosco
 * tiene que ser incapaz de equivocarse en lo caro.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import {
  AVISO_MS,
  INACTIVIDAD_MS,
  PROHIBIDO_EN_KIOSCO,
  folioDeKiosco,
  kioscoEnReposo,
  permitidoEnKiosco,
  porInactividad,
  puedeMandarACocina,
  segundosParaReiniciar,
  type EstadoKiosco,
  type PasoKiosco,
} from "../ventas/kiosco.js";

const AHORA = new Date(2026, 6, 24, 14, 0).getTime();

function estado(paso: PasoKiosco, quietoMs = 0): EstadoKiosco {
  return { paso, modalidad: "comer_aqui", ultimo_toque_ts: AHORA - quietoMs };
}

// --- El pedido abandonado --------------------------------------------------------------------

describe("cuando alguien se va a media orden", () => {
  /*
   * Un carrito que se queda en pantalla le enseña al siguiente lo que pidió el
   * anterior — y si llegara a cocina, el restaurante prepara comida que nadie
   * pidió.
   */
  it("se reinicia solo tras minuto y medio quieto", () => {
    expect(porInactividad(estado("carta", INACTIVIDAD_MS), AHORA)).toBe("reiniciar");
  });

  it("avisa antes de borrar, por si sigue ahí pensando", () => {
    expect(porInactividad(estado("carta", INACTIVIDAD_MS - AVISO_MS), AHORA)).toBe("avisar");
    expect(porInactividad(estado("carta", 5_000), AHORA)).toBe("nada");
  });

  /*
   * EL CANDADO MÁS IMPORTANTE. Reiniciar mientras alguien teclea su tarjeta —o
   * peor, después de haber cobrado— le quitaría un pedido PAGADO. Es el fallo
   * más caro que puede tener esta máquina.
   */
  it("NUNCA reinicia pagando ni después de pagar", () => {
    for (const paso of ["pago", "listo"] as const) {
      expect(porInactividad(estado(paso, INACTIVIDAD_MS * 10), AHORA)).toBe("nada");
    }
  });

  it("en reposo no hay nada que reiniciar", () => {
    expect(porInactividad(estado("reposo", INACTIVIDAD_MS * 10), AHORA)).toBe("nada");
  });

  it("la cuenta atrás llega a cero y no sigue en negativo", () => {
    expect(segundosParaReiniciar(estado("carta", INACTIVIDAD_MS - 10_000), AHORA)).toBe(10);
    expect(segundosParaReiniciar(estado("carta", INACTIVIDAD_MS * 3), AHORA)).toBe(0);
  });

  it("el reposo arranca limpio", () => {
    const k = kioscoEnReposo(AHORA);
    expect(k.paso).toBe("reposo");
    expect(k.folio).toBeUndefined();
  });
});

// --- Lo que no puede hacer -------------------------------------------------------------------

describe("lo que el kiosco no puede hacer nunca", () => {
  /*
   * Todo esto necesita a alguien con criterio delante. En el POS son acciones
   * que "requieren autorización"; en un kiosco no hay a quién pedírsela, así que
   * simplemente no existen.
   */
  it("ni descuentos, ni cortesías, ni tocar precios", () => {
    for (const accion of PROHIBIDO_EN_KIOSCO) {
      expect(permitidoEnKiosco(accion)).toBe(false);
    }
  });

  it("pero pedir y pagar sí, que es a lo que viene", () => {
    expect(permitidoEnKiosco("pos.item.agregar")).toBe(true);
    expect(permitidoEnKiosco("pos.cobro.registrar")).toBe(true);
  });

  it("abrir la caja tampoco: no hay cajón que abrir", () => {
    expect(permitidoEnKiosco("caja.sesion.abrir")).toBe(false);
  });
});

// --- Nada a cocina sin pagar -----------------------------------------------------------------

describe("qué llega a cocina", () => {
  const conCosas = { articulos: 2, subtotal: pesos(300), total: pesos(348) };

  /*
   * En el salón se manda primero y se cobra al final porque el comensal está
   * sentado y va a pagar. De pie y sin nombre no hay a quién cobrarle si se va.
   */
  it("nada sin pagar, aunque el pedido esté completo", () => {
    const r = puedeMandarACocina(estado("pago"), conCosas, false);
    expect(r.puede).toBe(false);
    expect(r.razon).toContain("no se ha pagado");
  });

  it("un pedido vacío no llega a cocina ni pagando", () => {
    const r = puedeMandarACocina(estado("pago"), { articulos: 0, subtotal: CERO, total: CERO }, true);
    expect(r.puede).toBe(false);
  });

  it("pagado y con cosas, sale", () => {
    expect(puedeMandarACocina(estado("pago"), conCosas, true).puede).toBe(true);
    expect(puedeMandarACocina(estado("listo"), conCosas, true).puede).toBe(true);
  });

  it("desde la carta no se manda nada aunque diga que está pagado", () => {
    expect(puedeMandarACocina(estado("carta"), conCosas, true).puede).toBe(false);
  });
});

// --- El folio -------------------------------------------------------------------------------

describe("el número para recoger", () => {
  /*
   * Tres cifras que se cantan en voz alta sin equivocarse. Un UUID en la
   * pantalla de recogida es inservible: nadie grita "el pedido 8f3a-…".
   */
  it("son tres cifras que se pueden gritar", () => {
    expect(folioDeKiosco(0)).toBe("001");
    expect(folioDeKiosco(41)).toBe("042");
    expect(folioDeKiosco(998)).toBe("999");
  });

  it("vuelve a empezar sin llegar nunca a cero", () => {
    expect(folioDeKiosco(999)).toBe("001");
    expect(folioDeKiosco(1000)).toBe("002");
  });
});
