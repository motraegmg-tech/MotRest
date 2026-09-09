/**
 * El nombre del cliente en el papel.
 *
 * El dato existía desde el principio y ya llegaba a la comanda de cocina —para
 * que supieran de quién era la bolsa del mostrador—, pero NO al papel que se le
 * entrega al comensal. Estas pruebas fijan que ahora sí, en los tres papeles, y
 * que sigue siendo opcional: la inmensa mayoría de las mesas no llevan nombre y
 * su ticket no debe cambiar en nada.
 */
import { describe, expect, it } from "vitest";
import type { Centavos } from "@motrest/dominio";
import {
  precuenta,
  ticketInterno,
  ticketVenta,
  type DatosPrecuenta,
  type DatosTicket,
  type DatosTicketInterno,
} from "../plantillas.js";

const c = (n: number): Centavos => n as Centavos;

const RENGLONES = [{ cantidad: 2, descripcion: "Pizza mitad y mitad", importe: c(38900) }];

const BASE_PRECUENTA: DatosPrecuenta = {
  folio: "A1B2C3D4",
  ts: Date.UTC(2026, 8, 5, 20, 30),
  local: { nombre: "Rodizio" },
  mesa: "7",
  mesero: "Lucía",
  renglones: RENGLONES,
  suma: c(38900),
  descuentos: c(0),
  cortesias: c(0),
  total: c(38900),
};

const BASE_TICKET: DatosTicket = {
  folio: "A1B2C3D4",
  ts: Date.UTC(2026, 8, 5, 20, 30),
  local: { nombre: "Rodizio" },
  mesa: "7",
  mesero: "Lucía",
  renglones: RENGLONES,
  subtotal: c(33534),
  descuentos: c(0),
  cortesias: c(0),
  iva: c(5366),
  ieps: c(0),
  total: c(38900),
  propina: c(0),
  pagos: [],
  cambio: c(0),
};

const BASE_INTERNO: DatosTicketInterno = {
  folio: "A1B2C3D4",
  ts: Date.UTC(2026, 8, 5, 20, 30),
  mesa: "7",
  mesero: "Lucía",
  renglones: RENGLONES,
  suma: c(38900),
  descuentos: c(0),
  cortesias: c(0),
  total: c(38900),
  propina: c(0),
  pagos: [],
  cambio: c(0),
};

describe("la pre-cuenta que se entrega al comensal", () => {
  it("lleva el nombre cuando la cuenta lo tiene", () => {
    const texto = precuenta({ ...BASE_PRECUENTA, a_nombre_de: "Familia Ramírez" }).aTexto();
    expect(texto).toContain("Cliente: Familia Ramírez");
  });

  it("no dice nada de cliente cuando la cuenta no tiene nombre", () => {
    expect(precuenta(BASE_PRECUENTA).aTexto()).not.toContain("Cliente:");
  });

  it("el nombre va DESPUÉS de la mesa y ANTES de los platillos", () => {
    const lineas = precuenta({ ...BASE_PRECUENTA, a_nombre_de: "Ramírez" })
      .aTexto()
      .split("\n");
    const mesa = lineas.findIndex((l) => l.includes("Mesa: 7"));
    const cliente = lineas.findIndex((l) => l.includes("Cliente: Ramírez"));
    const platillo = lineas.findIndex((l) => l.includes("Pizza mitad y mitad"));
    expect(mesa).toBeGreaterThanOrEqual(0);
    expect(cliente).toBeGreaterThan(mesa);
    expect(platillo).toBeGreaterThan(cliente);
  });

  it("un nombre largo no empuja al mesero fuera del papel angosto", () => {
    // 32 columnas es lo que da una térmica angosta. El nombre va en su PROPIA
    // línea justamente para esto: si compartiera línea con la mesa, el mesero
    // se perdería.
    const texto = precuenta(
      { ...BASE_PRECUENTA, a_nombre_de: "Familia Hernández Gutiérrez" },
      32,
    ).aTexto();
    expect(texto).toContain("Lucía");
    expect(texto).toContain("Familia Hernández Gutiérrez");
  });
});

describe("el ticket de venta", () => {
  it("lleva el nombre cuando lo hay, y nada cuando no", () => {
    expect(ticketVenta({ ...BASE_TICKET, a_nombre_de: "Ramírez" }).aTexto()).toContain(
      "Cliente: Ramírez",
    );
    expect(ticketVenta(BASE_TICKET).aTexto()).not.toContain("Cliente:");
  });
});

describe("la copia que archiva el restaurante", () => {
  it("también lleva el nombre: al reclamar una cuenta hay que saber de quién era", () => {
    expect(ticketInterno({ ...BASE_INTERNO, a_nombre_de: "Ramírez" }).aTexto()).toContain(
      "Cliente: Ramírez",
    );
    expect(ticketInterno(BASE_INTERNO).aTexto()).not.toContain("Cliente:");
  });
});

describe("el nombre no es solo para pedidos para llevar", () => {
  it("una mesa numerada puede llevarlo igual que el mostrador", () => {
    const texto = precuenta({
      ...BASE_PRECUENTA,
      mesa: "7",
      a_nombre_de: "Los del jueves",
    }).aTexto();
    // Las dos cosas conviven: la mesa sigue diciendo cuál es, y el nombre dice
    // de quién. Ninguna sustituye a la otra.
    expect(texto).toContain("Mesa: 7");
    expect(texto).toContain("Cliente: Los del jueves");
  });
});
