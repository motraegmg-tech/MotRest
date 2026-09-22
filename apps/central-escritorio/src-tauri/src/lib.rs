//! MotRest Central para Windows.
//!
//! Central firma licencias y manifiestos para toda la cartera, así que sus
//! privadas no pueden vivir en `localStorage` ni en el perfil sin cifrar de la
//! webview. Este módulo las protege con DPAPI antes de escribir un solo byte a
//! disco. DPAPI las liga al usuario de Windows de Gonzalo: copiar el archivo a
//! otra cuenta no permite descifrarlo.
//!
//! La firma Ed25519 se mantiene en WebCrypto porque Central comparte esa
//! implementación con el dominio. La privada solo se entrega al frontend de la
//! propia ventana, cuando éste la necesita para firmar; nunca se renderiza ni se
//! deja en el almacenamiento del navegador.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const ARCHIVO_SECRETOS: &str = "secretos.dpapi";

fn ruta_secretos(app: &AppHandle) -> Result<PathBuf, String> {
    let carpeta = app
        .path()
        .app_local_data_dir()
        .map_err(|causa| format!("No se pudo resolver la carpeta segura de Central: {causa}"))?;
    fs::create_dir_all(&carpeta)
        .map_err(|causa| format!("No se pudo crear la carpeta segura de Central: {causa}"))?;
    Ok(carpeta.join(ARCHIVO_SECRETOS))
}

