/**
 * Transporte ESC/POS por Bluetooth: escribe los bytes directamente al puerto
 * serie virtual (COM) que Windows asigna al emparejar una impresora Bluetooth.
 *
 * ## Por qué NO se usa el spooler, si el transporte USB sí lo usa
 *
 * Se puede dar de alta una cola de Windows sobre el puerto COM y mandarle RAW,
 * y es lo que había en Rodizio con la impresora de cocina. No funciona:
 *
 * - El enlace Bluetooth es **intermitente por diseño**. Una térmica de batería
 *   se duerme. Cuando el monitor de puerto del spooler intenta abrir el COM y la
 *   impresora está dormida, el trabajo entra en error.
 * - **El spooler no se recupera solo de eso.** El trabajo se queda en
 *   «Imprimiendo» para siempre y tapa la cola entera. Medido en Rodizio el
 *   20-ago-2026: 20 comandas detenidas detrás de una del 16-ago, cuatro días sin
 *   que saliera un solo papel por esa impresora.
 * - Nadie se enteró, porque entregar el trabajo al spooler **sí** funcionaba.
 *
 * Abrir el COM directamente quita al spooler de en medio: si la impresora no
 * está, la apertura falla AHORA y el POS puede decirlo. No hay cola donde se
 * acumule lo que nunca va a salir.
 *
 * La otra mitad de esa lección vive en `transporte-usb.ts`, donde la
 * comprobación de estado previa al envío dejaba pasar justo el caso que dejó las
 * comandas dentro de la cola.
 */
import { spawn } from "node:child_process";

export interface ResultadoImpresionBluetooth {
  ok: boolean;
  error?: string;
}

