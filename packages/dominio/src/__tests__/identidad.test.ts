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
  permisosNoOtorgables,
  puedeAutorizar,
  puedeGestionarA,
  puedeOperar,
  puedeOtorgar,
  puedeVer,
  rolesAsignablesPor,
  rolesQueAutorizan,
} from "../identidad/matriz.js";
import {
  ROLES,
  permisosDePlantilla,
  rangoDe,
  type RolId,
  type Usuario,
} from "../identidad/roles.js";

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

// --- Jerarquía: nadie administra a un igual ni a un superior -----------------------

describe("jerarquía de roles", () => {
  const gonzalo = usuario("propietario");
  const marco = usuario("gerente");
  const otroGerente = usuario("gerente", { id: "usr-gerente-2" });
  const lucia = usuario("mesero");

  it("el propietario está por encima de todos", () => {
    for (const rol of ["gerente", "administracion", "chef", "cajero", "mesero"] as RolId[]) {
      expect(rangoDe("propietario") > rangoDe(rol), rol).toBe(true);
    }
  });

  it("un gerente NO puede administrar a la dirección", () => {
    // Este era el hueco: Marco podía editar los permisos de Gonzalo.
    expect(puedeGestionarA(marco, gonzalo)).toBe(false);
  });

  it("un gerente NO puede administrar a otro gerente", () => {
    expect(puedeGestionarA(marco, otroGerente)).toBe(false);
  });

  it("nadie puede administrarse a sí mismo", () => {
    expect(puedeGestionarA(gonzalo, gonzalo)).toBe(false);
    expect(puedeGestionarA(marco, marco)).toBe(false);
  });

  it("el gerente sí administra a quien está por debajo", () => {
    expect(puedeGestionarA(marco, lucia)).toBe(true);
  });

  it("el propietario administra al gerente", () => {
    expect(puedeGestionarA(gonzalo, marco)).toBe(true);
  });

  it("solo se asignan roles por debajo del propio", () => {
    const porGerente = rolesAsignablesPor(marco);
    expect(porGerente).not.toContain("propietario");
    expect(porGerente).not.toContain("gerente");
    expect(porGerente).toContain("mesero");

    expect(rolesAsignablesPor(gonzalo)).toContain("gerente");
    // El mesero solo supera en rango al comensal; de todos modos el permiso
    // admin.usuario.crear le impide dar de alta a nadie.
    expect(rolesAsignablesPor(lucia)).toEqual(["comensal"]);
    expect(evaluar(lucia, "admin.usuario.crear").resultado).not.toBe("permitido");
  });
});

describe("delegación de permisos", () => {
  const marco = usuario("gerente");
  const lucia = usuario("mesero");

  it("no se puede conceder un permiso que uno no tiene", () => {
    // El gerente no tiene admin.rol.editar: no puede dárselo a nadie.
    expect(puedeOtorgar(marco, { accion: "admin.rol.editar", nivel: "operar" })).toBe(false);
  });

  it("no se puede conceder un nivel superior al propio", () => {
    // El gerente solo VE el food cost; no puede dar permiso de operarlo.
    expect(puedeOtorgar(marco, { accion: "fin.costo.ver", nivel: "ver" })).toBe(true);
    expect(puedeOtorgar(marco, { accion: "fin.costo.ver", nivel: "autorizar" })).toBe(false);
  });

  it("sí se puede conceder lo que uno tiene, al mismo nivel o menor", () => {
    expect(puedeOtorgar(marco, { accion: "pos.item.agregar", nivel: "operar" })).toBe(true);
    expect(puedeOtorgar(marco, { accion: "pos.item.cancelar_enviado", nivel: "operar" })).toBe(true);
  });

  it("no se puede delegar un límite mayor al propio", () => {
    // El gerente tiene descuento hasta 20 %.
    expect(puedeOtorgar(marco, { accion: "pos.descuento.aplicar", nivel: "operar", limite: 0.1 })).toBe(true);
    expect(puedeOtorgar(marco, { accion: "pos.descuento.aplicar", nivel: "operar", limite: 0.5 })).toBe(false);
    // Sin límite explícito sería "sin tope": tampoco se permite.
    expect(puedeOtorgar(marco, { accion: "pos.descuento.aplicar", nivel: "operar" })).toBe(false);
  });

  it("señala exactamente qué permisos exceden lo que el actor puede dar", () => {
    const intento = [
      { accion: "pos.item.agregar", nivel: "operar" } as const,
      { accion: "admin.rol.editar", nivel: "autorizar" } as const,
      { accion: "caja.corte.sellar", nivel: "autorizar" } as const,
    ];
    const excedidos = permisosNoOtorgables(marco, intento);
    expect(excedidos.map((p) => p.accion)).toEqual(["admin.rol.editar", "caja.corte.sellar"]);
  });

  it("un mesero no puede delegar nada que no tenga", () => {
    expect(puedeOtorgar(lucia, { accion: "fin.costo.ver", nivel: "ver" })).toBe(false);
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

// --- Quién ve qué propinas ------------------------------------------------------

/*
 * El alcance va en SU PROPIA ACCIÓN, no en el nivel. El nivel "ver" vs "operar"
 * no separa alcances en una consulta: la matriz trata toda acción terminada en
 * .ver como lectura, así que "ver" ya alcanza para ejecutarla. Con una sola
 * acción de dos niveles, un mesero habría visto lo que gana todo el equipo.
 */
describe("propinas: quién ve las suyas y quién las del local", () => {
  it("un mesero ve las suyas, nunca el fondo del local", () => {
    const m = usuario("mesero");
    expect(puedeVer(m, "rrhh.propina.ver")).toBe(true);
    expect(puedeVer(m, "rrhh.propina.ver_local")).toBe(false);
    // El candado que importa: ni siquiera por la puerta de "operar".
    expect(puedeOperar(m, "rrhh.propina.ver_local")).toBe(false);
  });

  it("un cajero también ve solo las suyas", () => {
    const c = usuario("cajero");
    expect(puedeVer(c, "rrhh.propina.ver")).toBe(true);
    expect(puedeVer(c, "rrhh.propina.ver_local")).toBe(false);
  });

  it("gerencia y contabilidad ven el fondo completo", () => {
    for (const rol of ["gerente", "administracion", "propietario"] as const) {
      expect(puedeVer(usuario(rol), "rrhh.propina.ver_local")).toBe(true);
    }
  });

  /* Cocina no atiende mesas: el apartado ni siquiera se le pinta. */
  it("a quien no atiende mesas no se le muestra nada", () => {
    expect(puedeVer(usuario("chef"), "rrhh.propina.ver")).toBe(false);
    expect(puedeVer(usuario("comensal"), "rrhh.propina.ver")).toBe(false);
    expect(puedeVer(usuario("comensal"), "rrhh.propina.ver_local")).toBe(false);
  });
});
