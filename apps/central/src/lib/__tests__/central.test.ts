/**
 * El store de MOTRAE Central.
 *
 * Lo importante que se prueba aquí es la emisión de licencias, porque es donde
 * se juntan las dos cosas que sostienen todo el modelo: que la licencia solo
 * valga en SU local, y que el acceso de soporte viaje dentro de la firma.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  pesos,
  verificarLicencia,
  verificarCredencial,
  verificarVersion,
} from "@motrest/dominio";
import { crearCentralParaPruebas, StoreCentral } from "../central.svelte";

let central: StoreCentral;

beforeEach(async () => {
  central = crearCentralParaPruebas();
  central.clientes = [];
  central.pulsos = [];
  await central.generarPares();
  await central.guardarConfiguracion({ repositorio: "motrae/motrest" });
});

function alta(nombre = "Rodizio", sufijo = "Centro") {
  return central.alta({
    nombre, sufijo, contacto: "Dueño", plan: "mensual", cuota: pesos(1_500),
  });
}

describe("dar de alta un restaurante", () => {
  it("propone un identificador legible que se pueda dictar por teléfono", () => {
    expect(alta().cliente!.id).toBe("suc-rodizio-centro");
  });

  it("no admite dos locales con el mismo identificador", () => {
    alta();
    const r = alta();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Ya existe");
  });

  it("sin nombre no se da de alta", () => {
    expect(central.alta({ nombre: "  ", contacto: "", plan: "mensual", cuota: pesos(0) }).ok).toBe(false);
  });

  /*
   * Un cliente que se fue sigue siendo historia del negocio, y volver a darlo de
   * alta el día que regrese vale más que la línea que ahorra borrarlo.
   */
  it("dar de baja no borra: desactiva", () => {
    const id = alta().cliente!.id;
    central.baja(id);
    expect(central.clientes).toHaveLength(1);
    expect(central.activos).toHaveLength(0);
  });

  /* Un local nuevo NO nace con licencia: primero se instala y se ve su id. */
  it("nace sin licencia, a propósito", () => {
    expect(alta().cliente!.licencia).toBeNull();
  });
});

