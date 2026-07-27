/**
 * Clientes: ficha, datos fiscales y búsqueda.
 *
 * Lo que importa probar: que la ficha fiscal quede lista para prellenar una
 * factura, que la búsqueda encuentre a "José" tecleando "jose", y que dar de
 * baja conserve el historial en vez de borrarlo.
 */
import { describe, expect, it } from "vitest";
import { FabricaEventos } from "../evento.js";
import type { DatosReceptor } from "../fiscal/comprobante.js";
import type { EventoCliente } from "../clientes/eventos.js";
import {
  buscarClientes,
  clientesConFiscal,
  proyectarClientes,
  receptorDe,
} from "../clientes/reducers.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-caja", sucursal_id: "suc-1" };
const STREAM = "clientes:suc-1";
const fabrica = () => new FabricaEventos<EventoCliente>(CTX);

const FISCAL: DatosReceptor = {
  rfc: "GODE561231GR8",
  nombre: "JOSE PEREZ",
  regimen_fiscal: "612",
  codigo_postal: "44650",
  uso_cfdi: "G03",
};

describe("alta y edición", () => {
  it("registra la ficha con sus datos fiscales", () => {
    const f = fabrica();
    const clientes = proyectarClientes([
      f.crear("cliente_registrado", STREAM, {
        cliente_id: "c1",
        datos: { nombre: "José Pérez", telefono: "33-1122-3344", fiscal: FISCAL },
      }),
    ]);

    expect(clientes[0]).toMatchObject({ nombre: "José Pérez", activo: true });
    expect(receptorDe(clientes[0]!)).toEqual(FISCAL);
  });

  it("una actualización mezcla solo lo que trae", () => {
    const f = fabrica();
    const clientes = proyectarClientes([
      f.crear("cliente_registrado", STREAM, {
        cliente_id: "c1",
        datos: { nombre: "José Pérez", telefono: "33-1122-3344" },
      }),
      f.crear("cliente_actualizado", STREAM, {
        cliente_id: "c1",
        cambios: { correo: "jose@correo.mx" },
      }),
    ]);

    expect(clientes[0]).toMatchObject({
      nombre: "José Pérez",
      telefono: "33-1122-3344",
      correo: "jose@correo.mx",
    });
  });

  it("reaplicar el alta no duplica ni pisa lo editado", () => {
    const f = fabrica();
    const alta = f.crear("cliente_registrado", STREAM, {
      cliente_id: "c1",
      datos: { nombre: "José" },
    });
    const clientes = proyectarClientes([
      alta,
      f.crear("cliente_actualizado", STREAM, { cliente_id: "c1", cambios: { telefono: "555" } }),
      alta,
    ]);

    expect(clientes).toHaveLength(1);
    expect(clientes[0]!.telefono).toBe("555");
  });

  it("dar de baja lo conserva en el historial", () => {
    const f = fabrica();
    const clientes = proyectarClientes([
      f.crear("cliente_registrado", STREAM, { cliente_id: "c1", datos: { nombre: "José" } }),
      f.crear("cliente_desactivado", STREAM, { cliente_id: "c1", motivo: "Duplicado" }),
    ]);

    expect(clientes).toHaveLength(1);
    expect(clientes[0]!.activo).toBe(false);
  });
});

describe("búsqueda", () => {
  function conVarios(): EventoCliente[] {
    const f = fabrica();
    return [
      f.crear("cliente_registrado", STREAM, {
        cliente_id: "c1",
        datos: { nombre: "José Pérez", telefono: "33-1122-3344", fiscal: FISCAL },
      }),
      f.crear("cliente_registrado", STREAM, {
        cliente_id: "c2",
        datos: { nombre: "Ana López", telefono: "33-9988-7766" },
      }),
    ];
  }

  it("encuentra a José tecleando sin acento", () => {
    const clientes = proyectarClientes(conVarios());
    expect(buscarClientes(clientes, "jose").map((c) => c.cliente_id)).toEqual(["c1"]);
  });

  it("busca también por teléfono y por RFC", () => {
    const clientes = proyectarClientes(conVarios());
    expect(buscarClientes(clientes, "9988").map((c) => c.cliente_id)).toEqual(["c2"]);
    expect(buscarClientes(clientes, "GODE561231").map((c) => c.cliente_id)).toEqual(["c1"]);
  });

  it("sin término devuelve todos los activos, ordenados por nombre", () => {
    const clientes = proyectarClientes(conVarios());
    expect(buscarClientes(clientes, "").map((c) => c.nombre)).toEqual(["Ana López", "José Pérez"]);
  });

  it("solo los que tienen RFC pueden prellenar una factura", () => {
    const clientes = proyectarClientes(conVarios());
    expect(clientesConFiscal(clientes).map((c) => c.cliente_id)).toEqual(["c1"]);
  });
});
