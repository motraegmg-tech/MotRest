import { describe, expect, it } from "vitest";
import { pesos, type Centavos } from "@motrest/dominio";
import { Ticket, type BloqueTicket, type ImagenMonocroma } from "../escpos.js";
import { precuenta, ticketVenta } from "../plantillas.js";
import {
  ALTO_MAX_LOGO,
  PUNTOS_POR_ANCHO,
  desempaquetarLogo,
  empaquetarLogo,
  medidaParaPapel,
  type MapaLogo,
} from "../logo.js";

const T0 = new Date(2026, 6, 22, 21, 15).getTime();

/**
 * Un logo cualquiera pero reproducible.
 *
 * El dibujo no importa; lo que importa es que tenga puntos encendidos y
 * apagados en las dos mitades de cada byte, que es donde se notan los errores
 * de empaquetado.
 */
function logoDePrueba(ancho: number, alto: number): ImagenMonocroma {
  const pixeles: boolean[] = [];
  for (let i = 0; i < ancho * alto; i += 1) pixeles.push((i * 7) % 11 < 4);
  return { ancho, alto, pixeles };
}

function bloquesDeTexto(bloques: BloqueTicket[]): Extract<BloqueTicket, { tipo: "texto" }>[] {
  return bloques.filter(
    (b): b is Extract<BloqueTicket, { tipo: "texto" }> => b.tipo === "texto",
  );
}

/** El ticket tal como lo leería alguien juntando los bloques de la vista previa. */
function textoDeBloques(bloques: BloqueTicket[]): string {
  return bloquesDeTexto(bloques)
    .flatMap((b) => b.lineas)
    .join("\n");
}

/** Lo que un ticket puede contener: ASCII imprimible y el español de CP437. */
const CARACTERES_DE_TICKET = /^[\x20-\x7e áéíóúÁÉÍÓÚñÑüÜ¿¡°ºª½]*$/;

// --- El logo guardado en el disco del local -------------------------------------------

describe("el logo del local guardado en el disco", () => {
  it("ida y vuelta: lo que se guarda es punto por punto lo que se imprime", () => {
    const logo = logoDePrueba(64, 24);
    const vuelta = desempaquetarLogo(empaquetarLogo(logo));

    expect(vuelta).not.toBeNull();
    expect(vuelta!.ancho).toBe(64);
    expect(vuelta!.alto).toBe(24);
    expect(vuelta!.pixeles).toEqual(logo.pixeles);
  });

  /*
   * Ocho puntos por byte: cuando el total no es múltiplo de ocho, el último byte
   * va a medias. Si el empaquetado lo redondea hacia abajo, esa parte del logo
   * simplemente no se guarda y nadie lo nota hasta ver el papel.
   */
  it("un mapa cuyo total de puntos no es múltiplo de 8 vuelve completo", () => {
    for (const [ancho, alto] of [
      [5, 3], // 15 puntos
      [13, 7], // 91 puntos
      [37, 11], // 407 puntos
    ] as const) {
      const logo = logoDePrueba(ancho, alto);
      const vuelta = desempaquetarLogo(empaquetarLogo(logo));
      expect(vuelta!.pixeles).toEqual(logo.pixeles);
      expect(vuelta!.pixeles).toHaveLength(ancho * alto);
    }
  });

  it("no se pierde el último punto del mapa", () => {
    const puntos = 15;
    const imagen: ImagenMonocroma = {
      ancho: 5,
      alto: 3,
      pixeles: Array.from({ length: puntos }, (_, i) => i === puntos - 1),
    };

    const vuelta = desempaquetarLogo(empaquetarLogo(imagen));
    expect(vuelta!.pixeles[puntos - 1]).toBe(true);
    expect(vuelta!.pixeles.filter(Boolean)).toHaveLength(1);
  });

  it("una sola fila del ancho del papel también sobrevive", () => {
    const fila = logoDePrueba(PUNTOS_POR_ANCHO[42], 1);
    expect(desempaquetarLogo(empaquetarLogo(fila))!.pixeles).toEqual(fila.pixeles);
  });
});

