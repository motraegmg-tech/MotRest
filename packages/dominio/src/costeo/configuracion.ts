/**
 * Construcción de un renglón a partir de lo que el usuario configuró.
 *
 * Única puerta de entrada: aquí se resuelven precio, costo, impuesto y texto
 * descriptivo, y se congelan como snapshot. Que exista un solo camino evita que
 * la pantalla, el ticket de cocina y la factura calculen cosas distintas.
 */
import { sumar, type Centavos } from "../comun/dinero.js";
import { uuidv7, type ID } from "../comun/ids.js";
import { snapshotTasas, type PerfilImpuesto } from "../comun/impuestos.js";
import {
  costoModificadores,
  describirSeleccion,
  precioModificadores,
  validarSeleccion,
  type ProblemaSeleccion,
  type SeleccionModificador,
} from "../catalogo/modificadores.js";
import type { PorcionElegida } from "../catalogo/porciones.js";
import { gruposDe, productoDe, type CatalogoIndex } from "../catalogo/productos.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { costearPorciones } from "./costeo.js";

/** Lo que el usuario eligió antes de agregar el platillo a la cuenta. */
export interface ConfiguracionRenglon {
  producto_id: ID;
  cantidad: number;
  porciones?: PorcionElegida[];
  modificadores?: SeleccionModificador[];
  notas?: string;
  curso?: number;
}

export interface DesglosePrecio {
  base: Centavos;
  modificadores: Centavos;
  unitario: Centavos;
}

export interface DesgloseCosto {
  base: Centavos;
  modificadores: Centavos;
  unitario: Centavos;
}

/** Precio unitario: el del producto (o de sus porciones) más los modificadores. */
export function precioConfiguracion(
  config: ConfiguracionRenglon,
  cat: CatalogoIndex,
): DesglosePrecio {
  const producto = productoDe(cat, config.producto_id);
  const base = producto.precio;
  const modificadores = precioModificadores(
    gruposDe(cat, producto),
    config.modificadores ?? [],
  );
  return { base, modificadores, unitario: sumar(base, modificadores) };
}

/** Costo unitario: porciones si las hay, más los deltas de los modificadores. */
export function costoConfiguracion(
  config: ConfiguracionRenglon,
  cat: CatalogoIndex,
): DesgloseCosto {
  const producto = productoDe(cat, config.producto_id);
  const base = config.porciones?.length
    ? costearPorciones(config.porciones, cat)
    : producto.costo;
  const modificadores = costoModificadores(config.modificadores ?? []);
  return { base, modificadores, unitario: sumar(base, modificadores) };
}

/** Revisa que la configuración cumpla los mínimos y máximos de cada grupo. */
export function validarConfiguracion(
  config: ConfiguracionRenglon,
  cat: CatalogoIndex,
): ProblemaSeleccion[] {
  const producto = productoDe(cat, config.producto_id);
  return validarSeleccion(gruposDe(cat, producto), config.modificadores ?? []);
}

/** Texto legible de la configuración: "½ Margherita · ½ Pepperoni · Extra queso". */
export function describirConfiguracion(
  config: ConfiguracionRenglon,
  cat: CatalogoIndex,
): string | undefined {
  const partes: string[] = [];

  if (config.porciones?.length) {
    partes.push(
      config.porciones
        .map((p) => `½ ${productoDe(cat, p.producto_id).nombre}`)
        .join(" · "),
    );
  }
  if (config.modificadores?.length) {
    partes.push(describirSeleccion(config.modificadores));
  }
  if (config.notas?.trim()) {
    partes.push(config.notas.trim());
  }

  return partes.length > 0 ? partes.join(" · ") : undefined;
}

/**
 * Construye el renglón completo. Es la ÚNICA forma de crear uno: garantiza que
 * precio, costo, impuesto y descripción queden congelados de forma coherente.
 */
export function construirRenglon(
  config: ConfiguracionRenglon,
  cat: CatalogoIndex,
  impuestoPorDefecto: PerfilImpuesto,
): RenglonComanda {
  const producto = productoDe(cat, config.producto_id);
  const perfil = cat.impuestos.get(producto.impuesto_id) ?? impuestoPorDefecto;

  return {
    id: uuidv7(),
    producto_id: producto.id,
    descripcion: producto.nombre,
    detalle: describirConfiguracion(config, cat),
    cantidad: config.cantidad,
    precio_unitario: precioConfiguracion(config, cat).unitario,
    costo_unitario: costoConfiguracion(config, cat).unitario,
    impuesto: snapshotTasas(perfil),
    porciones: config.porciones,
    modificadores: config.modificadores,
    notas: config.notas?.trim() || undefined,
    estado: "capturado",
    estacion_id: producto.estacion_id,
    curso: config.curso,
  };
}
