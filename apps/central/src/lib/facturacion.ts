/**
 * La facturación de cada restaurante, vista desde Central.
 *
 * Aquí vive lo que se puede pensar sin red: leer lo que contesta FacturAPI,
 * convertirlo en un semáforo que Gonzalo entienda de un vistazo, y traducir el
 * estado que reporta cada Hub. Las peticiones —que necesitan las llaves— están
 * en `central.svelte.ts`; esto son funciones puras y por eso se prueban solas.
 *
 * TODO LO QUE LLEGA DE FUERA SE LEE CAMPO A CAMPO, igual que los pulsos. Una
 * respuesta de FacturAPI o un estado del Hub traen lo que traen, y copiarlos
 * enteros es cómo un dato que nadie decidió enseñar acaba pintado en pantalla —
 * y en el caso de un estado de secretos, cómo una llave colada por error acabaría
 * a la vista.
 */
import {
  esPublicaDeSobre,
  type ClaseSecreto,
  type EstadoFacturapi,
  type EstadoGmail,
  type EstadoSecretos,
  type ModoFacturapi,
  type OrigenSecreto,
} from "@motrest/dominio";

/**
 * Lo que Central recuerda de la facturación de cada local.
 *
 * NADA DE ESTO ES SECRETO, y es a propósito: vive en la cartera (localStorage),
 * que se lee sin desproteger nada y se exporta a un archivo que se manda por
 * correo. La llave de usuario de MOTRAE vive en DPAPI, y las llaves de cada
 * restaurante no se guardan en Central en ninguna parte: se sacan de FacturAPI
 * en el momento de enviarlas, se cierran en el sobre y se olvidan.
 *
 * Lo que sí se recuerda son IDENTIFICADORES —de la organización y de las llaves
 * Live que Central creó para este local—, que es lo que hace falta para
 * revocar una llave filtrada sin revocar las de los demás.
 */
export interface FacturacionDeLocal {
  organizacion_id?: string;
  organizacion_nombre?: string;
  modo?: ModoFacturapi;
  /** Cuándo se mandó la última llave de FacturAPI desde Central. */
  facturapi_enviado_ts?: number;
  /**
   * Las llaves Live que Central creó para este local, la más reciente al final.
   * El id y la fecha; nunca la llave.
   */
  llaves_live?: { id: string; creada_ts: number }[];
  gmail_remitente?: string;
  gmail_enviado_ts?: number;
}

/** Una organización de FacturAPI, reducida a lo que el panel enseña. */
export interface OrganizacionFacturapi {
  id: string;
  /** El nombre comercial, o la razón social si no hay otro. */
  nombre: string;
  razon_social?: string;
  /** No viene en la especificación oficial, pero sí en las respuestas reales. */
  rfc?: string;
  /** `is_production_ready`: si puede timbrar de verdad. */
  lista: boolean;
  pendientes: { tipo: string; descripcion: string }[];
  csd: { cargado: boolean; vence?: string };
}

export type ColorSemaforo = "verde" | "ambar" | "rojo" | "gris";

export interface PuntoSemaforo {
  color: ColorSemaforo;
  texto: string;
}

export interface Semaforo {
  color: ColorSemaforo;
  titulo: string;
  puntos: PuntoSemaforo[];
}

/** La fila del buzón, sin el sobre: Central no lo necesita de vuelta. */
export interface FilaSecretoPendiente {
  sucursal_id: string;
  clase: ClaseSecreto;
  depositado_ts: number;
  entregado_ts?: number;
  aplicado_ts?: number;
  ultimo_error?: string;
}

/** Lo que el pulso trae sobre los secretos de un local. */
export interface SecretosDelLocal {
  /** Con qué cerrarle un sobre. Sin ella, su Hub es anterior a la 1.5.5. */
  llave_publica?: string;
  estado?: EstadoSecretos;
}

/**
 * FacturAPI. En la aplicación instalada esta base la fija Rust
 * (`BASE_FACTURAPI` en lib.rs) y la ventana no la elige; aquí solo la usa el
 * camino de desarrollo y de pruebas, que va por `fetch`.
 */
export const BASE_FACTURAPI = "https://www.facturapi.io";

/** Tope de páginas de 100 al listar organizaciones: el de FacturAPI (3 000). */
export const PAGINAS_MAXIMAS = 30;

/** Cuántos días antes de que venza el CSD empieza a ponerse en ámbar. */
export const DIAS_AVISO_CSD = 30;

