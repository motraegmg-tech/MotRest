/**
 * Socios e inversionistas: sus beneficios y su bolsa de consumo del mes.
 *
 * La prueba que da sentido a todo el módulo es la última: **lo que consume un
 * socio sigue siendo una venta**. Si algún día alguien la cambia para que el
 * consumo se descuente de las ventas, el food cost y el ticket promedio del
 * local dejarán de ser ciertos, y eso no se nota hasta que se toma una decisión
 * de compras con esos números.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import { FabricaEventos } from "../evento.js";
import { cuentasCerradasEn, resumenVentas } from "../inteligencia/reportes.js";
import {
  bolsaDelMes,
  consumidoPorSocio,
  mesDe,
  problemaConsumoSocio,
  proyectarSocios,
  sociosActivos,
  valorBeneficio,
  type EventoSocio,
  type Socio,
} from "../organizacion/socios.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };
const AHORA = new Date(2026, 7, 10, 21, 0).getTime(); // 10-ago-2026, 21:00 local
const SOCIO = "socio-1";

function socio(parcial: Partial<Socio> = {}): Socio {
  return {
    socio_id: SOCIO,
    nombre: "María Fernández",
    beneficios: [{ tipo: "saldo_mensual", valor: pesos(5_000) }],
    activo: true,
    registrado_ts: AHORA - 86_400_000,
    ...parcial,
  };
}

function renglon(precio: number): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "p1", descripcion: "Pizza", cantidad: 1,
    precio_unitario: pesos(precio), costo_unitario: pesos(precio / 3),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

/** Una cuenta cobrada, con la forma de pago que se le indique. */
function cuentaCobrada(opciones: {
  precio: number;
  forma: "efectivo" | "socio";
  socioId?: string;
  ts?: number;
  anulada?: boolean;
}): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const ts = opciones.ts ?? AHORA;
  const r = renglon(opciones.precio);

  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: ts }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: r }),
  ];

  if (opciones.anulada) {
    eventos.push(f.crear("orden_anulada", orden_id, { orden_id }));
    return { ...proyectarComanda(eventos), cerrada_ts: ts };
  }

  const total = totalesComanda(proyectarComanda(eventos)).total;
  eventos.push(
    f.crear("pago_registrado", orden_id, {
      orden_id,
      monto: total,
      forma: opciones.forma,
      socio_id: opciones.socioId,
    }),
    f.crear("cuenta_cerrada", orden_id, { orden_id }),
  );

  // El sello se fija a mano: la fábrica usa el reloj real y estas pruebas
  // comparan contra un mes concreto.
  return { ...proyectarComanda(eventos), cerrada_ts: ts };
}

describe("proyección de socios", () => {
  const f = new FabricaEventos<EventoSocio>(CTX);

  it("un alta reaplicada no pisa lo editado después", () => {
    const alta = f.crear("socio_registrado", "socios:suc-1", {
      socio_id: SOCIO,
      datos: { nombre: "María", beneficios: [] },
    });
    const cambio = f.crear("socio_actualizado", "socios:suc-1", {
      socio_id: SOCIO,
      cambios: { nombre: "María Fernández" },
    });

    // El Hub reenvía el alta tras una resincronización: no puede borrar el
    // cambio posterior.
    const socios = proyectarSocios([alta, cambio, alta]);
    expect(socios[0]!.nombre).toBe("María Fernández");
  });

  it("se da de baja, no se borra, y se puede reactivar", () => {
    const alta = f.crear("socio_registrado", "socios:suc-1", {
      socio_id: SOCIO,
      datos: { nombre: "María", beneficios: [] },
    });
    const baja = f.crear("socio_desactivado", "socios:suc-1", {
      socio_id: SOCIO,
      motivo: "Vendió su parte",
    });

    expect(sociosActivos(proyectarSocios([alta, baja]))).toHaveLength(0);
    expect(proyectarSocios([alta, baja])).toHaveLength(1);

    const alta2 = f.crear("socio_reactivado", "socios:suc-1", { socio_id: SOCIO });
    expect(sociosActivos(proyectarSocios([alta, baja, alta2]))).toHaveLength(1);
  });
});