const PUENTE_BLUETOOTH = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'
try {
  $puerto = $env:MOTREST_PUERTO_COM
  if ([string]::IsNullOrWhiteSpace($puerto)) { throw "Falta el nombre del puerto COM" }

  $base64 = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($base64)) { throw "No llegaron datos que imprimir" }
  $bytes = [Convert]::FromBase64String($base64.Trim())

  # El baudio es decorativo en un puerto Bluetooth: por debajo es RFCOMM, que va
  # por paquetes y no por bits en un cable. Se pone 9600 porque el constructor
  # exige un número, no porque la impresora escuche a esa velocidad.
  $serial = New-Object System.IO.Ports.SerialPort $puerto, 9600, None, 8, One
  # Explícito a propósito: un control de flujo heredado de otra aplicación deja
  # la escritura esperando un CTS que una impresora Bluetooth nunca levanta.
  $serial.Handshake = 'None'
  $serial.WriteTimeout = 5000

  # ABRIR ES LO QUE DESPIERTA EL ENLACE, y es donde falla si la impresora no esta.
  #
  # .NET miente aqui. Cuando no logra levantar el canal RFCOMM lanza el MISMO
  # ArgumentException que usaria para un nombre mal escrito: "el nombre de puerto
  # proporcionado no empieza por COM". Medido en la caja de Rodizio con la
  # impresora apagada: el puerto COM5 existe, esta mapeado al aparato correcto y
  # el constructor lo acepta —falla Open()—. Ese texto manda a revisar la
  # configuracion cuando lo unico que pasa es que nadie encendio la impresora.
  try {
    $serial.Open()
  } catch [System.ArgumentException] {
    throw "No se pudo abrir $puerto. La impresora Bluetooth esta apagada, dormida o fuera de alcance: enciendela y vuelve a intentar."
  } catch [System.UnauthorizedAccessException] {
    throw "$puerto esta ocupado por otro programa. Si la impresora tiene una cola en Windows sobre ese puerto, quitala: MotRest le habla al puerto directamente."
  }

  try {
    $serial.Write($bytes, 0, $bytes.Length)

    # NO SE PUEDE CERRAR TODAVÍA.
    #
    # Escribir solo deja los bytes en el búfer de salida; quien los saca por el
    # aire es el enlace RFCOMM, después. Cerrar el puerto en ese momento descarta
    # lo que aún no salió, y el síntoma es una comanda impresa a la mitad —con el
    # encabezado y sin los platillos—, que en la cocina parece un pedido completo.
    #
    # Se espera a que el búfer quede vacío, con un tope: si la impresora se apagó
    # a media comanda esto tiene que rendirse y decirlo, no colgar el Hub.
    $limite = [System.Diagnostics.Stopwatch]::StartNew()
    while ($serial.BytesToWrite -gt 0 -and $limite.ElapsedMilliseconds -lt 8000) {
      Start-Sleep -Milliseconds 25
    }
    if ($serial.BytesToWrite -gt 0) {
      throw "La impresora dejo de recibir a media comanda: quedaron $($serial.BytesToWrite) bytes sin salir"
    }
    # El búfer vacío dice que el driver ya los entregó, no que la impresora los
    # imprimió. Esta pausa le da al enlace tiempo de sacar el último paquete
    # antes de que el cierre lo tumbe.
    Start-Sleep -Milliseconds 300
  } finally {
    $serial.Close()
  }

  [Console]::Out.Write('{"ok":true}')
} catch {
  $mensaje = $_.Exception.Message -replace '\\', '\\' -replace '"', '\"' -replace '[\r\n]+', ' '
  [Console]::Out.Write('{"ok":false,"error":"' + $mensaje + '"}')
  exit 1
}
`;

function comandoCodificado(): string {
  return Buffer.from(PUENTE_BLUETOOTH, "utf16le").toString("base64");
}

/**
 * ¿Es un puerto COM de verdad?
 *
 * El puerto no se interpola en ningún comando —viaja por variable de entorno—,
 * así que esto no protege de una inyección: atrapa lo que alguien puede teclear
 * de más en la pantalla de configuración. `COM4 ` con un espacio de sobra, o el
 * nombre completo que Windows enseña en el administrador de dispositivos
 * («Serie estándar sobre el vínculo Bluetooth (COM4)»), fallarían al abrir con
 * un error del sistema que no dice qué corregir.
 *
 * Windows numera del 1 al 256, y `startsWith("COM")` dejaba pasar «COMANDA».
 */
export function esPuertoValido(puerto: string): boolean {
  return /^COM([1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-6])$/i.test(puerto.trim());
}

export function enviarABluetooth(
  puerto: string,
  datos: Uint8Array,
  timeoutMs = 15_000,
): Promise<ResultadoImpresionBluetooth> {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, error: "La impresión por COM solo está disponible en Windows" });
  }
  if (!esPuertoValido(puerto)) {
    return Promise.resolve({
      ok: false,
      error: `«${puerto}» no es un puerto COM. Se espera algo como COM4, tal como aparece entre paréntesis en el administrador de dispositivos de Windows.`,
    });
  }
  const limpio = puerto.trim().toUpperCase();

  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (resultado: ResultadoImpresionBluetooth): void => {
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
        env: { ...process.env, MOTREST_PUERTO_COM: limpio },
      },
    );

    const alarma = setTimeout(() => {
      hijo.kill();
      terminar({
        ok: false,
        error: `${limpio} no respondió a tiempo. Lo normal es que la impresora esté apagada, dormida o fuera de alcance.`,
      });
    }, timeoutMs);

    let salida = "";
    let errores = "";
    hijo.stdout.on("data", (trozo: Buffer) => { salida += trozo.toString("utf8"); });
    hijo.stderr.on("data", (trozo: Buffer) => { errores += trozo.toString("utf8"); });
    hijo.on("error", (causa) => terminar({ ok: false, error: causa.message }));

    hijo.on("close", () => {
      const limpia = salida.trim();
      if (limpia.length > 0) {
        try {
          const leido = JSON.parse(limpia) as { ok?: unknown; error?: unknown };
          if (leido.ok === true) return terminar({ ok: true });
          if (typeof leido.error === "string") return terminar({ ok: false, error: leido.error });
        } catch {
          // Si no es JSON, caemos al error genérico
        }
      }
      const detalle = errores.trim() || limpia || "sin detalle";
      terminar({ ok: false, error: `Fallo al imprimir en ${limpio}: ${detalle}` });
    });

    hijo.stdin.on("error", () => {});
    hijo.stdin.end(Buffer.from(datos).toString("base64"));
  });
}

export interface PuertoBluetooth {
  /** `COM5`. */
  puerto: string;
  /** El nombre con el que se emparejó el aparato: «MP210». */
  nombre: string;
  /** La dirección del aparato, para distinguir dos con el mismo nombre. */
  direccion: string;
  /**
   * El aparato se anuncia como impresora en su clase Bluetooth.
   *
   * `false` no lo descarta —hay térmicas baratas que se declaran mal— pero sí
   * lo manda al final de la lista: unos audífonos emparejados también ofrecen
   * puerto serie, y no deberían competir por ser la impresora de la cocina.
   */
  es_impresora: boolean;
}

/**
 * Las impresoras Bluetooth emparejadas, con el puerto COM que Windows les dio.
 *
 * ## Por qué hace falta
 *
 * Sin esto, dar de alta la impresora de cocina exige teclear «COM5» a ciegas. En
 * la caja de Rodizio hay CUATRO puertos Bluetooth —COM3 a COM6— y solo uno es la
 * impresora: dos son puertos de entrada que Windows crea solos y otro es de un
 * aparato distinto. Elegir mal no da error, deja a la cocina sin comandas.
 *
 * Windows tampoco lo pone fácil: en el administrador de dispositivos los cuatro
 * se llaman igual, «Serie estándar sobre el vínculo Bluetooth (COMn)», sin decir
 * a qué aparato va cada uno. Ese emparejamiento solo está en el registro.
 *
 * ## Cómo se averigua
 *
 * La rama `BTHENUM` del registro guarda un `PortName` por cada puerto serie
 * Bluetooth, y la ruta de esa clave lleva dentro la dirección del aparato. Con
 * esa dirección se busca el nombre amable entre los dispositivos emparejados.
 * Los puertos de entrada tienen dirección `000000000000` y se descartan: no
 * llevan a ninguna impresora.
 */
export function puertosBluetooth(timeoutMs = 10_000): Promise<PuertoBluetooth[]> {
  if (process.platform !== "win32") return Promise.resolve([]);

  const guion = String.raw`
