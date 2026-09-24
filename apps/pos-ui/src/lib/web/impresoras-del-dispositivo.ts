/**
 * Impresoras y cajón conectados AL PROPIO DISPOSITIVO (MotRest en la web, 1.6.0).
 *
 * En la red del salón el papel sale por el Hub: él abre el socket al 9100 o
 * entrega el trabajo al spooler de Windows. En la modalidad nube no hay Hub, y
 * Gonzalo pidió que, si el equipo tiene una impresora o un cajón conectado por
 * USB o Bluetooth, se imprima y se cobre como siempre. El navegador puede
 * hacerlo, con cuatro vías y un límite que no es nuestro:
 *
 * | Vía        | Dónde funciona                    | Qué cubre                                  |
 * |------------|-----------------------------------|--------------------------------------------|
 * | Serial     | Chrome/Edge en computadora         | USB-serie y Bluetooth emparejado como COM  |
 * | USB        | Chrome en computadora y Android    | Impresoras USB sin un driver que las acapare |
 * | Bluetooth  | Chrome en Android y computadora    | Impresoras BLE                             |
 * | Sistema    | Cualquiera                         | El diálogo de imprimir: AirPrint en iPad   |
 *
 * EL LÍMITE: Safari en iPad y iPhone no tiene ni Serial, ni USB, ni Bluetooth.
 * Ahí solo queda el diálogo de imprimir del sistema, que manda TEXTO —no bytes
 * ESC/POS— y no abre cajones. Es una decisión de Apple, no de MotRest.
 *
 * El cajón cuelga de la impresora: se abre con el pulso `ESC p` que ya genera
 * `Ticket.abrirCajon()`. Por Serial, USB o Bluetooth sale igual que desde la
 * caja; por el diálogo del sistema no hay forma, y se dice.
 */
import type { Impresora, ResultadoEnvio, TrabajoImpresion, Transporte } from "@motrest/impresion";

/* Las APIs de hardware del navegador no vienen en los tipos de TypeScript. Se
   describe aquí solo lo que se usa. */