describe("la bolsa del mes", () => {
  it("suma solo lo que se le cargó a ESE socio", () => {
    const comandas = [
      cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO }),
      cuentaCobrada({ precio: 500, forma: "socio", socioId: "socio-2" }),
      cuentaCobrada({ precio: 800, forma: "efectivo" }),
    ];
    // 1000 + IVA.
    expect(consumidoPorSocio(comandas, SOCIO, mesDe(AHORA))).toBe(pesos(1_160));
  });

  it("no cuenta lo de otros meses", () => {
    const mesPasado = new Date(2026, 6, 10, 21, 0).getTime();
    const comandas = [
      cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO, ts: mesPasado }),
    ];
    expect(consumidoPorSocio(comandas, SOCIO, mesDe(AHORA))).toBe(CERO);
  });

  it("el crédito amplía el tope, y lo que queda se calcula sobre los dos", () => {
    const conCredito = socio({
      beneficios: [
        { tipo: "saldo_mensual", valor: pesos(5_000) },
        { tipo: "credito_mensual", valor: pesos(3_000) },
      ],
    });
    const bolsa = bolsaDelMes(
      conCredito,
      [cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO })],
      AHORA,
    );

    expect(bolsa.tope).toBe(pesos(8_000));
    expect(bolsa.consumido).toBe(pesos(1_160));
    expect(bolsa.disponible).toBe(pesos(6_840));
  });

  it("nunca queda en negativo aunque se haya consumido de más", () => {
    const bolsa = bolsaDelMes(
      socio({ beneficios: [{ tipo: "saldo_mensual", valor: pesos(500) }] }),
      [cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO })],
      AHORA,
    );
    expect(bolsa.disponible).toBe(CERO);
  });
});

describe("qué se le puede cargar a un socio", () => {
  const vacia = bolsaDelMes(socio(), [], AHORA);

  it("deja pasar un cargo dentro de su bolsa", () => {
    expect(problemaConsumoSocio(socio(), pesos(1_000), vacia)).toBeNull();
  });

  it("no deja pasar un cargo mayor que lo que le queda, y dice cuánto le queda", () => {
    const problema = problemaConsumoSocio(socio(), pesos(9_000), vacia);
    expect(problema).toContain("5000.00");
  });

  it("un socio sin bolsa pactada no puede consumir a cuenta", () => {
    const sinBolsa = socio({ beneficios: [] });
    const problema = problemaConsumoSocio(sinBolsa, pesos(100), bolsaDelMes(sinBolsa, [], AHORA));
    expect(problema).toContain("no tiene bolsa");
  });

  it("un socio dado de baja tampoco", () => {
    const baja = socio({ activo: false });
    expect(problemaConsumoSocio(baja, pesos(100), vacia)).toContain("ya no es socio");
  });

  it("los beneficios que no se pactaron valen cero", () => {
    expect(valorBeneficio(socio(), "descuento_permanente")).toBe(0);
    expect(valorBeneficio(socio(), "saldo_mensual")).toBe(pesos(5_000));
  });
});

/*
 * LA REGLA QUE SOSTIENE EL DISEÑO. Si esta prueba se cae, los reportes del
 * restaurante dejaron de decir la verdad.
 */
describe("el consumo de un socio SÍ es una venta", () => {
  it("cuenta completo en el reporte de ventas, igual que un cobro en efectivo", () => {
    const rango = mesDe(AHORA);
    const delSocio = resumenVentas(
      cuentasCerradasEn([cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO })], rango),
    );
    const enEfectivo = resumenVentas(
      cuentasCerradasEn([cuentaCobrada({ precio: 1_000, forma: "efectivo" })], rango),
    );

    expect(delSocio.total).toBe(enEfectivo.total);
    expect(delSocio.cuentas).toBe(1);
  });

  it("en cambio, una mesa liberada sin consumo NO cuenta como cuenta", () => {
    const rango = mesDe(AHORA);
    const r = resumenVentas(
      cuentasCerradasEn([cuentaCobrada({ precio: 100, forma: "efectivo", anulada: true })], rango),
    );
    expect(r.cuentas).toBe(0);
    expect(r.total).toBe(CERO);
  });
});
