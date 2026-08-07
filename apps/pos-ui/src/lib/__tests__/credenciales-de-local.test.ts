/**
 * Las credenciales que se generan para cada restaurante.
 *
 * ANTES: el propietario venía con una clave de fábrica **idéntica en toda
 * instalación**, escrita en claro en el repositorio, y con el hash de un PIN de
 * cuatro dígitos empaquetado en el instalador. La justificación era la analogía
 * del router que sale con clave por defecto — y no se sostiene: un router
 * moderno trae **clave única por equipo**, no una constante para todo el parque.
 *
 * AHORA: cada local genera las suyas en el primer arranque. Nada de lo que hay
 * en este repositorio abre ningún restaurante.
 */
import { describe, expect, it } from "vitest";
import { validarSecreto } from "@motrest/dominio";
import { generarContrasenaDeLocal, generarPinDeLocal } from "../sesion/usuarios";

describe("la contraseña que se genera para un local", () => {
  /*
   * EL CANDADO. Dos instalaciones no pueden compartir credencial: era
   * exactamente el problema de la clave de fábrica.
   */
  it("nunca sale igual dos veces", () => {
    const generadas = new Set(Array.from({ length: 500 }, () => generarContrasenaDeLocal()));
    expect(generadas.size).toBe(500);
  });

  /* Si no pasa la política del propio sistema, no vale generarla. */
  it("cumple la política de contraseñas", () => {
    for (let i = 0; i < 100; i++) {
      expect(validarSecreto(generarContrasenaDeLocal(), "contrasena")).toBeNull();
    }
  });

  /*
   * Esto se apunta a mano en un papel el día de la instalación y se dicta en
   * llamadas de soporte. Sin caracteres que se confundan al leerlos: ni `0/O`,
   * ni `1/I/L`, ni `U` (se oye como `V`).
   */
  it("no lleva caracteres que se confunden al dictarla", () => {
    for (let i = 0; i < 100; i++) {
      expect(generarContrasenaDeLocal()).not.toMatch(/[0O1ILU]/);
    }
  });

  /* Tres grupos de cuatro: un bloque de doce seguidos se copia mal a mano. */
  it("viene en grupos, para poder copiarla sin equivocarse", () => {
    expect(generarContrasenaDeLocal()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe("el PIN que se genera para el propietario", () => {
  /*
   * OCHO DÍGITOS, NO CUATRO. No lo teclea nadie a diario —para eso está la
   * contraseña— y es el que firma cancelaciones, descuentos y retiros de caja.
   * Sube de diez mil a cien millones el espacio a probar, y no cuesta nada
   * porque nadie lo escribe cien veces por turno.
   */
  it("tiene ocho dígitos", () => {
    expect(generarPinDeLocal()).toMatch(/^\d{8}$/);
  });

  it("nunca sale igual dos veces", () => {
    const generados = new Set(Array.from({ length: 500 }, () => generarPinDeLocal()));
    // Con 10^8 posibilidades, 500 repetidos sería un fallo del generador.
    expect(generados.size).toBe(500);
  });

  it("cumple la política de PIN del sistema", () => {
    for (let i = 0; i < 100; i++) {
      expect(validarSecreto(generarPinDeLocal(), "pin")).toBeNull();
    }
  });

  /* Ni todo el mismo dígito ni una escalera: se adivinan mirando los dedos. */
  it("no sale un PIN obvio", () => {
    for (let i = 0; i < 200; i++) {
      const pin = generarPinDeLocal();
      expect(pin).not.toMatch(/^(\d)\1+$/);
      expect(pin).not.toBe("12345678");
    }
  });
});

describe("lo que llega al restaurante", () => {
  /*
   * Esta es la prueba que de verdad cierra el hallazgo, y NO se puede hacer
   * aquí: comprobar que el paquete compilado no lleva la contraseña exige mirar
   * el bundle, no el código. Se hace en el ritual de cierre de etapa:
   *
   *   grep -a "MotRest.Inicio" apps/pos-ui/dist/assets/*.js
   *
   * Se deja anotado porque es exactamente la trampa que dejó a «Gonz Motrae»
   * sin existir en producción con doce pruebas verdes: el empaquetador elimina
   * lo que nadie llama, y ninguna prueba de este archivo lo detectaría.
   */
  it("las credenciales de demostración solo existen dentro de una función", async () => {
    const modulo = await import("../sesion/usuarios");
    // Si esto dejara de ser una función y pasara a ser una constante de módulo,
    // sus valores viajarían al instalador aunque nadie los use.
    expect(typeof modulo.credencialesDeDemostracion).toBe("function");
  });
});
