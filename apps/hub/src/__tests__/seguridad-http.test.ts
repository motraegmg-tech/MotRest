/** Las defensas HTTP viven fuera de main.ts para probarlas sin arrancar el Hub. */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archivoDentroDe,
  autoridadDelHub,
  clienteHttp,
  encabezadosDeSeguridad,
  esOrigenDelHub,
  LIMITE_GLOBAL_HTTP_POR_MINUTO,
  LimitadorDeRitmo,
  origenDelHub,
  politicaDeRitmoHttp,
  type ConfiguracionHostHub,
} from "../seguridad-http.js";

const RED: ConfiguracionHostHub = {
  puerto: 8787,
  seguro: true,
  nombreRed: "motrest",
  direccionesLan: ["192.168.1.40"],
  esLocal: false,
};

describe("Host del Hub", () => {
  it("acepta únicamente el nombre anunciado o una IP propia", () => {
    expect(autoridadDelHub("motrest.local:8787", RED)).toMatchObject({
      host: "motrest.local",
      puerto: 8787,
    });
    expect(autoridadDelHub("192.168.1.40:8787", RED)).toMatchObject({
      host: "192.168.1.40",
    });
  });

  it("no deja convertir localhost de la caja en un Host de la LAN", () => {
    expect(autoridadDelHub("localhost:8787", RED)).toBeNull();
    expect(autoridadDelHub("atacante.example:8787", RED)).toBeNull();
    expect(autoridadDelHub("motrest.local:9999", RED)).toBeNull();

    const caja = { ...RED, puerto: 8788, seguro: false, esLocal: true };
    expect(autoridadDelHub("localhost:8788", caja)).toMatchObject({ host: "localhost" });
    expect(autoridadDelHub("127.0.0.1:8788", caja)).toMatchObject({ host: "127.0.0.1" });
  });
});

describe("origen y cabeceras", () => {
  const autoridad = autoridadDelHub("motrest.local:8787", RED)!;

  it("solo concede CORS al origen exacto del Hub", () => {
    expect(origenDelHub(true, autoridad)).toBe("https://motrest.local:8787");
    expect(esOrigenDelHub("https://motrest.local:8787", true, autoridad)).toBe(true);
    expect(esOrigenDelHub("http://motrest.local:8787", true, autoridad)).toBe(false);
    expect(esOrigenDelHub("https://atacante.example", true, autoridad)).toBe(false);
  });

  it("impide marco, sniffing y scripts inline salvo el nonce de la caja", () => {
    const cabeceras = encabezadosDeSeguridad(true, autoridad, "nonce-de-prueba");
    expect(cabeceras["x-frame-options"]).toBe("DENY");
    expect(cabeceras["x-content-type-options"]).toBe("nosniff");
    expect(cabeceras["referrer-policy"]).toBe("no-referrer");
    expect(cabeceras["strict-transport-security"]).toBeDefined();
    expect(cabeceras["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(cabeceras["content-security-policy"]).toContain("'nonce-nonce-de-prueba'");
    expect(cabeceras["content-security-policy"]).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe("rutas estáticas", () => {
  it("no confunde un hermano con una carpeta hija", () => {
    const pos = join(process.cwd(), "pos");
    expect(archivoDentroDe(pos, "/assets/index.js")).toBe(join(pos, "assets", "index.js"));
    expect(archivoDentroDe(pos, "/../poscopia/secreto.txt")).toBeNull();
    expect(archivoDentroDe(pos, "/../../fuera.txt")).toBeNull();
  });
});

describe("límite de ritmo HTTP", () => {
  it("frena dentro de la ventana y vuelve a abrir al siguiente minuto", () => {
    const limitador = new LimitadorDeRitmo();
    expect(limitador.permitir("kiosco:10.0.0.4", 2, 1_000).permitido).toBe(true);
    expect(limitador.permitir("kiosco:10.0.0.4", 2, 1_001).permitido).toBe(true);

    const tercero = limitador.permitir("kiosco:10.0.0.4", 2, 1_002);
    expect(tercero).toMatchObject({ permitido: false, reintentarEnSegundos: 59 });
    expect(limitador.permitir("kiosco:10.0.0.4", 2, 60_000).permitido).toBe(true);
  });

  it("clasifica las ocho puertas y normaliza IPv4 mapeada", () => {
    expect(LIMITE_GLOBAL_HTTP_POR_MINUTO).toBeGreaterThan(0);
    expect(clienteHttp("::ffff:192.168.1.40")).toBe("192.168.1.40");
    expect(politicaDeRitmoHttp("/arranque-automatico", "POST").clave).toBe("arranque");
    expect(politicaDeRitmoHttp("/portal/api/cuenta/firma", "GET").clave).toBe("portal-cuenta");
    expect(politicaDeRitmoHttp("/portal/api/reserva", "POST").clave).toBe("portal-mutacion");
    expect(politicaDeRitmoHttp("/portal/", "GET").clave).toBe("portal-estatico");
    expect(politicaDeRitmoHttp("/imprimir", "POST").clave).toBe("impresion");
    expect(politicaDeRitmoHttp("/kiosco/pedido", "POST").clave).toBe("kiosco-pedido");
    expect(politicaDeRitmoHttp("/licencia", "GET").clave).toBe("licencia");
    expect(politicaDeRitmoHttp("/salud", "GET").clave).toBe("salud");
    expect(politicaDeRitmoHttp("/", "GET").clave).toBe("pos-estatico");
  });
});