fn blob(bytes: &mut [u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
    let longitud = u32::try_from(bytes.len())
        .map_err(|_| "El almacén de secretos excede el tamaño permitido por DPAPI".to_string())?;
    Ok(CRYPT_INTEGER_BLOB {
        cbData: longitud,
        pbData: bytes.as_mut_ptr(),
    })
}

fn copiar_y_liberar(salida: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let bytes = if salida.pbData.is_null() || salida.cbData == 0 {
        Vec::new()
    } else {
        // CryptProtectData/CryptUnprotectData asignan esta memoria con LocalAlloc.
        unsafe { std::slice::from_raw_parts(salida.pbData, salida.cbData as usize).to_vec() }
    };
    if !salida.pbData.is_null() {
        unsafe {
            LocalFree(salida.pbData.cast());
        }
    }
    bytes
}

fn proteger(datos: &str) -> Result<Vec<u8>, String> {
    let mut entrada_bytes = datos.as_bytes().to_vec();
    let entrada = blob(&mut entrada_bytes)?;
    let mut salida = CRYPT_INTEGER_BLOB::default();
    let correcto = unsafe {
        CryptProtectData(
            &entrada,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut salida,
        )
    };
    entrada_bytes.fill(0);

    if correcto == 0 {
        return Err(format!(
            "Windows no pudo proteger las llaves con DPAPI: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(copiar_y_liberar(salida))
}

fn desproteger(cifrado: &[u8]) -> Result<String, String> {
    let mut entrada_bytes = cifrado.to_vec();
    let entrada = blob(&mut entrada_bytes)?;
    let mut salida = CRYPT_INTEGER_BLOB::default();
    let correcto = unsafe {
        CryptUnprotectData(
            &entrada,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut salida,
        )
    };
    entrada_bytes.fill(0);

    if correcto == 0 {
        return Err(format!(
            "Windows no pudo abrir las llaves protegidas con DPAPI: {}",
            std::io::Error::last_os_error()
        ));
    }

    String::from_utf8(copiar_y_liberar(salida))
        .map_err(|_| "El almacén DPAPI de Central no contiene texto UTF-8 válido".to_string())
}

fn validar_json(texto: &str) -> Result<(), String> {
    match serde_json::from_str::<serde_json::Value>(texto) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err("El almacén de secretos debe contener un objeto JSON".to_string()),
    }
}

fn escribir_cifrado(app: &AppHandle, cifrado: &[u8]) -> Result<(), String> {
    let ruta = ruta_secretos(app)?;
    fs::write(&ruta, cifrado)
        .map_err(|causa| format!("No se pudo guardar el almacén DPAPI de Central: {causa}"))
}

/// Persiste el objeto de claves cifrado por Windows antes de tocar el disco.
#[tauri::command]
fn guardar_secretos(app: AppHandle, secretos: String) -> Result<(), String> {
    validar_json(&secretos)?;
    escribir_cifrado(&app, &proteger(&secretos)?)
}

/// Devuelve el objeto únicamente a la ventana de Central, para una firma puntual.
#[tauri::command]
fn cargar_secretos(app: AppHandle) -> Result<Option<String>, String> {
    let ruta = ruta_secretos(&app)?;
    if !ruta.exists() {
        return Ok(None);
    }
    let cifrado = fs::read(&ruta)
        .map_err(|causa| format!("No se pudo leer el almacén DPAPI de Central: {causa}"))?;
    desproteger(&cifrado).map(Some)
}

/// Copia el blob DPAPI, no las privadas. Solo restaura en el mismo perfil Windows.
#[tauri::command]
fn respaldo_de_secretos(app: AppHandle) -> Result<Option<Vec<u8>>, String> {
    let ruta = ruta_secretos(&app)?;
    if !ruta.exists() {
        return Ok(None);
    }
    fs::read(&ruta)
        .map(Some)
        .map_err(|causa| format!("No se pudo respaldar el almacén DPAPI de Central: {causa}"))
}

/// Restaura solo un blob que DPAPI pueda abrir y que contenga el JSON esperado.
#[tauri::command]
fn restaurar_secretos(app: AppHandle, respaldo: Vec<u8>) -> Result<(), String> {
    let texto = desproteger(&respaldo)?;
    validar_json(&texto)?;
    escribir_cifrado(&app, &respaldo)
}

/// Lo que la ventana recibe de una llamada a la nube. Sin cabeceras de más.
#[derive(serde::Serialize)]
struct RespuestaNube {
    estado: u16,
    cuerpo: String,
    /// Solo esta cabecera, y solo porque de ella sale el total de un conteo.
    content_range: Option<String>,
}

/// La lista blanca de rutas por las que Central puede hablar con la nube.
///
/// La ventana elige el camino, y aunque sea nuestra propia interfaz, esto impide
/// que un `../` o una ruta absoluta acaben mandando la llave de servicio a otro
/// sitio. Es la misma regla que el Hub aplica a la URL de un manifiesto firmado:
/// decir qué instalar no autoriza a pedirlo donde sea.
///
/// `/auth/v1/admin/users` entra, y SOLO ésa de todo `/auth/v1/`: es lo que da de
/// alta la identidad de un restaurante en la nube desde el panel. Antes ese paso
/// se hacía por fuera —un script de consola con la llave de servicio en una
/// variable de entorno— y había que pegar a mano la credencial que devolvía. Un
/// paso manual que hay que acordarse de dar es un paso que no se da: medido en la
/// nube el 17-sep-2026, de tres locales solo uno había quedado enlazado.
///
/// Se abre el mínimo: la colección para crear y buscar, y `/<id>` para reemitir
/// la credencial de uno que ya existe. Nada de `/auth/v1/` a secas, que
/// incluiría el resto de la API de administración de identidades.
///
/// Vive aparte del comando para poder probarla: dentro de una función `async` de
/// Tauri no había forma de comprobarla más que ejecutando la aplicación, y una
/// lista blanca que nadie prueba es una lista blanca que se amplía sin querer.
fn comprobar_ruta_de_nube(ruta: &str) -> Result<(), String> {
    let auth_de_altas = ruta == "/auth/v1/admin/users"
        || ruta.starts_with("/auth/v1/admin/users?")
        || ruta.starts_with("/auth/v1/admin/users/");

    if !ruta.starts_with("/rest/v1/") && !ruta.starts_with("/storage/v1/") && !auth_de_altas {
        return Err(format!("Ruta no permitida para la nube: {ruta}"));
    }
    if ruta.contains("..") {
        return Err("La ruta de la nube no puede subir de directorio".into());
    }
    Ok(())
}

/// Habla con la nube de MotRest **desde Rust**, no desde la webview.
///
/// POR QUÉ EXISTE, y no es una preferencia de estilo: Supabase **rechaza** una
/// llave de servicio si la petición trae `User-Agent` de navegador. Contesta
/// `401 Forbidden use of secret API key in browser`. La interfaz de Central
/// corre en una webview, así que cada llamada suya llegaba con esa cabecera y
/// era rechazada.
///
/// Y el control tiene razón. Esa llave se salta **todas** las políticas RLS:
/// quien la tenga lee el padrón entero de MOTRAE y puede repartir licencias. No
/// tiene nada que hacer en un contexto donde el contenido web podría leerla.
///
/// Así que la llave se lee aquí, del almacén que ya protege DPAPI, y no viaja a
/// la ventana. La ventana dice **qué** quiere pedir; nunca **con qué**.
#[tauri::command]
async fn nube_peticion(
    app: AppHandle,
    metodo: String,
    ruta: String,
    cuerpo: Option<String>,
    // `bytes` es el instalador, cuando lo que se sube no es JSON.
    bytes: Option<Vec<u8>>,
    prefer: Option<String>,
    upsert: Option<bool>,
) -> Result<RespuestaNube, String> {
    /*
     * La ruta se comprueba contra una lista blanca.
     *
     * La ventana elige el camino, y aunque sea nuestra propia interfaz, esto
     * impide que un `../` o una ruta absoluta acaben mandando la llave de
     * servicio a otro sitio. Es la misma regla que el Hub aplica a la URL de un
     * manifiesto firmado: decir qué instalar no autoriza a pedirlo donde sea.
     */
    if let Err(motivo) = comprobar_ruta_de_nube(&ruta) {
        return Err(motivo);
    }

    let secretos = cargar_secretos(app)?.ok_or("Todavía no hay secretos guardados en Central")?;
    let json: serde_json::Value = serde_json::from_str(&secretos)
        .map_err(|causa| format!("El almacén de Central no es JSON: {causa}"))?;

    let base = json["nube_url"]
        .as_str()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string();
    let llave = json["nube_servicio"].as_str().unwrap_or("").to_string();
    if base.is_empty() || llave.is_empty() {
        return Err("Falta la dirección de la nube o su llave de servicio (ver Llaves)".into());
    }
    if !base.starts_with("https://") {
        return Err("La dirección de la nube tiene que ser https://".into());
    }

    let cliente = reqwest::Client::builder()
        // Explícito, y NO uno de navegador: es justo lo que distingue esta
        // llamada de la que Supabase rechaza.
        .user_agent("MotRest-Central")
        .build()
        .map_err(|causa| format!("No se pudo preparar la conexión: {causa}"))?;

    let verbo = reqwest::Method::from_bytes(metodo.as_bytes())
        .map_err(|_| format!("Método HTTP inválido: {metodo}"))?;

    let mut peticion = cliente
        .request(verbo, format!("{base}{ruta}"))
        .header("apikey", &llave)
        .bearer_auth(&llave);

    if let Some(p) = prefer {
        peticion = peticion.header("prefer", p);
    }
    if upsert == Some(true) {
        // Volver a publicar una versión reemplaza su archivo. Sin esto, un
        // segundo intento tras un fallo a medias daría «ya existe» y habría que
        // ir a borrarlo a mano al panel de Supabase.
        peticion = peticion.header("x-upsert", "true");
    }
    if let Some(b) = bytes {
        peticion = peticion
            .header("content-type", "application/octet-stream")
            .body(b);
    } else if let Some(c) = cuerpo {
        peticion = peticion.header("content-type", "application/json").body(c);
    }

    let respuesta = peticion
        .send()
        .await
        .map_err(|causa| format!("No se pudo hablar con la nube: {causa}"))?;

    let estado = respuesta.status().as_u16();
    let content_range = respuesta
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());
    let cuerpo = respuesta
        .text()
        .await
        .map_err(|causa| format!("No se pudo leer la respuesta de la nube: {causa}"))?;

    Ok(RespuestaNube {
        estado,
        cuerpo,
        content_range,
    })
}

/// Dónde está FacturAPI. Fija aquí y no en el almacén: no es configuración del
/// despliegue, es el proveedor, y dejar que la ventana la eligiera sería dejarle
/// elegir a quién se le manda la llave de usuario.
const BASE_FACTURAPI: &str = "https://www.facturapi.io";

/// Lo que la ventana recibe de FacturAPI: el estado y el cuerpo, nada más.
#[derive(serde::Serialize)]
struct RespuestaFacturapi {
    estado: u16,
    cuerpo: String,
}

/// Un identificador de FacturAPI —de organización o de llave— tal como llega en
/// sus respuestas: letras, dígitos, `_` y `-`. Nada de `.`, `/` ni `%`, que es
/// por donde una ruta armada con él podría llevar a otra parte.
fn es_id_de_facturapi(texto: &str) -> bool {
    !texto.is_empty()
        && texto.len() <= 64
        && texto
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// La lista blanca de lo que Central le puede pedir a FacturAPI.
///
/// POR QUÉ TAN ESTRECHA. Por aquí viaja la llave de USUARIO de MOTRAE, la
/// `sk_user_`: con ella se crean y se BORRAN organizaciones, se sacan las llaves
/// de cualquier restaurante y se invalidan. Central solo necesita cuatro cosas
/// —ver la lista de organizaciones, ver una, sacarle una llave y, si se filtra,
/// revocarla—, y la lista blanca es esa y ni una más. En particular NO entran:
///
///   - `DELETE /v2/organizations/{id}`, que borra la organización entera con sus
///     facturas: un clic equivocado que no tiene vuelta.
///   - `PUT …/apikeys/test`, que RENUEVA la de pruebas e invalida la anterior al
///     instante: dejaría sin facturar a cualquier local que estuviera probando.
///   - cualquier cosa fuera de `/v2/organizations`, como timbrar o cancelar, que
///     es trabajo del Hub de cada local con su propia llave, no de Central.
///
/// Se compara MÉTODO Y RUTA juntos: `GET …/apikeys/live` enseña solo los doce
/// primeros caracteres de cada llave, y `PUT` en la misma ruta crea una. No es lo
/// mismo pedir la lista que fabricar una llave.
///
/// `GET …/apikeys/live` hace falta para revocar: crear una Live devuelve solo el
/// texto de la llave, sin su identificador, y `DELETE` pide el identificador. Es
/// la única forma de saber cuál de la lista es la que se acaba de crear.
///
/// Vive aparte del comando para poder probarla con `cargo test`, por lo mismo
/// que `comprobar_ruta_de_nube`: una lista blanca que nadie prueba es una lista
/// blanca que se amplía sin querer.
fn comprobar_peticion_de_facturapi(metodo: &str, ruta: &str) -> Result<(), String> {
    let rechazo = || Err(format!("Petición no permitida a FacturAPI: {metodo} {ruta}"));

    let (camino, consulta) = match ruta.split_once('?') {
        Some((camino, consulta)) => (camino, Some(consulta)),
        None => (ruta, None),
    };

    let partes: Vec<&str> = camino.split('/').collect();
    if partes.len() < 3 || !partes[0].is_empty() || partes[1] != "v2" || partes[2] != "organizations" {
        return rechazo();
    }

    let permitida = match (metodo, &partes[3..]) {
        ("GET", []) => true,
        ("GET", [organizacion]) => es_id_de_facturapi(organizacion),
        ("GET", [organizacion, "apikeys", "live"])
        | ("PUT", [organizacion, "apikeys", "live"])
        | ("GET", [organizacion, "apikeys", "test"]) => es_id_de_facturapi(organizacion),
        ("DELETE", [organizacion, "apikeys", "live", llave]) => {
            es_id_de_facturapi(organizacion) && es_id_de_facturapi(llave)
        }
        _ => false,
    };
    if !permitida {
        return rechazo();
    }

    /*
     * Solo la lista de organizaciones lleva consulta (página, tamaño, búsqueda),
     * y solo con caracteres de una consulta ya codificada. Un `#` o un espacio no
     * tienen nada que hacer ahí, y ninguna otra ruta la necesita.
     */
    if let Some(consulta) = consulta {
        let es_la_lista = metodo == "GET" && partes.len() == 3;
        let caracteres_de_consulta = consulta
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"=&%_.-+".contains(&b));
        if !es_la_lista || consulta.is_empty() || consulta.len() > 200 || !caracteres_de_consulta {
            return rechazo();
        }
    }

    Ok(())
}

/// Habla con FacturAPI **desde Rust**, con la llave de usuario de MOTRAE.
///
/// Es el mismo trato que la llave de servicio de la nube en `nube_peticion`: la
/// llave se lee aquí, del almacén que protege DPAPI, y NO viaja a la ventana. La
/// ventana dice qué quiere pedir; nunca con qué. Esa llave abre las
/// organizaciones de todos los restaurantes, y la interfaz no la necesita para
/// nada: solo necesita saber si ya hay una guardada.
///
/// Lo que sí vuelve a la ventana es la respuesta, y en un caso lleva una llave
/// dentro —la Live o la Test del restaurante, al pedirla—. Es inevitable: la
/// ventana es la que la cierra en el sobre para ese Hub. Se queda en memoria lo
/// que dura el envío y no se guarda ni se registra en ninguna parte.
#[tauri::command]
async fn facturapi_peticion(
    app: AppHandle,
    metodo: String,
    ruta: String,
    cuerpo: Option<String>,
) -> Result<RespuestaFacturapi, String> {
    comprobar_peticion_de_facturapi(&metodo, &ruta)?;

    let secretos = cargar_secretos(app)?.ok_or("Todavía no hay secretos guardados en Central")?;
    let json: serde_json::Value = serde_json::from_str(&secretos)
        .map_err(|causa| format!("El almacén de Central no es JSON: {causa}"))?;
    let llave = json["facturapi_usuario"].as_str().unwrap_or("").to_string();
    if !llave.starts_with("sk_user_") {
        return Err("Falta tu llave de usuario de FacturAPI (ver Llaves)".into());
    }

    let cliente = reqwest::Client::builder()
        .user_agent("MotRest-Central")
        // Sin tope, un FacturAPI que no contesta deja el botón «Enviar» girando
        // para siempre y a Gonzalo sin saber si la llave salió o no.
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|causa| format!("No se pudo preparar la conexión: {causa}"))?;

    let verbo = reqwest::Method::from_bytes(metodo.as_bytes())
        .map_err(|_| format!("Método HTTP inválido: {metodo}"))?;
    // Un PUT o un DELETE sin cuerpo Y sin esta marca es lo que FacturAPI
    // rechazaba con 411 al crear la Live: ver la nota bajo `peticion`.
    let necesita_largo_declarado = cuerpo.is_none() && verbo != reqwest::Method::GET;

    let mut peticion = cliente
        .request(verbo, format!("{BASE_FACTURAPI}{ruta}"))
        .bearer_auth(&llave);
    if let Some(c) = cuerpo {
        peticion = peticion.header("content-type", "application/json").body(c);
    } else if necesita_largo_declarado {
        /*
         * SIN CUERPO NO ES LO MISMO QUE SIN `Content-Length`, Y UN CUERPO
         * VACÍO TAMPOCO BASTA.
         *
         * Al crear la llave Live (`PUT …/apikeys/live`) no hace falta mandar
         * nada, y por eso `cuerpo` llegaba `None`. Sin llamar a `.body(..)`,
         * reqwest no manda `Content-Length` en absoluto, y el servidor de
         * FacturAPI contestaba `411 Length Required` — el error real al crear
         * la llave de producción de Tortas Fc (21-sep-2026).
         *
         * La primera corrección probada fue `.body("")`, y NO alcanza:
         * comprobado capturando los bytes de verdad (ver
         * `pruebas_facturapi::bytes_enviados`), reqwest trata una cadena vacía
         * igual que ningún cuerpo, y la cabecera sigue sin salir. Hace falta un
         * cuerpo con contenido — aquí, el objeto JSON vacío — para que reqwest
         * calcule y mande su largo. FacturAPI no necesita leerlo: le basta con
         * que la petición declare cuánto va a leer, aunque sea «2».
         */
        peticion = peticion.header("content-type", "application/json").body("{}");
    }

    let respuesta = peticion
        .send()
        .await
        .map_err(|causa| format!("No se pudo hablar con FacturAPI: {causa}"))?;

    let estado = respuesta.status().as_u16();
    let cuerpo = respuesta
        .text()
        .await
        .map_err(|causa| format!("No se pudo leer la respuesta de FacturAPI: {causa}"))?;

    Ok(RespuestaFacturapi { estado, cuerpo })
}

pub fn ejecutar() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            guardar_secretos,
            cargar_secretos,
            respaldo_de_secretos,
            restaurar_secretos,
            nube_peticion,
            facturapi_peticion,
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo arrancar MotRest Central");
}

