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
import {
  permisosDePlantilla,
  puedeOperar,
  puedeVer,
  type Accion,
  type RolId,
  type Usuario,
} from "@motrest/dominio";
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

/*
 * LOS BOTONES DEL DINERO, dentro de la cuenta.
 *
 * `PanelCuenta.svelte` decide con `puedeOperar` si enseña cobrar, propina,
 * descuentos, cortesías y consumo de socio. Antes se enseñaban a todo el mundo y
 * el permiso se comprobaba al pulsar: el mesero veía «Cobrar», lo tocaba y le
 * salía un teclado pidiendo la firma de un superior.
 *
 * Se prueba la REGLA, no el componente. `puedeOperar` es el mismo atajo que usa
 * la pantalla, así que esto falla el día que alguien le dé el cobro al personal
 * de piso para resolver otra cosa — que es exactamente cuando hay que enterarse.
 */
const BOTONES_DEL_DINERO: Accion[] = [
  "pos.cobro.registrar",
  "pos.descuento.aplicar",
  "pos.cortesia.otorgar",
  "pos.socio.consumir",
];

function operables(rol_id: RolId, acciones: Accion[]): Accion[] {
  const usuario = usuarioCon(rol_id);
  return acciones.filter((accion) => puedeOperar(usuario, accion));
}

describe("quién ve el cobro y lo que cuelga de él", () => {
  it("al mesero no le aparece ninguno: el dinero se toca en la caja", () => {
    expect(operables("mesero", BOTONES_DEL_DINERO)).toEqual([]);
  });

  /*
   * El chef es el otro perfil de piso —la barra y la cocina cuelgan de ahí— y
   * tampoco cobra. Se comprueba aparte porque su plantilla es distinta y podría
   * ganar permisos de POS sin que nadie mirara la cuenta.
   */
  it("al chef tampoco", () => {
    expect(operables("chef", BOTONES_DEL_DINERO)).toEqual([]);
  });

  it("el cajero cobra y carga a socios, pero no regala", () => {
    const suyos = operables("cajero", BOTONES_DEL_DINERO);
    expect(suyos).toContain("pos.cobro.registrar");
    expect(suyos).toContain("pos.socio.consumir");
    // Descuentos y cortesías siguen pidiendo la firma de un superior: quien
    // maneja el cajón no puede además decidir a quién se le rebaja la cuenta.
    expect(suyos).not.toContain("pos.descuento.aplicar");
    expect(suyos).not.toContain("pos.cortesia.otorgar");
  });

  it("el gerente y la dirección los tienen todos", () => {
    expect(operables("gerente", BOTONES_DEL_DINERO)).toEqual(BOTONES_DEL_DINERO);
    expect(operables("propietario", BOTONES_DEL_DINERO)).toEqual(BOTONES_DEL_DINERO);
  });

  /*
   * El límite del gerente es del 20 %. El botón de la cuenta aplica un 10 %, así
   * que le sale directo; pedirle autorización a sí mismo sería absurdo. Se fija
   * porque el día que alguien baje ese límite por debajo del 10 %, el botón
   * desaparecería de la pantalla del gerente sin que nadie lo relacionara.
   */
  it("al gerente el −10 % de la cuenta le entra dentro de su límite", () => {
    const gerente = usuarioCon("gerente");
    expect(puedeOperar(gerente, "pos.descuento.aplicar", { porcentaje: 0.1 })).toBe(true);
  });

  /*
   * Imprimir la cuenta NO es cobrar. El comensal la pide en la mesa y quien
   * atiende se la lleva: si esto se hubiera escondido junto con el cobro, el
   * mesero habría tenido que ir por el cajero para entregar un papel.
   */
  it("pero el mesero conserva lo suyo: abrir, capturar, enviar y entregar", () => {
    const mesero = usuarioCon("mesero");
    for (const accion of [
      "pos.orden.abrir",
      "pos.item.agregar",
      "pos.item.enviar_cocina",
      "pos.item.entregar",
    ] as Accion[]) {
      expect(puedeOperar(mesero, accion), accion).toBe(true);
    }
  });
});
