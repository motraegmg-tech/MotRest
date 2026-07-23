/**
 * Genera el documento de trámites fiscales de MotRest.
 *
 * Se produce con código y no a mano para que se pueda regenerar cuando cambie
 * algo del SAT o del PAC contratado, sin rehacer el formato.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { writeFileSync } from "node:fs";

const NARANJA = "F2853A";
const ROJO = "E0392B";
const PIZARRA = "14181A";
const GRIS = "5A666C";
const CLARO = "FDF1E8";

const TITULO = "Space Grotesk";
const CUERPO = "Inter";

// --- Piezas reutilizables ----------------------------------------------------------------

const h1 = (texto) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [
      new TextRun({ text: texto, font: TITULO, size: 32, bold: true, color: PIZARRA }),
    ],
  });

const h2 = (texto) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 140 },
    children: [
      new TextRun({ text: texto, font: TITULO, size: 26, bold: true, color: NARANJA }),
    ],
  });

const h3 = (texto) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [
      new TextRun({ text: texto, font: TITULO, size: 22, bold: true, color: PIZARRA }),
    ],
  });

/** Párrafo con negritas embebidas: el texto usa **así**. */
const p = (texto, opciones = {}) =>
  new Paragraph({
    spacing: { after: opciones.after ?? 120, line: 280 },
    alignment: opciones.centrado ? AlignmentType.CENTER : AlignmentType.LEFT,
    indent: opciones.sangria ? { left: 360 } : undefined,
    children: partir(texto, opciones),
  });

function partir(texto, opciones = {}) {
  return texto.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((trozo) => {
    const negrita = trozo.startsWith("**") && trozo.endsWith("**");
    return new TextRun({
      text: negrita ? trozo.slice(2, -2) : trozo,
      bold: negrita || opciones.bold,
      font: opciones.mono ? "Consolas" : CUERPO,
      size: opciones.size ?? 21,
      color: opciones.color ?? PIZARRA,
      italics: opciones.italica,
    });
  });
}

const punto = (texto, nivel = 0) =>
  new Paragraph({
    bullet: { level: nivel },
    spacing: { after: 80, line: 276 },
    children: partir(texto),
  });

const numerado = (texto, referencia) =>
  new Paragraph({
    numbering: { reference: referencia, level: 0 },
    spacing: { after: 100, line: 276 },
    children: partir(texto),
  });

/** Recuadro de advertencia: lo que cuesta caro pasar por alto. */
const aviso = (titulo, texto, color = ROJO) =>
  new Paragraph({
    spacing: { before: 160, after: 200, line: 280 },
    shading: { type: ShadingType.CLEAR, fill: color === ROJO ? "FDECEA" : CLARO },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color, space: 12 },
      top: { style: BorderStyle.SINGLE, size: 2, color: "FFFFFF", space: 8 },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "FFFFFF", space: 8 },
      right: { style: BorderStyle.SINGLE, size: 2, color: "FFFFFF", space: 8 },
    },
    children: [
      new TextRun({ text: `${titulo}  `, bold: true, font: CUERPO, size: 21, color }),
      ...partir(texto, { size: 21 }),
    ],
  });

const celda = (texto, { encabezado = false, ancho = 25, mono = false } = {}) =>
  new TableCell({
    width: { size: ancho, type: WidthType.PERCENTAGE },
    shading: encabezado ? { type: ShadingType.CLEAR, fill: PIZARRA } : undefined,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    children: [
      new Paragraph({
        spacing: { after: 0, line: 260 },
        children: partir(texto, {
          size: 19,
          bold: encabezado,
          color: encabezado ? "FFFFFF" : PIZARRA,
          mono,
        }),
      }),
    ],
  });

const tabla = (filas, anchos) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "D9DEE1" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "D9DEE1" },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E8ECEE" },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: filas.map(
      (fila, i) =>
        new TableRow({
          tableHeader: i === 0,
          children: fila.map((c, j) =>
            celda(c, { encabezado: i === 0, ancho: anchos[j] }),
          ),
        }),
    ),
  });