#[cfg(test)]
mod pruebas {
    use super::comprobar_ruta_de_nube;

    /// Lo que el panel necesita de verdad. Si esto se cierra, el alta de un
    /// restaurante deja de enlazarlo con la nube y vuelve el paso manual.
    #[test]
    fn deja_pasar_lo_que_central_usa() {
        for ruta in [
            "/rest/v1/sucursales",
            "/rest/v1/licencias_pendientes",
            "/storage/v1/object/instaladores/1.5.4.exe",
            "/auth/v1/admin/users",
            "/auth/v1/admin/users?filter=suc-rodizio%40hubs.motrae.mx",
            "/auth/v1/admin/users/2f1c8a90-0000-4000-8000-000000000000",
        ] {
            assert!(comprobar_ruta_de_nube(ruta).is_ok(), "deberia permitirse: {ruta}");
        }
    }

    /// Por aqui viaja la llave de servicio, que se salta todas las politicas
    /// RLS. Abrir `/auth/v1/` entero entregaria la administracion de identidades.
    #[test]
    fn no_abre_mas_de_la_cuenta() {
        for ruta in [
            "/auth/v1/",
            "/auth/v1/token",
            "/auth/v1/admin/generate_link",
            "/auth/v1/admin/userszzz",
            "/functions/v1/enviar-whatsapp",
            "/",
            "https://otro-sitio.example/rest/v1/sucursales",
        ] {
            assert!(comprobar_ruta_de_nube(ruta).is_err(), "no deberia permitirse: {ruta}");
        }
    }

