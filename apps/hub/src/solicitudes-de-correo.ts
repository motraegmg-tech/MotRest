/**
 * Los correos que alguien pide desde una terminal, atendidos por el Hub.
 *
 * POR QUÉ EXISTE. De los seis correos del catálogo solo salía uno —la
 * confirmación de reserva, que el Hub dispara solo—; los otros cinco eran
 * interruptores conectados a nada, porque no había manera de pedirlos. Ahora el
 * camino es de ida y vuelta por el registro, a propósito:
 *
 *   1. La terminal anota `correo_solicitado`.
 *   2. El Hub lo ve al ingerirlo (aquí), lo manda y anota el resultado.
 *   3. `correo_enviado` o `correo_rechazado` vuelve a todas las terminales,
 *      atado por `solicitud_id`, y la ficha del comensal enseña qué pasó.
 *
 * Vive aparte de `main.ts` para poder probarlo de verdad: `main.ts` no se puede
 * importar sin arrancar el Hub entero, y una réplica en la prueba demostraría
 * que la réplica funciona, no que funciona esto.
 *
 * LO QUE MÁS IMPORTA AQUÍ ES NO MANDAR DOS VECES. El Hub puede ver la misma
 * petición más de una vez —una terminal que reconecta reenvía su ventana, un
 * lote puede traerla repetida, el Hub se reinicia—, y el mismo cupón dos veces
 * en el buzón de un comensal es exactamente lo que acaba en «reportar spam». Un
 * reporte de spam no mancha un correo: mancha la cuenta del restaurante, y a
 * partir de ahí tampoco llegan sus confirmaciones de reserva.
 */
import {
  VERSION_EVENTO,
  definicionCorreo,
  proyectarClientes,
  streamClientes,
  streamCorreo,
  uuidv7,
  type DatosCorreo,
  type EventoBase,
  type EventoCliente,
  type EventoCorreo,
  type ID,
  type TipoCorreo,
} from "@motrest/dominio";
import { CADUCA_MS, type PeticionCorreo, type ResultadoCorreo } from "./correo.js";

export type SolicitudDeCorreo = Extract<EventoCorreo, { tipo: "correo_solicitado" }>;

/**
 * A nombre de quién firma el Hub lo que anota por su cuenta.
 *
 * Es `sistema`, el mismo que usan el facturador y el cancelador, y aquí es
 * seguro por tres razones que conviene no olvidar, porque en este proyecto un
 * `caja_cerrada` firmado como `sistema` estuvo rechazándose en bucle durante
 * meses:
 *
 *   - Los resultados se meten con `hub.inyectar`, que NO pasa por la
 *     revalidación de permisos: esa es para lo que llega de una terminal.
 *   - Ninguno de los tres eventos de correo está en `PERMISO_POR_EVENTO`
 *     (`servidor.ts`), así que ni siquiera por `ingerir` se buscaría al firmante
 *     en el padrón.
 *   - Una terminal nunca reenvía lo que nació en el Hub: su bandeja de salida
 *     solo guarda lo suyo. El bucle de la caja nació de un evento de la TERMINAL
 *     firmado como `sistema`, que es el caso contrario.
 *
 * Y es lo honesto: el correo lo mandó el Hub, minutos u horas después de que
 * alguien lo pidiera. Colgárselo a la persona que lo pidió sería escribir en la
 * bitácora algo que esa persona no hizo; quién lo pidió ya está en el
 * `correo_solicitado`.
 */
export const EMPLEADO_DEL_HUB = "sistema";

/** A quién y de qué se anota un resultado. */
export interface DestinoDeCorreo {
  sucursal_id: ID;
  correo: string;
  clase_correo: TipoCorreo;
  /** Ausente en lo que el Hub manda por su cuenta, como la confirmación de reserva. */
  solicitud_id?: ID;
}

export interface DependenciasSolicitudes {
  hubId: ID;
  /** El envío. `null` mientras el Hub todavía no lo ha preparado. */
  correo: () => { mandar(peticion: PeticionCorreo): Promise<ResultadoCorreo> } | null;
  /** Un stream del registro del local, en el orden del Hub (`seq`). */
  leerStream: (streamId: ID) => Promise<readonly EventoBase[]>;
  /** Mete en el registro, y reparte a todas las terminales, lo que nace en el Hub. */
  inyectar: (eventos: readonly EventoBase[]) => void;
  registrar: (nivel: "info" | "aviso" | "error", texto: string) => void;
  ahora?: () => number;
}