/**
 * Lo que se le dice a Gonzalo cuando el local no publicó su llave pública.
 *
 * Un Hub anterior a la 1.5.5 no sabe abrir sobres. Depositarle uno sería dejar
 * una llave esperando para siempre con el panel diciendo «enviada».
 */
export const SIN_LLAVE_PUBLICA = "Este restaurante necesita la 1.5.5 para recibir llaves";

/**
 * Lo que se dice si esta computadora no sabe hacer X25519.
 *
 * La ventana de Central es WebView2, que lo trae desde Chromium 133. Un Windows
 * sin actualizar puede tener uno anterior, y fallar a medio envío —con la llave
 * Live ya creada en FacturAPI— sería peor que no empezar.
 */
export const SIN_SOBRES =
  "Esta computadora no sabe cifrar las llaves para los restaurantes: su motor de " +
  "ventanas (Microsoft Edge WebView2) es anterior a la versión 133. Actualiza Windows " +
  "o Microsoft Edge y vuelve a abrir Central.";

// --- Formas de lo que se escribe a mano ---------------------------------------------------

/** La llave de USUARIO de FacturAPI: la de la cuenta, no la de un restaurante. */
export function llaveDeUsuarioValida(llave: string): boolean {
  const limpia = llave.trim();
  return limpia.startsWith("sk_user_") && limpia.length >= 24 && !/\s/.test(limpia);
}

/**
 * Un identificador de FacturAPI. La misma regla que aplica Rust a la ruta
 * (`es_id_de_facturapi`): si aquí pasara algo que allí no, el botón fallaría
 * con un «petición no permitida» que nadie entendería.
 */
export function esIdDeFacturapi(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export function correoValido(texto: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim()) && texto.trim().length <= 254;
}

// --- Lo que contesta FacturAPI ------------------------------------------------------------

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() ? valor.trim() : undefined;
}

function objeto(valor: unknown): Record<string, unknown> | undefined {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : undefined;
}

/** Una organización tal como la devuelve FacturAPI, o `null` si no lo es. */
export function leerOrganizacion(valor: unknown): OrganizacionFacturapi | null {
  const org = objeto(valor);
  if (!org || !esIdDeFacturapi(org.id)) return null;

  const legal = objeto(org.legal) ?? {};
  const certificado = objeto(org.certificate) ?? {};
  const razon_social = texto(legal.legal_name);
  const rfc = texto(legal.tax_id);
  const vence = texto(certificado.expires_at);

  const pendientes = (Array.isArray(org.pending_steps) ? org.pending_steps : [])
    .map((paso) => {
      const p = objeto(paso);
      const tipo = texto(p?.type);
      return tipo ? { tipo, descripcion: texto(p?.description) ?? "" } : null;
    })
    .filter((p): p is { tipo: string; descripcion: string } => p !== null)
    .slice(0, 10);

  return {
    id: org.id,
    nombre: texto(legal.name) ?? razon_social ?? org.id,
    ...(razon_social ? { razon_social } : {}),
    ...(rfc ? { rfc } : {}),
    lista: org.is_production_ready === true,
    pendientes,
    csd: { cargado: certificado.has_certificate === true, ...(vence ? { vence } : {}) },
  };
}

/** Una página de `GET /v2/organizations`. */
export function leerPaginaDeOrganizaciones(
  cuerpo: string,
): { organizaciones: OrganizacionFacturapi[]; paginas: number } | null {
  try {
    const pagina = objeto(JSON.parse(cuerpo));
    if (!pagina || !Array.isArray(pagina.data)) return null;
    return {
      organizaciones: pagina.data
        .map(leerOrganizacion)
        .filter((o): o is OrganizacionFacturapi => o !== null),
      paginas:
        typeof pagina.total_pages === "number" && pagina.total_pages > 0 ? pagina.total_pages : 1,
    };
  } catch {
    return null;
  }
}

/**
 * La llave que devuelve FacturAPI al pedirla.
 *
 * La especificación dice que la respuesta es un `string` en JSON, es decir, la
 * llave ENTRE COMILLAS. Se acepta también sin ellas por si un día cambia, y se
 * comprueba el prefijo del modo: pedir la de producción y recibir otra cosa
 * tiene que pararse aquí, no en la caja del restaurante.
 */