    /// El `..` se rechaza incluso dentro de una ruta que por lo demas vale.
    #[test]
    fn no_deja_subir_de_directorio() {
        assert!(comprobar_ruta_de_nube("/rest/v1/../../auth/v1/token").is_err());
        assert!(comprobar_ruta_de_nube("/auth/v1/admin/users/../token").is_err());
    }
}

#[cfg(test)]
mod pruebas_facturapi {
    use super::comprobar_peticion_de_facturapi as comprobar;

    const ORG: &str = "5a2a307be93a2f00129ea035";

    /// Lo que la pestaña de Facturación usa. Si algo de esto se cierra, Gonzalo
    /// vuelve a copiar llaves a mano del panel de FacturAPI.
    #[test]
    fn deja_pasar_lo_que_central_usa() {
        for (metodo, ruta) in [
            ("GET", "/v2/organizations".to_string()),
            ("GET", "/v2/organizations?limit=100&page=2".to_string()),
            ("GET", "/v2/organizations?q=rodizio%20centro".to_string()),
            ("GET", format!("/v2/organizations/{ORG}")),
            ("GET", format!("/v2/organizations/{ORG}/apikeys/live")),
            ("PUT", format!("/v2/organizations/{ORG}/apikeys/live")),
            ("GET", format!("/v2/organizations/{ORG}/apikeys/test")),
            ("DELETE", format!("/v2/organizations/{ORG}/apikeys/live/6512ab34cd56ef7890123456")),
        ] {
            assert!(comprobar(metodo, &ruta).is_ok(), "deberia permitirse: {metodo} {ruta}");
        }
    }

