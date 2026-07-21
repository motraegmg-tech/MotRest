import { describe, expect, it } from "vitest";
import {
  CATALOGO_ACCIONES,
  TODAS_LAS_ACCIONES,
  definicionAccion,
} from "../identidad/acciones.js";
import {
  MAX_INTENTOS,
  crearCredencial,
  politicaIntentos,
  validarSecreto,
  verificarCredencial,
} from "../identidad/credenciales.js";
import {
  esLectura,
  evaluar,
  puedeAutorizar,
  puedeVer,
  rolesQueAutorizan,
} from "../identidad/matriz.js";
import { ROLES, permisosDePlantilla, type RolId, type Usuario } from "../identidad/roles.js";

function usuario(rol_id: RolId, extra: Partial<Usuario> = {}): Usuario {
  return {
    id: `usr-${rol_id}`,
    nombre: rol_id,
    iniciales: rol_id.slice(0, 1).toUpperCase(),
    rol_id,
    puesto: ROLES[rol_id].nombre,
    sucursal_id: "suc-centro",
    permisos: permisosDePlantilla(rol_id),
    activo: true,
    ...extra,
  };
}

// --- Catálogo de acciones -------------------------------------------------------

describe("catálogo de acciones", () => {
  it("no tiene acciones duplicadas", () => {
    expect(new Set(TODAS_LAS_ACCIONES).size).toBe(TODAS_LAS_ACCIONES.length);
  });

  it("toda acción tiene etiqueta y descripción para mostrar al administrador", () => {
    for (const accion of TODAS_LAS_ACCIONES) {
      const d = definicionAccion(accion);
      expect(d, accion).toBeDefined();
      expect(d!.etiqueta.length).toBeGreaterThan(0);
      expect(d!.descripcion.length).toBeGreaterThan(0);
    }
  });

  it("cubre los nueve módulos", () => {
    expect(CATALOGO_ACCIONES.map((g) => g.modulo)).toEqual([
      "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9",
    ]);
  });

  it("distingue acciones de consulta de las que modifican", () => {
    expect(esLectura("fin.costo.ver")).toBe(true);
    expect(esLectura("pos.orden.ver_ajenas")).toBe(true);
    expect(esLectura("pos.item.cancelar_enviado")).toBe(false);
  });
});

// --- Jerarquía de roles ----------------------------------------------------------

describe("roles del PRD §2", () => {
  it("el propietario puede todo, al máximo nivel", () => {
    const g = usuario("propietario");
    for (const accion of TODAS_LAS_ACCIONES) {
      expect(evaluar(g, accion).resultado, accion).toBe("permitido");
      expect(puedeAutorizar(g, accion), accion).toBe(true);
    }
  });

  it("todo permiso apunta a una acción que existe", () => {
    for (const rol of Object.values(ROLES)) {
      for (const permiso of rol.permisos) {
        expect(definicionAccion(permiso.accion), `${rol.id}/${permiso.accion}`).toBeDefined();
      }
    }
  });

  it("un usuario desactivado no puede nada", () => {
    const inactivo = usuario("gerente", { activo: false });
    expect(evaluar(inactivo, "pos.item.agregar").resultado).toBe("denegado");
  });
});

// --- El caso que pidió Gonzalo ---------------------------------------------------

describe("cancelar un platillo ya enviado a cocina", () => {
  it("el mesero no puede: requiere autorización de un superior", () => {
    const v = evaluar(usuario("mesero"), "pos.item.cancelar_enviado");
    expect(v.resultado).toBe("requiere_autorizacion");
    if (v.resultado === "requiere_autorizacion") {
      expect(v.roles_autorizantes).toContain("gerente");
      expect(v.roles_autorizantes).toContain("propietario");
    }
  });

  it("el gerente sí puede, y además puede firmar la autorización de otros", () => {
    expect(evaluar(usuario("gerente"), "pos.item.cancelar_enviado").resultado).toBe("permitido");
    expect(puedeAutorizar(usuario("gerente"), "pos.item.cancelar_enviado")).toBe(true);
  });

  it("el mesero sí puede cancelar lo que aún no sale a cocina", () => {
    expect(evaluar(usuario("mesero"), "pos.item.cancelar_previo_envio").resultado).toBe(
      "permitido",
    );
  });
});

describe("el food cost no lo ve cualquiera", () => {
  it("el mesero no ve costos ni márgenes", () => {
    expect(puedeVer(usuario("mesero"), "fin.costo.ver")).toBe(false);
  });

  it("el gerente, el chef y el propietario sí", () => {
    for (const rol of ["gerente", "chef", "propietario"] as RolId[]) {
      expect(puedeVer(usuario(rol), "fin.costo.ver"), rol).toBe(true);
    }
  });
});

describe("límites por rol", () => {
  it("el gerente aplica descuentos hasta su tope y pide autorización arriba de él", () => {
    const g = usuario("gerente");
    expect(evaluar(g, "pos.descuento.aplicar", { porcentaje: 0.15 }).resultado).toBe("permitido");

    const excedido = evaluar(g, "pos.descuento.aplicar", { porcentaje: 0.5 });
    expect(excedido.resultado).toBe("requiere_autorizacion");
    if (excedido.resultado === "requiere_autorizacion") {
      expect(excedido.roles_autorizantes).toContain("propietario");
    }
  });

  it("el retiro de caja respeta el tope en centavos", () => {
    const g = usuario("gerente");
    expect(evaluar(g, "caja.retiro.registrar", { monto: 300_000 }).resultado).toBe("permitido");
    expect(evaluar(g, "caja.retiro.registrar", { monto: 900_000 }).resultado).toBe(
      "requiere_autorizacion",
    );
  });
});

