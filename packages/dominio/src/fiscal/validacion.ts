/**
 * Revisión del comprobante antes de mandarlo al PAC.
 *
 * Atrapar aquí lo que el SAT rechazaría ahorra timbres y, sobre todo, evita que
 * el comensal se vaya sin su factura. Es la diferencia entre "el PAC lo rechazó"
 * y "aquí falta el código postal".
 */
import { sumar, type Centavos } from "../comun/dinero.js";
import { REGIMENES_FISCALES, RFC_PUBLICO_GENERAL, USOS_CFDI } from "./claves.js";
import type { Comprobante } from "./comprobante.js";
import { codigoPostalValido, rfcValido } from "./rfc.js";

export type ProblemaFiscal =
  | { campo: "emisor.rfc"; mensaje: string }
  | { campo: "emisor.nombre"; mensaje: string }
  | { campo: "emisor.regimen"; mensaje: string }
  | { campo: "emisor.cp"; mensaje: string }
  | { campo: "receptor.rfc"; mensaje: string }
  | { campo: "receptor.nombre"; mensaje: string }
  | { campo: "receptor.regimen"; mensaje: string }
  | { campo: "receptor.cp"; mensaje: string }
  | { campo: "receptor.uso"; mensaje: string }
  | { campo: "conceptos"; mensaje: string }
  | { campo: "totales"; mensaje: string };

/** Revisa el comprobante. Sin problemas = listo para timbrar. */
export function validarComprobante(c: Comprobante): ProblemaFiscal[] {
  const problemas: ProblemaFiscal[] = [];

  // --- Emisor ---
  if (!rfcValido(c.emisor.rfc)) {
    problemas.push({ campo: "emisor.rfc", mensaje: "El RFC del restaurante no es válido" });
  }
  if (c.emisor.nombre.trim().length < 3) {
    problemas.push({
      campo: "emisor.nombre",
      mensaje: "Falta la razón social del restaurante, tal como aparece en la constancia fiscal",
    });
  }
  if (!REGIMENES_FISCALES.some((r) => r.clave === c.emisor.regimen_fiscal)) {
    problemas.push({ campo: "emisor.regimen", mensaje: "El régimen fiscal del emisor no es válido" });
  }
  if (!codigoPostalValido(c.emisor.codigo_postal)) {
    problemas.push({
      campo: "emisor.cp",
      mensaje: "Falta el código postal del domicilio fiscal del restaurante",
    });
  }

  // --- Receptor ---
  const esPublicoGeneral = c.receptor.rfc === RFC_PUBLICO_GENERAL;

  if (!rfcValido(c.receptor.rfc)) {
    problemas.push({ campo: "receptor.rfc", mensaje: "El RFC del cliente no es válido" });
  }
  if (c.receptor.nombre.trim().length < 3) {
    problemas.push({
      campo: "receptor.nombre",
      mensaje: "Falta el nombre o razón social del cliente",
    });
  }
  if (!REGIMENES_FISCALES.some((r) => r.clave === c.receptor.regimen_fiscal)) {
    problemas.push({ campo: "receptor.regimen", mensaje: "El régimen fiscal del cliente no es válido" });
  }
  // CFDI 4.0 exige el domicilio fiscal del receptor, salvo público en general.
  if (!esPublicoGeneral && !codigoPostalValido(c.receptor.codigo_postal)) {
    problemas.push({
      campo: "receptor.cp",
      mensaje: "Falta el código postal del cliente (obligatorio en CFDI 4.0)",
    });
  }
  if (!USOS_CFDI.some((u) => u.clave === c.receptor.uso_cfdi)) {
    problemas.push({ campo: "receptor.uso", mensaje: "El uso del CFDI no es válido" });
  }
  if (esPublicoGeneral && c.receptor.uso_cfdi !== "S01") {
    problemas.push({
      campo: "receptor.uso",
      mensaje: 'Al público en general el uso debe ser "Sin efectos fiscales"',
    });
  }

  // --- Conceptos y cuadre ---
  if (c.conceptos.length === 0) {
    problemas.push({ campo: "conceptos", mensaje: "El comprobante no tiene conceptos" });
  }
  if (c.total <= 0) {
    problemas.push({ campo: "totales", mensaje: "El total del comprobante debe ser mayor a cero" });
  }

  const sumaConceptos = sumar(...c.conceptos.map((x) => x.importe));
  if (sumaConceptos !== c.subtotal) {
    problemas.push({
      campo: "totales",
      mensaje: "La suma de los conceptos no coincide con el subtotal",
    });
  }

  const totalEsperado = (c.subtotal - c.descuento + c.total_impuestos_trasladados) as Centavos;
  if (totalEsperado !== c.total) {
    problemas.push({
      campo: "totales",
      mensaje: "El total no cuadra con subtotal − descuento + impuestos",
    });
  }

  return problemas;
}

export function listoParaTimbrar(c: Comprobante): boolean {
  return validarComprobante(c).length === 0;
}