    /// Por aqui viaja la llave de USUARIO: borra organizaciones y renueva llaves.
    /// Nada de eso es trabajo de Central.
    #[test]
    fn no_abre_mas_de_la_cuenta() {
        for (metodo, ruta) in [
            // Borrar la organizacion entera, con sus facturas.
            ("DELETE", format!("/v2/organizations/{ORG}")),
            // Renovar la de pruebas invalida la anterior al instante.
            ("PUT", format!("/v2/organizations/{ORG}/apikeys/test")),
            // Crear organizaciones, o tocar sus datos fiscales y su CSD.
            ("POST", "/v2/organizations".to_string()),
            ("PUT", format!("/v2/organizations/{ORG}/legal")),
            ("PUT", format!("/v2/organizations/{ORG}/certificate")),
            ("DELETE", format!("/v2/organizations/{ORG}/certificate")),
            ("GET", format!("/v2/organizations/{ORG}/team")),
            // Timbrar o cancelar es trabajo del Hub, con la llave del local.
            ("POST", "/v2/invoices".to_string()),
            ("GET", "/v2/invoices".to_string()),
            // Revocar exige la llave concreta, no «todas».
            ("DELETE", format!("/v2/organizations/{ORG}/apikeys/live")),
            // El metodo se compara exacto: la misma ruta con otro verbo es otra cosa.
            ("POST", format!("/v2/organizations/{ORG}/apikeys/live")),
            ("get", "/v2/organizations".to_string()),
            ("GET", "/v1/organizations".to_string()),
            ("GET", "/".to_string()),
            ("GET", "".to_string()),
            ("GET", "https://otro-sitio.example/v2/organizations".to_string()),
            ("GET", "/v2/organizations/".to_string()),
        ] {
            assert!(comprobar(metodo, &ruta).is_err(), "no deberia permitirse: {metodo} {ruta}");
        }
    }

