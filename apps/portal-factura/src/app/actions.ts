"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { cerrarSobre, problemaRfc } from "@motrest/dominio";
import { headers } from "next/headers";

export type EstadoSolicitud = 
  | { exito: true; idSolicitud: string }
  | { exito: false; error: string; cerradoPorIntentos?: boolean; vencido?: boolean; estadoActual?: string };

interface DatosFiscales {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCfdi: string;
  correo: string;
}

/*
 * LA FORMA DE LO QUE LLEGA, antes de tocar la base.
 *
 * La clave, el folio y el código vienen de lo que alguien tecleó o de una URL
 * que cualquiera puede escribir. Se pasan a mayúsculas —en el ticket van así, y
 * «rodizio» tecleado en minúsculas no es un intento fallido— y se comprueba su
 * forma: algo que ni siquiera puede ser un folio no merece una consulta, y
 * tampoco puede llegar al contador de intentos, donde un texto de un megabyte
 * se guardaría como llave.
 */
const FORMA_CLAVE = /^[A-Z0-9-]{3,20}$/;
const FORMA_FOLIO = /^[0-9A-Z]{8}$/;
const FORMA_CODIGO = /^[2-9A-HJKMNP-TV-Z]{16}$/;
const FORMA_CP = /^\d{5}$/;
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * La dirección de quien pide. En Vercel, `x-real-ip` es la del cliente y no se
 * puede falsificar; `x-forwarded-for` puede traer varias («cliente, proxy») y
 * la primera es la del cliente.
 */
function direccionDe(h: Headers): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const primera = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (primera || "desconocida").slice(0, 64);
}

