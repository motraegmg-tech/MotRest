/**
 * Conserva las decisiones nativas del KDS después de cada `cap sync`.
 *
 * `android/` es un artefacto generado y queda fuera de Git: editar sus Gradle
 * a mano deja una tablet funcionando hoy, pero hace que la siguiente persona
 * regenere un APK con mínimos antiguos. Este archivo sí viaja con el proyecto
 * y aplica tanto la migración a Capacitor 8 como el modo cocina sobre la
 * plantilla que Capacitor acaba de escribir.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const android = resolve(aqui, "android");

if (!existsSync(android)) {
  console.error("No existe apps/kds-android/android.");
  console.error("  Ejecuta antes: npx cap sync android");
  process.exit(1);
}

const cambiados = [];

ajustarVariables();
ajustarGradleRaiz();
ajustarWrapper();
ajustarGradleApp();
ajustarPuenteCapacitor();
ajustarManifiesto();

console.log(
  cambiados.length === 0
    ? "Proyecto Android ya alineado con Capacitor 8."
    : `Proyecto Android ajustado: ${cambiados.join(", ")}.`,
);

function ajustarVariables() {
  const ruta = resolve(android, "variables.gradle");
  const valores = {
    minSdkVersion: "24",
    compileSdkVersion: "36",
    targetSdkVersion: "36",
    androidxActivityVersion: "'1.11.0'",
    androidxAppCompatVersion: "'1.7.1'",
    androidxCoordinatorLayoutVersion: "'1.3.0'",
    androidxCoreVersion: "'1.17.0'",
    androidxFragmentVersion: "'1.8.9'",
    coreSplashScreenVersion: "'1.2.0'",
    androidxWebkitVersion: "'1.14.0'",
    androidxJunitVersion: "'1.3.0'",
    androidxEspressoCoreVersion: "'3.7.0'",
    cordovaAndroidVersion: "'14.0.1'",
  };

  actualizarArchivo(ruta, (gradle) => {
    let ajustado = gradle;
    for (const [nombre, valor] of Object.entries(valores)) {
      ajustado = reemplazarObligatorio(
        ajustado,
        new RegExp(`^(\\s*${nombre}\\s*=\\s*)[^\\r\\n]*`, "m"),
        (_coincidencia, prefijo) => `${prefijo}${valor}`,
        `${nombre} en variables.gradle`,
      );
    }
    return ajustado;
  });
}

function ajustarGradleRaiz() {
  const ruta = resolve(android, "build.gradle");
  actualizarArchivo(ruta, (gradle) => {
    let ajustado = reemplazarObligatorio(
      gradle,
      /(classpath\s+'com\.android\.tools\.build:gradle:)[^']+'/,
      (_coincidencia, prefijo) => `${prefijo}8.13.0'`,
      "Android Gradle Plugin en build.gradle",
    );
    ajustado = reemplazarObligatorio(
      ajustado,
      /(classpath\s+'com\.google\.gms:google-services:)[^']+'/,
      (_coincidencia, prefijo) => `${prefijo}4.4.4'`,
      "Google Services Gradle Plugin en build.gradle",
    );
    return ajustado;
  });
}

function ajustarWrapper() {
  const ruta = resolve(android, "gradle/wrapper/gradle-wrapper.properties");
  actualizarArchivo(ruta, (propiedades) =>
    reemplazarObligatorio(
      propiedades,
      /^distributionUrl=[^\r\n]*/m,
      "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip",
      "distributionUrl en gradle-wrapper.properties",
    ),
  );
}