/*
 * UN LOGO ILEGIBLE NO PUEDE DEJAR SIN TICKET A QUIEN ESTÁ PAGANDO.
 *
 * El mapa vive en el disco de la caja y viaja en los respaldos: puede llegar a
 * medias, con medidas absurdas o directamente sin ser base64. En todos esos
 * casos se imprime el ticket sin logo, que es un ticket válido; lanzar dejaría
 * al comensal esperando en la caja por un adorno.
 */
describe("un logo corrupto no tumba la impresión", () => {
  it("base64 que no es base64 se descarta", () => {
    const basura = { ancho: 64, alto: 24, bits: "esto-no-es-base64-es-un-PNG!!" };
    expect(() => desempaquetarLogo(basura)).not.toThrow();
    expect(desempaquetarLogo(basura)).toBeNull();
  });

  it("un mapa sin medidas se descarta", () => {
    const bits = empaquetarLogo(logoDePrueba(64, 24)).bits;
    expect(desempaquetarLogo({ ancho: 0, alto: 24, bits })).toBeNull();
    expect(desempaquetarLogo({ ancho: 64, alto: 0, bits })).toBeNull();
    expect(desempaquetarLogo({ ancho: -64, alto: 24, bits })).toBeNull();
    expect(desempaquetarLogo({ ancho: 64.5, alto: 24, bits })).toBeNull();
    expect(desempaquetarLogo({ ancho: Number.NaN, alto: 24, bits })).toBeNull();
  });

  it("un mapa recortado a medias se descarta en vez de imprimir medio logo", () => {
    const entero = empaquetarLogo(logoDePrueba(64, 24));
    const recortado: MapaLogo = { ...entero, bits: entero.bits.slice(0, 8) };

    expect(desempaquetarLogo(recortado)).toBeNull();
    // Y el entero sí se acepta, para que la prueba no pase por el motivo malo.
    expect(desempaquetarLogo(entero)).not.toBeNull();
  });

  it("un mapa que declara más puntos de los que trae se descarta", () => {
    const pequeño = empaquetarLogo(logoDePrueba(16, 4));
    expect(desempaquetarLogo({ ...pequeño, alto: 200 })).toBeNull();
  });

  it("sin logo configurado no hay nada que desempaquetar", () => {
    expect(desempaquetarLogo(null)).toBeNull();
    expect(desempaquetarLogo(undefined)).toBeNull();
    expect(desempaquetarLogo({ ancho: 64, alto: 24, bits: "" })).toBeNull();
    expect(desempaquetarLogo({ ancho: 64, alto: 24 } as unknown as MapaLogo)).toBeNull();
    expect(desempaquetarLogo({ ancho: 64, alto: 24, bits: 12 } as unknown as MapaLogo)).toBeNull();
  });
});

// --- La medida del logo para cada papel ----------------------------------------------