export async function solicitarFactura(
  claveTecleada: string,
  folioTecleado: string,
  montoOpcional: number | undefined,
  codigoTecleado: string | undefined,
  datos: DatosFiscales
): Promise<EstadoSolicitud> {
  const ip = direccionDe(await headers());
  const claveLocal = String(claveTecleada ?? "").trim().toUpperCase();
  const folio = String(folioTecleado ?? "").trim().toUpperCase();
  const codigoOpcional = codigoTecleado ? String(codigoTecleado).trim().toUpperCase() : undefined;

  if (problemaRfc(datos.rfc)) {
    return { exito: false, error: "El RFC introducido no es válido." };
  }
  if (!datos.razonSocial || !datos.regimenFiscal || !datos.codigoPostal || !datos.usoCfdi || !datos.correo) {
    return { exito: false, error: "Faltan datos fiscales requeridos." };
  }
  if (datos.razonSocial.trim().length > 300) {
    return { exito: false, error: "La razón social es demasiado larga." };
  }
  if (!FORMA_CP.test(datos.codigoPostal.trim())) {
    return { exito: false, error: "El código postal son 5 dígitos, como en tu constancia." };
  }
  if (!FORMA_CORREO.test(datos.correo.trim()) || datos.correo.length > 200) {
    return { exito: false, error: "Revisa tu correo: ahí te llega la factura." };
  }
  if (
    !FORMA_CLAVE.test(claveLocal) ||
    !FORMA_FOLIO.test(folio) ||
    (codigoOpcional !== undefined && !FORMA_CODIGO.test(codigoOpcional))
  ) {
    return { exito: false, error: "Revisa la clave del restaurante y el folio: están impresos en tu ticket." };
  }

  // Límite 1: Por red (IP), aplica siempre. Máximo 20 en 1 hora.
  const { data: intentoIp } = await supabaseAdmin
    .from("intentos_factura")
    .select("fallos, ultimo_ts")
    .eq("llave", `ip:${ip}`)
    .single();

  if (intentoIp && intentoIp.fallos >= 20) {
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
    if (new Date(intentoIp.ultimo_ts) > haceUnaHora) {
      return { 
        exito: false, 
        error: "Demasiados intentos fallidos. Por seguridad, el acceso desde tu red está bloqueado por 1 hora.",
        cerradoPorIntentos: true 
      };
    }
  }

  // Buscamos la sucursal
  const { data: mapping } = await supabaseAdmin
    .from("claves_de_autofactura")
    .select("sucursal_id")
    .eq("clave", claveLocal)
    .single();

  if (!mapping) {
    await registrarFallo(claveLocal, folio, ip);
    return { exito: false, error: "La clave del restaurante no es válida." };
  }
  const sucursal_id = mapping.sucursal_id;

  // Buscamos el ticket
  const { data: ticket, error: errTicket } = await supabaseAdmin
    .from("tickets_facturables")
    .select("*")
    .eq("sucursal_id", sucursal_id)
    .eq("folio", folio)
    .single();

  if (errTicket || !ticket) {
    await registrarFallo(claveLocal, folio, ip);
    return { exito: false, error: "No se encontró el ticket o los datos son incorrectos." };
  }

  // Verificamos si el código QR es correcto para saltar el bloqueo por ticket
  const codigoCorrecto = !!(codigoOpcional && ticket.codigo === codigoOpcional);

  // Límite 2: Por ticket, se ignora si trae el código QR correcto
  if (!codigoCorrecto) {
    const { data: intentoTicket } = await supabaseAdmin
      .from("intentos_factura")
      .select("fallos, ultimo_ts")
      .eq("llave", `ticket:${claveLocal}:${folio}`)
      .single();

    if (intentoTicket && intentoTicket.fallos >= 5) {
      const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
      if (new Date(intentoTicket.ultimo_ts) > haceUnaHora) {
        return { 
          exito: false, 
          error: "Demasiados intentos fallidos. Por seguridad, el acceso a este ticket está bloqueado por 1 hora.",
          cerradoPorIntentos: true 
        };
      }
    }
  }

  // Validar monto o código
  let esValido = false;
  if (codigoCorrecto) {
    esValido = true;
  } else if (montoOpcional !== undefined && ticket.total === montoOpcional) {
    esValido = true;
  }

  if (!esValido) {
    await registrarFallo(claveLocal, folio, ip);
    return { exito: false, error: "Los datos de comprobación no coinciden con el ticket." };
  }

  // Validar estado y vigencia
  if (new Date() > new Date(ticket.vence_ts)) {
    return { 
      exito: false, 
      error: "Ya pasaron las 72 horas desde su cobro. Debes pedir la factura directamente en el restaurante.", 
      vencido: true 
    };
  }

  if (ticket.estado !== "disponible") {
    const estadoTexto = ticket.estado === 'solicitado' ? 'en proceso de ser timbrado' : 'facturado';
    return { 
      exito: false, 
      error: `El ticket ya fue procesado. Estado actual: ${estadoTexto}.`,
      estadoActual: ticket.estado 
    };
  }

  const { data: pulso } = await supabaseAdmin
    .from("pulsos")
    .select("llave_publica")
    .eq("sucursal_id", sucursal_id)
    .single();

  if (!pulso?.llave_publica) {
    return { exito: false, error: "El restaurante no está configurado para recibir solicitudes de autofactura en este momento." };
  }

  // Formatear datos al contrato de dominio
  const payloadSobre = {
    rfc: datos.rfc.trim().toUpperCase(),
    nombre: datos.razonSocial.trim().toUpperCase(),
    regimen_fiscal: datos.regimenFiscal.trim(),
    codigo_postal: datos.codigoPostal.trim(),
    uso_cfdi: datos.usoCfdi.trim(),
    correo: datos.correo.trim().toLowerCase(),
  };

  let sobreCifrado;
  try {
    sobreCifrado = await cerrarSobre(pulso.llave_publica, JSON.stringify(payloadSobre));
  } catch {
    return { exito: false, error: "Ocurrió un error al cifrar los datos fiscales." };
  }

  const { data: ticketMarcado, error: errUpdate } = await supabaseAdmin
    .from("tickets_facturables")
    .update({ estado: "solicitado" })
    .eq("sucursal_id", sucursal_id)
    .eq("orden_id", ticket.orden_id)
    .eq("estado", "disponible")
    .select("orden_id")
    .single();

  if (errUpdate || !ticketMarcado) {
    return { 
      exito: false, 
      error: "El ticket acaba de ser solicitado desde otra ventana o dispositivo." 
    };
  }

  const { data: nuevaSolicitud, error: errInsert } = await supabaseAdmin
    .from("solicitudes_de_factura")
    .insert({
      sucursal_id: sucursal_id,
      orden_id: ticket.orden_id,
      sobre: sobreCifrado,
    })
    .select("id")
    .single();

  if (errInsert || !nuevaSolicitud) {
    await supabaseAdmin
      .from("tickets_facturables")
      .update({ estado: "disponible" })
      .eq("sucursal_id", sucursal_id)
      .eq("orden_id", ticket.orden_id);
      
    return { exito: false, error: "Ocurrió un error al guardar la solicitud. Intenta de nuevo." };
  }

  return { exito: true, idSolicitud: nuevaSolicitud.id };
}

/**
 * En qué va el ticket, para quien vuelve a abrir su QR (1.5.6).
 *
 * Decisión de Gonzalo: si el SAT rechaza los datos, el comensal se entera en
 * el portal —además de por correo, cuando el restaurante lo tiene configurado—.
 * Así que al abrir el QR otra vez se le dice: en proceso, ya facturado, o por
 * qué no salió la última vez, con el formulario para corregir.
 *
 * SOLO CON EL CÓDIGO DEL QR. Sin él cualquiera podría preguntar por folios
 * ajenos y enterarse de quién pidió factura; un código equivocado cuenta como
 * intento fallido, igual que en `solicitarFactura`.
 */
export type EstadoDelTicket =
  | { estado: "disponible"; rechazo?: string }
  | { estado: "solicitado" }
  | { estado: "facturado" }
  | { estado: "vencido" }
  | { estado: "desconocido" };

