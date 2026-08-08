import { describe, expect, it } from "vitest";
import { crearCredencial, verificarCredencial } from "../identidad/credenciales.js";
import {
  cuentaResponsableDeLicencia,
  PUESTO_RESPONSABLE,
  USUARIO_RESPONSABLE_ID,
} from "../identidad/responsable.js";
import { puedeGestionarA } from "../identidad/matriz.js";
import { usuarioSoporte } from "../identidad/soporte.js";
import type { Licencia } from "../organizacion/licencia.js";

const SUCURSAL = "suc-rodizio";
const PIN_DE_PRUEBA = "28164937";

async function licenciaConResponsable(): Promise<Licencia> {
  const credencial = await crearCredencial(USUARIO_RESPONSABLE_ID, PIN_DE_PRUEBA, "pin");
  return {
    sucursal_id: SUCURSAL,
    nombre: "Rodizio",
    plan: "mensual",
    vence_ts: Date.now() + 30 * 86_400_000,
    gracia_dias: 3,
    emitida_ts: Date.now(),
    responsable: {
      id: USUARIO_RESPONSABLE_ID,
      nombre: "Responsable Rodizio",
      puesto: PUESTO_RESPONSABLE,
      provision_id: "018f8fe4-6740-7d0d-98b5-a4a3e0000001",
      credencial,
    },
    firma: "firma-de-prueba",
  };
}

describe("el responsable licenciado", () => {
  it("solo nace de una licencia comprobada y queda debajo de soporte", async () => {
    const licencia = await licenciaConResponsable();

    expect(cuentaResponsableDeLicencia(licencia, false, SUCURSAL, true)).toBeNull();

    const cuenta = cuentaResponsableDeLicencia(licencia, true, SUCURSAL, true)!;
    expect(cuenta.usuario).toMatchObject({
      id: USUARIO_RESPONSABLE_ID,
      nombre: "Responsable Rodizio",
      rol_id: "propietario",
      puesto: PUESTO_RESPONSABLE,
      debe_cambiar_credencial: true,
    });
    expect(await verificarCredencial(PIN_DE_PRUEBA, cuenta.credencial)).toBe(true);
    expect(puedeGestionarA(usuarioSoporte(SUCURSAL), cuenta.usuario)).toBe(true);
    expect(puedeGestionarA(cuenta.usuario, usuarioSoporte(SUCURSAL))).toBe(false);
  });

  it("rechaza un perfil malformado aunque haya llegado desde el archivo", async () => {
    const licencia = await licenciaConResponsable();
    licencia.responsable = {
      ...licencia.responsable!,
      credencial: null as unknown as typeof licencia.responsable.credencial,
    };

    expect(cuentaResponsableDeLicencia(licencia, true, SUCURSAL, false)).toBeNull();
  });
});
