/**
 * La API pública del restaurante (F4).
 *
 * PARA QUÉ EXISTE. Para que el restaurante pueda sacar SUS datos sin pedirle
 * permiso a nadie: su contador quiere las ventas del mes, su agencia quiere el
 * menú para la página, el dueño quiere un tablero propio. Sin API, todo eso
 * termina en capturas de pantalla y en un archivo de Excel a mano.
 *
 * LAS TRES REGLAS QUE LA HACEN SEGURA, Y NINGUNA ES OPCIONAL:
 *
 *   1. **SOLO LECTURA.** Ni un endpoint que escriba. Una API que puede crear
 *      ventas es una API que puede falsearlas, y el event log dejaría de ser una
 *      bitácora fiable el día que alguien filtre un token. Quien necesite meter
 *      pedidos entra por el canal de comandas, que sí valida permisos y deja
 *      rastro con un empleado detrás.
 *
 *   2. **UN TOKEN, UN ALCANCE.** El token del contador lee ventas y no ve
 *      clientes. El de la agencia lee el menú y nada más. Un token que lo lee
 *      todo es el que acaba pegado en una hoja de cálculo compartida.
 *
 *   3. **SE PUEDE REVOCAR SIN TOCAR A LOS DEMÁS.** El día que una agencia deja
 *      de trabajar con el restaurante, se apaga SU token. Si hubiera uno solo
 *      para todos, apagarlo dejaría también al contador sin datos.
 *
 * DÓNDE VIVE. En el Hub del local, en la red del restaurante. No es una API en
 * internet: quien la consuma tiene que estar en la red o entrar por el relay.
 * Publicar los datos de un restaurante en internet para comodidad de su contador
 * es un intercambio que nadie hizo a conciencia.
 */
import type { ID } from "../comun/ids.js";

/** Qué puede leer un token. Deliberadamente pocos y gruesos. */
export type AlcanceApi =
  /** Carta, precios, disponibilidad. Lo único que un tercero suele necesitar. */
  | "menu"
  /** Ventas y cortes, sin el detalle de quién comió qué. */
  | "ventas"
  /** Existencias y mermas. */
  | "inventario"
  /** Fichas de comensales. El más delicado: son datos personales. */
  | "clientes";

export interface DefinicionAlcance {
  alcance: AlcanceApi;
  etiqueta: string;
  /** Qué se lleva quien lo tenga, dicho sin rodeos. */
  descripcion: string;
  /** true = son datos personales y hay que pensárselo dos veces. */
  delicado?: boolean;
}

export const ALCANCES: DefinicionAlcance[] = [
  {
    alcance: "menu",
    etiqueta: "Carta y precios",
    descripcion: "Categorías, platillos, precios y qué está disponible.",
  },
  {
    alcance: "ventas",
    etiqueta: "Ventas y cortes",
    descripcion: "Totales por día, por producto y por forma de pago. Sin datos de comensales.",
  },
  {
    alcance: "inventario",
    etiqueta: "Inventario",
    descripcion: "Existencias, mermas y consumos.",
  },
  {
    alcance: "clientes",
    etiqueta: "Comensales",
    descripcion:
      "Nombres, teléfonos y correos de sus clientes. Son datos personales: solo a quien " +
      "los necesite de verdad, y respondiendo usted por ellos ante la ley.",
    delicado: true,
  },
];

export interface TokenApi {
  id: ID;
  /** Para qué es, escrito por quien lo creó: "Contador", "Página web". */
  nombre: string;
  /** Solo el HASH. El token en claro se enseña UNA vez y no se vuelve a ver. */
  hash: string;
  alcances: AlcanceApi[];
  creado_ts: number;
  /** Si caduca. Un token sin caducidad sobrevive a la relación que lo justificó. */
  expira_ts?: number;
  /** Cuándo se usó por última vez. Un token que nadie usa hay que apagarlo. */
  usado_ts?: number;
  revocado: boolean;
}

/** Cuántas peticiones por minuto admite un token. */
export const LIMITE_POR_MINUTO = 60;