interface PuertoSerie {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface ApiSerie {
  requestPort(): Promise<PuertoSerie>;
  getPorts(): Promise<PuertoSerie[]>;
}
interface PuntoUsb {
  endpointNumber: number;
  direction: "in" | "out";
  type: string;
}
interface AparatoUsb {
  vendorId: number;
  productId: number;
  productName?: string;
  configuration: { interfaces: { interfaceNumber: number; alternate: { endpoints: PuntoUsb[] } }[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(punto: number, datos: BufferSource): Promise<unknown>;
}
interface ApiUsb {
  requestDevice(o: { filters: { classCode?: number }[] }): Promise<AparatoUsb>;
  getDevices(): Promise<AparatoUsb[]>;
}
interface CaracteristicaBle {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithoutResponse?(d: BufferSource): Promise<void>;
  writeValue(d: BufferSource): Promise<void>;
}
interface AparatoBle {
  id: string;
  name?: string;
  gatt?: {
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{ getCharacteristics(): Promise<CaracteristicaBle[]> }>;
      disconnect(): void;
    }>;
  };
}
interface ApiBluetooth {
  requestDevice(o: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<AparatoBle>;
  getDevices?(): Promise<AparatoBle[]>;
}

type NavegadorConHardware = Navigator & { serial?: ApiSerie; usb?: ApiUsb; bluetooth?: ApiBluetooth };

function nav(): NavegadorConHardware | null {
  return typeof navigator === "undefined" ? null : (navigator as NavegadorConHardware);
}

/**
 * Los servicios por los que suelen escuchar las térmicas BLE baratas. Web
 * Bluetooth exige nombrarlos de antemano; no hay forma de preguntar «cuáles
 * tienes» sin haberlos pedido.
 */
const SERVICIOS_BLE = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
];
const TROZO_BLE = 180;

/** Qué vías tiene ESTE navegador. La pantalla solo ofrece las que existen. */
export function viasDisponibles(): { serial: boolean; usb: boolean; bluetooth: boolean; sistema: boolean } {
  const n = nav();
  return {
    serial: !!n?.serial,
    usb: !!n?.usb,
    bluetooth: !!n?.bluetooth,
    sistema: typeof window !== "undefined" && typeof window.print === "function",
  };
}

export type ViaNavegador = "serial" | "usb" | "bluetooth" | "sistema";

/**
 * Pide al navegador que el usuario elija el aparato. TIENE que llamarse desde
 * un toque —el navegador lo exige— y el permiso queda recordado para la
 * próxima vez.
 */
export async function elegirAparato(
  via: ViaNavegador,
): Promise<{ ok: true; nombre: string; reconocer: NonNullable<Impresora["reconocer"]> } | { ok: false; error: string }> {
  const n = nav();
  try {
    switch (via) {
      case "serial": {
        if (!n?.serial) return { ok: false, error: "Este navegador no puede usar puertos serie. Usa Chrome o Edge en computadora." };
        const puerto = await n.serial.requestPort();
        const info = puerto.getInfo();
        return {
          ok: true,
          nombre: "Impresora por puerto serie",
          reconocer: { vendor: info.usbVendorId, producto: info.usbProductId, baudios: 9600 },
        };
      }
      case "usb": {
        if (!n?.usb) return { ok: false, error: "Este navegador no puede usar USB. Usa Chrome en computadora o Android." };
        const aparato = await n.usb.requestDevice({ filters: [{ classCode: 7 }, { classCode: 255 }] });
        return {
          ok: true,
          nombre: aparato.productName || "Impresora USB",
          reconocer: { vendor: aparato.vendorId, producto: aparato.productId },
        };
      }
      case "bluetooth": {
        if (!n?.bluetooth) return { ok: false, error: "Este navegador no puede usar Bluetooth. Usa Chrome en Android o computadora." };
        const aparato = await n.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS_BLE });
        return { ok: true, nombre: aparato.name || "Impresora Bluetooth", reconocer: { bluetooth: aparato.id } };
      }
      case "sistema":
        return { ok: true, nombre: "Impresora del sistema", reconocer: {} };
    }
  } catch (causa) {
    // Cerrar el cuadro de elegir sin escoger nada no es un error que haya que gritar.
    const texto = String(causa);
    if (/NotFoundError|No port selected|cancel/i.test(texto)) return { ok: false, error: "" };
    return { ok: false, error: `No se pudo usar ese aparato: ${texto}` };
  }
}

function coincide(r: Impresora["reconocer"], vendor?: number, producto?: number): boolean {
  if (!r) return false;
  if (r.vendor === undefined && r.producto === undefined) return true;
  return r.vendor === vendor && r.producto === producto;
}

/** El papel en el diálogo de imprimir del sistema (AirPrint en un iPad). */
function imprimirConElSistema(impresora: Impresora, texto: string): void {
  const marco = document.createElement("iframe");
  marco.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
  document.body.append(marco);
  const doc = marco.contentDocument;
  if (!doc) {
    marco.remove();
    throw new Error("El navegador no dejó preparar la impresión");
  }
  const ancho = impresora.ancho === 32 ? "58mm" : "80mm";
  const pre = doc.createElement("pre");
  pre.textContent = texto;
  const estilo = doc.createElement("style");
  estilo.textContent =
    `@page { size: ${ancho} auto; margin: 2mm; } ` +
    `body { margin: 0; } pre { font: 11px/1.25 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }`;
  doc.head.append(estilo);
  doc.body.append(pre);
  marco.contentWindow?.focus();
  marco.contentWindow?.print();
  setTimeout(() => marco.remove(), 60_000);
}

export class TransporteDispositivo implements Transporte {
  constructor(private equipo: () => string) {}

  puede(impresora: Impresora): boolean {
    if (impresora.conexion !== "dispositivo" || impresora.equipo !== this.equipo()) return false;
    const vias = viasDisponibles();
    return impresora.navegador ? vias[impresora.navegador] : false;
  }

  async enviar(impresora: Impresora, datos: Uint8Array, trabajo?: TrabajoImpresion): Promise<ResultadoEnvio> {
    try {
      switch (impresora.navegador) {
        case "serial":
          return await this.porSerie(impresora, datos);
        case "usb":
          return await this.porUsb(impresora, datos);
        case "bluetooth":
          return await this.porBluetooth(impresora, datos);
        case "sistema":
          // El diálogo del sistema no manda el pulso del cajón: se dice, no se finge.
          if (trabajo?.documento === "cajon") return { ok: true, simulado: true };
          imprimirConElSistema(impresora, trabajo?.vista ?? "");
          return { ok: true };
        default:
          return { ok: false, error: "La impresora no dice cómo conectarse" };
      }
    } catch (causa) {
      return { ok: false, error: String(causa) };
    }
  }

