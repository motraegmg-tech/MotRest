/**
 * Las credenciales del personal viven en el Hub, no en una sola terminal.
 *
 * EL FALLO QUE ESTO FIJA, y que costó una tarde de diagnóstico:
 *
 * Se guardaban únicamente en el almacén de la terminal donde se creó cada
 * usuario. Las consecuencias eran dos, y la segunda es la que rompe el producto:
 *
 *   1. Al reinstalar MotRest —que registra una terminal nueva— todos los PIN
 *      dejaban de valer a la vez, sin más pista que «credencial inválida».
 *   2. Un mesero dado de alta en la caja **no podía entrar desde ninguna
 *      tableta del salón**. En un local con tabletas, eso es el primer día.
 *
 * Se comprobó leyendo el event log de una instalación real: tres usuarios
 * creados, cero credenciales replicadas, ocho accesos rechazados seguidos.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { permisosDePlantilla } from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";
// Clave de fábrica, no una credencial personal: nunca escribimos una real aquí.
import { credencialesDeDemostracion } from "../sesion/usuarios";

beforeAll(async () => {
  await arranque.iniciar();
});

let contador = 500;
const pinNuevo = () => String(contador++).padStart(6, "0");

describe("una credencial nueva sube al Hub", () => {
  beforeEach(async () => {
    // El propietario es quien puede dar de alta a los demás.
    await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
    sesion.alPublicarCredencial = null;
  });

  it("al crear un usuario se publica su credencial, no solo se guarda aquí", async () => {
    const publicadas: { id: string; cuantas: number }[] = [];
    sesion.alPublicarCredencial = (id, credenciales) =>
      publicadas.push({ id, cuantas: credenciales.length });

    const pin = pinNuevo();
    const r = await sesion.crearUsuario({
      nombre: "Mesero de prueba",
      rol_id: "mesero",
      puesto: "mesero",
      pin,
      permisos: permisosDePlantilla("mesero"),
    });
    expect(r.ok).toBe(true);

    /*
     * Sin esta publicación, ese PIN solo abriría en la terminal donde se tecleó.
     * Es exactamente el fallo que se está fijando.
     */
    expect(publicadas).toHaveLength(1);
    expect(publicadas[0]!.cuantas).toBeGreaterThan(0);
  });

  it("lo que sube es la derivación, nunca el PIN", async () => {
    let enviado = "";
    sesion.alPublicarCredencial = (_id, credenciales) => {
      enviado = JSON.stringify(credenciales);
    };

    const pin = pinNuevo();
    await sesion.crearUsuario({
      nombre: "Cajero de prueba",
      rol_id: "cajero",
      puesto: "cajero",
      pin,
      permisos: permisosDePlantilla("cajero"),
    });

    // El secreto no se guarda en ningún sitio; solo su PBKDF2 con sal.
    expect(enviado).not.toContain(pin);
    expect(enviado).toContain("hash");
    expect(enviado).toContain("sal");
  });
});

describe("lo que el Hub manda, manda", () => {
  it("adopta las credenciales del Hub y descarta las locales", async () => {
    const antes = new Map(sesion["credenciales"] as Map<string, unknown[]>);
    const unUsuario = [...antes.keys()].find((k) => k.startsWith("usr-") && !k.includes("soporte"));
    expect(unUsuario).toBeTruthy();

    await sesion.adoptarCredencialesDelHub({
      "usr-del-hub": [{ hash: "x", sal: "y", tipo: "pin", iteraciones: 310000 }],
    });

    const despues = sesion["credenciales"] as Map<string, unknown[]>;
    expect(despues.has("usr-del-hub")).toBe(true);
    /*
     * Y la vieja se va. Si un PIN se restableció en otra terminal, el anterior
     * tiene que dejar de servir en esta: conservarlo «por si acaso» convertiría
     * un restablecimiento en una credencial que sigue abriendo.
     */
    expect(despues.has(unUsuario!)).toBe(false);
  });

  it("un Hub sin credenciales todavía NO deja al local fuera de su sistema", async () => {
    const pin = pinNuevo();
    await sesion.crearUsuario({
      nombre: "Alguien",
      rol_id: "mesero",
      puesto: "mesero",
      pin,
      permisos: permisosDePlantilla("mesero"),
    });
    const cuantas = (sesion["credenciales"] as Map<string, unknown[]>).size;

    /*
     * Un Hub recién actualizado no tiene ninguna guardada. Vaciar aquí dejaría
     * al restaurante sin poder entrar mientras se sube la primera — y sería un
     * fallo mucho peor que el que se está arreglando.
     */
    await sesion.adoptarCredencialesDelHub({});

    expect((sesion["credenciales"] as Map<string, unknown[]>).size).toBe(cuantas);
  });
});