const espacio = (alto = 160) => new Paragraph({ spacing: { after: alto }, children: [] });

// --- Contenido ---------------------------------------------------------------------------

const contenido = [];

// Portada
contenido.push(
  new Paragraph({ spacing: { before: 2400, after: 0 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "MOTRAE", font: TITULO, size: 30, bold: true, color: NARANJA }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: "MotRest · Software Restaurantero ERP",
        font: CUERPO,
        size: 20,
        color: GRIS,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 140 },
    children: [
      new TextRun({
        text: "Puesta en marcha de la facturación",
        font: TITULO,
        size: 48,
        bold: true,
        color: PIZARRA,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 500 },
    children: [
      new TextRun({
        text: "Obtención del CSD y contratación del PAC",
        font: TITULO,
        size: 26,
        color: NARANJA,
      }),
    ],
  }),
  p(
    "Los dos únicos pasos de la facturación que no dependen del software. Todo lo demás —generar el comprobante, sellarlo, encolarlo y timbrarlo— ya está construido y probado en MotRest.",
    { centrado: true },
  ),
  espacio(600),
  p("Documento operativo · 23 de julio de 2026", { centrado: true, color: GRIS, size: 19 }),
  new Paragraph({ children: [new PageBreak()] }),
);

// --- Para qué sirve este documento -------------------------------------------------------

contenido.push(
  h1("Para qué sirve este documento"),
  p(
    "MotRest ya sabe facturar: arma el comprobante CFDI 4.0, calcula la cadena original, la sella con el certificado del restaurante, la guarda en una cola que sobrevive a un apagón y la timbra en cuanto hay conexión. Nada de eso requiere intervención.",
  ),
  p(
    "Pero un sistema de facturación no puede fabricar dos cosas: **el certificado que identifica al contribuyente ante el SAT** y **el contrato con quien está autorizado a certificar las facturas**. Ambos son trámites externos, con sus tiempos y sus requisitos.",
  ),
  p("Este documento los desarma paso a paso, en el orden en que hay que hacerlos."),
  espacio(),

  h3("Cómo encajan las piezas"),
  tabla(
    [
      ["Pieza", "Quién la aporta", "Para qué"],
      [
        "**CSD** (.cer y .key)",
        "El SAT, a nombre del restaurante",
        "Firmar cada factura. Es la firma fiscal del negocio.",
      ],
      [
        "**PAC**",
        "Un proveedor privado autorizado",
        "Certificar la factura ante el SAT y asignarle su folio fiscal (UUID).",
      ],
      [
        "**MotRest**",
        "MOTRAE (ya entregado)",
        "Generar el comprobante, sellarlo, encolarlo y enviarlo al PAC.",
      ],
    ],
    [24, 30, 46],
  ),
  espacio(),
  aviso(
    "Orden recomendado.",
    "Primero el CSD, después el PAC. Varios PAC piden el CSD para dar de alta el RFC en su plataforma, así que hacerlo al revés obliga a esperar de todas formas.",
    NARANJA,
  ),
  new Paragraph({ children: [new PageBreak()] }),
);

// --- PARTE 1: CSD ------------------------------------------------------------------------

contenido.push(
  h1("Parte 1 · Obtener el Certificado de Sello Digital"),
  p(
    "El CSD es un par de archivos que el SAT emite a nombre del contribuyente. Con la llave privada se firma cada factura; sin él no se puede emitir ninguna.",
  ),

  h2("Antes de empezar: qué hace falta tener"),
  tabla(
    [
      ["Requisito", "Cómo se comprueba"],
      [
        "**RFC activo** con obligación de expedir comprobantes",
        "Constancia de Situación Fiscal vigente",
      ],
      [
        "**e.firma vigente** (antes FIEL): archivos .cer, .key y su contraseña",
        "Se valida en el portal del SAT al entrar a CertiSAT",
      ],
      [
        "**Régimen fiscal** y **código postal** fiscal correctos",
        "Constancia de Situación Fiscal",
      ],
      [
        "**Buzón Tributario** habilitado con medios de contacto confirmados",
        "Portal del SAT",
      ],
    ],
    [55, 45],
  ),
  espacio(),
  aviso(
    "La e.firma NO es el CSD.",
    "Es la confusión más común y cuesta un día. La e.firma sirve para hacer trámites ante el SAT —incluido pedir el CSD—; el CSD sirve para facturar. MotRest rechaza una e.firma con un mensaje explícito, pero conviene saberlo antes.",
  ),
  p(
    "Si la e.firma está vencida o el certificado fue revocado, hay que renovarla primero, y eso puede requerir cita presencial. **Compruébalo antes que nada**: es lo único de este proceso que puede tardar días.",
  ),

  h2("Paso a paso"),

  h3("1. Descargar la aplicación Certifica"),
  numerado("Entra a **sat.gob.mx** y busca la herramienta **Certifica**.", "pasos1"),
  numerado(
    "Descarga la versión que corresponda a tu equipo (32 o 64 bits). Es una aplicación de escritorio en Java; no requiere instalación.",
    "pasos1",
  ),
  p(
    "Certifica es lo que antes se llamaba SOLCEDI. Sirve para generar el archivo de solicitud y, sobre todo, **para generar tu llave privada en tu propia computadora**: esa llave nunca viaja al SAT.",
    { sangria: true },
  ),

  h3("2. Generar el requerimiento y la llave privada"),
  numerado("Abre Certifica y elige **Solicitud de Certificados de Sello Digital**.", "pasos2"),
  numerado(
    "Carga tu **e.firma** (.cer y .key) y escribe su contraseña para identificarte.",
    "pasos2",
  ),
  numerado(
    "Captura el **nombre de la sucursal o unidad** —por ejemplo, «Rodizio Centro»— y define la **contraseña de la clave privada del CSD**.",
    "pasos2",
  ),
  numerado("Mueve el ratón dentro de la ventana para generar entropía y firma la solicitud.", "pasos2"),
  numerado("Guarda los dos archivos que produce.", "pasos2"),
  espacio(80),
  tabla(
    [
      ["Archivo", "Qué es", "Qué hacer con él"],
      [
        "**.req**",
        "El requerimiento: la solicitud pública",
        "Se sube al SAT en el paso 3. Después ya no sirve.",
      ],
      [
        "**.key**",
        "Tu llave privada",
        "**GUÁRDALA.** El SAT no la tiene ni te la puede reponer.",
      ],
    ],
    [16, 38, 46],
  ),
  espacio(),
  aviso(
    "La contraseña de la clave privada no se puede recuperar.",
    "La eliges tú en este paso y el SAT no la guarda en ningún lado. Si se pierde, el CSD queda inservible y hay que revocarlo y tramitar uno nuevo desde cero. Anótala en el gestor de contraseñas antes de continuar, no después.",
  ),
  p(
    "**Recomendación de contraseña:** entre 8 y 255 caracteres, sin acentos ni eñes. Algunos sistemas antiguos tienen problemas con caracteres especiales poco comunes; letras, números y guiones bajos son la apuesta segura.",
  ),

  h3("3. Enviar la solicitud en CertiSAT Web"),
  numerado(
    "Entra a **CertiSAT Web** desde el portal del SAT y accede con tu **e.firma**.",
    "pasos3",
  ),
  numerado("Elige **Solicitud de Certificados de Sello Digital**.", "pasos3"),
  numerado("Sube el archivo **.req** que generó Certifica.", "pasos3"),
  numerado("Firma el envío con tu e.firma y guarda el **número de operación** que aparece.", "pasos3"),

  h3("4. Descargar el certificado"),
  numerado(
    "Vuelve a CertiSAT Web, a **Recuperación de certificados**, y busca por RFC.",
    "pasos4",
  ),
  numerado(
    "Localiza el certificado nuevo por su fecha y descarga el archivo **.cer**.",
    "pasos4",
  ),
  numerado(
    "Anota su **número de certificado**: son 20 dígitos y es el que MotRest mostrará en pantalla, así que sirve para verificar que se cargó el correcto.",
    "pasos4",
  ),
  p(
    "Suele estar disponible en minutos, aunque el SAT se reserva hasta 24 horas. Si no aparece, vuelve a intentarlo más tarde antes de rehacer la solicitud: **generar un segundo CSD no cancela el primero** y acabarías con dos, que es como empiezan las confusiones de archivos.",
    { sangria: true },
  ),

  h3("5. Verificar que quedó bien"),
  p("Antes de darlo por terminado, comprueba que tienes las tres cosas:"),
  punto("El archivo **.cer** descargado del SAT."),
  punto("El archivo **.key** que generó Certifica en tu computadora."),
  punto("La **contraseña** de la clave privada, anotada donde no se pierda."),
  p(
    "Los tres van juntos. Un .cer sin su .key no sirve, y un .key sin su contraseña tampoco.",
  ),
  new Paragraph({ children: [new PageBreak()] }),

  h2("Custodia: dónde vive el CSD y dónde no"),
  p(
    "El CSD es, en la práctica, la firma del restaurante. Quien tenga la llave privada y su contraseña puede emitir facturas a nombre del negocio. Se trata en consecuencia.",
  ),
  tabla(
    [
      ["Dónde", "¿Correcto?", "Por qué"],
      [
        "**En la caja**, cargado en MotRest",
        "Sí",
        "Es donde se sella. Queda con permisos de solo-el-dueño y no se sincroniza a ninguna otra terminal.",
      ],
      [
        "**Copia de respaldo** en un gestor de contraseñas o USB bajo llave",
        "Sí",
        "Si el disco de la caja muere, sin respaldo hay que tramitar un CSD nuevo.",
      ],
      [
        "**Por WhatsApp o correo**",
        "No",
        "Queda copiado en servidores ajenos y en el teléfono de cualquiera del grupo, indefinidamente.",
      ],
      [
        "**En las tablets del piso**",
        "No",
        "MotRest no lo envía ahí a propósito. Cada tablet perdida sería la firma fiscal en la calle.",
      ],
      [
        "**En manos de MOTRAE**",
        "No",
        "MOTRAE no necesita el CSD para nada y no debe tenerlo. Si alguien lo pide en nombre de MOTRAE, no lo entregues.",
      ],
    ],
    [30, 14, 56],
  ),
  espacio(),
  aviso(
    "MOTRAE nunca pide tu CSD.",
    "El diseño de MotRest lo mantiene dentro del restaurante precisamente para que no haya que confiárselo a nadie. Cualquier solicitud en sentido contrario es motivo para detenerse y verificar por otro canal.",
    NARANJA,
  ),

  h2("Cargarlo en MotRest"),
  p("Ya con los tres elementos, la carga toma un minuto:"),
  numerado(
    "Abre MotRest en la caja y entra con un perfil autorizado. **Solo quien tenga el permiso «Administrar el CSD» puede hacerlo** —está separado a propósito de «Emitir facturas», que sí tiene el personal de caja—.",
    "carga",
  ),
  numerado("Ve a **Finanzas y facturación**.", "carga"),
  numerado(
    "Comprueba que los **datos fiscales del restaurante** estén completos y correctos: el RFC de ahí se coteja contra el del certificado.",
    "carga",
  ),
  numerado("En **Certificado de Sello Digital**, sube el .cer y el .key y escribe la contraseña.", "carga"),
  numerado("Pulsa **Instalar certificado**.", "carga"),
  espacio(80),
  p("MotRest comprueba cuatro cosas antes de guardar nada:"),
  punto("Que el .cer y el .key sean **pareja** —se firma y se verifica de verdad—."),
  punto("Que el **RFC** del certificado coincida con el del emisor."),
  punto("Que el certificado esté **vigente**."),
  punto(
    "Que su número de serie tenga los **20 dígitos** del Anexo 20, que es lo que distingue un CSD de una e.firma.",
  ),
  p(
    "Si algo falla, lo dice en palabras y **no guarda nada**. Es a propósito: descubrir un CSD equivocado con el comensal esperando su factura es el peor momento posible.",
  ),

  h2("Vigencia y renovación"),
  p(
    "Un CSD dura **cuatro años**. MotRest muestra los días restantes en la misma pantalla y avisa en su bitácora cuando quedan menos de 30 días.",
  ),
  aviso(
    "El día que vence, la facturación se detiene.",
    "No hay periodo de gracia. Tramita el nuevo con al menos un mes de anticipación: el proceso es idéntico al de la primera vez y se puede hacer sin tocar el CSD en uso.",
  ),
  p(
    "**Artículo 17-H Bis.** El SAT puede restringir temporalmente un CSD por irregularidades —discrepancias en declaraciones, domicilio no localizado, entre otras—. El efecto es el mismo que un vencimiento: deja de timbrarse. Si ocurre, MotRest seguirá vendiendo y encolando facturas, pero la restricción se resuelve ante el SAT, no en el software. Mantener las obligaciones al día es la única prevención.",
  ),
  new Paragraph({ children: [new PageBreak()] }),
);

// --- PARTE 2: PAC ------------------------------------------------------------------------

contenido.push(
  h1("Parte 2 · Contratar el PAC"),
  p(
    "Un **Proveedor Autorizado de Certificación** es una empresa privada con autorización del SAT para certificar comprobantes. Es el único camino: ninguna factura tiene validez fiscal hasta que un PAC le asigna su folio fiscal.",
  ),
  p(
    "MotRest **sella localmente y el PAC solo timbra**, de modo que el CSD nunca sale del restaurante. Esto es relevante al contratar: hay PAC que ofrecen «timbrado con su certificado», lo que implica entregarles la llave. No hace falta.",
  ),

  h2("Cómo elegir"),
  p(
    "El precio por timbre es lo primero que se mira y no es lo más importante. Un restaurante emite pocas facturas comparado con su volumen de tickets —solo factura quien la pide—, así que la diferencia entre proveedores rara vez pasa de unos cientos de pesos al año. Lo que sí duele es un PAC caído un viernes por la noche.",
  ),
  espacio(80),
  tabla(
    [
      ["Criterio", "Qué preguntar", "Por qué importa"],
      [
        "**Vigencia de los timbres**",
        "¿Los timbres del paquete caducan? ¿En cuánto tiempo?",
        "Algunos caducan al año. Un restaurante que factura poco puede perder lo comprado.",
      ],
      [
        "**Ambiente de pruebas**",
        "¿Hay sandbox gratuito con credenciales inmediatas?",
        "Permite validar toda la integración antes de emitir una factura real.",
      ],
      [
        "**Consulta de CFDI timbrados**",
        "¿Puedo recuperar por API un CFDI que ya timbraron?",
        "**Importante.** Es lo que permite a MotRest resolver solo el caso de una factura timbrada cuyo acuse se perdió. Ver la sección siguiente.",
      ],
      [
        "**Cancelación por API**",
        "¿Se cancela desde la API, con los motivos del SAT?",
        "Cancelar a mano en el portal del PAC no escala.",
      ],
      [
        "**Soporte en horario real**",
        "¿Atienden viernes por la noche y fines de semana?",
        "Es cuando el restaurante factura. Un soporte de 9 a 6 entre semana no sirve.",
      ],
      [
        "**Tipo de API**",
        "¿REST o SOAP?",
        "MotRest está construido para REST. SOAP funciona, pero requiere trabajo adicional de integración.",
      ],
      [
        "**Precio por timbre**",
        "Costo por paquete y su vigencia",
        "Último criterio, no el primero.",
      ],
    ],
    [24, 32, 44],
  ),
  espacio(),
  aviso(
    "Verifica que siga autorizado.",
    "El SAT publica y actualiza la lista de PAC autorizados, y algunos pierden la autorización. Antes de firmar, confirma que el proveedor aparezca en la lista vigente del portal del SAT.",
    NARANJA,
  ),

  h3("Proveedores a considerar"),
  p(
    "Los siguientes operan en México y son de uso extendido en el sector. La lista es un punto de partida para pedir cotización, **no una recomendación**: las condiciones cambian y hay que confirmarlas al momento de contratar.",
  ),
  punto("**Finkok** — muy usado por desarrolladores; sandbox accesible."),
  punto("**SW sapien (Smarter Web)** — API REST moderna y documentación clara."),
  punto("**Facturama** — orientado a integraciones sencillas."),
  punto("**Prodigia** — presencia fuerte en el sector restaurantero."),
  punto("**Solución Factible**, **Diverza**, **Formas Digitales**, **Edicom** — alternativas establecidas."),
  espacio(80),
  p(
    "Pide cotización a tres. Al pedirla, menciona explícitamente que necesitas **API REST de timbrado**, **consulta de CFDI ya timbrados** y **ambiente de pruebas**: eso filtra rápido.",
  ),

  h2("Por qué insistir en la consulta de CFDI"),
  p(
    "Existe un caso que ocurre en todo restaurante tarde o temprano: el PAC timbra la factura y, justo entonces, se cae el internet. La factura **existe ante el SAT** pero el restaurante no la recibió.",
  ),
  p(
    "Al reintentar, el PAC responde el error **307 «CFDI previamente timbrado»**. Sin consulta por API, la única salida es que alguien entre al portal del PAC, busque la factura y la descargue a mano.",
  ),
  p(
    "MotRest lo resuelve solo **si el PAC ofrece consulta**: detecta el 307, deja de pedir el timbrado y va por el documento que ya existe, buscándolo por serie, folio, RFC y total. Reintenta con paciencia —el buscador del PAC tarda unos segundos en ver lo recién timbrado— y solo avisa a una persona si de verdad no aparece.",
  ),
  aviso(
    "Es la pregunta que más ahorra a largo plazo.",
    "«¿Puedo recuperar por API un CFDI que ustedes ya timbraron?» Si la respuesta es no, ese caso será siempre trabajo manual.",
    NARANJA,
  ),

  h2("Requisitos para contratar"),
  tabla(
    [
      ["Documento", "Para qué"],
      ["**Constancia de Situación Fiscal** vigente", "Alta del RFC en la plataforma del PAC"],
      ["**RFC y razón social**", "Contrato y facturación del servicio"],
      ["**Correo y teléfono de contacto**", "Credenciales y avisos de saldo"],
      [
        "**e.firma o CSD**",
        "Varios PAC lo piden para asociar el RFC emisor a la cuenta",
      ],
      ["**Forma de pago**", "Compra del paquete de timbres"],
    ],
    [40, 60],
  ),
  espacio(),

  h2("Puesta en marcha técnica"),
  p("Terminado el trámite comercial, el PAC entrega credenciales. Esto es lo que hace falta:"),
  espacio(80),
  tabla(
    [
      ["Dato", "Qué es", "Dónde se configura"],
      [
        "**URL de timbrado**",
        "El endpoint al que se manda el comprobante sellado",
        "Variable `MOTREST_PAC_URL`",
      ],
      [
        "**URL de consulta**",
        "El endpoint para recuperar un CFDI ya timbrado",
        "Variable `MOTREST_PAC_URL_CONSULTA`",
      ],
      [
        "**Token o credencial**",
        "La llave de acceso a la API",
        "Variable `MOTREST_PAC_TOKEN`",
      ],
      [
        "**Documentación de la API**",
        "Nombres exactos de los campos de petición y respuesta",
        "Se coteja contra el adaptador de MotRest",
      ],
    ],
    [24, 38, 38],
  ),
  espacio(),
  aviso(
    "El token es dinero.",
    "Con él se consume el saldo de timbres del restaurante. Va en variables de entorno de la caja, nunca en un archivo compartido, en el repositorio ni en un chat.",
  ),

  h3("Orden de las pruebas"),
  numerado(
    "**Sandbox primero.** Con las credenciales de prueba y el CSD de pruebas que publica el propio SAT, se timbra sin gastar saldo y sin emitir nada real.",
    "pruebas",
  ),
  numerado(
    "**Cotejar el mapeo.** Se comparan los nombres de campo del adaptador de MotRest con la documentación del PAC. Es media hora de trabajo y evita el error más común: un sello correcto rechazado porque el campo se llamaba distinto.",
    "pruebas",
  ),
  numerado(
    "**Una factura real de importe bajo.** Ya en producción, con el CSD del restaurante. Se verifica que el UUID llegue y que el XML se guarde.",
    "pruebas",
  ),
  numerado(
    "**Validarla ante el SAT.** Se comprueba el comprobante en el verificador público del SAT: es la confirmación de que la cadena original y el sello quedaron correctos.",
    "pruebas",
  ),
  numerado(
    "**Servicio completo.** Un viernes real, con facturas de verdad, vigilando la cola en la pantalla de Finanzas.",
    "pruebas",
  ),
  espacio(),
  aviso(
    "Compra el paquete más pequeño al principio.",
    "Hasta confirmar que todo funciona de punta a punta, no tiene sentido comprometer saldo. Ampliar después es inmediato; recuperar timbres caducados de un proveedor que no convenció, no.",
    NARANJA,
  ),
  new Paragraph({ children: [new PageBreak()] }),
);

// --- Parte 3: Plan y listas ---------------------------------------------------------------

contenido.push(
  h1("Parte 3 · Plan de una semana"),
  p(
    "Los dos trámites corren en paralelo. El único que puede tardar de verdad es la renovación de la e.firma, si estuviera vencida — por eso se comprueba el primer día.",
  ),
  espacio(80),
  tabla(
    [
      ["Día", "CSD", "PAC"],
      [
        "**1**",
        "Verificar e.firma vigente y Constancia de Situación Fiscal. Si la e.firma está vencida, agendar cita **hoy**.",
        "Pedir cotización a tres proveedores con los tres requisitos clave.",
      ],
      [
        "**2**",
        "Descargar Certifica, generar el .req y el .key. Anotar la contraseña en el gestor.",
        "Comparar respuestas. Confirmar que estén en la lista vigente del SAT.",
      ],
      [
        "**3**",
        "Subir el .req en CertiSAT y descargar el .cer.",
        "Contratar y pedir credenciales de **sandbox**.",
      ],
      [
        "**4**",
        "Cargar el CSD en MotRest. Guardar el respaldo.",
        "Cotejar el mapeo de la API y timbrar en sandbox.",
      ],
      [
        "**5**",
        "—",
        "Credenciales de producción. Primera factura real de importe bajo y validación ante el SAT.",
      ],
      [
        "**6 y 7**",
        "—",
        "Servicio completo en Rodizio vigilando la cola de timbrado.",
      ],
    ],
    [10, 45, 45],
  ),
  espacio(),

  h2("Lista de verificación"),
  h3("CSD"),
  punto("e.firma vigente comprobada"),
  punto("Constancia de Situación Fiscal actualizada"),
  punto("Archivo **.key** generado y respaldado"),
  punto("**Contraseña** de la clave privada anotada en el gestor de contraseñas"),
  punto("Archivo **.cer** descargado del SAT"),
  punto("Número de certificado (20 dígitos) anotado"),
  punto("Cargado en MotRest y verificado en pantalla"),
  punto("Respaldo guardado fuera de la caja"),
  punto("Fecha de vencimiento anotada en el calendario, con aviso un mes antes"),
  espacio(80),

  h3("PAC"),
  punto("Tres cotizaciones comparadas"),
  punto("Proveedor confirmado en la lista vigente del SAT"),
  punto("Confirmado que ofrece **consulta de CFDI timbrados** por API"),
  punto("Confirmado el horario de soporte"),
  punto("Contrato firmado y paquete pequeño comprado"),
  punto("Credenciales de sandbox recibidas y probadas"),
  punto("Mapeo de la API cotejado con la documentación"),
  punto("Credenciales de producción configuradas en la caja"),
  punto("Primera factura real emitida y validada ante el SAT"),
  espacio(),

  h2("Preguntas frecuentes"),
  h3("¿Se puede vender sin CSD y sin PAC?"),
  p(
    "Sí, y sin ninguna limitación. MotRest opera el restaurante completo —comandas, cocina, inventario, cortes, tickets— sin nada de esto. Lo único que no puede hacer es entregar una factura con validez fiscal.",
  ),

  h3("¿Qué pasa si se va el internet a media noche del viernes?"),
  p(
    "Nada. El comprobante se sella en la caja, que no necesita conexión, y espera en la cola. El comensal se lleva su ticket. Cuando vuelve la red, se timbra solo. El SAT permite timbrar dentro de las 72 horas siguientes a la emisión, y MotRest avisa mucho antes de agotar ese plazo.",
  ),

  h3("¿Y si se va la luz?"),
  p(
    "La cola vive en disco, no en memoria. Al encender de nuevo, sigue exactamente donde estaba.",
  ),

  h3("¿Hace falta un CSD por sucursal?"),
  p(
    "No es obligatorio: un mismo CSD sirve para todo el RFC. Tener uno por sucursal facilita aislar un problema sin detener a las demás, y es lo recomendable cuando hay varios locales.",
  ),

  h3("¿Quién puede cargar el CSD en MotRest?"),
  p(
    "Solo un perfil con el permiso **«Administrar el CSD»**, que está separado del de emitir facturas. La caja factura todos los días; el certificado con el que se firman todas esas facturas lo instala quien manda.",
  ),

  h3("¿Qué pasa si el CSD vence sin renovarlo?"),
  p(
    "La facturación se detiene ese mismo día, sin periodo de gracia. Las ventas siguen; las facturas se acumulan en la cola hasta que haya un CSD válido. MotRest avisa con 30 días de anticipación.",
  ),
  espacio(400),
  p(
    "MOTRAE · Tecnología y Sistemas · Documento operativo de MotRest",
    { centrado: true, color: GRIS, size: 18 },
  ),
);

// --- Documento ---------------------------------------------------------------------------

const numeracion = ["pasos1", "pasos2", "pasos3", "pasos4", "carga", "pruebas"].map((ref) => ({
  reference: ref,
  levels: [
    {
      level: 0,
      format: "decimal",
      text: "%1.",
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 460, hanging: 280 } } },
    },
  ],
}));

const doc = new Document({
  creator: "MOTRAE",
  title: "MotRest · Puesta en marcha de la facturación",
  description: "Obtención del CSD ante el SAT y contratación del PAC",
  numbering: { config: numeracion },
  styles: {
    default: {
      document: { run: { font: CUERPO, size: 21, color: PIZARRA } },
    },
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: "MOTRAE · MotRest · Puesta en marcha de la facturación",
                  font: CUERPO,
                  size: 16,
                  color: GRIS,
                }),
              ],
            }),
          ],
        }),
      },
      children: contenido,
    },
  ],
});

const salida = process.argv[2];
Packer.toBuffer(doc).then((buffer) => {
  writeFileSync(salida, buffer);
  console.log(`Listo: ${salida} (${Math.round(buffer.length / 1024)} KB)`);
});
