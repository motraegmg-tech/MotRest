/**
 * Store de socios e inversionistas (M9 · Administración).
 *
 * Quién puso dinero en el restaurante y qué tiene pactado a cambio. El consumo
 * que se le carga NO vive aquí: son los pagos con forma `socio` de las propias
 * cuentas (ver `organizacion/socios.ts` en el dominio). Guardar un saldo aparte
 * se desincronizaría en cuanto una terminal cobrara en isla.
 */
import {
  FabricaEventos,
  bolsaDelMes,
  compararEventos,
  proyectarSocios,
  sociosActivos,
  streamSocios,
  uuidv7,
  type BolsaSocio,
  type DatosSocio,
  type EventoSocio,
  type ID,
  type Socio,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { pos } from "./pos.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export interface ResultadoSocio {
  ok: boolean;
  id?: ID;
  error?: string;
}

class StoreSocios {
  private eventos = $state.raw<EventoSocio[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoSocio>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  socios = $derived(proyectarSocios(this.eventos));
  activos = $derived(sociosActivos(this.socios));

  hidratar(eventos: readonly EventoSocio[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoSocio[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  private emitir(evento: EventoSocio): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento de socios", causa);
    });
  }

  de(socioId: ID): Socio | undefined {
    return this.socios.find((s) => s.socio_id === socioId);
  }

  nombreDe(socioId: ID): string {
    return this.de(socioId)?.nombre ?? "Socio";
  }

  /** Lo pactado, lo consumido y lo que le queda este mes. */
  bolsa(socio: Socio, ahora = Date.now()): BolsaSocio {
    return bolsaDelMes(socio, pos.todasLasComandas, ahora);
  }

  registrar(datos: DatosSocio): ResultadoSocio {
    const nombre = datos.nombre.trim();
    if (nombre.length < 2) return { ok: false, error: "Escribe el nombre del socio" };

    const socio_id = uuidv7();
    this.emitir(
      this.fabrica.crear("socio_registrado", streamSocios(SUCURSAL_ID), {
        socio_id,
        datos: limpiar({ ...datos, nombre }),
      }),
    );
    return { ok: true, id: socio_id };
  }

  actualizar(socioId: ID, cambios: Partial<DatosSocio>): ResultadoSocio {
    if (!this.de(socioId)) return { ok: false, error: "No se encontró el socio" };
    if (cambios.nombre !== undefined && cambios.nombre.trim().length < 2) {
      return { ok: false, error: "Escribe el nombre del socio" };
    }
    this.emitir(
      this.fabrica.crear("socio_actualizado", streamSocios(SUCURSAL_ID), {
        socio_id: socioId,
        cambios: limpiar(cambios),
      }),
    );
    return { ok: true, id: socioId };
  }

  desactivar(socioId: ID, motivo?: string): void {
    this.emitir(
      this.fabrica.crear("socio_desactivado", streamSocios(SUCURSAL_ID), {
        socio_id: socioId,
        motivo: motivo?.trim() || undefined,
      }),
    );
  }

  reactivar(socioId: ID): void {
    this.emitir(
      this.fabrica.crear("socio_reactivado", streamSocios(SUCURSAL_ID), { socio_id: socioId }),
    );
  }
}

/** Quita cadenas vacías: un `telefono: ""` en el log es ruido, no un dato. */
function limpiar<T extends Partial<DatosSocio>>(datos: T): T {
  const salida: T = { ...datos };
  for (const clave of ["nombre", "telefono", "correo", "cumpleanos", "notas"] as const) {
    const valor = salida[clave];
    if (typeof valor !== "string") continue;
    if (valor.trim() === "") delete salida[clave];
    else salida[clave] = valor.trim() as T[typeof clave];
  }
  return salida;
}

export const socios = new StoreSocios();
