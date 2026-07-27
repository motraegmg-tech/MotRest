/**
 * Proyección de clientes.
 *
 * Como todo el dominio, funciones puras sobre el log. Un alta reaplicada no
 * duplica ni pisa lo editado —una resincronización reenvía eventos con toda
 * normalidad—, y una actualización mezcla solo los campos que trae.
 */
import type { ID } from "../comun/ids.js";
import type { DatosReceptor } from "../fiscal/comprobante.js";
import type { DatosCliente, EventoCliente } from "./eventos.js";

export interface Cliente extends DatosCliente {
  cliente_id: ID;
  activo: boolean;
  registrado_ts: number;
}

export function proyectarClientes(eventos: readonly EventoCliente[]): Cliente[] {
  const porId = new Map<ID, Cliente>();

  for (const ev of eventos) {
    if (ev.tipo === "cliente_registrado") {
      if (porId.has(ev.cliente_id)) continue;
      porId.set(ev.cliente_id, {
        cliente_id: ev.cliente_id,
        ...ev.datos,
        activo: true,
        registrado_ts: ev.ts,
      });
    } else if (ev.tipo === "cliente_actualizado") {
      const previo = porId.get(ev.cliente_id);
      if (previo) porId.set(ev.cliente_id, fusionar(previo, ev.cambios));
    } else if (ev.tipo === "cliente_desactivado") {
      const previo = porId.get(ev.cliente_id);
      if (previo) porId.set(ev.cliente_id, { ...previo, activo: false });
    }
  }

  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Aplica los cambios sobre un cliente.
 *
 * Los objetos anidados —fiscal y domicilio— se reemplazan enteros cuando vienen
 * en los cambios, no se mezclan campo a campo: editar el domicilio manda el
 * domicilio completo, y una mezcla profunda dejaría datos viejos colgando.
 */
function fusionar(previo: Cliente, cambios: Partial<DatosCliente>): Cliente {
  return { ...previo, ...cambios };
}

export function clientesActivos(clientes: readonly Cliente[]): Cliente[] {
  return clientes.filter((c) => c.activo);
}

/** Los que pueden facturar: tienen RFC guardado. Prellenan el diálogo de factura. */
export function clientesConFiscal(clientes: readonly Cliente[]): Cliente[] {
  return clientes.filter((c) => c.activo && c.fiscal && c.fiscal.rfc.trim().length > 0);
}

/**
 * Busca por nombre, teléfono o RFC. Sin término, devuelve todos los activos.
 *
 * Se normaliza a minúsculas y sin acentos: quien busca "jose" debe encontrar a
 * "José", y quien teclea un teléfono no debería fallar por un espacio.
 */
export function buscarClientes(clientes: readonly Cliente[], termino: string): Cliente[] {
  const activos = clientesActivos(clientes);
  const q = normalizar(termino);
  if (q.length === 0) return activos;
  return activos.filter((c) => {
    const heno = normalizar(
      [c.nombre, c.telefono ?? "", c.correo ?? "", c.fiscal?.rfc ?? ""].join(" "),
    );
    return heno.includes(q);
  });
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Los datos fiscales del cliente en la forma que pide el CFDI, si los tiene. */
export function receptorDe(cliente: Cliente): DatosReceptor | null {
  return cliente.fiscal && cliente.fiscal.rfc.trim().length > 0 ? cliente.fiscal : null;
}
