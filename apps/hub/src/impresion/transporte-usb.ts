/**
 * Transporte ESC/POS por USB: entrega los bytes al spooler de Windows en modo
 * RAW, y el spooler los saca por el cable sin tocarlos.
 *
 * Por qué el spooler y no hablar USB directo: para abrir el dispositivo en
 * crudo habría que reemplazar su controlador por WinUSB, y entonces la
 * impresora deja de ser una impresora para Windows —se rompe cualquier otro
 * programa del local que imprima ahí—. El spooler ya tiene el canal abierto.
 *
 * Por qué RAW: es lo que hace que el controlador NO interprete los datos. Un
 * trabajo normal se renderiza como página gráfica; en RAW los bytes llegan al
 * puerto tal cual, que es la única forma de que `1B 40` sea un comando ESC/POS
 * y no dos letras impresas. Con RAW da igual qué controlador esté instalado.
 *
 * El puente hasta la API de Windows es un PowerShell de un solo uso. Se arranca
 * uno por trabajo (~440 ms medidos) en vez de mantener un proceso vivo: como
 * imprimir nunca bloquea la venta, esos milisegundos no los ve nadie, y un
 * proceso permanente sería una pieza más que se puede quedar colgada a media
 * noche de viernes.
 */
import { spawn } from "node:child_process";

export interface ResultadoImpresionUsb {
  ok: boolean;
  error?: string;
}

/**
 * El puente a `winspool.drv`, incrustado en el binario.
 *
 * Va aquí dentro y no en un `.ps1` junto al ejecutable a propósito: un archivo
 * suelto lo borra un antivirus, lo bloquea una directiva de ejecución o se
 * queda atrás en una actualización. Se le pasa a PowerShell ya codificado, así
 * que nunca toca el disco.
 *
 * NADA de lo que manda el POS se interpola en este texto. El nombre de la
 * impresora entra por variable de entorno y los bytes por la entrada estándar,
 * de modo que un nombre con comillas es un nombre con comillas y no un
 * comando.
 */
const PUENTE_WINSPOOL = String.raw`
$ErrorActionPreference = "Stop"
# Sin esto, la barra de progreso sale por la salida de error como CLIXML y
# convierte cualquier diagnóstico en un muro de XML.
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RawSpooler {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void Enviar(string impresora, byte[] datos, string titulo) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero))
      throw new Exception("No se pudo abrir la impresora (codigo " + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = titulo;
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di))
        throw new Exception("El spooler rechazo el trabajo (codigo " + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(h))
          throw new Exception("StartPagePrinter fallo (codigo " + Marshal.GetLastWin32Error() + ")");
        IntPtr buf = Marshal.AllocCoTaskMem(datos.Length);
        try {
          Marshal.Copy(datos, 0, buf, datos.Length);
          int escritos;
          if (!WritePrinter(h, buf, datos.Length, out escritos))
            throw new Exception("No se pudieron escribir los bytes (codigo " + Marshal.GetLastWin32Error() + ")");
          if (escritos != datos.Length)
            throw new Exception("Solo se escribieron " + escritos + " de " + datos.Length + " bytes");
        } finally { Marshal.FreeCoTaskMem(buf); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@

  $impresora = $env:MOTREST_IMPRESORA
  $titulo = $env:MOTREST_TITULO
  if ([string]::IsNullOrWhiteSpace($impresora)) { throw "Falta el nombre de la impresora" }

  # Se avisa de una impresora desconectada ANTES de entregar el trabajo. El
  # spooler acepta trabajos para una impresora apagada y los guarda en cola; sin
  # esta comprobacion el POS daria por impresa una comanda que nadie recogio.
  if (Get-Command Get-Printer -ErrorAction SilentlyContinue) {
    $info = $null
    try { $info = Get-Printer -Name $impresora -ErrorAction Stop } catch { $info = $null }
    if ($null -eq $info) { throw "No existe una impresora llamada '$impresora' en este equipo" }
    if ($info.PrinterStatus -eq "Offline") { throw "La impresora esta fuera de linea" }
  }

  $base64 = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($base64)) { throw "No llegaron datos que imprimir" }
  $bytes = [Convert]::FromBase64String($base64.Trim())

  [RawSpooler]::Enviar($impresora, $bytes, $titulo)
  [Console]::Out.Write('{"ok":true}')
} catch {
  $mensaje = $_.Exception.Message -replace '\\', '\\' -replace '"', '\"' -replace '[\r\n]+', ' '
  [Console]::Out.Write('{"ok":false,"error":"' + $mensaje + '"}')
  exit 1
}
`;

