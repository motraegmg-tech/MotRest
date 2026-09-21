/**
 * Store de clientes (M7).
 *
 * La ficha del comensal: contacto, domicilio para entregas y datos fiscales
 * para no volver a dictar el RFC en cada factura. Se da de baja, no se borra:
 * sus facturas pasadas apuntan a él.
 */
import {
  FabricaEventos,
  buscarClientes,
  clientesActivos,
  clientesConFiscal,
  compararEventos,
  proyectarClientes,
  receptorDe,
  streamClientes,
  uuidv7,
  type Cliente,
  type DatosCliente,
  type DatosReceptor,
  type EventoCliente,
  type ID,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export interface ResultadoCliente {
  ok: boolean;
  id?: ID;
  error?: string;
}

/** Lo que se hizo para llegar a la ficha: se dice en pantalla, no se adivina. */
export type ComoSeLigo =
  /** La eligió una persona en el selector: su decisión manda sobre todo. */
  | "elegida"
  /** El teléfono ya era de una ficha. Decisión de Gonzalo: se liga a ESA. */
  | "telefono"
  /** No había ninguna: se dio de alta con el nombre y el teléfono tecleados. */
  | "nueva"
  /** Sin teléfono no hay a quién reconocer ni a quién dar de alta. */
  | "sin_ficha";

export interface ResultadoLigar extends ResultadoCliente {
  como: ComoSeLigo;
}

/**
 * La forma en que se comparan dos teléfonos para saber si son la misma persona.
 *
 * El mismo comensal da su número de tres maneras a lo largo del año: en la mesa
 * lo dicta sin lada, el portal lo manda con `+52` y WhatsApp lo entrega como
 * `521…`. Comparando la cadena tal cual, esa persona acaba con tres fichas y
 * con tres historiales que no se suman — que es justo lo que la ficha del
 * comensal existe para evitar.
 *
 * Son los ÚLTIMOS DIEZ DÍGITOS, la misma regla que `identidadDe` usa en la
 * ficha 360° del dominio. Tiene que ser la misma a propósito: si aquí se
 * reconociera a alguien que allá se ve como dos personas distintas, las dos
 * pantallas dirían cosas diferentes del mismo cliente.
 *
 * Con menos de diez dígitos se compara lo que haya. Un número corto no es un
 * número nacional, pero si alguien anotó «5512» en dos reservas es el mismo
 * apunte, y partirlo en dos fichas no ayuda a nadie.
 */
export function telefonoClave(telefono: string | undefined): string | null {
  const digitos = telefono?.replace(/\D/g, "") ?? "";
  if (digitos.length === 0) return null;
  return digitos.length >= 10 ? digitos.slice(-10) : digitos;
}

/** ¿Estos dos teléfonos son de la misma persona? */
export function mismoTelefono(uno: string | undefined, otro: string | undefined): boolean {
  const a = telefonoClave(uno);
  const b = telefonoClave(otro);
  return a !== null && a === b;
}

class StoreClientes {
  private eventos = $state.raw<EventoCliente[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoCliente>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  clientes = $derived(proyectarClientes(this.eventos));
  activos = $derived(clientesActivos(this.clientes));
  conFiscal = $derived(clientesConFiscal(this.clientes));

  hidratar(eventos: readonly EventoCliente[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoCliente[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  private emitir(evento: EventoCliente): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento de clientes", causa);
    });
  }

  buscar(termino: string): Cliente[] {
    return buscarClientes(this.clientes, termino);
  }

  /**
   * La ficha de ese id, esté activa o de baja.
   *
   * Se busca entre TODAS y no solo entre las activas: una reserva de hace un mes
   * apunta a quien quizá ya se dio de baja, y enseñar su nombre en la puerta es
   * mejor que enseñar un hueco.
   */
  porId(clienteId: ID | undefined): Cliente | undefined {
    if (!clienteId) return undefined;
    return this.clientes.find((c) => c.cliente_id === clienteId);
  }

  /**
   * ¿Quién tiene ya ese teléfono?
   *
   * Solo entre las ACTIVAS: ligar una reserva nueva a una ficha dada de baja
   * sería revivirla por la puerta de atrás. Si el comensal volvió, se le vuelve
   * a dar de alta.
   */
  porTelefono(telefono: string | undefined): Cliente | undefined {
    if (telefonoClave(telefono) === null) return undefined;
    return this.activos.find((c) => mismoTelefono(c.telefono, telefono));
  }

  /**
   * LA FICHA A LA QUE SE LIGA LO QUE SE ACABA DE TECLEAR.
   *
   * Es el puente entre reservas y la ficha del comensal, y por eso vive aquí:
   * la pantalla de la puerta pide una ficha, no sabe —ni tiene que saber— si
   * había que buscarla o darla de alta.
   *
   * El orden no es casual:
   *
   *  1. Si una persona ELIGIÓ una ficha en el selector, gana. Aunque después
   *     tecleara otro teléfono: quien está atendiendo sabe más que la
   *     comparación de cadenas.
   *  2. Si ese teléfono ya es de alguien, se liga a ESA ficha y no se duplica
   *     —decisión de Gonzalo—. El nombre de la reserva puede quedar distinto
   *     («Familia Ramírez» para la ficha de José Pérez): la reserva guarda su
   *     propio nombre, y la pantalla lo avisa antes de guardar.
   *  3. Si no hay ninguna, se da de alta con el nombre y el teléfono. Esto es
   *     lo que antes no pasaba: una reserva por teléfono no dejaba ficha, así
   *     que el cliente que reservaba cada quince días seguía siendo un
   *     desconocido para el CRM.
   *  4. Sin teléfono no se inventa nada. Una ficha con solo un nombre no se
   *     puede reconocer la próxima vez —se duplicaría en cada reserva— y
   *     ensuciaría la lista de clientes con apuntes de una noche.
   */
  ligarFicha(datos: { cliente_id?: ID; nombre: string; telefono?: string; correo?: string }): ResultadoLigar {
    const elegida = this.porId(datos.cliente_id);
    if (elegida) return { ok: true, id: elegida.cliente_id, como: "elegida" };

    const porTelefono = this.porTelefono(datos.telefono);
    if (porTelefono) return { ok: true, id: porTelefono.cliente_id, como: "telefono" };

    if (telefonoClave(datos.telefono) === null) return { ok: true, como: "sin_ficha" };

    const alta = this.registrar({
      nombre: datos.nombre,
      telefono: datos.telefono,
      correo: datos.correo,
    });
    return alta.ok ? { ...alta, como: "nueva" } : { ...alta, como: "sin_ficha" };
  }

  /**
   * LA FICHA QUE DEJA UNA FACTURA (1.5.6, pedido de Gonzalo).
   *
   * Quien pide factura casi siempre vuelve. Al emitirla, su constancia y su
   * correo ya están tecleados: se guardan en su ficha para no volver a
   * dictarlos. Se llama DESPUÉS de emitir, nunca antes —una ficha hecha para una
   * factura que no salió quedaría con datos que nadie confirmó—.
   *
   *  1. Si se eligió una ficha en el buscador, se COMPLETA esa.
   *  2. Si no, solo se hace ficha cuando alguien pulsó «Hacer la Ficha de este
   *     Comensal» (`nueva`). Una factura suelta no llena la lista de clientes.
   *  3. Si ese teléfono ya es de otra ficha, se completa ESA y no se duplica: la
   *     misma regla que en Reservas.
   *
   * COMPLETAR NO ES PISAR: a una ficha que ya existía solo se le agrega lo que
   * no tenía. Si ya traía otro RFC, se queda el suyo; cambiarlo es una decisión
   * que se toma en la ficha, a la vista, no de rebote al facturar.
   */
  fichaDesdeFactura(datos: {
    cliente_id?: ID;
    receptor: DatosReceptor;
    correo: string;
    nueva?: Omit<DatosCliente, "fiscal" | "correo">;
  }): { como: "completada" | "telefono" | "nueva" | "sin_ficha"; id?: ID; nombre?: string } {
    const correo = datos.correo.trim();
    const nueva = datos.nueva;

    const completar = (c: Cliente): void => {
      const faltan: Partial<DatosCliente> = {};
      if (!c.fiscal) faltan.fiscal = datos.receptor;
      if (!c.correo && correo) faltan.correo = correo;
      if (nueva) {
        if (!c.notas && nueva.notas) faltan.notas = nueva.notas;
        if (!c.domicilio && nueva.domicilio) faltan.domicilio = nueva.domicilio;
        // Un «sí» nuevo a las promociones es un permiso nuevo, con su fecha.
        if (!c.acepta_promociones && nueva.acepta_promociones) {
          faltan.acepta_promociones = true;
          faltan.acepta_promociones_ts = nueva.acepta_promociones_ts ?? Date.now();
        }
      }
      if (Object.keys(faltan).length > 0) this.actualizar(c.cliente_id, faltan);
    };

    const elegida = this.porId(datos.cliente_id);
    if (elegida) {
      completar(elegida);
      return { como: "completada", id: elegida.cliente_id, nombre: elegida.nombre };
    }
    if (!nueva) return { como: "sin_ficha" };

    const existente = this.porTelefono(nueva.telefono);
    if (existente) {
      completar(existente);
      return { como: "telefono", id: existente.cliente_id, nombre: existente.nombre };
    }

    const nombre = nueva.nombre.trim() || datos.receptor.nombre;
    const alta = this.registrar({ ...nueva, nombre, correo, fiscal: datos.receptor });
    return alta.ok ? { como: "nueva", id: alta.id, nombre } : { como: "sin_ficha" };
  }

  receptorDe(cliente: Cliente): DatosReceptor | null {
    return receptorDe(cliente);
  }

  registrar(datos: DatosCliente): ResultadoCliente {
    const nombre = datos.nombre.trim();
    if (nombre.length < 2) return { ok: false, error: "Escribe el nombre del cliente" };

    const cliente_id = uuidv7();
    this.emitir(
      this.fabrica.crear("cliente_registrado", streamClientes(SUCURSAL_ID), {
        cliente_id,
        datos: this.limpiar({ ...datos, nombre }),
      }),
    );
    return { ok: true, id: cliente_id };
  }

  actualizar(clienteId: ID, cambios: Partial<DatosCliente>): ResultadoCliente {
    if (!this.clientes.some((c) => c.cliente_id === clienteId)) {
      return { ok: false, error: "No se encontró el cliente" };
    }
    this.emitir(
      this.fabrica.crear("cliente_actualizado", streamClientes(SUCURSAL_ID), {
        cliente_id: clienteId,
        cambios: this.limpiar(cambios),
      }),
    );
    return { ok: true, id: clienteId };
  }

  desactivar(clienteId: ID, motivo?: string): void {
    this.emitir(
      this.fabrica.crear("cliente_desactivado", streamClientes(SUCURSAL_ID), {
        cliente_id: clienteId,
        motivo,
      }),
    );
  }

  /**
   * Quita cadenas vacías para no guardar campos en blanco.
   *
   * Un `telefono: ""` en el log es ruido: si el campo no se llenó, mejor que no
   * exista a que exista vacío. Los objetos anidados (fiscal, domicilio) se dejan
   * tal cual: la pantalla ya decide si mandarlos o no.
   */
  private limpiar<T extends Partial<DatosCliente>>(datos: T): T {
    const salida: T = { ...datos };
    for (const clave of ["telefono", "correo", "notas"] as const) {
      const valor = salida[clave];
      if (typeof valor === "string" && valor.trim() === "") delete salida[clave];
      else if (typeof valor === "string") salida[clave] = valor.trim() as T[typeof clave];
    }
    return salida;
  }
}

export const clientes = new StoreClientes();