export type VeredictoApi =
  | { permitido: true; token: TokenApi }
  | { permitido: false; codigo: 401 | 403 | 429; razon: string };

/**
 * ¿Este token puede leer esto, ahora?
 *
 * El orden de las comprobaciones importa para no filtrar información: primero se
 * decide si el token existe y sirve, y solo después si alcanza para el recurso.
 * Al revés, las respuestas distinguirían "token válido sin permiso" de "token
 * inválido", y eso le dice a quien prueba tokens al azar cuándo acertó uno.
 */
export function autorizarApi(
  token: TokenApi | undefined,
  alcance: AlcanceApi,
  peticionesEsteMinuto: number,
  ahora = Date.now(),
): VeredictoApi {
  if (!token || token.revocado) {
    return { permitido: false, codigo: 401, razon: "Token no válido" };
  }
  if (token.expira_ts !== undefined && token.expira_ts <= ahora) {
    return { permitido: false, codigo: 401, razon: "Token caducado" };
  }

  /*
   * El límite va ANTES del alcance. Un atacante que prueba alcances a ciegas
   * consume peticiones igual, y frenarlo aquí es lo que evita que use la API
   * como oráculo para descubrir qué puede hacer con un token robado.
   */
  if (peticionesEsteMinuto >= LIMITE_POR_MINUTO) {
    return { permitido: false, codigo: 429, razon: "Demasiadas peticiones. Espera un minuto." };
  }

  if (!token.alcances.includes(alcance)) {
    return { permitido: false, codigo: 403, razon: `Este token no puede leer "${alcance}"` };
  }

  return { permitido: true, token };
}

/**
 * Genera un token nuevo, en claro. Se enseña UNA vez.
 *
 * Con prefijo `mrt_` para que sea reconocible: los buscadores de secretos que
 * revisan repositorios detectan por prefijo, y un token que aparece en un
 * repositorio público conviene que salte a la vista antes que tarde.
 */
export function generarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `mrt_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Hash del token, que es lo único que se guarda. */
export async function hashDeToken(token: string): Promise<string> {
  const resumen = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Busca el token que corresponde a un secreto presentado.
 *
 * Recorre TODOS aunque encuentre el suyo al principio. Cortar en cuanto acierta
 * haría que el tiempo de respuesta delatara la posición del token en la lista, y
 * con eso se puede ir adivinando de a poco.
 */
export async function buscarToken(
  presentado: string,
  tokens: readonly TokenApi[],
): Promise<TokenApi | undefined> {
  const hash = await hashDeToken(presentado);
  let encontrado: TokenApi | undefined;

  for (const token of tokens) {
    let diferencia = token.hash.length ^ hash.length;
    for (let i = 0; i < Math.min(token.hash.length, hash.length); i++) {
      diferencia |= token.hash.charCodeAt(i) ^ hash.charCodeAt(i);
    }
    if (diferencia === 0) encontrado = token;
  }

  return encontrado;
}

/** Lo que se le enseña al restaurantero de cada token. Nunca el secreto. */
export interface ResumenToken {
  id: ID;
  nombre: string;
  alcances: string[];
  creado_ts: number;
  usado_ts?: number;
  estado: "activo" | "revocado" | "caducado" | "sin_usar";
}

export function resumirTokens(tokens: readonly TokenApi[], ahora = Date.now()): ResumenToken[] {
  return tokens.map((t) => ({
    id: t.id,
    nombre: t.nombre,
    alcances: t.alcances.map(
      (a) => ALCANCES.find((d) => d.alcance === a)?.etiqueta ?? a,
    ),
    creado_ts: t.creado_ts,
    usado_ts: t.usado_ts,
    estado: t.revocado
      ? "revocado"
      : t.expira_ts !== undefined && t.expira_ts <= ahora
        ? "caducado"
        // Un token que se creó y nunca se usó suele ser uno que se pidió "por si
        // acaso". Señalarlo es lo que hace que alguien lo apague.
        : t.usado_ts === undefined
          ? "sin_usar"
          : "activo",
  }));
}