/** PowerShell espera el guion en UTF-16LE y base64 para `-EncodedCommand`. */
function comandoCodificado(): string {
  return Buffer.from(PUENTE_WINSPOOL, "utf16le").toString("base64");
}

/**
 * ¿Es un nombre de impresora aceptable?
 *
 * El nombre no se interpola en ningún comando —viaja por variable de entorno—,
 * así que esto no protege de una inyección: descarta basura evidente antes de
 * pagar el arranque de un proceso. Windows ya limita los nombres de impresora.
 */
export function esDispositivoValido(dispositivo: string): boolean {
  if (dispositivo.length === 0 || dispositivo.length > 220) return false;
  // Los caracteres que Windows nunca admite en el nombre de una cola.
  return !/[\\!,]|[\x00-\x1f]/.test(dispositivo);
}

/**
 * Manda los bytes a una impresora instalada en Windows.
 *
 * Qué significa `ok`: el spooler recibió el trabajo completo y la impresora no
 * estaba fuera de línea. No es un acuse de que el papel ya salió —eso el
 * spooler no lo dice— pero sí descarta lo que de verdad pasa en un local: la
 * impresora apagada, desconectada o con otro nombre.
 */
export function enviarAUsb(
  dispositivo: string,
  datos: Uint8Array,
  titulo = "MotRest",
  timeoutMs = 10_000,
): Promise<ResultadoImpresionUsb> {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, error: "La impresión USB solo está disponible en Windows" });
  }
  if (!esDispositivoValido(dispositivo)) {
    return Promise.resolve({ ok: false, error: `Nombre de impresora no válido: ${dispositivo}` });
  }

  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (resultado: ResultadoImpresionUsb): void => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(alarma);
      resolver(resultado);
    };

    const hijo = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", comandoCodificado()],
      {
        windowsHide: true,
        env: { ...process.env, MOTREST_IMPRESORA: dispositivo, MOTREST_TITULO: titulo },
      },
    );

    const alarma = setTimeout(() => {
      hijo.kill();
      terminar({ ok: false, error: "El spooler de Windows no respondió a tiempo" });
    }, timeoutMs);

    let salida = "";
    let errores = "";
    hijo.stdout.on("data", (trozo: Buffer) => { salida += trozo.toString("utf8"); });
    hijo.stderr.on("data", (trozo: Buffer) => { errores += trozo.toString("utf8"); });
    hijo.on("error", (causa) => terminar({ ok: false, error: causa.message }));

    hijo.on("close", () => {
      terminar(interpretarSalida(salida, errores));
    });

    // Los bytes van por la entrada estándar: no se escribe ningún archivo
    // temporal, así que un ticket con los datos del comensal no queda en disco.
    hijo.stdin.on("error", () => { /* si el hijo murió antes, lo cuenta `close` */ });
    hijo.stdin.end(Buffer.from(datos).toString("base64"));
  });
}

export interface ImpresoraDelSistema {
  nombre: string;
  puerto: string;
  /** Tal cual lo reporta Windows: `Normal`, `Offline`, `Error`… */
  estado: string;
}

/**
 * Las impresoras dadas de alta en Windows.
 *
 * Sirve para que la pantalla de configuración las OFREZCA en una lista en vez
 * de pedir que alguien teclee el nombre. El nombre tiene que coincidir letra
 * por letra con el del sistema, y «BIXOLON SRP-350plus» escrito a mano un
 * viernes por la noche es exactamente el tipo de error que deja sin comandas a
 * la cocina.
 */