export class SolicitudesDeCorreo {
  /**
   * Las peticiones que se están atendiendo AHORA, en memoria.
   *
   * El registro dice qué peticiones ya tienen respuesta, pero la respuesta se
   * anota cuando el proveedor contesta —segundos, u horas si no hay internet—.
   * En ese hueco la misma petición puede volver a entrar (dos veces en un lote,
   * o reemitida con otro id de evento), el registro todavía no la ve resuelta y
   * saldría un segundo correo. Este conjunto cierra ese hueco: se toma de forma
   * síncrona, antes de cualquier `await`, y se suelta solo cuando el resultado
   * ya está en el registro.
   */
  private enVuelo = new Set<ID>();
  /**
   * Una petición detrás de otra, nunca todas a la vez.
   *
   * Una campaña son cientos de peticiones en un solo lote. Mandarlas en
   * paralelo abriría cientos de conexiones a Gmail en el mismo segundo, que es
   * lo que un proveedor lee como abuso —la misma razón por la que la cola del
   * correo se vacía en serie—.
   */
  private turno: Promise<void> = Promise.resolve();
  private ahora: () => number;

  constructor(private deps: DependenciasSolicitudes) {
    this.ahora = deps.ahora ?? Date.now;
  }

  /**
   * Atiende las peticiones de correo de un lote recién aceptado.
   *
   * Se llama desde `alIngerir`, y por eso no puede lanzar ni esperar: una
   * excepción ahí se comería el acuse a la terminal, y una espera frenaría la
   * ingesta de comandas por un correo. El trabajo se encola y esta función
   * vuelve enseguida.
   */
  atender(eventos: readonly EventoBase[]): void {
    for (const ev of eventos) {
      if (ev.tipo !== "correo_solicitado") continue;
      const solicitud = ev as unknown as SolicitudDeCorreo;
      const id = solicitud.solicitud_id;

      if (typeof id !== "string" || id.length === 0) {
        // Sin `solicitud_id` no hay a qué atar la respuesta: la ficha nunca la
        // encontraría. Mandarlo igual sería mandar algo que nadie puede seguir.
        this.deps.registrar(
          "aviso",
          `Petición de correo sin identificador (evento ${ev.id}): se ignora.`,
        );
        continue;
      }

      if (this.enVuelo.has(id)) continue;
      this.enVuelo.add(id);

      this.turno = this.turno
        .then(() => this.atenderUna(solicitud))
        .catch((causa: unknown) => {
          this.deps.registrar("error", `Fallo al atender la petición de correo ${id}: ${String(causa)}`);
        });
    }
  }

  /**
   * Al arrancar: las peticiones que se quedaron sin respuesta.
   *
   * Un Hub que se reinicia —y se reinicia solo cada vez que se actualiza—
   * pierde lo que tenía en memoria, incluida la cola de correos que esperaban
   * internet. Sin esta vuelta, esas peticiones se quedarían «pendientes» para
   * siempre en la ficha del comensal, y un pendiente eterno es peor que un «no
   * se pudo»: nadie sabe si volver a pedirlo.
   *
   * No reenvía a ciegas: pasa por el mismo camino que una petición nueva, con
   * su comprobación del registro y su caducidad. Lo viejo se contesta como
   * caducado en vez de salir días tarde.
   */
  retomar(eventosDelStream: readonly EventoBase[]): number {
    // Las respondidas se calculan UNA vez aquí. Dejar que cada petición lo
    // comprobara leyendo el stream entero haría el arranque cuadrático sobre
    // todo el historial de correos del local.
    const respondidas = new Set<unknown>();
    for (const ev of eventosDelStream) {
      if (ev.tipo === "correo_enviado" || ev.tipo === "correo_rechazado") {
        respondidas.add((ev as { solicitud_id?: unknown }).solicitud_id);
      }
    }
    const huerfanas = eventosDelStream.filter(
      (ev) =>
        ev.tipo === "correo_solicitado" &&
        !respondidas.has((ev as { solicitud_id?: unknown }).solicitud_id),
    );
    this.atender(huerfanas);
    return huerfanas.length;
  }

  /** Espera a que no quede nada en turno. Para las pruebas y para cerrar con orden. */
  async enCalma(): Promise<void> {
    for (;;) {
      const actual = this.turno;
      await actual;
      if (actual === this.turno) return;
    }
  }