  private async porSerie(impresora: Impresora, datos: Uint8Array): Promise<ResultadoEnvio> {
    const puertos = (await nav()?.serial?.getPorts()) ?? [];
    const puerto = puertos.find((p) => {
      const i = p.getInfo();
      return coincide(impresora.reconocer, i.usbVendorId, i.usbProductId);
    });
    if (!puerto) return { ok: false, error: "La impresora no está conectada a este equipo (o hay que volver a elegirla)." };
    await puerto.open({ baudRate: impresora.reconocer?.baudios ?? 9600 });
    try {
      const escritor = puerto.writable?.getWriter();
      if (!escritor) return { ok: false, error: "El puerto no deja escribir" };
      await escritor.write(datos);
      escritor.releaseLock();
      return { ok: true };
    } finally {
      await puerto.close().catch(() => undefined);
    }
  }

  private async porUsb(impresora: Impresora, datos: Uint8Array): Promise<ResultadoEnvio> {
    const aparatos = (await nav()?.usb?.getDevices()) ?? [];
    const aparato = aparatos.find((a) => coincide(impresora.reconocer, a.vendorId, a.productId));
    if (!aparato) return { ok: false, error: "La impresora USB no está conectada a este equipo (o hay que volver a elegirla)." };
    await aparato.open();
    try {
      if (!aparato.configuration) await aparato.selectConfiguration(1);
      const interfaz = aparato.configuration?.interfaces.find((i) =>
        i.alternate.endpoints.some((e) => e.direction === "out" && e.type === "bulk"),
      );
      const salida = interfaz?.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (!interfaz || !salida) return { ok: false, error: "Esa impresora USB no tiene por dónde recibir datos" };
      /*
       * En Windows falla aquí si la impresora tiene su driver instalado: el
       * sistema ya la tiene tomada. Se dice cuál es la salida.
       */
      try {
        await aparato.claimInterface(interfaz.interfaceNumber);
      } catch {
        return {
          ok: false,
          error: "Windows tiene tomada la impresora con su driver. Úsala por «puerto serie» o quita el driver.",
        };
      }
      await aparato.transferOut(salida.endpointNumber, datos as BufferSource);
      await aparato.releaseInterface(interfaz.interfaceNumber).catch(() => undefined);
      return { ok: true };
    } finally {
      await aparato.close().catch(() => undefined);
    }
  }

  private async porBluetooth(impresora: Impresora, datos: Uint8Array): Promise<ResultadoEnvio> {
    const bt = nav()?.bluetooth;
    const aparatos = (await bt?.getDevices?.()) ?? [];
    const aparato = aparatos.find((a) => a.id === impresora.reconocer?.bluetooth);
    if (!aparato?.gatt) {
      return { ok: false, error: "La impresora Bluetooth no está a la vista. Enciéndela o vuelve a elegirla." };
    }
    const servidor = await aparato.gatt.connect();
    try {
      for (const uuid of SERVICIOS_BLE) {
        let servicio;
        try {
          servicio = await servidor.getPrimaryService(uuid);
        } catch {
          continue;
        }
        const escribible = (await servicio.getCharacteristics()).find(
          (c) => c.properties.writeWithoutResponse || c.properties.write,
        );
        if (!escribible) continue;
        for (let i = 0; i < datos.length; i += TROZO_BLE) {
          const trozo = datos.slice(i, i + TROZO_BLE);
          if (escribible.properties.writeWithoutResponse && escribible.writeValueWithoutResponse) {
            await escribible.writeValueWithoutResponse(trozo);
          } else {
            await escribible.writeValue(trozo);
          }
        }
        return { ok: true };
      }
      return { ok: false, error: "No se encontró por dónde mandarle datos a esa impresora Bluetooth" };
    } finally {
      servidor.disconnect();
    }
  }
}
