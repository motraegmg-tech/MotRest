/**
 * Emitir la licencia de un restaurante desde la terminal.
 *
 * Es la misma emisión que hace el botón de MotRest Central, en forma de comando.
 * Existe porque hay dos momentos en los que abrir el navegador estorba: cuando
 * se está instalando en el local con las manos ocupadas, y cuando se quiere
 * dejar el alta escrita en un guion.
 *
 * LA LLAVE PRIVADA NUNCA SE TECLEA EN EL COMANDO. Entra por variable de entorno, y no
 * como argumento, porque los argumentos quedan en el historial del shell y en la
 * lista de procesos de la máquina — cualquiera que corra `ps` mientras esto se
 * ejecuta se lleva la llave con la que se firman TODAS las licencias.
 *
 *   $env:MOTRAE_LLAVE_PRIVADA_LICENCIAS = "..."      # PowerShell
 *   corepack pnpm@9.15.0 --filter @motrest/central licencia -- \
 *     --sucursal suc-rodizio-centro --nombre "Rodizio" --responsable "Responsable" --meses 1
 */
import { writeFileSync } from "node:fs";
import {
  crearCredencial,
  emitirLicencia,
  generarPinSeguro,
  PUESTO_RESPONSABLE,
  publicaDe,
  siguienteVencimiento,
  situacionDe,
  USUARIO_RESPONSABLE_ID,
  uuidv7,
  verificarLicencia,
  type Licencia,
  type Plan,
} from "@motrest/dominio";

interface Opciones {
  sucursal: string;
  nombre: string;
  responsable: string;
  plan: Plan;
  meses: number;
  salida: string;
  desde?: number;
}

function leerArgumentos(argv: string[]): Opciones | string {
  const dado = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const clave = argv[i]?.replace(/^--/, "");
    if (!clave) continue;
    dado.set(clave, argv[i + 1] ?? "");
  }

  const sucursal = dado.get("sucursal")?.trim();
  if (!sucursal) return "Falta --sucursal (el identificador que muestra el Hub del local)";

  const responsable = dado.get("responsable")?.trim();
  if (!responsable || responsable.length < 2) {
    return "Falta --responsable (la persona que tendrá el control total del restaurante)";
  }

  const plan = (dado.get("plan") ?? "mensual") as Plan;
  if (!["prueba", "mensual", "anual"].includes(plan)) {
    return `Plan desconocido: ${plan}. Usa prueba, mensual o anual.`;
  }

  const meses = Number(dado.get("meses") ?? (plan === "anual" ? 12 : 1));
  if (!Number.isFinite(meses) || meses < 1) return "--meses tiene que ser un número mayor que cero";

  return {
    sucursal,
    nombre: dado.get("nombre")?.trim() || sucursal,
    responsable,
    plan,
    meses,
    salida: dado.get("salida")?.trim() || "licencia.json",
    /*
     * `--desde` permite renovar contando desde el vencimiento anterior. Sin él
     * se cuenta desde hoy, y renovar tres días antes regalaría esos tres días.
     */
    desde: dado.get("desde") ? Date.parse(dado.get("desde")!) : undefined,
  };
}