  /**
   * Anota en el registro cómo acabó un correo.
   *
   * Devuelve si pudo. Lo usa también la confirmación de reserva, que el Hub
   * manda por su cuenta: antes solo dejaba una línea en la bitácora, y lo que
   * no está en el registro no lo ve nadie desde la caja.
   */
  anotar(destino: DestinoDeCorreo, resultado: ResultadoCorreo): boolean {
    const sobre = {
      id: uuidv7(),
      ts: this.ahora(),
      orden_local: 0,
      device_id: this.deps.hubId,
      empleado_id: EMPLEADO_DEL_HUB,
      sucursal_id: destino.sucursal_id,
      stream_id: streamCorreo(destino.sucursal_id),
      v: VERSION_EVENTO,
      correo: destino.correo,
      clase_correo: destino.clase_correo,
      ...(destino.solicitud_id ? { solicitud_id: destino.solicitud_id } : {}),
    };
    const evento: EventoCorreo = resultado.enviado
      ? {
          ...sobre,
          tipo: "correo_enviado",
          ...(resultado.externo_id ? { externo_id: resultado.externo_id } : {}),
        }
      : { ...sobre, tipo: "correo_rechazado", motivo: resultado.razon || "No se pudo mandar" };

    try {
      this.deps.inyectar([evento]);
      return true;
    } catch (causa) {
      this.deps.registrar(
        "error",
        `No se pudo anotar el resultado de un correo (${destino.clase_correo}): ${String(causa)}`,
      );
      return false;
    }
  }

  private async atenderUna(s: SolicitudDeCorreo): Promise<void> {
    const id = s.solicitud_id;
    // Se suelta al final salvo que el correo siga vivo en la cola, o que haya
    // salido sin que se pudiera anotar (ver `cerrar`).
    let soltar = true;

    try {
      /*
       * EL REGISTRO PRIMERO. Si ya hay un resultado con este `solicitud_id`,
       * esta petición ya se atendió —en esta vida del Hub o en una anterior— y
       * no se hace nada. Ni siquiera se vuelve a contestar: una segunda
       * respuesta confundiría a la ficha y no le diría nada nuevo a nadie.
       */
      if (await this.yaRespondida(s)) {
        this.deps.registrar("info", `La petición de correo ${id} ya estaba atendida: no se repite.`);
        return;
      }

      const destino = this.destinoDe(s);
      const motivo = this.motivoParaNoIntentar(s);
      if (motivo) {
        soltar = this.cerrar(destino, { enviado: false, razon: motivo });
        return;
      }

      /*
       * Sin correo preparado se contesta igual, con un «no». Si no se
       * contestara, la ficha se quedaría en «pendiente» para siempre, y un
       * pendiente eterno es peor que un «no se pudo»: el segundo al menos dice
       * que hay que hacer algo. (Sin LLAVE no se llega aquí: el correo existe y
       * es `mandar` quien contesta «falta la contraseña de aplicación».)
       */
      const correo = this.deps.correo();
      if (!correo) {
        soltar = this.cerrar(destino, {
          enviado: false,
          razon: "El Hub todavía no tiene listo el correo del restaurante. Pídalo otra vez en un momento.",
        });
        return;
      }

      const resultado = await correo.mandar({
        tipo: s.clase_correo,
        para: s.correo,
        datos: datosDe(s),
        /*
         * EL CONSENTIMIENTO LO COMPRUEBA EL HUB, no se le cree a la tableta. Es
         * una función y no un valor para que se vuelva a preguntar en cada
         * intento, también si el correo sale de la cola horas después.
         */
        aceptaMarketing: () => this.consentimiento(s),
        alResolverse: (final) => {
          if (this.cerrar(destino, final)) this.enVuelo.delete(id);
        },
      });

      if (resultado.encolado) {
        /*
         * No salió todavía, pero saldrá cuando vuelva la red. NO es un
         * rechazo: anotarlo como tal sería mentir y, peor, invitaría a pedirlo
         * otra vez —y entonces al volver la red saldrían los dos—. Se queda
         * «pendiente», que es la verdad, y en vuelo hasta que la cola lo
         * resuelva y avise por `alResolverse`.
         */
        soltar = false;
        this.deps.registrar("info", `Correo ${id} en cola: sale cuando vuelva internet.`);
        return;
      }

      soltar = this.cerrar(destino, resultado);
    } finally {
      if (soltar) this.enVuelo.delete(id);
    }
  }