describe("permisos ajustados por usuario", () => {
  it("se pueden quitar permisos de la plantilla al dar de alta", () => {
    const cajeroSinCobro = usuario("cajero", {
      permisos: permisosDePlantilla("cajero").filter((x) => x.accion !== "pos.cobro.registrar"),
    });
    expect(evaluar(cajeroSinCobro, "pos.cobro.registrar").resultado).toBe("denegado");
    expect(evaluar(cajeroSinCobro, "pos.item.agregar").resultado).toBe("permitido");
  });

  it("se pueden agregar permisos por encima de la plantilla", () => {
    const meseroConCostos = usuario("mesero", {
      permisos: [...permisosDePlantilla("mesero"), { accion: "fin.costo.ver", nivel: "ver" }],
    });
    expect(puedeVer(meseroConCostos, "fin.costo.ver")).toBe(true);
  });

  it("quien autoriza una acción aparece listado", () => {
    expect(rolesQueAutorizan("pos.cortesia.otorgar")).toEqual(
      expect.arrayContaining(["propietario", "gerente"]),
    );
  });
});

// --- Credenciales -----------------------------------------------------------------

describe("credenciales", () => {
  it("verifica el secreto correcto y rechaza el incorrecto", async () => {
    const cred = await crearCredencial("usr-1", "1234", "pin");
    expect(await verificarCredencial("1234", cred)).toBe(true);
    expect(await verificarCredencial("1235", cred)).toBe(false);
  });

  it("nunca guarda el secreto en claro", async () => {
    const cred = await crearCredencial("usr-1", "MiClaveSegura9", "contrasena");
    const serializado = JSON.stringify(cred);
    expect(serializado).not.toContain("MiClaveSegura9");
    expect(cred.algoritmo).toBe("PBKDF2-SHA256");
  });

  it("dos credenciales del mismo secreto tienen sal y hash distintos", async () => {
    const a = await crearCredencial("usr-1", "1234", "pin");
    const b = await crearCredencial("usr-2", "1234", "pin");
    expect(a.sal).not.toBe(b.sal);
    expect(a.hash).not.toBe(b.hash);
  });

  it("bloquea progresivamente tras varios fallos", () => {
    const ahora = 1_000_000;
    expect(politicaIntentos({ fallos: 2, ultimo_fallo_ts: ahora }, ahora).permitido).toBe(true);

    const esperando = politicaIntentos({ fallos: 4, ultimo_fallo_ts: ahora }, ahora);
    expect(esperando.permitido).toBe(false);
    expect(esperando.bloqueado).toBe(false);
    expect(esperando.espera_ms).toBeGreaterThan(0);

    // Tras esperar lo suficiente, vuelve a permitir.
    expect(
      politicaIntentos({ fallos: 4, ultimo_fallo_ts: ahora }, ahora + 10 * 60_000).permitido,
    ).toBe(true);
  });
});

describe("tope de 7 intentos", () => {
  const ahora = 1_000_000;

  it("son exactamente 7 los intentos permitidos", () => {
    expect(MAX_INTENTOS).toBe(7);
  });

  it("va descontando los intentos restantes", () => {
    expect(politicaIntentos({ fallos: 0, ultimo_fallo_ts: 0 }, ahora).restantes).toBe(7);
    expect(politicaIntentos({ fallos: 3, ultimo_fallo_ts: 0 }, ahora).restantes).toBe(4);
    expect(politicaIntentos({ fallos: 6, ultimo_fallo_ts: 0 }, ahora).restantes).toBe(1);
  });

  it("al séptimo fallo queda bloqueado", () => {
    const r = politicaIntentos({ fallos: MAX_INTENTOS, ultimo_fallo_ts: ahora }, ahora);
    expect(r.bloqueado).toBe(true);
    expect(r.permitido).toBe(false);
    expect(r.restantes).toBe(0);
  });

  it("el bloqueo NO se levanta con el tiempo: requiere desbloqueo", () => {
    // Un año después sigue bloqueado; solo un autorizante puede reactivarlo.
    const muchoDespues = ahora + 365 * 24 * 60 * 60_000;
    const r = politicaIntentos({ fallos: MAX_INTENTOS, ultimo_fallo_ts: ahora }, muchoDespues);
    expect(r.bloqueado).toBe(true);
    expect(r.permitido).toBe(false);
  });

  it("nunca permite un octavo intento", () => {
    for (const fallos of [7, 8, 20, 100]) {
      const r = politicaIntentos({ fallos, ultimo_fallo_ts: 0 }, ahora);
      expect(r.permitido, `con ${fallos} fallos`).toBe(false);
      expect(r.bloqueado, `con ${fallos} fallos`).toBe(true);
    }
  });

  it("valida la calidad del secreto", () => {
    expect(validarSecreto("1111", "pin")).not.toBeNull();
    expect(validarSecreto("12", "pin")).not.toBeNull();
    expect(validarSecreto("4821", "pin")).toBeNull();

    expect(validarSecreto("corta1", "contrasena")).not.toBeNull();
    expect(validarSecreto("solamenteletras", "contrasena")).not.toBeNull();
    expect(validarSecreto("MotraeCEO21", "contrasena")).toBeNull();
  });
});
