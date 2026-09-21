/**
 * La ficha que deja una factura (1.5.6, pedido de Gonzalo).
 *
 * Al emitir un CFDI la constancia y el correo del comensal ya están tecleados.
 * Estas pruebas cuidan las tres cosas que no pueden salir mal:
 *
 *  - que una factura suelta NO llene la lista de clientes: solo hay ficha nueva
 *    si alguien pulsó «Hacer la Ficha de este Comensal»;
 *  - que un teléfono que ya tiene ficha complete ESA en vez de duplicarla, la
 *    misma regla que en Reservas;
 *  - y que completar no sea pisar: el RFC o el correo que la ficha ya tenía se
 *    quedan como estaban.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatosReceptor } from "@motrest/dominio";
import { clientes } from "../clientes.svelte";

const JUAN: DatosReceptor = {
  rfc: "PELJ800101AB1",
  nombre: "JUAN PEREZ LOPEZ",
  regimen_fiscal: "612",
  codigo_postal: "44650",
  uso_cfdi: "G03",
};

beforeEach(() => {
  clientes.hidratar([]);
});

describe("La ficha que deja una factura", () => {
  it("una factura sin «Hacer la ficha» no da de alta a nadie", () => {
    const r = clientes.fichaDesdeFactura({ receptor: JUAN, correo: "juan@correo.com" });
    expect(r.como).toBe("sin_ficha");
    expect(clientes.activos).toHaveLength(0);
  });

  it("«Hacer la ficha» la crea con la constancia, el correo y lo que se llenó abajo", () => {
    const antes = Date.now();
    const r = clientes.fichaDesdeFactura({
      receptor: JUAN,
      correo: " juan@correo.com ",
      nueva: {
        nombre: "Juan Pérez",
        telefono: "33 1122 3344",
        notas: "Sin cebolla",
        acepta_promociones: true,
        acepta_promociones_ts: antes,
      },
    });

    expect(r.como).toBe("nueva");
    const ficha = clientes.porId(r.id)!;
    expect(ficha.nombre).toBe("Juan Pérez");
    expect(ficha.fiscal).toEqual(JUAN);
    expect(ficha.correo).toBe("juan@correo.com");
    expect(ficha.notas).toBe("Sin cebolla");
    expect(ficha.acepta_promociones).toBe(true);
    expect(ficha.acepta_promociones_ts).toBe(antes);
  });

  it("sin nombre de contacto, la ficha toma el de la factura", () => {
    const r = clientes.fichaDesdeFactura({
      receptor: JUAN,
      correo: "juan@correo.com",
      nueva: { nombre: "  ", telefono: "3311223344" },
    });
    expect(clientes.porId(r.id)?.nombre).toBe("JUAN PEREZ LOPEZ");
  });

  it("si el teléfono ya tiene ficha, completa ESA y no la duplica, se dicte como se dicte", () => {
    const { id } = clientes.registrar({ nombre: "Juan", telefono: "33-1122-3344" });

    const r = clientes.fichaDesdeFactura({
      receptor: JUAN,
      correo: "juan@correo.com",
      nueva: { nombre: "Juan Pérez", telefono: "+52 33 1122 3344" },
    });

    expect(r.como).toBe("telefono");
    expect(r.id).toBe(id);
    expect(clientes.activos).toHaveLength(1);
    const ficha = clientes.porId(id)!;
    expect(ficha.fiscal).toEqual(JUAN);
    expect(ficha.correo).toBe("juan@correo.com");
    // El nombre de la ficha no cambia de rebote: «Juan» sigue siendo «Juan».
    expect(ficha.nombre).toBe("Juan");
  });

  it("a la ficha elegida en el buscador solo se le agrega lo que le faltaba", () => {
    const { id } = clientes.registrar({ nombre: "Juan", correo: "viejo@correo.com" });

    const r = clientes.fichaDesdeFactura({ cliente_id: id, receptor: JUAN, correo: "nuevo@correo.com" });

    expect(r.como).toBe("completada");
    const ficha = clientes.porId(id)!;
    expect(ficha.fiscal).toEqual(JUAN);
    expect(ficha.correo).toBe("viejo@correo.com");
  });

  it("un RFC que la ficha ya tenía no se pisa al facturar con otro", () => {
    const suyo = { ...JUAN, rfc: "PELJ800101XX9" };
    const { id } = clientes.registrar({ nombre: "Juan", fiscal: suyo });

    clientes.fichaDesdeFactura({ cliente_id: id, receptor: JUAN, correo: "juan@correo.com" });

    expect(clientes.porId(id)?.fiscal?.rfc).toBe("PELJ800101XX9");
  });

  it("un «sí» nuevo a las promociones se guarda con su fecha en la ficha existente", () => {
    const { id } = clientes.registrar({ nombre: "Juan", telefono: "3311223344" });
    const cuando = new Date("2026-09-21T14:00:00").getTime();

    clientes.fichaDesdeFactura({
      receptor: JUAN,
      correo: "juan@correo.com",
      nueva: { nombre: "Juan", telefono: "3311223344", acepta_promociones: true, acepta_promociones_ts: cuando },
    });

    const ficha = clientes.porId(id)!;
    expect(ficha.acepta_promociones).toBe(true);
    expect(ficha.acepta_promociones_ts).toBe(cuando);
  });
});