export function leerLlaveDeRespuesta(cuerpo: string, modo: ModoFacturapi): string | null {
  let valor: unknown = cuerpo.trim();
  try {
    valor = JSON.parse(cuerpo);
  } catch {
    /* Ya era el texto tal cual. */
  }
  if (typeof valor !== "string") return null;
  const llave = valor.trim();
  const prefijo = modo === "produccion" ? "sk_live_" : "sk_test_";
  return llave.startsWith(prefijo) && llave.length >= prefijo.length + 16 && !/\s/.test(llave)
    ? llave
    : null;
}

/** Una llave Live de la lista: nunca la llave, solo su principio. */
export interface LlaveLive {
  id: string;
  /** `first_12`: «sk_live_» y cuatro caracteres. Sirve para reconocerla. */
  inicio: string;
  creada_ts: number;
}

export function leerLlavesLive(cuerpo: string): LlaveLive[] | null {
  try {
    const lista = JSON.parse(cuerpo) as unknown;
    if (!Array.isArray(lista)) return null;
    return lista
      .map((l) => {
        const llave = objeto(l);
        if (!llave || !esIdDeFacturapi(llave.id)) return null;
        const creada = Date.parse(String(llave.created_at ?? ""));
        return {
          id: llave.id,
          inicio: texto(llave.first_12)?.slice(0, 12) ?? "",
          creada_ts: Number.isFinite(creada) ? creada : 0,
        };
      })
      .filter((l): l is LlaveLive => l !== null)
      .sort((a, b) => b.creada_ts - a.creada_ts);
  } catch {
    return null;
  }
}

/**
 * ¿Cuál de la lista es la que se acaba de crear?
 *
 * Crear una Live devuelve solo el texto de la llave, sin su identificador, y
 * para revocarla hace falta el identificador. Se busca por los doce primeros
 * caracteres, que es lo único que la lista enseña, y ante dos iguales —cuatro
 * caracteres de azar pueden coincidir— se queda con la más reciente, que es la
 * que acabamos de pedir.
 */
export function idDeLaLlaveNueva(llaves: LlaveLive[], llave: string): string | undefined {
  const inicio = llave.slice(0, 12);
  return llaves
    .filter((l) => l.inicio === inicio)
    .sort((a, b) => b.creada_ts - a.creada_ts)[0]?.id;
}

/**
 * El motivo de un error de FacturAPI, en palabras de persona.
 *
 * FacturAPI contesta `{ message }` en español; se usa tal cual cuando lo hay. El
 * 401 se traduce aparte porque lo único que puede significar desde Central es
 * que la llave de usuario guardada en Llaves ya no sirve.
 */
export function errorDeFacturapi(estado: number, cuerpo: string): string {
  if (estado === 401 || estado === 403) {
    return "FacturAPI rechazó tu llave de usuario. Revísala en Llaves → FacturAPI.";
  }
  if (estado === 404) return "FacturAPI no encuentra esa organización.";
  if (estado === 429) return "FacturAPI pide esperar un momento: demasiadas peticiones seguidas.";
  try {
    const mensaje = texto(objeto(JSON.parse(cuerpo))?.message);
    if (mensaje) return `FacturAPI respondió: ${mensaje}`;
  } catch {
    /* Sin cuerpo legible: se dice el código. */
  }
  return `FacturAPI respondió ${estado}`;
}

// --- El semáforo --------------------------------------------------------------------------

/** Días hasta una fecha ISO, redondeando hacia abajo. `null` si no es fecha. */
export function diasHasta(iso: string | undefined, ahora: number): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.floor((ts - ahora) / 86_400_000);
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Los pasos pendientes de FacturAPI, dichos como se le diría a Gonzalo.
 *
 * FacturAPI da un código (`legal`, `logo`, `certificate`, `manifiesto`) y un
 * texto. El código se traduce porque el texto está pensado para el dueño de la
 * cuenta, no para quien tiene al restaurantero al teléfono; si llega un código
 * que no conocemos, se usa su texto tal cual en vez de callarlo.
 */
export function textoDePendiente(tipo: string, descripcion = ""): string {
  switch (tipo) {
    case "legal":
      return "Completar los datos fiscales (razón social, régimen y domicilio fiscal)";
    case "certificate":
      return "Cargar el CSD del restaurante (.cer, .key y su contraseña)";
    case "manifiesto":
      return "Firmar el manifiesto de FacturAPI (la autorización para timbrar ante el SAT)";
    case "logo":
      return "Subir el logotipo (sale en el PDF de la factura)";
    default:
      return descripcion || `Completar «${tipo}» en FacturAPI`;
  }
}

const PESO: Record<ColorSemaforo, number> = { gris: 0, verde: 1, ambar: 2, rojo: 3 };

