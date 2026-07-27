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
