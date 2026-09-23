/**
 * El QR de factura del ticket (1.5.6): el portal de autofactura, en el papel.
 *
 * Lo que se fija: que solo salga cuando el Hub anuncia el portal encendido, que
 * no salga en una cuenta que el portal rechazaría, que traiga debajo cómo
 * teclearlo a mano, y que su código sea EXACTAMENTE el que el Hub publicará —si
 * difieren en un carácter, el comensal escanea y el portal no encuentra nada—.
 *
 * La clave del local se sustituye como en el QR de reseña: emparejar de verdad
 * abriría un WebSocket contra un Hub que aquí no existe.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FabricaEventos,
  IVA_16,
  codigoDeAutofactura,
  pesos,
  proyectarComanda,
  snapshotTasas,
  uuidv7,
  type EventoComanda,
  type FormaPago,
} from "@motrest/dominio";
import { derivarSecretoAutofactura, generarClaveLocal } from "@motrest/protocolo-sync";
import { autofactura } from "../autofactura.svelte";
import { portal } from "../portal.svelte";
import { sync } from "../sync.svelte";

const CLAVE_LOCAL = generarClaveLocal();
const ENCENDIDO = { activo: true, clave: "RODIZIO", portal_url: "https://motrest-factura.vercel.app/" };

beforeAll(() => {
  const proto = Object.getPrototypeOf(sync) as { claveLocal: string };
  vi.spyOn(proto, "claveLocal", "get").mockReturnValue(CLAVE_LOCAL);
});

beforeEach(() => {
  autofactura.fusionar({ activo: false });
});

function cuenta(precio: number, forma?: FormaPago) {
  const f = new FabricaEventos<EventoComanda>({ device_id: "d1", empleado_id: "u1", sucursal_id: "s1" });
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "m1", abierta_ts: Date.now() }),
    f.crear("item_agregado", orden_id, {
      orden_id,
      renglon: {
        id: uuidv7(), producto_id: "p", descripcion: "Pizza", cantidad: 1, precio_unitario: pesos(precio),
        costo_unitario: pesos(1), impuesto: snapshotTasas(IVA_16), estado: "entregado",
      },
    }),
    ...(forma ? [f.crear("pago_registrado", orden_id, { orden_id, monto: pesos(precio * 1.16), forma })] : []),
  ];
  return proyectarComanda(eventos);
}

describe("el QR de factura del ticket", () => {
  it("con el portal apagado no se imprime", async () => {
    expect(await portal.qrDeFactura(cuenta(250))).toBeNull();
  });

  it("encendido, lleva a la clave y folio del ticket, con el MISMO código que publica el Hub", async () => {
    autofactura.fusionar(ENCENDIDO);
    const c = cuenta(250);
    const folio = c.orden_id.slice(-8).toUpperCase();
    const codigo = await codigoDeAutofactura(c.orden_id, await derivarSecretoAutofactura(CLAVE_LOCAL));

    const qr = (await portal.qrDeFactura(c))!;
    expect(qr.url).toBe(`https://motrest-factura.vercel.app/r/RODIZIO/${folio}?t=${codigo}`);
    // Debajo del QR: primero la dirección escrita, luego la clave y el folio.
    expect(qr.pie).toEqual(["motrest-factura.vercel.app", `Clave: RODIZIO   Folio: ${folio}`]);
    expect(qr.leyenda).toMatch(/Escanee este código QR/);
    expect(qr.esFactura).toBe(true);
  });

  it("no se imprime en una cuenta en $0 ni en consumo de socio: el portal la rechazaría", async () => {
    autofactura.fusionar(ENCENDIDO);
    expect(await portal.qrDeFactura(cuenta(0))).toBeNull();
    expect(await portal.qrDeFactura(cuenta(250, "socio"))).toBeNull();
  });

  it("lo que no tiene forma de portal encendido se toma por apagado", async () => {
    autofactura.fusionar({ activo: true, clave: "RODIZIO", portal_url: "http://inseguro.example" });
    expect(autofactura.portal).toBeNull();
    autofactura.fusionar("encendido");
    expect(autofactura.portal).toBeNull();
  });
});