  /**
   * Anota el resultado y dice si ya se puede soltar la petición.
   *
   * Hay un caso en que NO: el correo salió y el registro no lo aceptó. Soltarlo
   * dejaría que la misma petición, al volver a entrar, no encontrara respuesta y
   * mandara un segundo correo. Mejor retenerla —mientras este proceso viva no
   * se repite— y dejarlo escrito en la bitácora.
   */
  private cerrar(destino: DestinoDeCorreo, resultado: ResultadoCorreo): boolean {
    const anotado = this.anotar(destino, resultado);
    if (!anotado && resultado.enviado) {
      this.deps.registrar(
        "error",
        `El correo ${destino.solicitud_id ?? ""} salió pero no quedó anotado: no se volverá a mandar mientras el Hub siga encendido.`,
      );
      return false;
    }
    if (resultado.enviado) {
      this.deps.registrar("info", `Correo enviado (${destino.clase_correo}, petición ${destino.solicitud_id}).`);
    } else {
      this.deps.registrar(
        "info",
        `Correo no enviado (${destino.clase_correo}, petición ${destino.solicitud_id}): ${resultado.razon}`,
      );
    }
    return true;
  }

  private async yaRespondida(s: SolicitudDeCorreo): Promise<boolean> {
    const eventos = await this.deps.leerStream(streamCorreo(s.sucursal_id));
    return eventos.some(
      (ev) =>
        (ev.tipo === "correo_enviado" || ev.tipo === "correo_rechazado") &&
        (ev as { solicitud_id?: unknown }).solicitud_id === s.solicitud_id,
    );
  }

  /** Lo que se contesta sin llegar a intentar el envío, o `null` si hay que intentarlo. */
  private motivoParaNoIntentar(s: SolicitudDeCorreo): string | null {
    if (!definicionCorreo(s.clase_correo)) {
      return `Tipo de correo desconocido: «${String(s.clase_correo)}»`;
    }

    /*
     * CADUCIDAD, con la misma ventana que la cola del correo. Una tableta que
     * estuvo horas en isla entrega sus peticiones al volver, y un «gracias por
     * su visita» de anteayer o el recordatorio de una reserva que ya pasó no
     * son un correo tardío: son una molestia. Es también la red de seguridad si
     * el Hub pierde historia y una terminal le reenvía peticiones viejas cuyas
     * respuestas ya no están.
     *
     * El `ts` es el reloj de la tableta. Uno adelantado da una edad negativa y
     * pasa; solo uno atrasado más de seis horas lo rechazaría, y lo haría
     * diciendo por qué.
     */
    const edad = this.ahora() - s.ts;
    if (edad > CADUCA_MS) {
      const horas = Math.floor(edad / (60 * 60 * 1000));
      return (
        `La petición llegó al Hub ${horas} horas después de hacerse y ya no se manda. ` +
        "Si todavía hace falta, pídalo otra vez."
      );
    }

    return null;
  }

  /**
   * ¿Este comensal acepta publicidad? Lo dice su ficha, no la tableta.
   *
   * ES UN REQUISITO LEGAL, no una preferencia de diseño. `acepta_marketing` en
   * la petición lo escribe la terminal, y una tableta con una versión vieja o
   * manipulada puede declarar un consentimiento que el comensal nunca dio. La
   * ficha, en cambio, es el registro del permiso: quién lo marcó y cuándo. Y si
   * el comensal pidió la baja entre la petición y el envío, la baja manda — por
   * eso esto se evalúa en el momento de mandar, y otra vez en cada reintento.
   *
   * Sin `cliente_id` no hay ficha contra la que comprobar (un correo tecleado a
   * mano), y solo entonces se usa lo que dice la petición. Con `cliente_id` y
   * sin ficha, o con la ficha dada de baja, la respuesta es NO: una petición
   * que apunta a un cliente que el Hub no conoce no puede ser la prueba de un
   * permiso.
   */
  private async consentimiento(s: SolicitudDeCorreo): Promise<boolean> {
    if (!s.cliente_id) return s.acepta_marketing === true;

    const eventos = await this.deps.leerStream(streamClientes(s.sucursal_id));
    // Solo los de ESTE cliente: la proyección los ordena por nombre, y una ficha
    // ajena mal formada no puede tumbar el permiso de otra.
    const suyos = eventos.filter(
      (ev) => (ev as { cliente_id?: unknown }).cliente_id === s.cliente_id,
    ) as unknown as EventoCliente[];
    const ficha = proyectarClientes(suyos)[0];

    return ficha !== undefined && ficha.activo && ficha.acepta_promociones === true;
  }

  private destinoDe(s: SolicitudDeCorreo): DestinoDeCorreo {
    return {
      sucursal_id: s.sucursal_id,
      correo: typeof s.correo === "string" ? s.correo : "",
      clase_correo: s.clase_correo,
      solicitud_id: s.solicitud_id,
    };
  }
}

/** Los datos del correo, o ninguno si la terminal mandó algo que no es un objeto. */
function datosDe(s: SolicitudDeCorreo): DatosCorreo {
  return typeof s.datos === "object" && s.datos !== null ? s.datos : {};
}
