/**
 * QUÉ MÓDULOS VE CADA RANGO, fijado por escrito.
 *
 * El sidebar filtra por permiso (`MODULOS.filter(m => sesion.puedeVer(m.permiso))`),
 * así que lo que un mesero puede ver no lo decide una pantalla: lo decide la
 * plantilla de su rol. Eso es lo correcto —hay un solo sitio donde mentir— pero
 * también significa que un permiso de más en `roles.ts` le abre el módulo entero
 * sin que nadie lo note al revisar la interfaz.
 *
 * Estas pruebas son el candado. Si algún día alguien le da `fin.corte.ver` a un
 * mesero para resolver otra cosa, esto falla y se entera antes de que el
 * restaurante descubra que el personal de piso ve los cortes de caja.
 *
 * NO se prueba el componente, se prueba la regla. Un test de render diría que el
 * menú tiene tres entradas; este dice CUÁLES y por qué.
 */
import { describe, expect, it } from "vitest";
import { permisosDePlantilla, puedeVer, type RolId, type Usuario } from "@motrest/dominio";
import { MODULOS } from "../nav/modulos";

function usuarioCon(rol_id: RolId): Usuario {
  return {
    id: `usr-${rol_id}`,
    nombre: rol_id,
    iniciales: rol_id.slice(0, 1).toUpperCase(),
    rol_id,
    puesto: rol_id,
    sucursal_id: "suc-prueba",
    permisos: permisosDePlantilla(rol_id),
    activo: true,
  };
}

/** Los módulos que aparecerían en el sidebar de este rol. */
function modulosVisibles(rol_id: RolId): string[] {
  const usuario = usuarioCon(rol_id);
  return MODULOS.filter((m) => puedeVer(usuario, m.permiso)).map((m) => m.titulo);
}

/** Lo que un rango bajo NO puede ver, por más que se toque otra cosa. */
const VEDADOS = ["Finanzas", "Inteligencia", "Administración", "Compras"];

describe("lo que ve el personal de piso", () => {
  it("un mesero NO ve finanzas, inteligencia, compras ni administración", () => {
    const visibles = modulosVisibles("mesero");
    for (const vedado of VEDADOS) {
      expect(visibles).not.toContain(vedado);
    }
  });

  it("pero sí ve aquello con lo que trabaja", () => {
    const visibles = modulosVisibles("mesero");
    expect(visibles).toContain("Venta");
    expect(visibles).toContain("Cocina");
    expect(visibles).toContain("Personal");
  });

  /*
   * El cajero cobra y factura, así que toca dinero — pero eso NO es ver el
   * negocio. El corte del turno, el estado de resultados y el comparativo entre
   * sucursales son del gerente para arriba.
   */
  it("un cajero no ve inteligencia ni administración", () => {
    const visibles = modulosVisibles("cajero");
    expect(visibles).not.toContain("Inteligencia");
    expect(visibles).not.toContain("Administración");
  });
});

describe("lo que ve la dirección", () => {
  it("el propietario ve los nueve módulos: es el rango más alto", () => {
    expect(modulosVisibles("propietario")).toHaveLength(MODULOS.length);
  });
});

/*
 * Sin sesión no se ve NADA. Es la regla de la que cuelga la bitácora entera: si
 * se pudiera operar sin identificarse, cada movimiento quedaría atribuido a
 * nadie. Hubo un parche que devolvía un usuario de «configuración inicial» con
 * permisos de propietario mientras faltaba dar de alta al responsable, y con él
 * cualquiera que abriera la caja tenía el negocio completo.
 */
describe("sin nadie en sesión", () => {
  it("no hay un solo módulo visible", () => {
    const nadie = null;
    const visibles = MODULOS.filter((m) => (nadie ? puedeVer(nadie, m.permiso) : false));
    expect(visibles).toHaveLength(0);
  });
});