function peor(colores: ColorSemaforo[]): ColorSemaforo {
  return colores.reduce<ColorSemaforo>((a, b) => (PESO[b] > PESO[a] ? b : a), "verde");
}

/**
 * Cómo está la organización para facturar, en tres colores.
 *
 * EL MODO CAMBIA LA PREGUNTA. En pruebas no hace falta CSD ni manifiesto: lo
 * que no está listo solo impide facturar DE VERDAD, así que se enseña en ámbar
 * —«puedes probar ya, para producción falta esto»—. En producción lo mismo es
 * rojo, porque una llave Live de una organización sin CSD es un restaurante que
 * no puede darle factura al cliente que la pide.
 */
export function semaforoDeOrganizacion(
  org: OrganizacionFacturapi,
  modo: ModoFacturapi,
  ahora: number,
): Semaforo {
  const bloquea: ColorSemaforo = modo === "produccion" ? "rojo" : "ambar";
  const puntos: PuntoSemaforo[] = [];
  const tipos = new Set(org.pendientes.map((p) => p.tipo));

  if (tipos.has("legal")) {
    puntos.push({ color: bloquea, texto: textoDePendiente("legal") });
  } else {
    const quien = [org.razon_social ?? org.nombre, org.rfc].filter(Boolean).join(" · ");
    puntos.push({ color: "verde", texto: `Datos fiscales completos: ${quien}` });
  }

  const dias = diasHasta(org.csd.vence, ahora);
  if (!org.csd.cargado || tipos.has("certificate")) {
    puntos.push({ color: bloquea, texto: "Falta cargar el CSD (.cer, .key y su contraseña) en FacturAPI" });
  } else if (dias !== null && dias < 0) {
    puntos.push({
      color: bloquea,
      texto: `El CSD venció el ${fechaCorta(org.csd.vence!)}: hay que tramitar uno nuevo en el SAT y subirlo a FacturAPI`,
    });
  } else if (dias !== null && dias <= DIAS_AVISO_CSD) {
    puntos.push({
      color: "ambar",
      texto:
        `El CSD vence el ${fechaCorta(org.csd.vence!)} (en ${dias} ${dias === 1 ? "día" : "días"}): ` +
        "renuévalo en el SAT y súbelo a FacturAPI antes de esa fecha",
    });
  } else {
    puntos.push({
      color: "verde",
      texto: org.csd.vence
        ? `CSD cargado, vigente hasta el ${fechaCorta(org.csd.vence)}`
        : "CSD cargado",
    });
  }

  for (const paso of org.pendientes) {
    if (paso.tipo === "legal" || paso.tipo === "certificate") continue;
    /* El logotipo no impide timbrar: se avisa, no se bloquea. */
    puntos.push({
      color: paso.tipo === "logo" ? "ambar" : bloquea,
      texto: textoDePendiente(paso.tipo, paso.descripcion),
    });
  }

  if (!org.lista) {
    puntos.push({ color: bloquea, texto: "FacturAPI todavía no la deja facturar en producción" });
  }

  const color = peor(puntos.map((p) => p.color));
  const titulo =
    color === "verde"
      ? modo === "produccion"
        ? "Lista para facturar de verdad"
        : "Lista: puedes probar, y también pasar a producción"
      : modo === "pruebas"
        ? org.lista
          ? "Puede probar ya; hay algo que conviene atender"
          : "Puede probar ya. Para facturar de verdad falta lo que está en ámbar"
        : color === "rojo"
          ? "Todavía no puede facturar de verdad"
          : "Puede facturar, pero hay algo que atender pronto";

  return { color, titulo, puntos };
}

// --- Lo que reporta el Hub ----------------------------------------------------------------