async function principal(): Promise<void> {
  const llavePrivada = process.env.MOTRAE_LLAVE_PRIVADA_LICENCIAS ?? "";
  if (!llavePrivada) {
    console.error(
      "Falta MOTRAE_LLAVE_PRIVADA_LICENCIAS.\n\n" +
        "Es la llave privada Ed25519 de MotRest Central → Llaves.\n" +
        "En PowerShell:\n" +
        '  $env:MOTRAE_LLAVE_PRIVADA_LICENCIAS = "la-llave-privada"\n',
    );
    process.exit(1);
  }

  const opciones = leerArgumentos(process.argv.slice(2));
  if (typeof opciones === "string") {
    console.error(`${opciones}\n\nEjemplo:\n  --sucursal suc-rodizio-centro --nombre "Rodizio" --responsable "Responsable" --meses 1\n`);
    process.exit(1);
  }

  /*
   * La contraseña de soporte es opcional aquí. Si no se pasa, la licencia sale
   * SIN acceso de MOTRAE — y se avisa, porque un local sin ese acceso es un
   * local al que no se le puede entrar a resolver nada, y eso se descubre el
   * peor día posible.
   */
  const contrasenaSoporte = process.env.MOTRAE_CONTRASENA_SOPORTE ?? "";
  const soporte = contrasenaSoporte
    ? await (async () => {
        const c = await crearCredencial("usr-motrae-soporte", contrasenaSoporte, "contrasena");
        return { sal: c.sal, hash: c.hash, iteraciones: c.iteraciones };
      })()
    : undefined;

  /*
   * Este comando es para la primera emisión desde la terminal. Central guarda
   * el hash protegido por DPAPI y conserva el PIN al renovar; aquí se genera
   * una sola vez y se muestra para entregarlo por un canal privado.
   */
  const pinResponsable = generarPinSeguro(8);
  const credencialResponsable = await crearCredencial(
    USUARIO_RESPONSABLE_ID,
    pinResponsable,
    "pin",
  );

  // Se calcula mes a mes con `siguienteVencimiento` para respetar los meses de
  // distinta duración: sumar 30 días desperdicia días en enero y regala en febrero.
  let vence = opciones.desde ?? null;
  for (let i = 0; i < opciones.meses; i++) {
    vence = siguienteVencimiento(vence, opciones.plan === "anual" ? "anual" : "mensual");
  }

  const licencia: Licencia = await emitirLicencia(
    {
      sucursal_id: opciones.sucursal,
      nombre: opciones.nombre,
      plan: opciones.plan,
      vence_ts: vence!,
      gracia_dias: 3,
      emitida_ts: Date.now(),
      ...(soporte ? { soporte } : {}),
      responsable: {
        id: USUARIO_RESPONSABLE_ID,
        nombre: opciones.responsable,
        puesto: PUESTO_RESPONSABLE,
        provision_id: uuidv7(),
        credencial: credencialResponsable,
      },
    },
    llavePrivada,
  );

  /*
   * Se verifica lo que se acaba de emitir ANTES de escribirlo. Parece
   * redundante y no lo es: atrapa una llave privada mal pegada —con un salto de línea
   * al final, que es lo que pasa al copiarlo del navegador— antes de que alguien
   * viaje al restaurante con un archivo que no sirve.
   */
  const llavePublica = await publicaDe(llavePrivada);
  if (!(await verificarLicencia(licencia, opciones.sucursal, llavePublica))) {
    console.error("La licencia emitida no se verifica. Revisa la llave privada.");
    process.exit(1);
  }

  writeFileSync(opciones.salida, JSON.stringify(licencia, null, 2), "utf8");

  const situacion = situacionDe(licencia, true);
  console.log(`\n  Licencia emitida para ${opciones.nombre}`);
  console.log(`  Local:    ${opciones.sucursal}`);
  console.log(`  Plan:     ${opciones.plan}`);
  console.log(`  Responsable: ${opciones.responsable} (Propietario)`);
  console.log(`  Vence:    ${new Date(licencia.vence_ts).toLocaleDateString("es-MX", { dateStyle: "long" })} (${situacion.dias} días)`);
  console.log(`  Gracia:   ${licencia.gracia_dias} días, y después el sistema se bloquea`);
  console.log(`  Soporte:  ${soporte ? "incluido (Gonzalo DJA puede entrar)" : "SIN ACCESO — define MOTRAE_CONTRASENA_SOPORTE"}`);
  console.log(`  Archivo:  ${opciones.salida}\n`);
  console.log(`  PIN inicial del responsable: ${pinResponsable}`);
  console.log("  Entrégalo por un medio privado: debe cambiarlo al entrar por primera vez.\n");

  if (!soporte) {
    console.warn(
      "  AVISO: sin acceso de soporte no podrás entrar a este local a resolver\n" +
        "  nada, ni siquiera si se bloquea por falta de pago.\n",
    );
  }
}

void principal();
