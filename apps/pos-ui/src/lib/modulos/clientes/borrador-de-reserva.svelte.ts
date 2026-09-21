/**
 * Lo que se está llenando en «Reservas y espera», mientras se llena.
 *
 * EL PROBLEMA QUE ESTO RESUELVE
 *
 * Desde la 1.5.6 «A nombre de» es un selector de fichas del comensal con una
 * opción más: «+ Nuevo cliente». Esa opción no abre un diálogo: lleva al alta de
 * comensal de verdad —la del módulo Clientes, con su domicilio, sus datos
 * fiscales y su permiso de publicidad—, porque tener dos altas distintas del
 * mismo cliente es como se acaba con dos fichas que no se parecen.
 *
 * Pero irse a otro módulo DESMONTA la pantalla de reservas. Si lo tecleado
 * viviera en las variables del componente, quien estaba apartando la mesa del
 * viernes a las 21:00 para ocho personas volvería del alta con el formulario en
 * blanco y tendría que teclearlo todo otra vez. Por eso el borrador vive aquí,
 * en el módulo: sobrevive al viaje de ida y vuelta porque nunca se desmonta.
 *
 * Y es solo un borrador: NO se guarda en disco ni viaja a ninguna terminal. Si
 * la caja se reinicia a media captura, se pierde — igual que la lista de espera,
 * y por la misma razón: lo que está a medio teclear no es historia del negocio.
 */
import type { ID } from "@motrest/dominio";

/** Cuál de los dos formularios de la pantalla. Los dos reconocen al comensal. */
export type Formulario = "reserva" | "espera";

/** Lo que se está llenando en «+ Apartar mesa». */
export interface BorradorReserva {
  /** Si la tarjeta del alta está abierta. Vuelve abierta del viaje al alta. */
  abierto: boolean;
  /** La ficha ligada. Sin ella la reserva es un nombre suelto, como antes. */
  cliente_id?: ID;
  nombre: string;
  telefono: string;
  correo: string;
  personas: string;
  fecha: string;
  hora: string;
  /** El acomodo elegido, serializado como el JSON de sus mesas: ["m3","m4"]. */
  acomodo: string;
}

/** Lo que se está llenando en «Anotar en la lista». */
export interface BorradorEspera {
  cliente_id?: ID;
  nombre: string;
  telefono: string;
  personas: string;
}

/** La ficha que acaba de nacer —o que se eligió— y vuelve al formulario. */
export interface FichaParaElBorrador {
  cliente_id: ID;
  nombre: string;
  telefono?: string;
  correo?: string;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function reservaVacia(): BorradorReserva {
  return {
    abierto: false,
    cliente_id: undefined,
    nombre: "",
    telefono: "",
    correo: "",
    personas: "2",
    fecha: hoy(),
    hora: "21:00",
    acomodo: "",
  };
}

function esperaVacia(): BorradorEspera {
  return { cliente_id: undefined, nombre: "", telefono: "", personas: "2" };
}

class BorradorDeReserva {
  reserva = $state<BorradorReserva>(reservaVacia());
  espera = $state<BorradorEspera>(esperaVacia());

  /**
   * Quién mandó a crear una ficha, para saber a dónde vuelve.
   *
   * `null` mientras nadie lo pidió. Sin esto, la ficha recién creada no sabría
   * si la esperaba la reserva del viernes o la señora que está formada en la
   * puerta, y el dato acabaría en el formulario equivocado.
   */
  esperandoFicha = $state<Formulario | null>(null);

  /** «+ Nuevo cliente»: se apunta quién lo pidió y se deja el alta abierta. */
  pedirFicha(cual: Formulario): void {
    this.esperandoFicha = cual;
    if (cual === "reserva") this.reserva.abierto = true;
  }