function origen(valor: unknown): OrigenSecreto | undefined {
  return valor === "central" || valor === "local" ? valor : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/**
 * El `EstadoSecretos` del pulso, leído campo a campo.
 *
 * La nube ya lo reconstruye así antes de guardarlo (`privado.sanear_pulso`), y
 * aquí se vuelve a hacer: Central no puede depender de que la nube esté al día
 * con la migración para no pintar una llave entera. `termina_en` se corta a
 * cuatro caracteres por si acaso; es lo ÚNICO que se enseña de una llave.
 */
export function leerEstadoSecretos(valor: unknown): EstadoSecretos | undefined {
  const estado = objeto(valor);
  if (!estado) return undefined;
  const f = objeto(estado.facturapi);
  const g = objeto(estado.gmail);

  const facturapi: EstadoFacturapi = { configurada: f?.configurada === true };
  if (f) {
    if (f.modo === "pruebas" || f.modo === "produccion") facturapi.modo = f.modo;
    const termina = texto(f.termina_en)?.slice(-4);
    if (termina) facturapi.termina_en = termina;
    const o = origen(f.origen);
    if (o) facturapi.origen = o;
    const ts = numero(f.actualizado_ts);
    if (ts !== undefined) facturapi.actualizado_ts = ts;
    const org = texto(f.organizacion_id);
    if (org) facturapi.organizacion_id = org;
    const razon = texto(f.razon_social);
    if (razon) facturapi.razon_social = razon;
    const rfc = texto(f.rfc);
    if (rfc) facturapi.rfc = rfc;
    const vence = texto(f.csd_vence);
    if (vence) facturapi.csd_vence = vence;
    if (typeof f.lista === "boolean") facturapi.lista = f.lista;
    if (Array.isArray(f.pendientes)) {
      facturapi.pendientes = f.pendientes.filter((p): p is string => typeof p === "string").slice(0, 10);
    }
    const error = texto(f.error);
    if (error) facturapi.error = error;
  }

  const gmail: EstadoGmail = { configurada: g?.configurada === true };
  if (g) {
    const termina = texto(g.termina_en)?.slice(-4);
    if (termina) gmail.termina_en = termina;
    const o = origen(g.origen);
    if (o) gmail.origen = o;
    const ts = numero(g.actualizado_ts);
    if (ts !== undefined) gmail.actualizado_ts = ts;
    const remitente = texto(g.remitente);
    if (remitente) gmail.remitente = remitente;
    const error = texto(g.error);
    if (error) gmail.error = error;
  }

  return { facturapi, gmail };
}

/** Las dos columnas nuevas del pulso, validadas. */
export function leerSecretosDelPulso(fila: Record<string, unknown>): SecretosDelLocal {
  const estado = leerEstadoSecretos(fila.secretos);
  return {
    ...(esPublicaDeSobre(fila.llave_publica) ? { llave_publica: fila.llave_publica } : {}),
    ...(estado ? { estado } : {}),
  };
}

/** Una fila de `secretos_pendientes`, sin el sobre. */
export function leerFilaSecreto(valor: unknown): FilaSecretoPendiente | null {
  const fila = objeto(valor);
  if (!fila || typeof fila.sucursal_id !== "string") return null;
  if (fila.clase !== "facturapi" && fila.clase !== "gmail") return null;
  const cuando = (v: unknown): number | undefined => {
    const ts = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(ts) ? ts : undefined;
  };
  const depositado = cuando(fila.depositado_ts);
  if (depositado === undefined) return null;
  const entregado = cuando(fila.entregado_ts);
  const aplicado = cuando(fila.aplicado_ts);
  const error = texto(fila.ultimo_error);
  return {
    sucursal_id: fila.sucursal_id,
    clase: fila.clase,
    depositado_ts: depositado,
    ...(entregado !== undefined ? { entregado_ts: entregado } : {}),
    ...(aplicado !== undefined ? { aplicado_ts: aplicado } : {}),
    ...(error ? { ultimo_error: error } : {}),
  };
}

/**
 * En qué va el último envío, dicho en una frase.
 *
 * Se distingue DEPOSITADA de ENTREGADA de APLICADA, por lo mismo que con las
 * licencias: la nube solo sabe que el sobre está en el buzón, y quien dice si
 * la llave sirve es el Hub después de probarla contra FacturAPI. Decir «listo»
 * antes sería un restaurante que no puede dar factura con el panel en verde.
 */
export function entregaDeSecreto(
  fila: FilaSecretoPendiente | undefined,
  hace: (ts: number) => string,
): PuntoSemaforo | null {
  if (!fila) return null;
  if (fila.ultimo_error) {
    return {
      color: "rojo",
      texto: `El restaurante no la pudo usar: ${fila.ultimo_error}`,
    };
  }
  if (fila.aplicado_ts) {
    return { color: "verde", texto: `Recibida, probada y puesta ${hace(fila.aplicado_ts)}` };
  }
  if (fila.entregado_ts) {
    return {
      color: "ambar",
      texto: `Su Hub la recogió ${hace(fila.entregado_ts)} y todavía no confirma que funcione`,
    };
  }
  return {
    color: "ambar",
    texto:
      `Enviada ${hace(fila.depositado_ts)}. Su Hub la recoge en segundos si está encendido; ` +
      "si no, en cuanto encienda con internet",
  };
}