describe("emitir la licencia", () => {
  it("sin secreto de firma no emite nada", async () => {
    central = crearCentralParaPruebas();
    const id = alta().cliente!.id;

    const r = await central.emitir(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("llave privada");
  });

  it("la emitida se verifica en SU local y en ningún otro", async () => {
    const id = alta().cliente!.id;
    const r = await central.emitir(id);

    expect(r.ok).toBe(true);
    expect(await verificarLicencia(r.licencia!, id, central.secretos.licencias!.publica)).toBe(true);
    expect(await verificarLicencia(r.licencia!, "suc-otro", central.secretos.licencias!.publica)).toBe(false);
  });

  it("sale con los tres días de gracia", async () => {
    const id = alta().cliente!.id;
    expect((await central.emitir(id)).licencia!.gracia_dias).toBe(3);
  });

  /*
   * EL ACCESO DE SOPORTE VIAJA DENTRO DE LA FIRMA. Es lo que hace que "Gonz
   * Motrae" exista en ese MotRest y lo que impide que el restaurante se fabrique
   * uno propio: sin la firma de MOTRAE, la licencia no vale.
   */
  it("lleva dentro la credencial de soporte, si está configurada", async () => {
    await central.fijarContrasenaSoporte("una-contrasena-larga-de-motrae");
    const id = alta().cliente!.id;
    const licencia = (await central.emitir(id)).licencia!;

    expect(licencia.soporte).toBeDefined();
    expect(await verificarLicencia(licencia, id, central.secretos.licencias!.publica)).toBe(true);

    // Y el hash es de verdad el de la contraseña que puso Gonzalo.
    expect(
      await verificarCredencial("una-contrasena-larga-de-motrae", {
        empleado_id: "usr-motrae-soporte",
        tipo: "contrasena",
        algoritmo: "PBKDF2-SHA256",
        ...licencia.soporte!,
        creada_ts: licencia.emitida_ts,
      }),
    ).toBe(true);
  });

  /* Renovar cuenta desde el vencimiento anterior: pagar antes no regala días. */
  it("renovar suma sobre lo que quedaba, no sobre hoy", async () => {
    const id = alta().cliente!.id;
    const primera = (await central.emitir(id)).licencia!;
    const segunda = (await central.emitir(id)).licencia!;

    expect(segunda.vence_ts).toBeGreaterThan(primera.vence_ts);
  });
});

describe("la contraseña de soporte", () => {
  /*
   * Esta contraseña abre TODOS los restaurantes. Un mínimo de PIN de caja aquí
   * sería indefendible.
   */
  it("no admite una contraseña corta", async () => {
    const r = await central.fijarContrasenaSoporte("corta123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("TODOS los restaurantes");
  });

  /* De un hash no se recupera la contraseña: ni esta máquina la tiene. */
  it("solo se guarda el hash, nunca la contraseña", async () => {
    await central.fijarContrasenaSoporte("una-contrasena-larga-de-motrae");
    const guardado = JSON.stringify(central.secretos.soporte);

    expect(guardado).not.toContain("una-contrasena-larga");
    expect(central.secretos.soporte!.iteraciones).toBe(600_000);
  });
});

describe("las llaves de Central", () => {
  it("no sobrescribe DPAPI mientras el almacén todavía está cargando", async () => {
    const sinCargar = new StoreCentral(false);

    const r = await sinCargar.generarPares();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("todavía está abriendo");
    expect(sinCargar.secretos.licencias).toBeUndefined();
  });

  it("genera pares distintos y solo expone sus públicas a la interfaz", () => {
    expect(central.secretos.licencias?.publica).toBeTruthy();
    expect(central.secretos.publicacion?.publica).toBeTruthy();
    expect(central.secretos.licencias?.publica).not.toBe(central.secretos.publicacion?.publica);
    expect(JSON.stringify(central.secretos)).not.toContain("privada");
  });

  it("firma publicaciones con un publicado_ts monótono, aunque el reloj no avance", async () => {
    const datos = {
      version: "1.5.0",
      notas: "Arregla un detalle de seguridad.",
      url: "https://github.com/motrae/motrest/releases/download/v1.5.0/MotRest_setup.exe",
      sha256: "a".repeat(64),
      version_minima_soportada: "1.4.2",
    };
    const primero = await central.firmarActualizacion(datos, 1_000);
    const segundo = await central.firmarActualizacion({ ...datos, version: "1.5.1" }, 1_000);

    expect(primero.ok).toBe(true);
    expect(segundo.ok).toBe(true);
    if (!primero.ok || !segundo.ok) return;
    expect(segundo.manifiesto!.publicado_ts).toBeGreaterThan(primero.manifiesto!.publicado_ts);
    expect(
      await verificarVersion(primero.manifiesto!, central.secretos.publicacion!.publica),
    ).toBe(true);
  });

  it("no firma dos manifiestos a la vez con la misma marca de publicación", async () => {
    const datos = {
      version: "1.5.0",
      notas: "Arregla un detalle de seguridad.",
      url: "https://github.com/motrae/motrest/releases/download/v1.5.0/MotRest_setup.exe",
      sha256: "a".repeat(64),
    };

    const [primero, segundo] = await Promise.all([
      central.firmarActualizacion(datos, 1_000),
      central.firmarActualizacion({ ...datos, version: "1.5.1" }, 1_000),
    ]);

    expect([primero.ok, segundo.ok].filter(Boolean)).toHaveLength(1);
    const rechazado = primero.ok ? segundo : primero;
    if (!rechazado.ok) expect(rechazado.error).toContain("en proceso de firma");
  });
});

describe("respaldar la cartera", () => {
  /*
   * Este archivo se manda por correo sin pensarlo. No puede llevar dentro la
   * llave que firma las actualizaciones de todos los restaurantes.
   */
  it("el respaldo NO lleva los secretos", async () => {
    await central.fijarContrasenaSoporte("una-contrasena-larga-de-motrae");
    alta();

    const json = central.exportar();
    expect(json).toContain("Rodizio");
    expect(json).not.toContain(central.secretos.licencias!.publica);
    expect(json).not.toContain(central.secretos.soporte!.hash);
  });

  it("lo exportado se puede volver a importar", () => {
    alta();
    const copia = central.exportar();
    central.clientes = [];

    expect(central.importar(copia).ok).toBe(true);
    expect(central.clientes).toHaveLength(1);
  });

  it("un archivo que no es una cartera se rechaza sin romper nada", () => {
    alta();
    expect(central.importar("{{{").ok).toBe(false);
    expect(central.importar('{"otra":"cosa"}').ok).toBe(false);
    expect(central.clientes).toHaveLength(1);
  });
});

describe("los pulsos de los Hubs", () => {
  /* Un Hub que reintentó manda el pulso dos veces: se queda el último. */
  it("solo se guarda el último de cada local", () => {
    const id = alta().cliente!.id;
    central.recibirPulso({ sucursal_id: id, ts: 1_000, version: "1.3.0" });
    central.recibirPulso({ sucursal_id: id, ts: 2_000, version: "1.4.0" });

    expect(central.pulsos).toHaveLength(1);
    expect(central.pulsoDe(id)!.version).toBe("1.4.0");
  });
});