export function impresorasDelSistema(timeoutMs = 10_000): Promise<ImpresoraDelSistema[]> {
  if (process.platform !== "win32") return Promise.resolve([]);

  // El estado se convierte a texto A PROPÓSITO: `PrinterStatus` es un enum y
  // ConvertTo-Json lo serializa como número, así que el campo llegaba como "0"
  // —un dato que no significa nada para quien lo lea— en vez de «Normal».
  const guion =
    "$ProgressPreference = 'SilentlyContinue'; " +
    "try { $p = @(Get-Printer | Select-Object Name, PortName, " +
    "@{n='PrinterStatus';e={[string]$_.PrinterStatus}}) } " +
    "catch { $p = @(Get-WmiObject -Class Win32_Printer | Select-Object Name, PortName, " +
    "@{n='PrinterStatus';e={'Normal'}}) } " +
    "try { [Console]::Out.Write((ConvertTo-Json -InputObject $p -Compress)) } catch { [Console]::Out.Write('[]') }";

  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (lista: ImpresoraDelSistema[]): void => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(alarma);
      resolver(lista);
    };

    const hijo = spawn(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", Buffer.from(guion, "utf16le").toString("base64"),
      ],
      { windowsHide: true },
    );

    const alarma = setTimeout(() => {
      hijo.kill();
      terminar([]);
    }, timeoutMs);

    let salida = "";
    hijo.stdout.on("data", (trozo: Buffer) => { salida += trozo.toString("utf8"); });
    hijo.on("error", () => terminar([]));
    hijo.on("close", () => terminar(interpretarListado(salida)));
  });
}

/** Corre un guion de PowerShell y devuelve su salida, o "" si algo falla. */
function correrPowerShell(guion: string, timeoutMs: number): Promise<string> {
  if (process.platform !== "win32") return Promise.resolve("");
  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (texto: string): void => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(alarma);
      resolver(texto);
    };
    const hijo = spawn(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", Buffer.from(guion, "utf16le").toString("base64"),
      ],
      { windowsHide: true },
    );
    const alarma = setTimeout(() => { hijo.kill(); terminar(""); }, timeoutMs);
    let salida = "";
    hijo.stdout.on("data", (t: Buffer) => { salida += t.toString("utf8"); });
    hijo.on("error", () => terminar(""));
    hijo.on("close", () => terminar(salida));
  });
}

export interface PuertoSinCola {
  /** `USB001`, `USB002`… */
  puerto: string;
  /** Lo que Windows leyó del propio aparato: «BIXOLONSRP-350plus». */
  descripcion: string;
}

/**
 * Impresoras enchufadas que Windows NO terminó de dar de alta.
 *
 * ESTE CASO NO ERA RARO: es lo que pasó en Rodizio. Windows reconoció la
 * BIXOLON por USB y hasta le creó el puerto `USB001` con su nombre, pero nunca
 * instaló la cola de impresión. MotRest entrega los bytes al spooler, y sin cola
 * no hay a dónde entregarlos: la impresora estaba conectada, encendida y era
 * invisible para el asistente, que solo listaba colas.
 *
 * Desde fuera se ve como un fallo del software. Se detecta aquí para poder
 * ofrecer el arreglo en vez de que alguien tenga que saber de spoolers.
 */
export function puertosSinCola(timeoutMs = 10_000): Promise<PuertoSinCola[]> {
  const guion =
    "$ProgressPreference = 'SilentlyContinue'; " +
    // Los puertos que YA usa alguna cola quedan fuera: esos no son el problema.
    "try { $usados = @(Get-Printer | Select-Object -ExpandProperty PortName) } catch { $usados = @() } " +
    "try { $libres = @(Get-PrinterPort | Where-Object { $_.Name -like 'USB*' -and " +
    "$usados -notcontains $_.Name -and $_.Description } | " +
    "Select-Object @{n='puerto';e={$_.Name}}, @{n='descripcion';e={[string]$_.Description}}) } " +
    "catch { $libres = @() } " +
    "try { [Console]::Out.Write((ConvertTo-Json -InputObject $libres -Compress)) } catch { [Console]::Out.Write('[]') }";

  return correrPowerShell(guion, timeoutMs).then((salida) => {
    try {
      const dato: unknown = JSON.parse(salida.trim() || "[]");
      const lista = Array.isArray(dato) ? dato : [dato];
      return lista
        .filter((p): p is PuertoSinCola =>
          !!p && typeof (p as PuertoSinCola).puerto === "string")
        .map((p) => ({ puerto: p.puerto, descripcion: p.descripcion ?? "" }));
    } catch {
      return [];
    }
  });
}

