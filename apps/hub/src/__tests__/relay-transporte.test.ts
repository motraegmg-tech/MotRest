/**
 * Por dónde puede salir el enlace del Hub con el relay.
 *
 * Por este cable van dos cosas que no pueden viajar en claro: la credencial del
 * restaurante y el token de la API de Meta. Con el segundo se manda WhatsApp en
 * nombre del local, así que quien lo lea pasa a ser el local.
 *
 * La razón de que esto sea una prueba y no un comentario: un `ws://` en la
 * configuración funciona igual de bien que un `wss://`. No falla, no avisa, y no
 * hay forma de notarlo desde el restaurante — que es exactamente cómo una
 * prueba que se quedó puesta acaba en producción.
 */
import { describe, expect, it } from "vitest";
import { direccionUsable } from "../relay.js";

describe("la dirección del relay", () => {
  it("acepta wss://", () => {
    expect(direccionUsable("wss://relay.motrae.mx/hub").ok).toBe(true);
  });

  it("rechaza ws:// contra un dominio de internet", () => {
    const veredicto = direccionUsable("ws://relay.motrae.mx/hub");
    expect(veredicto.ok).toBe(false);
    // El mensaje tiene que explicar el porqué: quien lo lea está configurando
    // un restaurante, no leyendo este archivo.
    if (!veredicto.ok) {
      expect(veredicto.motivo).toContain("wss://");
      expect(veredicto.motivo).toContain("token");
    }
  });

  it("rechaza http:// y https://, que no son WebSocket", () => {
    expect(direccionUsable("https://relay.motrae.mx/hub").ok).toBe(false);
    expect(direccionUsable("http://relay.motrae.mx/hub").ok).toBe(false);
  });

  it("rechaza lo que no es una dirección", () => {
    expect(direccionUsable("relay.motrae.mx").ok).toBe(false);
    expect(direccionUsable("").ok).toBe(false);
  });

  /** El ensayo del relay corre en la misma máquina: ahí no hay red que escuchar. */
  it("deja pasar el bucle local, para los ensayos", () => {
    expect(direccionUsable("ws://localhost:8080/hub").ok).toBe(true);
    expect(direccionUsable("ws://127.0.0.1:8080/hub").ok).toBe(true);
  });

  /**
   * Un nombre que EMPIEZA por "localhost" no es el bucle local: `localhost.evil`
   * es un dominio de internet como cualquier otro.
   */
  it("no se deja engañar por un nombre parecido a localhost", () => {
    expect(direccionUsable("ws://localhost.sitio-ajeno.example/hub").ok).toBe(false);
    expect(direccionUsable("ws://127.0.0.1.sitio-ajeno.example/hub").ok).toBe(false);
  });
});
