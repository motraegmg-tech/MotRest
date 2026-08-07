/**
 * Certificado TLS del Hub.
 *
 * POR QUÉ HACE FALTA, si el canal ya va cifrado con la clave del local
 *
 * No es por el cifrado —ese ya está—, es porque el navegador lo exige para
 * habilitar su motor criptográfico. Sin HTTPS, `crypto.subtle` no existe, y sin
 * él una terminal no puede verificar contraseñas, ni cifrar el canal, ni sellar
 * el corte. Una tablet abierta como `http://192.168.1.50` se quedaba sin las
 * tres cosas, con el único síntoma de "no me deja entrar".
 *
 * El certificado es AUTOFIRMADO porque un equipo de la red del local no tiene
 * nombre de dominio y no hay autoridad que pueda emitirle uno. Cada terminal
 * acepta el aviso UNA vez, al emparejarse. Como el Hub sirve también el POS
 * desde el mismo puerto, esa aceptación cubre a la vez la aplicación y el canal
 * de sincronización: un solo aviso por terminal, no dos.
 *
 * El certificado se guarda y se reutiliza. Regenerarlo en cada arranque
 * obligaría a aceptarlo de nuevo cada mañana, y acostumbrar al personal a
 * aceptar avisos de seguridad es exactamente lo que no queremos.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import selfsigned from "selfsigned";
import { soloElDueno } from "./permisos.js";

export interface CertificadoTls {
  cert: string;
  key: string;
  /** Huella SHA-256, para poder cotejar que es el mismo Hub de siempre. */
  huella: string;
  /** true = se acaba de crear. */
  nuevo: boolean;
}

/**
 * Trece meses, que es el tope que aceptan hoy los navegadores.
 *
 * Antes eran diez años, con el argumento de que un restaurante no debería
 * renovar certificados a mano — y el argumento es bueno, pero la conclusión era
 * la contraria. Un certificado de diez años es una llave de diez años: si la
 * copian de la tablet de un mesero, sirve hasta 2036 y no hay forma de retirarla
 * (un autofirmado no tiene lista de revocación). Lo que hace que el restaurante
 * no renueve a mano no es que dure una década: es que se renueve solo.
 *
 * 397 días es el máximo que Chrome y Safari admiten desde 2020. Pasarse de ahí
 * hace que el navegador lo rechace incluso tras aceptar el aviso.
 */
const DIAS_VIGENCIA = 397;

/**
 * Con cuánta antelación se renueva.
 *
 * Treinta días es margen de sobra para que el Hub arranque al menos una vez —un
 * restaurante enciende su caja todos los días— y para que las terminales acepten
 * el nuevo sin prisa. Renovar el mismo día del vencimiento sería descubrirlo un
 * viernes por la noche con el salón lleno.
 */
const DIAS_ANTES_DE_RENOVAR = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Carga el certificado del Hub, o lo crea la primera vez.
 *
 * `direcciones` son las IP del equipo en la red: van dentro del certificado
 * como nombres alternativos para que el navegador no se queje además por no
 * coincidir el nombre.
 */
