/**
 * Arranque automático del Hub con Windows.
 *
 * Lo que de verdad hay que probar aquí no es que sepa escribir en el registro
 * —eso lo hace `reg`— sino la GUARDA: que NO se registre cuando el Hub corre
 * desde el código o sobre una base de pruebas. Sin esa guarda, cada ensayo y
 * cada sesión de desarrollo dejaría en el arranque de Windows una entrada que
 * apunta a un node suelto o a una carpeta temporal ya borrada.
 */
import { describe, expect, it } from "vitest";
import { asegurarAlArrancar, estado, soportado } from "../autoarranque.js";

describe("cuándo se puede registrar el arranque", () => {
  /*
   * Las pruebas corren con vitest, así que `process.execPath` es node.exe.
   * Ese es exactamente el caso que la guarda tiene que rechazar.
   */
  it("no se registra corriendo desde el código", () => {
    expect(soportado()).toBe(false);
  });

  it("dice por qué no se puede, en vez de callarse", async () => {
    const e = await estado();
    expect(e.soportado).toBe(false);
    expect(e.motivo).toBeTruthy();
  });

  /*
   * LA GUARDA QUE IMPORTA. Un ensayo levanta el ejecutable instalado sobre una
   * base temporal: si eso se registrara, Windows arrancaría cada mañana un Hub
   * apuntando a una carpeta que se borró al terminar la prueba.
   *
   * Se comprueba que NO CAMBIE nada, en vez de exigir que quede desactivado:
   * en el equipo de quien desarrolla puede haber un MotRest instalado y de
   * verdad registrado, y una prueba que dependa de eso falla según en qué
   * máquina corra — que es la peor clase de prueba.
   */
  it("un arranque que no es la instalación real no toca el registro", async () => {
    const antes = await estado();
    const despues = await asegurarAlArrancar(false);
    expect(despues.activo).toBe(antes.activo);
  });

  it("tampoco lo toca si el equipo no lo soporta", async () => {
    const antes = await estado();
    // En este proceso `soportado()` es falso: pase lo que pase, no debe escribir.
    const despues = await asegurarAlArrancar(true);
    expect(despues.activo).toBe(antes.activo);
  });
});