describe("la medida del logo para cada papel", () => {
  it("conserva la proporción: un logo estirado se nota más que uno pequeño", () => {
    // El PNG que entrega el restaurante: un logotipo alargado de 1024×384.
    const medida = medidaParaPapel(1024, 384, PUNTOS_POR_ANCHO[42]);
    expect(medida.ancho / medida.alto).toBeCloseTo(1024 / 384, 1);
  });

  it("cabe en el ancho de puntos de su papel, sea de 58 o de 80 mm", () => {
    for (const columnas of [32, 42] as const) {
      const puntos = PUNTOS_POR_ANCHO[columnas];
      const medida = medidaParaPapel(1024, 384, puntos);
      expect(medida.ancho).toBeLessThanOrEqual(puntos);
    }
    // El papel angosto recorta de verdad: no es el mismo mapa para los dos.
    expect(medidaParaPapel(1024, 384, PUNTOS_POR_ANCHO[32]).ancho).toBeLessThan(
      medidaParaPapel(1024, 384, PUNTOS_POR_ANCHO[42]).ancho,
    );
  });

  /*
   * El papel se paga en cada ticket, cada pre-cuenta y cada reimpresión: un logo
   * alto se cobra todos los días.
   */
  it("respeta el alto máximo aunque sobre ancho de papel", () => {
    const medida = medidaParaPapel(400, 1200, PUNTOS_POR_ANCHO[42]);
    expect(medida.alto).toBeLessThanOrEqual(ALTO_MAX_LOGO);
    expect(medida.alto).toBe(ALTO_MAX_LOGO);
    expect(medida.ancho / medida.alto).toBeCloseTo(400 / 1200, 1);
  });

  it("acepta un alto máximo distinto del de por defecto", () => {
    expect(medidaParaPapel(400, 1200, PUNTOS_POR_ANCHO[42], 80).alto).toBe(80);
  });

  it("NUNCA amplía un logo pequeño: saldría pixelado en el papel", () => {
    expect(medidaParaPapel(120, 40, PUNTOS_POR_ANCHO[42])).toEqual({ ancho: 120, alto: 40 });
    expect(medidaParaPapel(1, 1, PUNTOS_POR_ANCHO[32])).toEqual({ ancho: 1, alto: 1 });
  });

  it("un logo desmesuradamente ancho no se queda en cero puntos de alto", () => {
    const medida = medidaParaPapel(4000, 3, PUNTOS_POR_ANCHO[32]);
    expect(medida.ancho).toBeGreaterThanOrEqual(1);
    expect(medida.alto).toBeGreaterThanOrEqual(1);
  });

  it("medidas imposibles no producen una imagen imposible", () => {
    expect(medidaParaPapel(0, 100, PUNTOS_POR_ANCHO[42])).toEqual({ ancho: 0, alto: 0 });
    expect(medidaParaPapel(-10, -10, PUNTOS_POR_ANCHO[42])).toEqual({ ancho: 0, alto: 0 });
  });

  it("la medida calculada es la que se guarda y la que vuelve", () => {
    const medida = medidaParaPapel(1024, 384, PUNTOS_POR_ANCHO[32]);
    const vuelta = desempaquetarLogo(empaquetarLogo(logoDePrueba(medida.ancho, medida.alto)));
    expect(vuelta!.ancho).toBe(medida.ancho);
    expect(vuelta!.alto).toBe(medida.alto);
  });
});

// --- El ticket partido en piezas para la vista previa ---------------------------------

describe("el ticket partido en piezas para la vista previa", () => {
  it("un ticket de solo texto es un único bloque, igual al ticket legible", () => {
    const t = new Ticket(32);
    t.linea("Rodizio");
    t.separador();
    t.columnasDobles("2x Pizza familiar", "$996.00");
    t.columnasDobles("TOTAL", "$1,048.20");
    t.cortar();

    const bloques = t.aBloques();
    expect(bloques).toHaveLength(1);
    expect(bloques[0]!.tipo).toBe("texto");
    expect(bloquesDeTexto(bloques)[0]!.lineas).toEqual(t.aTexto().split("\n"));
  });

  it("un ticket vacío no inventa bloques", () => {
    expect(new Ticket(42).aBloques()).toEqual([]);
  });

  it("con logo y código, cada pieza sale en el orden en que se imprime", () => {
    const t = new Ticket(42);
    t.linea("** REIMPRESION #1 **");
    t.imagenMonocroma(logoDePrueba(48, 12), 1, 0);
    t.linea("Rodizio");
    t.columnasDobles("TOTAL", "$629.88");
    t.qr("https://f.motrest.mx/A-000123");
    t.linea("Factura tu consumo");

    const bloques = t.aBloques();
    expect(bloques.map((b) => b.tipo)).toEqual(["texto", "imagen", "texto", "qr", "texto"]);
    expect(bloques[3]).toEqual({ tipo: "qr", contenido: "https://f.motrest.mx/A-000123" });
  });

  /*
   * La vista previa y la vista legible salen del MISMO flujo de bytes: si el
   * texto de los bloques dijera algo distinto de `aTexto()`, el restaurante
   * estaría aprobando en pantalla un papel que no es el que va a salir.
   */
  it("el texto de los bloques no puede divergir del ticket legible", () => {
    const t = new Ticket(42);
    t.linea("Rodizio", { alineacion: "centro", negrita: true });
    t.imagenMonocroma(logoDePrueba(48, 12), 1, 0);
    t.columnasDobles("2x Pizza familiar mitad y mitad", "$996.00");
    t.qr("https://f.motrest.mx/A-000123");
    t.linea("Piña y jamón · ½ y ½");
    t.cortar();

    expect(textoDeBloques(t.aBloques())).toBe(t.aTexto());
  });

  it("el enlace del código vive en su bloque y no en el texto", () => {
    const t = new Ticket(42);
    t.linea("Factura tu consumo");
    t.qr("https://f.motrest.mx/A-000123");

    const bloques = t.aBloques();
    expect(textoDeBloques(bloques)).toContain("Factura tu consumo");
    expect(textoDeBloques(bloques)).not.toContain("https://");
    expect(bloques.find((b) => b.tipo === "qr")).toEqual({
      tipo: "qr",
      contenido: "https://f.motrest.mx/A-000123",
    });
  });

  it("el logo se muestra tal como se va a imprimir, sin reescalar", () => {
    const logo = logoDePrueba(PUNTOS_POR_ANCHO[42], 40);
    const t = new Ticket(42);
    t.imagenMonocroma(logo, 1, 0);

    const bloque = t.aBloques()[0]!;
    expect(bloque.tipo).toBe("imagen");
    if (bloque.tipo !== "imagen") return;
    // El mapa ya viene calculado para este papel: escalarlo otra vez lo dejaría
    // con los bordes en escalera.
    expect(bloque.escala).toBe(1);
    expect(bloque.margen).toBe(0);
    expect(bloque.imagen.ancho).toBe(PUNTOS_POR_ANCHO[42]);
    expect(bloque.imagen).toBe(logo);
  });
});

