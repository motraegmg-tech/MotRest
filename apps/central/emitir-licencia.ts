/**
 * Emitir la licencia de un restaurante desde la terminal.
 *
 * Es la misma emisión que hace el botón de MOTRAE Central, en forma de comando.
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
 *     --sucursal suc-rodizio-centro --nombre "Rodizio" --meses 1
 */
import { writeFileSync } from "node:fs";
import {
  crearCredencial,
  emitirLicencia,
  publicaDe,
  siguienteVencimiento,
  situacionDe,
  verificarLicencia,
  type Licencia,
  type Plan,
} from "@motrest/dominio";

interface Opciones {
  sucursal: string;
  nombre: string;
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

  const plan = (dado.get("plan") ?? "mensual") as Plan;
  if (!["prueba", "mensual", "anual"].includes(plan)) {
    return `Plan desconocido: ${plan}. Usa prueba, mensual o anual.`;
  }

  const meses = Number(dado.get("meses") ?? (plan === "anual" ? 12 : 1));
  if (!Number.isFinite(meses) || meses < 1) return "--meses tiene que ser un número mayor que cero";

  return {
    sucursal,
    nombre: dado.get("nombre")?.trim() || sucursal,
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
        "Es la llave privada Ed25519 de MOTRAE Central → Llaves.\n" +
        "En PowerShell:\n" +
        '  $env:MOTRAE_LLAVE_PRIVADA_LICENCIAS = "la-llave-privada"\n',
    );
    process.exit(1);
  }

  const opciones = leerArgumentos(process.argv.slice(2));
  if (typeof opciones === "string") {
    console.error(`${opciones}\n\nEjemplo:\n  --sucursal suc-rodizio-centro --nombre "Rodizio" --meses 1\n`);
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
  console.log(`  Vence:    ${new Date(licencia.vence_ts).toLocaleDateString("es-MX", { dateStyle: "long" })} (${situacion.dias} días)`);
  console.log(`  Gracia:   ${licencia.gracia_dias} días, y después el sistema se bloquea`);
  console.log(`  Soporte:  ${soporte ? "incluido (Gonz Motrae puede entrar)" : "SIN ACCESO — define MOTRAE_CONTRASENA_SOPORTE"}`);
  console.log(`  Archivo:  ${opciones.salida}\n`);

  if (!soporte) {
    console.warn(
      "  AVISO: sin acceso de soporte no podrás entrar a este local a resolver\n" +
        "  nada, ni siquiera si se bloquea por falta de pago.\n",
    );
  }
}

void principal();