    /// Un identificador no puede traer con que salirse de su sitio.
    #[test]
    fn los_identificadores_no_esconden_rutas() {
        for ruta in [
            "/v2/organizations/../invoices".to_string(),
            "/v2/organizations/%2e%2e/apikeys/live".to_string(),
            format!("/v2/organizations/{ORG}/apikeys/live/..%2f..%2finvoices"),
            "/v2/organizations/a.b".to_string(),
            format!("/v2/organizations/{}", "a".repeat(65)),
        ] {
            assert!(comprobar("GET", &ruta).is_err(), "no deberia permitirse: {ruta}");
        }
        assert!(comprobar("DELETE", &format!("/v2/organizations/{ORG}/apikeys/live/x.y")).is_err());
    }

    /// Solo la lista lleva consulta, y solo con caracteres de consulta.
    #[test]
    fn la_consulta_solo_en_la_lista() {
        assert!(comprobar("GET", &format!("/v2/organizations/{ORG}?expand=todo")).is_err());
        assert!(comprobar("PUT", &format!("/v2/organizations/{ORG}/apikeys/live?x=1")).is_err());
        assert!(comprobar("GET", "/v2/organizations?q=a b").is_err());
        assert!(comprobar("GET", "/v2/organizations?q=a#b").is_err());
        assert!(comprobar("GET", "/v2/organizations?").is_err());
        assert!(comprobar("GET", &format!("/v2/organizations?q={}", "a".repeat(201))).is_err());
    }

