/**
 * El acceso de soporte de MOTRAE.
 *
 * Aquí se prueban las dos mitades, y las dos importan igual:
 *
 *   - Que de verdad esté OCULTO. No basta con quitarlo de la lista de usuarios:
 *     un rol que asoma en el diálogo de "pide autorización a…" delata que existe.
 *
 *   - Que NO se pueda falsificar ni tapar. Sin firma no hay acceso, el
 *     restaurante no puede desactivarlo, y lo que hace se ve en la bitácora.
 *     Un acceso de proveedor que no se puede auditar es otra cosa.
 */
import { describe, expect, it } from "vitest";
import {
  NOMBRE_SOPORTE,
  USUARIO_SOPORTE_ID,
  conSoporte,
  credencialDeSoporte,
  esSoporte,
  puedeEntrarBloqueado,
  usuarioSoporte,
} from "../identidad/soporte.js";
import {
  ROLES_VISIBLES,
  permisosDePlantilla,
  usuariosVisibles,
  type Usuario,
} from "../identidad/roles.js";
import { puedeGestionarA, rolesAsignablesPor, rolesQueAutorizan } from "../identidad/matriz.js";
import type { Licencia } from "../organizacion/licencia.js";

const SUC = "suc-rodizio";
const AHORA = new Date(2026, 6, 24, 21, 0).getTime();

const SOPORTE = { sal: "c2FsLWRlLW1vdHJhZQ==", hash: "aGFzaC1kZS1tb3RyYWU=", iteraciones: 600_000 };

function lic(extra: Partial<Licencia> = {}): Licencia {
  return {
    sucursal_id: SUC, nombre: "Rodizio", plan: "mensual",
    vence_ts: AHORA + 30 * 86_400_000, gracia_dias: 3, emitida_ts: AHORA,
    soporte: SOPORTE, firma: "firma-valida", ...extra,
  };
}

const propietario: Usuario = {
  id: "usr-gonzalo", nombre: "Gonzalo DJA", iniciales: "G", rol_id: "propietario",
  puesto: "Dirección", sucursal_id: SUC, permisos: permisosDePlantilla("propietario"),
  activo: true,
};

// --- Que no se vea -------------------------------------------------------------------------

describe("el restaurante no lo ve por ninguna parte", () => {
  it("no sale en la lista de personal", () => {
    const todos = [propietario, usuarioSoporte(SUC)];
    expect(todos).toHaveLength(2);
    expect(usuariosVisibles(todos).map((u) => u.nombre)).toEqual(["Gonzalo DJA"]);
  });

  /*
   * EL ESCONDITE QUE SE OLVIDA. `rolesQueAutorizan` alimenta el diálogo de PIN
   * que ve cualquier mesero al pedir una cancelación. Si Soporte MOTRAE saliera
   * ahí, daría igual haberlo quitado de la lista de usuarios.
   */
  it("no asoma entre los roles que pueden autorizar", () => {
    expect(rolesQueAutorizan("pos.item.cancelar_enviado")).not.toContain("soporte");
    expect(rolesQueAutorizan("caja.retiro.registrar")).not.toContain("soporte");
  });

  it("no se puede elegir al dar de alta a alguien, ni siendo propietario", () => {
    expect(rolesAsignablesPor(propietario)).not.toContain("soporte");
    expect(ROLES_VISIBLES.map((r) => r.id)).not.toContain("soporte");
  });
});

// --- Que no se pueda quitar ni falsificar ---------------------------------------------------

describe("nadie del restaurante puede quitarlo ni fabricarse uno", () => {
  /*
   * Rango 120 contra 100: `puedeGestionarA` exige rango estrictamente mayor, así
   * que el propietario no puede desactivarlo ni cambiarle los permisos. Esto
   * también protege al restaurante: impide que un empleado enojado deje al local
   * sin vía de auxilio la noche que se rompe algo.
   */
  it("ni el propietario puede administrarlo", () => {
    expect(puedeGestionarA(propietario, usuarioSoporte(SUC))).toBe(false);
  });

  it("y él sí puede administrar al propietario, que es de lo que se trata", () => {
    expect(puedeGestionarA(usuarioSoporte(SUC), propietario)).toBe(true);
  });

  /*
   * EL CANDADO DE LA FIRMA. Sin verificar, la credencial no se entrega: si no,
   * bastaría con editar `licencia.json` y pegar el hash de una contraseña propia
   * para entrar con todos los permisos del proveedor.
   */
  it("sin licencia verificada no hay credencial de soporte", () => {
    expect(credencialDeSoporte(lic(), false)).toBeNull();
    expect(credencialDeSoporte(null, true)).toBeNull();
  });

  it("una licencia sin credencial de soporte no lo crea", () => {
    expect(credencialDeSoporte(lic({ soporte: undefined }), true)).toBeNull();
    expect(conSoporte([propietario], lic({ soporte: undefined }), true, SUC)).toHaveLength(1);
  });

  it("con licencia verificada sí entra, como contraseña y no como PIN", () => {
    const c = credencialDeSoporte(lic(), true)!;
    expect(c.empleado_id).toBe(USUARIO_SOPORTE_ID);
    // Contraseña, no PIN: cuatro dígitos con estos permisos sería indefendible.
    expect(c.tipo).toBe("contrasena");
    expect(c.iteraciones).toBe(600_000);
  });

  it("no se duplica si ya estaba en la lista", () => {
    const una = conSoporte([propietario], lic(), true, SUC);
    expect(conSoporte(una, lic(), true, SUC)).toHaveLength(2);
  });
});

// --- Que se pueda auditar -------------------------------------------------------------------

describe("lo que hace queda a la vista", () => {
  /*
   * Se llama "Gonzalo DJA" en la bitácora, con nombre y apellido. Ocultarlo de
   * las LISTAS es una cosa; ocultarlo de la auditoría sería otra muy distinta, y
   * es la que convertiría esto en una puerta trasera.
   */
  it("tiene nombre propio para la bitácora", () => {
    expect(usuarioSoporte(SUC).nombre).toBe(NOMBRE_SOPORTE);
    expect(NOMBRE_SOPORTE).toBe("Gonzalo DJA");
  });

  it("se reconoce a sí mismo", () => {
    expect(esSoporte(usuarioSoporte(SUC))).toBe(true);
    expect(esSoporte(propietario)).toBe(false);
    expect(esSoporte(null)).toBe(false);
  });
});

// --- El bloqueo por falta de pago -----------------------------------------------------------

describe("con el software bloqueado", () => {
  /*
   * Si al vencer la licencia nadie pudiera entrar, tampoco podría entrar quien
   * va a reactivarla ni quien va a sacarle sus datos al restaurante para
   * dárselos. Un bloqueo del que ni el proveedor puede salir es un ladrillo.
   */
  it("solo MOTRAE puede entrar", () => {
    expect(puedeEntrarBloqueado(usuarioSoporte(SUC))).toBe(true);
    expect(puedeEntrarBloqueado(propietario)).toBe(false);
  });
});
