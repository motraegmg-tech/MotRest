/**
 * Datos de presentación y semilla del local.
 *
 * Los empleados aquí son PROVISIONALES: la identidad real (login, roles y
 * permisos granulares, usuario Gonzalo DJA) llega en la etapa 2.
 */
import { uuidv7 } from "@motrest/dominio";
import type { ID } from "@motrest/dominio";

export const modulos = [
  "Venta",
  "Cocina",
  "Inventario",
  "Compras",
  "Finanzas",
  "Personal",
  "Clientes",
  "Inteligencia",
  "Ajustes",
] as const;

export const moduloActivo = "Venta";

export const SUCURSAL_ID: ID = "suc-rodizio-centro";

export interface Empleado {
  id: ID;
  nombre: string;
  puesto: string;
  iniciales: string;
}

/** Semilla provisional de empleados (la identidad real llega en la etapa 2). */
export const empleados: Empleado[] = [
  { id: "emp-lucia", nombre: "Lucía", puesto: "Mesera", iniciales: "L" },
  { id: "emp-gerente", nombre: "Marco", puesto: "Gerente", iniciales: "M" },
];

export const empleadosPorId: ReadonlyMap<ID, Empleado> = new Map(
  empleados.map((e) => [e.id, e]),
);

export function nombreEmpleado(id: ID): string {
  return empleadosPorId.get(id)?.nombre ?? "—";
}

/** Empleado con la sesión iniciada (provisional hasta la etapa 2). */
export const EMPLEADO_ACTUAL: ID = "emp-lucia";

export const cabecera = {
  titulo: "Punto de venta",
  sucursal: "Rodizio · Centro",
  demo: "Datos de demostración",
};

/**
 * Identidad del dispositivo, persistida en el navegador.
 * Sustituye al antiguo `"pos-caja-01"` hardcodeado: cada equipo tiene su UUID.
 */
const LLAVE_DEVICE = "motrest.device_id";

export function obtenerDeviceId(): ID {
  if (typeof localStorage === "undefined") return "dev-efimero";
  const guardado = localStorage.getItem(LLAVE_DEVICE);
  if (guardado) return guardado;
  const nuevo = uuidv7();
  localStorage.setItem(LLAVE_DEVICE, nuevo);
  return nuevo;
}

/** Mesas del salón. Sin número de comensales (decisión de Gonzalo). */
export interface Mesa {
  id: ID;
  numero: number;
}

export const mesas: Mesa[] = Array.from({ length: 12 }, (_, i) => ({
  id: `mesa-${i + 1}`,
  numero: i + 1,
}));