  /**
   * Lo tecleado que vale la pena llevarse al alta del comensal.
   *
   * Se prellena el alta con el nombre y el teléfono que ya se escribieron: en la
   * puerta, con el cliente al teléfono, volver a teclear lo mismo en la pantalla
   * siguiente es la clase de fricción por la que nadie usa la ficha.
   */
  loTecleado(): { nombre: string; telefono: string; correo: string } {
    /* La lista de espera no pide correo: quien espera de pie se llama a gritos. */
    if (this.esperandoFicha === "espera") {
      return { nombre: this.espera.nombre, telefono: this.espera.telefono, correo: "" };
    }
    return {
      nombre: this.reserva.nombre,
      telefono: this.reserva.telefono,
      correo: this.reserva.correo,
    };
  }

  /**
   * La ficha vuelve al formulario que la pidió, y se queda ligada.
   *
   * Devuelve a dónde hay que regresar —o `null` si nadie estaba esperando, que
   * es lo que pasa cuando alguien entró al alta de comensal por su cuenta.
   *
   * El teléfono y el correo de la ficha PISAN lo tecleado a propósito: la ficha
   * es la versión buena del dato, y es la que se acaba de revisar con el
   * comensal delante.
   */
  recibirFicha(ficha: FichaParaElBorrador): Formulario | null {
    const cual = this.esperandoFicha;
    if (cual === "espera") {
      this.espera.cliente_id = ficha.cliente_id;
      this.espera.nombre = ficha.nombre;
      if (ficha.telefono) this.espera.telefono = ficha.telefono;
    } else if (cual === "reserva") {
      this.reserva.abierto = true;
      this.reserva.cliente_id = ficha.cliente_id;
      this.reserva.nombre = ficha.nombre;
      if (ficha.telefono) this.reserva.telefono = ficha.telefono;
      if (ficha.correo) this.reserva.correo = ficha.correo;
    }
    this.esperandoFicha = null;
    return cual;
  }

  /**
   * Se volvió del alta sin crear nada: se cerró o se canceló.
   *
   * El borrador NO se toca —lo tecleado sigue ahí— y solo se olvida que alguien
   * estaba esperando una ficha. Cancelar el alta de un comensal no puede costar
   * la reserva que se estaba capturando.
   */
  cancelarViaje(): Formulario | null {
    const cual = this.esperandoFicha;
    this.esperandoFicha = null;
    return cual;
  }

  /** Desde la ficha del comensal: «Apartar mesa» llega con el cliente puesto. */
  apartarPara(ficha: FichaParaElBorrador): void {
    this.reserva = {
      ...reservaVacia(),
      abierto: true,
      cliente_id: ficha.cliente_id,
      nombre: ficha.nombre,
      telefono: ficha.telefono ?? "",
      correo: ficha.correo ?? "",
    };
    this.esperandoFicha = null;
  }

  /** La ficha ligada se suelta: se vuelve a buscar, o se anota un nombre suelto. */
  soltarFicha(cual: Formulario): void {
    if (cual === "espera") this.espera.cliente_id = undefined;
    else this.reserva.cliente_id = undefined;
  }

  /**
   * Ya se apartó: se limpia lo del comensal y se cierra la tarjeta.
   *
   * El día, la hora y el número de personas se quedan: en un viernes se anotan
   * cinco reservas seguidas para la misma noche. El ACOMODO no se queda, aunque
   * antes sí: esa mesa acaba de quedar apartada, y un desplegable que sigue
   * enseñándola es como se aparta dos veces la misma mesa.
   */
  limpiarReserva(): void {
    this.reserva.abierto = false;
    this.reserva.cliente_id = undefined;
    this.reserva.nombre = "";
    this.reserva.telefono = "";
    this.reserva.correo = "";
    this.reserva.acomodo = "";
  }

  /** Ya se anotó en la lista: el nombre y el teléfono se limpian, no las personas. */
  limpiarEspera(): void {
    this.espera.cliente_id = undefined;
    this.espera.nombre = "";
    this.espera.telefono = "";
  }
}

export const borrador = new BorradorDeReserva();