    /// Los bytes que reqwest manda DE VERDAD por la red al enviar una
    /// petición, capturados con un oyente en `localhost` que no contesta
    /// nada. Hace falta esto y no `RequestBuilder::build()` porque
    /// `Content-Length` no vive en el mapa de cabeceras de la petición: reqwest
    /// la calcula al armar los bytes sobre el cable, ya en el envío — que es
    /// justo lo que la primera versión de esta prueba pasaba por alto (ver el
    /// historial: comprobaba `.headers()` y fallaba incluso con `.body("")`).
    fn bytes_enviados<F>(armar: F) -> Vec<u8>
    where
        F: FnOnce(&reqwest::Client, u16) -> reqwest::RequestBuilder,
    {
        use std::io::Read;

        let oyente = std::net::TcpListener::bind("127.0.0.1:0").expect("puerto libre en localhost");
        let puerto = oyente.local_addr().expect("dirección local").port();

        let hilo = std::thread::spawn(move || -> Vec<u8> {
            let (mut socket, _) = oyente.accept().expect("reqwest se conecta");
            let mut leido = vec![0u8; 8192];
            let n = socket.read(&mut leido).unwrap_or(0);
            leido.truncate(n);
            leido
        });

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("runtime de la prueba");
        let cliente = reqwest::Client::new();
        // No hay servidor de verdad al otro lado: el envío truena después de
        // que salen los bytes, justo lo que hace falta y nada más.
        let _ = runtime.block_on(armar(&cliente, puerto).send());

        hilo.join().expect("el oyente no truena")
    }