export async function certificadoTls(
  carpeta: string,
  direcciones: readonly string[],
  nombreRed?: string,
  /** Inyectable para poder probar la renovación sin esperar trece meses. */
  ahora: Date = new Date(),
): Promise<CertificadoTls> {
  mkdirSync(carpeta, { recursive: true });
  // La llave privada del certificado vive aquí. En Windows el `mode: 0o600` con
  // que se escribe no restringe a nadie: las ACL son lo que de verdad cierra.
  soloElDueno(carpeta);
  const rutaCert = join(carpeta, "hub.crt");
  const rutaKey = join(carpeta, "hub.key");
  const rutaCubre = join(carpeta, "hub.cubre.json");

  /*
   * Qué nombres y direcciones tiene que cubrir el certificado hoy.
   *
   * Se guarda junto a él y se compara al arrancar, porque las dos cosas
   * cambian: el router puede reasignar la IP del equipo, y el nombre de red se
   * puede configurar. Un certificado que no cubre la dirección por la que se
   * abre da un aviso ADICIONAL al de la autoridad, y entonces el personal se
   * acostumbra a saltarse dos.
   */
  const cubre = [...(nombreRed ? [nombreRed] : []), ...direcciones].sort();

  if (existsSync(rutaCert) && existsSync(rutaKey)) {
    const previo = leerGuardado(rutaCubre);
    const sigueSirviendo = cubre.every((d) => previo.cubre.includes(d));

    /*
     * LA RENOVACIÓN, que antes no existía.
     *
     * El certificado solo se regeneraba si cambiaban las direcciones. Con diez
     * años de vigencia eso no se notaba; con trece meses, un Hub se quedaría con
     * un certificado vencido y **ninguna terminal podría entrar** — ni aceptando
     * el aviso, porque un certificado caducado no se puede aceptar. Sin esto, el
     * arreglo de la vigencia sería peor que el problema.
     */
    const caduca = previo.hasta > 0 && previo.hasta - ahora.getTime() < DIAS_ANTES_DE_RENOVAR * DIA_MS;

    if (sigueSirviendo && !caduca) {
      const cert = readFileSync(rutaCert, "utf8");
      const key = readFileSync(rutaKey, "utf8");
      return { cert, key, huella: huellaDe(cert), nuevo: false };
    }
    // Si no cubre lo de hoy, o está por vencer, se regenera. Cada terminal
    // tendrá que aceptar el nuevo una vez; es preferible a que vean un aviso
    // extra cada día, y mucho mejor que quedarse fuera sin poder aceptar nada.
  }

  // `type: 2` es un nombre DNS y `type: 7` una dirección IP, según el estándar
  // X.509. Se incluyen todas las IP del equipo para que el navegador no proteste
  // además por no coincidir el nombre.
  const alternativos: { type: 2 | 7; value?: string; ip?: string }[] = [
    { type: 2, value: "localhost" },
    // El nombre de red va dentro: si no, abrir por `motrest.local` daría un
    // aviso extra por no coincidir el nombre, además del de la autoridad.
    ...(nombreRed ? [{ type: 2 as const, value: nombreRed }] : []),
    { type: 7, ip: "127.0.0.1" },
    ...direcciones.map((ip) => ({ type: 7 as const, ip })),
  ];

  const desde = ahora;
  const hasta = new Date(desde.getTime() + DIAS_VIGENCIA * DIA_MS);

  const generado = await selfsigned.generate(
    [{ name: "commonName", value: "MotRest Hub" }],
    {
      notBeforeDate: desde,
      notAfterDate: hasta,
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        /*
         * `cA: false` y sin `keyCertSign`, que es el arreglo de fondo.
         *
         * Se generaba como AUTORIDAD CERTIFICADORA, con permiso para firmar
         * otros certificados. Eso importa por lo que pasa después: cada terminal
         * acepta este certificado una vez, y en algunos sistemas aceptarlo
         * significa **confiar en él como autoridad**. Quien copiara la llave
         * privada del Hub —que vive en el disco de una computadora de
         * restaurante— podría entonces emitir certificados válidos para
         * cualquier sitio, banco incluido, y esa tablet se los creería.
         *
         * Este certificado solo tiene que servir una cosa: identificar a ESTE
         * servidor. `serverAuth` lo dice, y sin `keyCertSign` no puede firmar
         * nada más aunque alguien se lo lleve.
         */
        { name: "basicConstraints", cA: false },
        {
          name: "keyUsage",
          digitalSignature: true,
          keyEncipherment: true,
        },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: alternativos },
      ],
    },
  );

  writeFileSync(rutaCert, generado.cert, { mode: 0o600 });
  // La llave privada solo la puede leer quien corre el servicio.
  writeFileSync(rutaKey, generado.private, { mode: 0o600 });
  writeFileSync(rutaCubre, JSON.stringify({ cubre, hasta: hasta.getTime() }), { mode: 0o600 });

  return {
    cert: generado.cert,
    key: generado.private,
    huella: huellaDe(generado.cert),
    nuevo: true,
  };
}

/**
 * Qué cubría el certificado guardado y hasta cuándo vale.
 *
 * Acepta el formato viejo —un array pelado de direcciones, sin fecha— porque hay
 * Hubs con ese archivo en disco. Se les asigna `hasta: 0`, que se lee como "no
 * se sabe cuándo vence": no fuerza la renovación por sí solo, pero en cuanto el
 * certificado se regenere por cualquier motivo queda ya con fecha. Reventar aquí
 * dejaría al local sin poder abrir el POS por un formato de archivo.
 */
function leerGuardado(ruta: string): { cubre: string[]; hasta: number } {
  if (!existsSync(ruta)) return { cubre: [], hasta: 0 };
  try {
    const dato: unknown = JSON.parse(readFileSync(ruta, "utf8"));
    if (Array.isArray(dato)) return { cubre: dato as string[], hasta: 0 };
    const objeto = dato as { cubre?: unknown; hasta?: unknown };
    return {
      cubre: Array.isArray(objeto.cubre) ? (objeto.cubre as string[]) : [],
      hasta: typeof objeto.hasta === "number" ? objeto.hasta : 0,
    };
  } catch {
    // Archivo corrupto: se trata como si no cubriera nada y se regenera.
    return { cubre: [], hasta: 0 };
  }
}

/** Huella legible del certificado, en grupos de cuatro para cotejarla a ojo. */
function huellaDe(cert: string): string {
  const cuerpo = cert
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(cuerpo, "base64");
  return createHash("sha256")
    .update(der)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1-");
}

/** Carpeta donde viven los certificados, junto a la base de datos del Hub. */
export function carpetaCertificados(rutaBaseDatos: string): string {
  return join(dirname(rutaBaseDatos), "tls");
}