export async function consultarTicket(
  claveTecleada: string,
  folioTecleado: string,
  codigoTecleado: string,
): Promise<EstadoDelTicket> {
  const claveLocal = String(claveTecleada ?? "").trim().toUpperCase();
  const folio = String(folioTecleado ?? "").trim().toUpperCase();
  const codigo = String(codigoTecleado ?? "").trim().toUpperCase();
  if (!FORMA_CLAVE.test(claveLocal) || !FORMA_FOLIO.test(folio) || !FORMA_CODIGO.test(codigo)) {
    return { estado: "desconocido" };
  }
  const ip = direccionDe(await headers());

  const { data: mapping } = await supabaseAdmin
    .from("claves_de_autofactura")
    .select("sucursal_id")
    .eq("clave", claveLocal)
    .single();
  if (!mapping) {
    await registrarFallo(claveLocal, folio, ip);
    return { estado: "desconocido" };
  }

  const { data: ticket } = await supabaseAdmin
    .from("tickets_facturables")
    .select("orden_id, codigo, estado, vence_ts")
    .eq("sucursal_id", mapping.sucursal_id)
    .eq("folio", folio)
    .single();
  // El ticket puede no estar TODAVÍA: el Hub lo publica al cobrar, y si el
  // local estuvo sin internet tarda. No es un intento fallido.
  if (!ticket) return { estado: "desconocido" };
  if (ticket.codigo !== codigo) {
    await registrarFallo(claveLocal, folio, ip);
    return { estado: "desconocido" };
  }

  if (ticket.estado === "facturado") return { estado: "facturado" };
  if (ticket.estado === "solicitado") return { estado: "solicitado" };
  if (new Date() > new Date(ticket.vence_ts)) return { estado: "vencido" };

  const { data: ultima } = await supabaseAdmin
    .from("solicitudes_de_factura")
    .select("resultado, error")
    .eq("sucursal_id", mapping.sucursal_id)
    .eq("orden_id", ticket.orden_id)
    .order("creado_ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  return ultima?.resultado === "rechazada" && ultima.error
    ? { estado: "disponible", rechazo: String(ultima.error) }
    : { estado: "disponible" };
}

/**
 * Encuentra el ticket con la clave y el folio y devuelve su total, para que el
 * comensal no tenga que teclearlo (pedido de Gonzalo, sep-2026).
 *
 * El total ya no sirve de comprobación en la entrada manual; lo que frena a
 * quien adivina folios es que un folio son 8 caracteres hexadecimales al azar
 * (más de 4 mil millones) y que cada búsqueda que no encuentra nada cuenta como
 * intento fallido de su red, con el mismo tope de 20 por hora que la solicitud.
 */
export type TicketEncontrado =
  | { ok: true; total: number }
  | { ok: false; error: string };

export async function buscarTicket(claveTecleada: string, folioTecleado: string): Promise<TicketEncontrado> {
  const claveLocal = String(claveTecleada ?? "").trim().toUpperCase();
  const folio = String(folioTecleado ?? "").trim().toUpperCase();
  if (!FORMA_CLAVE.test(claveLocal) || !FORMA_FOLIO.test(folio)) {
    return { ok: false, error: "Revisa la clave del restaurante y el folio: están impresos en tu ticket." };
  }
  const ip = direccionDe(await headers());

  const { data: intentoIp } = await supabaseAdmin
    .from("intentos_factura")
    .select("fallos, ultimo_ts")
    .eq("llave", `ip:${ip}`)
    .single();
  if (intentoIp && intentoIp.fallos >= 20 && new Date(intentoIp.ultimo_ts) > new Date(Date.now() - 60 * 60 * 1000)) {
    return { ok: false, error: "Demasiados intentos fallidos. Por seguridad, el acceso desde tu red está bloqueado por 1 hora." };
  }

  const { data: mapping } = await supabaseAdmin
    .from("claves_de_autofactura")
    .select("sucursal_id")
    .eq("clave", claveLocal)
    .single();
  if (!mapping) {
    await registrarFallo(claveLocal, folio, ip);
    return { ok: false, error: "La clave del restaurante no es válida." };
  }

  const { data: ticket } = await supabaseAdmin
    .from("tickets_facturables")
    .select("total, estado, vence_ts")
    .eq("sucursal_id", mapping.sucursal_id)
    .eq("folio", folio)
    .single();
  if (!ticket) {
    await registrarFallo(claveLocal, folio, ip);
    return {
      ok: false,
      error: "No encontramos ese ticket. Revisa el folio; si acabas de pagar, espera unos minutos y vuelve a intentarlo.",
    };
  }
  if (ticket.estado === "facturado") return { ok: false, error: "Este ticket ya tiene su factura." };
  if (ticket.estado === "solicitado") {
    return { ok: false, error: "La factura de este ticket ya se pidió y está en camino a tu correo." };
  }
  if (new Date() > new Date(ticket.vence_ts)) {
    return { ok: false, error: "Ya pasaron las 72 horas desde su cobro. Pide tu factura directamente en el restaurante." };
  }
  return { ok: true, total: Number(ticket.total) };
}

async function registrarFallo(clave: string, folio: string, ip: string) {
  await supabaseAdmin.rpc("registrar_fallo_autofactura", {
    p_clave: clave,
    p_folio: folio,
    p_ip: ip
  });
}