// --- El logo en los tickets que se entregan ------------------------------------------

const LOCAL = {
  nombre: "Rodizio",
  direccion: "Av. Central 100",
  rfc: "XAXX010101000",
  telefono: "55 1234 5678",
};

const DATOS_VENTA = {
  folio: "A-000123",
  ts: T0,
  local: LOCAL,
  mesa: "12",
  mesero: "Lucía",
  renglones: [
    { cantidad: 2, descripcion: "Pizza familiar", importe: pesos(498) },
    { cantidad: 1, descripcion: "Limonada", importe: pesos(45) },
  ],
  subtotal: pesos(543),
  descuentos: pesos(27),
  cortesias: pesos(0) as Centavos,
  iva: pesos(82.56),
  ieps: pesos(0) as Centavos,
  total: pesos(598.56),
  propina: pesos(60),
  pagos: [{ forma: "Efectivo", monto: pesos(700) }],
  cambio: pesos(41.44),
};

const DATOS_PRECUENTA = {
  folio: "A1B2C3D4",
  ts: T0,
  local: LOCAL,
  mesa: "12",
  mesero: "Lucía",
  renglones: [
    { cantidad: 2, descripcion: "Pizza familiar", importe: pesos(577.68) },
    { cantidad: 1, descripcion: "Limonada", importe: pesos(52.2) },
  ],
  suma: pesos(629.88),
  descuentos: pesos(0) as Centavos,
  cortesias: pesos(0) as Centavos,
  total: pesos(629.88),
};

/** El logo tal como se guardaría para el papel de 80 mm. */
const LOGO_RODIZIO = logoDePrueba(PUNTOS_POR_ANCHO[42], 40);

describe("el logo en el ticket de venta", () => {
  it("va arriba de todo, antes del nombre del local", () => {
    const bloques = ticketVenta({ ...DATOS_VENTA, logo: LOGO_RODIZIO }).aBloques();

    expect(bloques[0]!.tipo).toBe("imagen");
    // El nombre no desaparece: un logo de puntos térmicos no siempre se reconoce
    // y es el nombre lo que se lee de un vistazo tres semanas después.
    const primerTexto = bloquesDeTexto(bloques)[0]!;
    expect(primerTexto.lineas.find((l) => l.trim() !== "")).toBe("Rodizio");
  });

  it("sin logo configurado no aparece ningún bloque de imagen", () => {
    const bloques = ticketVenta(DATOS_VENTA).aBloques();
    expect(bloques.some((b) => b.tipo === "imagen")).toBe(false);
    expect(bloques[0]!.tipo).toBe("texto");
  });

  it("el logo no ensucia la vista legible ni cambia una cifra", () => {
    const conLogo = ticketVenta({ ...DATOS_VENTA, logo: LOGO_RODIZIO }).aTexto();
    const sinLogo = ticketVenta(DATOS_VENTA).aTexto();

    const visibles = (texto: string) => texto.split("\n").filter((l) => l.trim() !== "");
    expect(visibles(conLogo)).toEqual(visibles(sinLogo));
    expect(conLogo).toContain("$598.56");
    // Y ni un byte del mapa de puntos se cuela como carácter.
    for (const linea of conLogo.split("\n")) expect(linea).toMatch(CARACTERES_DE_TICKET);
  });

  it("con logo y QR de autofactura, la vista previa sigue diciendo lo mismo que el papel", () => {
    const ticket = ticketVenta({
      ...DATOS_VENTA,
      logo: LOGO_RODIZIO,
      url_autofactura: "https://f.motrest.mx/A-000123",
    });
    const bloques = ticket.aBloques();

    expect(bloques.map((b) => b.tipo)).toEqual(["imagen", "texto", "qr", "texto"]);
    expect(textoDeBloques(bloques)).toBe(ticket.aTexto());
  });

  it("una reimpresión avisa antes del logo: es lo primero que hay que leer", () => {
    const bloques = ticketVenta({
      ...DATOS_VENTA,
      logo: LOGO_RODIZIO,
      reimpresion: 1,
    }).aBloques();

    expect(bloques[0]!.tipo).toBe("texto");
    expect(bloquesDeTexto(bloques)[0]!.lineas.join("\n")).toContain("REIMPRESION #1");
    expect(bloques[1]!.tipo).toBe("imagen");
  });
});