function ajustarGradleApp() {
  const ruta = resolve(android, "app/build.gradle");
  actualizarArchivo(ruta, (gradle) => {
    let ajustado = reemplazarObligatorio(
      gradle,
      /^(\s*namespace)\s*(?:=\s*)?("[^"]+")\s*$/m,
      (_coincidencia, propiedad, valor) => `${propiedad} = ${valor}`,
      "namespace en app/build.gradle",
    );
    ajustado = reemplazarObligatorio(
      ajustado,
      /^(\s*compileSdk)\s*(?:=\s*)?(rootProject\.ext\.compileSdkVersion)\s*$/m,
      (_coincidencia, propiedad, valor) => `${propiedad} = ${valor}`,
      "compileSdk en app/build.gradle",
    );
    ajustado = reemplazarObligatorio(
      ajustado,
      /^(\s*ignoreAssetsPattern)\s*(?:=\s*)?('[^']*')\s*$/m,
      (_coincidencia, propiedad, valor) => `${propiedad} = ${valor}`,
      "ignoreAssetsPattern en app/build.gradle",
    );
    return ajustado;
  });
}

function ajustarPuenteCapacitor() {
  const ruta = resolve(android, "app/capacitor.build.gradle");
  actualizarArchivo(ruta, (gradle) => {
    let ajustado = reemplazarObligatorio(
      gradle,
      /(sourceCompatibility\s+JavaVersion\.)VERSION_\d+/,
      "$1VERSION_21",
      "sourceCompatibility en capacitor.build.gradle",
    );
    ajustado = reemplazarObligatorio(
      ajustado,
      /(targetCompatibility\s+JavaVersion\.)VERSION_\d+/,
      "$1VERSION_21",
      "targetCompatibility en capacitor.build.gradle",
    );
    return ajustado;
  });
}

function ajustarManifiesto() {
  const ruta = resolve(android, "app/src/main/AndroidManifest.xml");
  actualizarArchivo(ruta, (xml) => {
    let ajustado = xml;

    /*
     * El KDS se monta en una pared y se consulta con las manos ocupadas: no
     * puede apagarse, girar ni requerir que alguien abra un icono al encender.
     * Esto vive aquí porque `cap add` parte siempre del manifiesto genérico.
     */
    if (!ajustado.includes("android:keepScreenOn")) {
      ajustado = reemplazarObligatorio(
        ajustado,
        /android:launchMode="singleTask"/,
        'android:launchMode="singleTask"\n            android:screenOrientation="landscape"\n            android:keepScreenOn="true"',
        "launchMode en AndroidManifest.xml",
      );
    }

    if (!ajustado.includes("BOOT_COMPLETED")) {
      ajustado = reemplazarObligatorio(
        ajustado,
        /        <\/activity>/,
        `            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>

        </activity>`,
        "activity de AndroidManifest.xml",
      );
      ajustado = reemplazarObligatorio(
        ajustado,
        /<uses-permission android:name="android\.permission\.INTERNET" \/>/,
        `<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />`,
        "permiso INTERNET en AndroidManifest.xml",
      );
    }

    const configuracion = /android:configChanges="([^"]+)"/;
    const coincidencia = configuracion.exec(ajustado);
    if (!coincidencia) {
      throw new Error("Falta android:configChanges en AndroidManifest.xml.");
    }
    const cambios = coincidencia[1].split("|");
    for (const cambio of ["navigation", "density"]) {
      if (!cambios.includes(cambio)) cambios.push(cambio);
    }
    return ajustado.replace(configuracion, `android:configChanges="${cambios.join("|")}"`);
  });
}

function actualizarArchivo(ruta, transformar) {
  if (!existsSync(ruta)) {
    throw new Error(`Falta ${ruta}; ejecuta primero: npx cap sync android`);
  }

  const anterior = readFileSync(ruta, "utf8");
  const siguiente = transformar(anterior);
  if (siguiente !== anterior) {
    writeFileSync(ruta, siguiente);
    cambiados.push(ruta.slice(android.length + 1));
  }
}

function reemplazarObligatorio(texto, patron, reemplazo, descripcion) {
  if (!patron.test(texto)) {
    throw new Error(`No se encontró ${descripcion}; la plantilla de Capacitor cambió y requiere revisión.`);
  }
  return texto.replace(patron, reemplazo);
}