/**
 * Da de alta la cola que le faltaba a una impresora ya enchufada.
 *
 * Usa el controlador **genérico de texto** que Windows ya trae, y no el del
 * fabricante, porque MotRest imprime en RAW: el controlador no interpreta nada,
 * solo pone los bytes en el cable. Es lo que permite resolverlo sin descargar
 * nada ni pedirle al restaurante el CD de la impresora.
 *
 * Requiere permisos de administrador. Si no los hay, se devuelve el motivo tal
 * como lo dio Windows en vez de un «no se pudo» que no ayuda a nadie.
 */
export async function instalarImpresoraEnPuerto(
  nombre: string,
  puerto: string,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; error?: string }> {
  // Ni el nombre ni el puerto se interpolan crudos: van por variable de entorno
  // del propio PowerShell, así que un nombre con comillas es un nombre y no un
  // comando. Es la misma regla que sigue el envío de bytes a la impresora.
  const guion =
    "$ErrorActionPreference = 'Stop'; " +
    "$n = $env:MOTREST_IMP_NOMBRE; $p = $env:MOTREST_IMP_PUERTO; " +
    "try { " +
    "  foreach ($d in @('Generic / Text Only','Genérico / Sólo texto')) { " +
    "    try { Add-PrinterDriver -Name $d; $drv = $d; break } catch {} } " +
    "  if (-not $drv) { throw 'No se pudo instalar el controlador genérico de texto' } " +
    "  Add-Printer -Name $n -DriverName $drv -PortName $p; " +
    "  [Console]::Out.Write('OK') " +
    "} catch { [Console]::Out.Write('ERROR:' + $_.Exception.Message) }";

  const salida = await new Promise<string>((resolver) => {
    if (process.platform !== "win32") return resolver("ERROR:solo en Windows");
    let resuelto = false;
    const terminar = (t: string): void => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(alarma);
      resolver(t);
    };
    const hijo = spawn(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", Buffer.from(guion, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        env: { ...process.env, MOTREST_IMP_NOMBRE: nombre, MOTREST_IMP_PUERTO: puerto },
      },
    );
    const alarma = setTimeout(() => { hijo.kill(); terminar("ERROR:tardó demasiado"); }, timeoutMs);
    let salida = "";
    hijo.stdout.on("data", (t: Buffer) => { salida += t.toString("utf8"); });
    hijo.on("error", (e) => terminar("ERROR:" + e.message));
    hijo.on("close", () => terminar(salida));
  });

  const texto = salida.trim();
  if (texto.startsWith("OK")) return { ok: true };
  return { ok: false, error: texto.replace(/^ERROR:/, "") || "Windows no explicó el fallo" };
}

/** Windows devuelve un objeto suelto cuando solo hay una impresora, no un arreglo. */
function interpretarListado(salida: string): ImpresoraDelSistema[] {
  const limpia = salida.trim();
  if (limpia.length === 0) return [];
  try {
    const leido = JSON.parse(limpia) as unknown;
    const filas = Array.isArray(leido) ? leido : [leido];
    return filas
      .map((f) => f as { Name?: unknown; PortName?: unknown; PrinterStatus?: unknown })
      .filter((f) => typeof f.Name === "string" && f.Name.length > 0)
      .map((f) => ({
        nombre: f.Name as string,
        puerto: typeof f.PortName === "string" ? f.PortName : "",
        estado: typeof f.PrinterStatus === "string" ? f.PrinterStatus : String(f.PrinterStatus ?? ""),
      }));
  } catch {
    return [];
  }
}

/** Traduce lo que dijo el puente. Sin JSON legible, se reporta lo que haya. */
function interpretarSalida(salida: string, errores: string): ResultadoImpresionUsb {
  const limpia = salida.trim();
  if (limpia.length > 0) {
    try {
      const leido = JSON.parse(limpia) as { ok?: unknown; error?: unknown };
      if (leido.ok === true) return { ok: true };
      if (typeof leido.error === "string") return { ok: false, error: leido.error };
    } catch {
      // Cae al informe de abajo: la salida no era el JSON que esperábamos.
    }
  }
  const detalle = errores.trim() || limpia || "sin detalle";
  return { ok: false, error: `No se pudo imprimir por USB: ${detalle}` };
}