describe("el logo en la pre-cuenta", () => {
  it("va arriba del nombre del local, igual que en el ticket", () => {
    const bloques = precuenta({ ...DATOS_PRECUENTA, logo: LOGO_RODIZIO }).aBloques();

    expect(bloques[0]!.tipo).toBe("imagen");
    expect(bloquesDeTexto(bloques)[0]!.lineas.find((l) => l.trim() !== "")).toBe("Rodizio");
  });

  it("sin logo configurado no aparece ningún bloque de imagen", () => {
    expect(precuenta(DATOS_PRECUENTA).aBloques().some((b) => b.tipo === "imagen")).toBe(false);
  });

  it("el logo no ensucia la vista legible ni cambia el total a pagar", () => {
    const conLogo = precuenta({ ...DATOS_PRECUENTA, logo: LOGO_RODIZIO }).aTexto();
    const sinLogo = precuenta(DATOS_PRECUENTA).aTexto();

    const visibles = (texto: string) => texto.split("\n").filter((l) => l.trim() !== "");
    expect(visibles(conLogo)).toEqual(visibles(sinLogo));
    expect(conLogo).toContain("$629.88");
    expect(conLogo).toContain("Precios con IVA incluido");
    for (const linea of conLogo.split("\n")) expect(linea).toMatch(CARACTERES_DE_TICKET);
  });

  it("con logo y los dos QR del comensal, cada pieza queda en su sitio", () => {
    const ticket = precuenta({
      ...DATOS_PRECUENTA,
      logo: LOGO_RODIZIO,
      qrs: [
        { leyenda: "¿Cómo estuvo todo?", url: "https://motrest.test/opinion" },
        { leyenda: "Danos 5 estrellas", url: "https://maps.example/restaurante" },
      ],
    });
    const bloques = ticket.aBloques();

    expect(bloques.map((b) => b.tipo)).toEqual([
      "imagen",
      "texto",
      "qr",
      "texto",
      "qr",
      "texto",
    ]);
    expect(bloques.filter((b) => b.tipo === "qr")).toEqual([
      { tipo: "qr", contenido: "https://motrest.test/opinion" },
      { tipo: "qr", contenido: "https://maps.example/restaurante" },
    ]);
    expect(textoDeBloques(bloques)).toBe(ticket.aTexto());
    expect(textoDeBloques(bloques)).toContain("¿Cómo estuvo todo?");
  });

  it("el logo del disco llega al papel sin pasar por otra conversión", () => {
    // El camino completo: lo guardado en el local es lo que se imprime.
    const guardado = empaquetarLogo(logoDePrueba(PUNTOS_POR_ANCHO[32], 24));
    const logo = desempaquetarLogo(guardado)!;
    const bloque = precuenta({ ...DATOS_PRECUENTA, logo }, 32).aBloques()[0]!;

    expect(bloque.tipo).toBe("imagen");
    if (bloque.tipo !== "imagen") return;
    expect(bloque.imagen.ancho).toBe(PUNTOS_POR_ANCHO[32]);
    expect(bloque.imagen.pixeles).toEqual(logo.pixeles);
  });
});