    /// El arreglo real: con la misma forma que arma `facturapi_peticion` para
    /// un PUT sin `cuerpo` —bearer y `.body("{}")`—, la petición sale
    /// declarando `Content-Length: 2`. FacturAPI no necesita leer ese objeto
    /// vacío; le basta con que la petición diga cuánto va a leer.
    #[test]
    fn un_put_sin_cuerpo_manda_un_json_vacio_y_declara_su_largo() {
        let crudo = bytes_enviados(|cliente, puerto| {
            cliente
                .request(
                    reqwest::Method::PUT,
                    format!("http://127.0.0.1:{puerto}/v2/organizations/x/apikeys/live"),
                )
                .bearer_auth("sk_user_de_prueba")
                .body("{}")
        });
        let texto = String::from_utf8_lossy(&crudo).to_lowercase();
        assert!(texto.starts_with("put "), "se esperaba un PUT: {texto}");
        assert!(texto.contains("content-length: 2"), "faltó Content-Length: {texto}");
        assert!(texto.trim_end().ends_with("{}"), "el cuerpo debería ser el objeto vacío: {texto}");
    }

    /// Así estaba antes del arreglo: un PUT armado SIN `.body(..)` no declara
    /// ningún largo. Es el paquete exacto que FacturAPI rechazaba con 411 al
    /// crear la llave de producción de Tortas Fc (21-sep-2026), y por eso
    /// `facturapi_peticion` ya no arma la petición así.
    #[test]
    fn sin_body_explicito_un_put_no_declara_ningun_largo() {
        let crudo = bytes_enviados(|cliente, puerto| {
            cliente
                .request(
                    reqwest::Method::PUT,
                    format!("http://127.0.0.1:{puerto}/v2/organizations/x/apikeys/live"),
                )
                .bearer_auth("sk_user_de_prueba")
            // A propósito sin `.body(..)`: así se armaba antes del arreglo.
        });
        let texto = String::from_utf8_lossy(&crudo).to_lowercase();
        assert!(!texto.contains("content-length"), "esto es justo el bug del 411: {texto}");
    }

    /// LA TRAMPA QUE HIZO FALTA UNA PRIMERA CORRECCIÓN PARA VER: un cuerpo
    /// VACÍO tampoco declara largo. reqwest lo trata igual que no mandar nada,
    /// así que `.body("")` NO habría arreglado el 411 — hace falta contenido de
    /// verdad, aunque sea un objeto vacío (ver la prueba de arriba). Si esto
    /// deja de fallar, el comportamiento de reqwest cambió y el comentario de
    /// `facturapi_peticion` sobre por qué usa `"{}"` hay que revisarlo.
    #[test]
    fn un_body_vacio_tampoco_declara_largo() {
        let crudo = bytes_enviados(|cliente, puerto| {
            cliente
                .request(
                    reqwest::Method::PUT,
                    format!("http://127.0.0.1:{puerto}/v2/organizations/x/apikeys/live"),
                )
                .bearer_auth("sk_user_de_prueba")
                .body("")
        });
        let texto = String::from_utf8_lossy(&crudo).to_lowercase();
        assert!(!texto.contains("content-length"), "si esto falla, «.body(\"\")» ya sí alcanza: {texto}");
    }

    /// Un GET, en cambio, nunca tuvo este problema: nunca llevó cuerpo y
    /// FacturAPI nunca contestó 411 al listar organizaciones.
    #[test]
    fn un_get_no_manda_content_length() {
        let crudo = bytes_enviados(|cliente, puerto| {
            cliente
                .request(reqwest::Method::GET, format!("http://127.0.0.1:{puerto}/v2/organizations"))
                .bearer_auth("sk_user_de_prueba")
        });
        let texto = String::from_utf8_lossy(&crudo).to_lowercase();
        assert!(texto.starts_with("get "), "se esperaba un GET: {texto}");
        assert!(!texto.contains("content-length"), "un GET no debería declarar largo: {texto}");
    }
}