$ProgressPreference = 'SilentlyContinue'
$salida = @()
try {
  # Nombre amable y tipo de cada aparato emparejado, indexado por su direccion.
  $nombres = @{}
  $impresoras = @{}
  try {
    Get-PnpDevice -Class Bluetooth -ErrorAction Stop |
      Where-Object { $_.InstanceId -like 'BTHENUM\DEV_*' } |
      ForEach-Object {
        $trozos = $_.InstanceId -split '_'
        $dir = $trozos[$trozos.Length - 1]
        if ($dir -and -not $nombres.ContainsKey($dir.ToUpper())) {
          $clave = $dir.ToUpper()
          $nombres[$clave] = $_.FriendlyName
          # LA CLASE DE DISPOSITIVO SEPARA UNA IMPRESORA DE UNAS BOCINAS.
          #
          # Unos audifonos Bluetooth tambien exponen puerto serie, asi que sin
          # esto la lista de impresoras de cocina ofrecia «JBL Flip 5». Elegir
          # mal no da error: manda las comandas a un aparato que las tira.
          #
          # De los 32 bits, la clase mayor son los bits 8-12: 6 = Imagen. El bit
          # 0x20 de la clase menor es el que dice «impresora» —el resto de la
          # familia son camaras y escaneres—.
          try {
            $cod = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Bluetooth_ClassOfDevice' -ErrorAction Stop).Data
            if ($null -ne $cod) {
              $cod = [int]$cod
              $impresoras[$clave] = ((($cod -shr 8) -band 0x1F) -eq 6) -and ((($cod -shr 2) -band 0x20) -ne 0)
            }
          } catch {}
        }
      }
  } catch {}

  Get-ChildItem -Path 'HKLM:\SYSTEM\CurrentControlSet\Enum\BTHENUM' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -eq 'Device Parameters' } |
    ForEach-Object {
      $prop = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
      if ($prop -and $prop.PortName) {
        # La direccion sale del identificador de instancia, que es el segmento
        # ANTERIOR a 'Device Parameters':
        #   ...\{00001101-...-00805f9b34fb}_LOCALMFG&0046\9&9e7436e&0&DC0D5112F2DC_C00000000\Device Parameters
        #
        # Buscar 12 digitos hexadecimales en la ruta entera NO sirve: el GUID del
        # servicio SPP termina en 00805F9B34FB y gana siempre, con lo que todos
        # los puertos salian con la misma direccion inventada y sin nombre.
        $partes = $_.PSPath -split '\\'
        $instancia = $partes[$partes.Length - 2]
        $cola = ($instancia -split '&')[-1]
        $dir = (($cola -split '_')[0]).ToUpper()
        if ($dir -match '^[0-9A-F]{12}$') {
          # Los puertos de entrada que Windows crea solos: no son un aparato.
          if ($dir -ne '000000000000') {
            $nombre = $nombres[$dir]
            if (-not $nombre) { $nombre = 'Aparato Bluetooth' }
            $salida += [pscustomobject]@{
              puerto      = [string]$prop.PortName
              nombre      = [string]$nombre
              direccion   = $dir
              es_impresora = [bool]$impresoras[$dir]
            }
          }
        }
      }
    }
} catch {}
try { [Console]::Out.Write((ConvertTo-Json -InputObject @($salida) -Compress)) } catch { [Console]::Out.Write('[]') }
`;

  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (lista: PuertoBluetooth[]): void => {
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

    const alarma = setTimeout(() => { hijo.kill(); terminar([]); }, timeoutMs);

    let salida = "";
    hijo.stdout.on("data", (t: Buffer) => { salida += t.toString("utf8"); });
    hijo.on("error", () => terminar([]));
    hijo.on("close", () => {
      try {
        const leido: unknown = JSON.parse(salida.trim() || "[]");
        // Con un solo puerto, ConvertTo-Json devuelve el objeto suelto.
        const filas = Array.isArray(leido) ? leido : [leido];
        terminar(
          filas
            .map((f) => f as Partial<PuertoBluetooth>)
            .filter((f): f is PuertoBluetooth => typeof f?.puerto === "string" && esPuertoValido(f.puerto))
            .map((f) => ({
              puerto: f.puerto.trim().toUpperCase(),
              nombre: f.nombre?.trim() || "Aparato Bluetooth",
              direccion: f.direccion ?? "",
              es_impresora: f.es_impresora === true,
            }))
            // Las que se anuncian como impresora, primero.
            .sort((a, b) =>
              a.es_impresora === b.es_impresora
                ? a.puerto.localeCompare(b.puerto, "es")
                : a.es_impresora ? -1 : 1,
            ),
        );
      } catch {
        terminar([]);
      }
    });
  });
}
