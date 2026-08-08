/**
 * Entrega bytes ESC/POS al spooler de Windows en modo RAW.
 *
 * Es el mismo mecanismo que `apps/hub/src/impresion/transporte-usb.ts`, pero
 * en JavaScript suelto para las herramientas que corren sin compilar. El Hub
 * lleva su propia copia porque la suya va incrustada en el ejecutable.
 *
 * RAW es lo que hace que el controlador no interprete los datos: los bytes
 * llegan al puerto tal cual, que es la única forma de que `1B 40` sea un
 * comando de impresora y no dos letras impresas.
 */
import { spawn } from "node:child_process";

const PUENTE = String.raw`
$ErrorActionPreference = "Stop"
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
        StartPagePrinter(h);
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
  if ([string]::IsNullOrWhiteSpace($impresora)) { throw "Falta el nombre de la impresora" }

  $base64 = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($base64)) { throw "No llegaron datos que imprimir" }

  [RawSpooler]::Enviar($impresora, [Convert]::FromBase64String($base64.Trim()), $env:MOTREST_TITULO)
  [Console]::Out.Write('{"ok":true}')
} catch {
  $m = $_.Exception.Message -replace '\\', '\\' -replace '"', '\"' -replace '[\r\n]+', ' '
  [Console]::Out.Write('{"ok":false,"error":"' + $m + '"}')
  exit 1
}
`;

/**
 * Manda los bytes a una impresora instalada en Windows.
 *
 * El nombre viaja por variable de entorno y los datos por la entrada estándar:
 * nada de lo que entra se interpola en el guion, así que un nombre con comillas
 * es un nombre y no un comando, y un ticket de 40 KB no choca contra el límite
 * de la línea de comandos.
 */
export function enviarRaw(impresora, datos, titulo = "MotRest", timeoutMs = 10_000) {
  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (r) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(alarma);
      resolver(r);
    };

    const hijo = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
       "-EncodedCommand", Buffer.from(PUENTE, "utf16le").toString("base64")],
      {
        windowsHide: true,
        env: { ...process.env, MOTREST_IMPRESORA: impresora, MOTREST_TITULO: titulo },
      },
    );

    const alarma = setTimeout(() => {
      hijo.kill();
      terminar({ ok: false, error: "el spooler no respondió a tiempo" });
    }, timeoutMs);

    let salida = "";
    let errores = "";
    hijo.stdout.on("data", (t) => { salida += t.toString("utf8"); });
    hijo.stderr.on("data", (t) => { errores += t.toString("utf8"); });
    hijo.on("error", (e) => terminar({ ok: false, error: e.message }));
    hijo.on("close", () => {
      const limpia = salida.trim();
      try {
        const leido = JSON.parse(limpia);
        if (leido.ok === true) return terminar({ ok: true });
        if (leido.error) {
          // 1801 es ERROR_INVALID_PRINTER_NAME: el nombre no coincide con
          // ninguna cola. Dicho en número no le sirve a nadie en una caja.
          const detalle = String(leido.error).includes("1801")
            ? `no hay ninguna impresora llamada «${impresora}» en este equipo`
            : String(leido.error);
          return terminar({ ok: false, error: detalle });
        }
      } catch {
        // Cae abajo: la salida no era el JSON esperado.
      }
      terminar({ ok: false, error: errores.trim() || limpia || "sin detalle" });
    });

    hijo.stdin.on("error", () => { /* si el hijo murió antes, lo cuenta `close` */ });
    hijo.stdin.end(Buffer.from(datos).toString("base64"));
  });
}

/** Las impresoras dadas de alta en Windows, con su puerto y su estado. */
export function listarImpresoras(timeoutMs = 10_000) {
  const guion =
    "$ProgressPreference = 'SilentlyContinue'; " +
    "try { $p = @(Get-Printer | Select-Object Name, PortName, " +
    "@{n='PrinterStatus';e={[string]$_.PrinterStatus}}); " +
    "[Console]::Out.Write((ConvertTo-Json -InputObject $p -Compress)) } catch { [Console]::Out.Write('[]') }";

  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (l) => { if (!resuelto) { resuelto = true; clearTimeout(alarma); resolver(l); } };

    const hijo = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
       "-EncodedCommand", Buffer.from(guion, "utf16le").toString("base64")],
      { windowsHide: true },
    );
    const alarma = setTimeout(() => { hijo.kill(); terminar([]); }, timeoutMs);

    let salida = "";
    hijo.stdout.on("data", (t) => { salida += t.toString("utf8"); });
    hijo.on("error", () => terminar([]));
    hijo.on("close", () => {
      try {
        const leido = JSON.parse(salida.trim());
        const filas = Array.isArray(leido) ? leido : [leido];
        terminar(
          filas
            .filter((f) => typeof f?.Name === "string" && f.Name.length > 0)
            .map((f) => ({
              nombre: f.Name,
              puerto: typeof f.PortName === "string" ? f.PortName : "",
              estado: typeof f.PrinterStatus === "string" ? f.PrinterStatus : "",
            })),
        );
      } catch {
        terminar([]);
      }
    });
  });
}
