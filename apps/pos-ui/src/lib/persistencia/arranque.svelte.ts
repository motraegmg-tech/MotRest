/**
 * Arranque de la aplicación: abre el almacén local, rehidrata los stores desde
 * el event log y, si no hay nada guardado, siembra la demostración.
 *
 * A partir de aquí recargar el navegador ya no pierde la operación.
 */
import {
  compararEventos,
  esEventoIdentidad,
  type EventoBase,
  type EventoAsistencia,
  type EventoCaja,
  type EventoCliente,
  type EventoComanda,
  type EventoCompra,
  type EventoCorreo,
  type EventoEgreso,
  type EventoFiscal,
  type EventoInventario,
  type EventoOpinion,
  type EventoReserva,
  type EventoPrenomina,
  type EventoSocio,
  type EventoTesoreria,
  TIPOS_EVENTO_COMANDA,
  TIPOS_EVENTO_CORREO,
  TIPOS_EVENTO_SOCIO,
  TIPOS_EVENTO_FISCAL,
  TIPOS_EVENTO_TESORERIA,
} from "@motrest/dominio";
import { almacenEnMemoria, almacenIndexedDB, type Almacen } from "@motrest/protocolo-sync";
import { asignaciones } from "../asignaciones.svelte";
import { asistencia } from "../asistencia.svelte";
import { caja } from "../caja.svelte";
import { clientes } from "../clientes.svelte";
import { egresos } from "../egresos.svelte";
import { tesoreria } from "../tesoreria.svelte";
import { compras } from "../compras.svelte";
import { opiniones } from "../opiniones.svelte";
import { reservas } from "../reservas.svelte";
import { correo } from "../correo.svelte";
import { facturacion } from "../facturacion.svelte";
import { actualizaciones } from "../actualizaciones.svelte";
import { benchmark } from "../benchmark.svelte";
import { grupo } from "../grupo.svelte";
import { licencia } from "../licencia.svelte";
import { modoAbierto } from "../modo-abierto.svelte";
import { autofactura } from "../autofactura.svelte";
import { canales } from "../canales.svelte";
import { prenomina } from "../prenomina.svelte";
import { socios } from "../socios.svelte";
import { cartaVacia, catalogo, impuestos } from "../catalogo";
import { menuDemostracion } from "../demo/carta";
import { esLaCaja } from "../entorno";
import { fiscal } from "../fiscal.svelte";
import { impresion } from "../impresion.svelte";
import { existenciasDemo } from "../insumos";
import { inventario } from "../inventario.svelte";
import { local } from "../local.svelte";
import { menu } from "../menu.svelte";
import { plano } from "../plano.svelte";
import { MODO_DEMO } from "../presentacion";
import { pos, fabricaPos } from "../pos.svelte";
import { sembrarSalon } from "../semilla";
import { sesion } from "../sesion/sesion.svelte";
import { sync } from "../sync.svelte";

/** Eventos de comanda reconocidos, para separar el log por familia. */
/**
 * Los tipos de comanda salen del DOMINIO, no de una copia aquí.
 *
 * La copia que había se quedó corta: le faltaban `cambio_visto`,
 * `descuento_retirado` y `pago_corregido`. Esos eventos llegaban del Hub y
 * el reparto los tiraba en silencio, así que ni se integraban en vivo ni se
 * rehidrataban al arrancar. La lista del dominio va tipada, de modo que si
 * mañana falta uno lo dice el compilador.
 */
const TIPOS_COMANDA = new Set<string>(TIPOS_EVENTO_COMANDA);

/**
 * Eventos del ciclo fiscal (CFDI), emisión y cancelación.
 *
 * Sale del dominio y no de una lista escrita aquí: la de antes estaba completa,
 * pero eso era suerte —nada obligaba a mantenerla—, y la de reservas de un poco
 * más abajo demuestra lo que pasa cuando la suerte se acaba.
 *
 * Y ojo con el uso, que era el verdadero fallo: este conjunto solo filtraba la
 * HIDRATACIÓN de arranque. El reparto en vivo no tenía rama fiscal, así que un
 * `cfdi_timbrado` recién llegado se guardaba en disco y no se pintaba hasta
 * recargar. Ahora los dos caminos miran la misma lista.
 */
const TIPOS_FISCALES = new Set<string>(TIPOS_EVENTO_FISCAL);

/**
 * Cuánto se espera antes de empujar lo que se acaba de anotar.
 *
 * Un cobro escribe varios eventos seguidos —el pago, el cierre de la cuenta, el
 * consumo de insumos—; sin esta pausa saldrían tres mensajes en el mismo
 * suspiro. Con ella salen juntos, y un octavo de segundo no lo nota nadie: lo
 * que se estaba notando era el minuto largo hasta que alguien pulsaba F5.
 */
const RETARDO_EMPUJE_MS = 120;

/**
 * HACE QUE LA BANDEJA DE SALIDA SE VACÍE SOLA, DESDE UN ÚNICO PUNTO.
 *
 * ## El defecto que cierra
 *
 * `sync.empujar()` se llamaba desde **un solo sitio** de toda la operación: las
 * comandas. Otros trece almacenes —caja, checador, tesorería, egresos,
 * inventario, compras, clientes, prenómina, opiniones, reservas, socios, fiscal
 * y las altas de usuario— escribían su evento en la bandeja y ahí se quedaba.
 *
 * Una tableta que registraba una checada la guardaba y no la mandaba. Si después
 * tomaba una comanda, todo lo pendiente viajaba de golpe con ella —por eso a
 * veces «sí llegaba»—; y si no, esperaba a la siguiente reconexión. Recargar la
 * página ES una reconexión: de ahí que pulsar F5 «arreglara» las cosas.
 *
 * Es también la explicación del alta de personal que dejó a un local con la
 * credencial en el Hub y sin el usuario: la credencial sale por su propio canal
 * y el evento se quedaba en la bandeja.
 *
 * ## Por qué se envuelve el almacén en vez de tocar los trece almacenes
 *
 * Poner `sync.empujar()` dentro de cada `emitir` daría el mismo resultado hoy y
 * volvería a fallar mañana con el almacén número catorce. El defecto no fue
 * olvidarse una vez: fue que el diseño dependía de acordarse **siempre**. Aquí
 * no hay nada que recordar — cualquier evento que se anote sale.
 *
 * ## Qué NO se reenvía
 *
 * Lo que llega del Hub trae ya su `seq`. Empujarlo sería devolverle lo suyo, y
 * con dos terminales encendidas eso es un lazo que no para. Por eso solo
 * dispara lo que se anota SIN secuencia, que es exactamente lo que nació aquí.
 */
function conEmpujeAutomatico(almacen: Almacen): Almacen {
  const anexarOriginal = almacen.eventos.anexar.bind(almacen.eventos);
  let programado: ReturnType<typeof setTimeout> | null = null;

  almacen.eventos.anexar = async (eventos: readonly EventoBase[]) => {
    await anexarOriginal(eventos);

    const naceAqui = eventos.some((e) => e.seq === undefined);
    if (!naceAqui || programado) return;

    programado = setTimeout(() => {
      programado = null;
      // `empujar` ya se protege sola de no tener enlace y de ir dos veces a la
      // vez; aquí no hace falta mirar el estado del socket.
      sync.empujar();
    }, RETARDO_EMPUJE_MS);
  };

  return almacen;
}

/** Eventos de almacén. */
const TIPOS_INVENTARIO = new Set(["movimiento_inventario", "conteo_registrado"]);

/** Eventos del checador. */
const TIPOS_ASISTENCIA = new Set(["checada_registrada"]);

/** Condiciones laborales: la tarifa por hora de cada quien. */
const TIPOS_PRENOMINA = new Set(["tarifa_asignada", "sueldo_diario_asignado"]);

/** Voz del cliente. */
const TIPOS_OPINION = new Set(["opinion_registrada"]);
/**
 * Reservas (M7). La lista de espera NO viaja: vive solo en su terminal.
 *
 * `reserva_confirmada` FALTABA, y el efecto era peor que el del resto: como este
 * mismo conjunto filtra la hidratación de arranque, ni siquiera recargar lo
 * arreglaba. Una reserva que se acababa de apartar volvía a verse como
 * «solicitada» al reabrir la aplicación, incluso en la terminal que la había
 * confirmado. Es la tercera vez que una lista escrita a mano se queda corta en
 * este archivo.
 */
const TIPOS_RESERVA = new Set([
  "reserva_creada",
  "reserva_confirmada",
  "reserva_sentada",
  "reserva_cancelada",
  "reserva_no_llego",
]);

const TIPOS_EGRESO = new Set(["egreso_registrado", "egreso_pagado", "egreso_anulado"]);

/** Depósitos al banco y ajustes justificados del saldo (M5). */
const TIPOS_TESORERIA = new Set<string>(TIPOS_EVENTO_TESORERIA);

/** Eventos de compras (proveedores y ordenes). */
const TIPOS_COMPRA = new Set([
  "proveedor_registrado",
  "proveedor_actualizado",
  "proveedor_desactivado",
  "orden_compra_creada",
  "orden_compra_recibida",
  "orden_compra_cancelada",
  "equivalencia_aprendida",
]);

/** Eventos de caja (sesión de turno y corte). */
const TIPOS_CAJA = new Set([
  "caja_abierta",
  "movimiento_efectivo",
  "arqueo_registrado",
  "caja_cerrada",
]);

/** Eventos de clientes (ficha del comensal). */
const TIPOS_CLIENTE = new Set([
  "cliente_registrado",
  "cliente_actualizado",
  "cliente_desactivado",
]);

/** Socios e inversionistas del local y sus beneficios (M9). */
const TIPOS_SOCIO = new Set<string>(TIPOS_EVENTO_SOCIO);

/**
 * Los correos al comensal: la petición de la terminal y la respuesta del Hub.
 *
 * Sale de la lista del DOMINIO, que no compila si le falta un tipo. Es la
 * respuesta —`correo_enviado`, `correo_rechazado`— la que no puede perderse
 * aquí: si el reparto la tirara, la ficha diría «Enviando…» de un correo que ya
 * llegó, y quien lo pidió lo volvería a mandar.
 */
const TIPOS_CORREO = new Set<string>(TIPOS_EVENTO_CORREO);

class Arranque {
  cargando = $state(true);
  error = $state("");
  /** true = los datos viven solo en memoria (sin IndexedDB disponible). */
  efimero = $state(false);
  /**
   * true = terminal recién emparejada y todavía sin datos: espera a que el Hub
   * le mande la operación del local en vez de sembrar una demostración propia.
   */
  esperandoHub = $state(false);

  private almacen: Almacen | null = null;

  get repositorio(): Almacen | null {
    return this.almacen;
  }

  async iniciar(): Promise<void> {
    try {
      this.almacen = await almacenIndexedDB();
    } catch (causa) {
      // Navegador en modo privado, permisos denegados… se opera en memoria.
      console.warn("Sin persistencia local; se opera en memoria", causa);
      this.almacen = almacenEnMemoria();
      this.efimero = true;
    }

    this.almacen = conEmpujeAutomatico(this.almacen);

    try {
      const almacen = this.almacen;

      // Plano y menú son CATÁLOGO: se cargan antes que la operación, porque las
      // comandas se agrupan por las mesas del plano y sus renglones se leen
      // contra los productos del menú.
      await plano.hidratar(almacen);
      // El rol de mesas cuelga del plano: se carga junto a él para que el salón
      // ya sepa de quién es cada mesa en el primer pintado.
      await asignaciones.hidratar(almacen);
      /*
       * La carta de la demostración es SOLO para la demostración.
       *
       * Un local nuevo no puede abrir con las pizzas y los precios inventados de
       * otro: habría que borrarlos uno por uno, y el que se escape queda
       * vendible. En producción se arranca con la carta vacía y se carga la real
       * desde Administración → Catálogo, pegándola de una lista.
       */
      /*
       * Un `if` de sentencia y no un ternario: el empaquetador elimina la rama
       * apagada de un `if`, pero conserva la función que cuelga de un ternario
       * —y con ella toda la carta inventada—. Verificado sobre el bundle.
       */
      if (MODO_DEMO) {
        await menu.hidratar(almacen, menuDemostracion());
      } else {
        await menu.hidratar(almacen, cartaVacia());
      }
      await impresion.hidratar(almacen);
      await local.hidratar(almacen);

      // Con qué Hub trabaja esta terminal. Se resuelve ANTES de decidir si
      // sembrar, porque de eso depende la decisión.
      await sync.resolverDestino(almacen);

      /*
       * Quién puede dar de alta al responsable del restaurante.
       *
       * La caja, porque es el equipo del local. Y una terminal que todavía no
       * está enlazada con ningún Hub, porque entonces ella es el local. Una
       * tablet ya emparejada, no: su personal llega por sincronización, y un
       * alta de propietario en el salón le daría el negocio completo a quien
       * tomara la tablet.
       */
      sesion.marcarTerminalPrincipal(esLaCaja() || !sync.configurado);

      const guardados = await almacen.eventos.leerTodos();
      const ordenados = [...guardados].sort(compararEventos);

      /*
       * LA IDENTIDAD SE REHIDRATA SIEMPRE, incluso con el log vacío.
       *
       * Estaba dentro del `else`, y ese detalle dejaba a una terminal que espera
       * al Hub operando contra la SEMILLA compilada en el programa en vez de
       * contra lo que hay en su disco: ni leía las credenciales guardadas ni
       * aplicaba las cuentas de la licencia. En una compilación de desarrollo el
       * síntoma era una pantalla de acceso ofreciendo a «Gonzalo DJA», «Marco» y
       * «Lucía» —los usuarios de juguete— en lugar de la cuenta que el
       * restaurante creó, y con sus PIN de fábrica funcionando.
       *
       * Peor: `conectarAlmacen` guarda los secretos justo después, así que ese
       * mapa de credenciales de juguete se escribía ENCIMA del que tenía el
       * equipo. El PIN elegido por el local no «no se guardaba»: se borraba.
       *
       * Con el log vacío la lista sale vacía, que es la respuesta correcta —y la
       * pantalla ya lo explica: «esta terminal todavía no ha recibido el personal».
       *
       * No basta con excluir las familias conocidas: un tipo nuevo o malformado
       * jamás debe llegar al reducer de identidad.
       */
      await sesion.hidratar(ordenados.filter(esEventoIdentidad), almacen);

      if (guardados.length === 0) {
        // Una terminal que se une a un local existente NO inventa su propio
        // salón: recibe el que ya está operando. Sembrar aquí crearía órdenes
        // distintas para las mismas mesas en cada dispositivo, y el salón
        // aparecería duplicado en cuanto ambos sincronizaran.
        if (sync.configurado) {
          this.esperandoHub = true;
        } else {
          await this.sembrar();
        }
      } else {
        const comanda = ordenados.filter((e) =>
          TIPOS_COMANDA.has((e as EventoComanda).tipo),
        ) as EventoComanda[];

        pos.hidratar(comanda);
        await fiscal.hidratar(
          ordenados.filter((e) => TIPOS_FISCALES.has((e as EventoFiscal).tipo)) as EventoFiscal[],
          almacen,
        );
        inventario.hidratar(
          ordenados.filter((e) =>
            TIPOS_INVENTARIO.has((e as EventoInventario).tipo),
          ) as EventoInventario[],
        );
        asistencia.hidratar(
          ordenados.filter((e) =>
            TIPOS_ASISTENCIA.has((e as EventoAsistencia).tipo),
          ) as EventoAsistencia[],
        );
        tesoreria.hidratar(
          ordenados.filter((e) =>
            TIPOS_TESORERIA.has((e as EventoTesoreria).tipo),
          ) as EventoTesoreria[],
        );
        egresos.hidratar(
          ordenados.filter((e) =>
            TIPOS_EGRESO.has((e as EventoEgreso).tipo),
          ) as EventoEgreso[],
        );
        compras.hidratar(
          ordenados.filter((e) =>
            TIPOS_COMPRA.has((e as EventoCompra).tipo),
          ) as EventoCompra[],
        );
        caja.hidratar(
          ordenados.filter((e) =>
            TIPOS_CAJA.has((e as EventoCaja).tipo),
          ) as EventoCaja[],
        );
        clientes.hidratar(
          ordenados.filter((e) =>
            TIPOS_CLIENTE.has((e as EventoCliente).tipo),
          ) as EventoCliente[],
        );
        prenomina.hidratar(
          ordenados.filter((e) =>
            TIPOS_PRENOMINA.has((e as EventoPrenomina).tipo),
          ) as EventoPrenomina[],
        );
        opiniones.hidratar(
          ordenados.filter((e) =>
            TIPOS_OPINION.has((e as EventoOpinion).tipo),
          ) as EventoOpinion[],
        );
        reservas.hidratar(
          ordenados.filter((e) =>
            TIPOS_RESERVA.has((e as EventoReserva).tipo),
          ) as EventoReserva[],
        );
        socios.hidratar(
          ordenados.filter((e) =>
            TIPOS_SOCIO.has((e as EventoSocio).tipo),
          ) as EventoSocio[],
        );
        correo.hidratarEventos(
          ordenados.filter((e) =>
            TIPOS_CORREO.has((e as EventoCorreo).tipo),
          ) as EventoCorreo[],
        );
      }

      // Migración idempotente: una instalación que ya tenía operación pero
      // todavía no registraba usuarios deja por fin la semilla que el Hub
      // necesita. Una terminal nueva que espera datos del Hub no siembra.
      if (!this.esperandoHub) await this.sembrarUsuarios(almacen);

      // A partir de aquí, cada evento emitido se persiste.
      pos.conectarAlmacen(almacen);
      sesion.conectarAlmacen(almacen);
      plano.conectarAlmacen(almacen);
      asignaciones.conectarAlmacen(almacen);
      fiscal.conectarAlmacen(almacen);
      inventario.conectarAlmacen(almacen);
      menu.conectarAlmacen(almacen);
      asistencia.conectarAlmacen(almacen);
      egresos.conectarAlmacen(almacen);
      await egresos.hidratarPresupuestos(almacen);

      /*
       * LA RETENCIÓN SE APLICA AL ARRANCAR, y solo al arrancar.
       *
       * El restaurante ya podía elegir cuánto historial conservar, pero nadie
       * borraba nada: el ajuste no hacía nada. Aquí es donde surte efecto.
       *
       * Va al abrir la aplicación y no en mitad del servicio: recorrer el log
       * entero mientras alguien cobra sería pagar una limpieza con la fluidez
       * de la caja. Y no se espera —`void`— porque el POS tiene que estar
       * usable ya; la purga termina cuando termine.
       */
      await tesoreria.hidratarArrastre(almacen);
      void pos.purgarHistorial(local.retencionMeses, tesoreria.historialRetiradoHasta).then(async (purga) => {
        if (purga.retirados === 0) return;
        /*
         * EL ARRASTRE VA ANTES QUE EL AVISO.
         *
         * El saldo del restaurante se calcula sumando los cobros, así que
         * retirar cuentas sin arrastrar su dinero lo desploma. Medido: 55 000
         * pesos pasaban a 5 000 al purgar cien cuentas.
         */
        await tesoreria.sumarArrastre(purga.arrastre, almacen);
        console.info(
          `Retención: se retiraron ${purga.cuentas} cuentas (${purga.retirados} registros)`,
        );
      });
      tesoreria.conectarAlmacen(almacen);
      compras.conectarAlmacen(almacen);
      caja.conectarAlmacen(almacen);
      clientes.conectarAlmacen(almacen);
      prenomina.conectarAlmacen(almacen);
      opiniones.conectarAlmacen(almacen);
      reservas.conectarAlmacen(almacen);
      socios.conectarAlmacen(almacen);
      await correo.hidratar(almacen);
      await facturacion.hidratar(almacen);
      // Los datos fiscales del restaurante viajan con la configuración (1.5.6).
      await fiscal.enlazarConLaConfiguracion();
      await canales.hidratar(almacen);
      /*
       * La licencia y las actualizaciones las decide el Hub. Aquí solo se
       * recupera lo último que dijo, para que una terminal que enciende sin red
       * no se comporte como si no supiera nada — ni bloqueando de más ni
       * dejando pasar de más.
       */
      await licencia.hidratar(almacen);
      await modoAbierto.hidratar(almacen);
      await autofactura.hidratar(almacen);
      await actualizaciones.hidratar(almacen);
      await grupo.hidratar(almacen);
      await benchmark.hidratar(almacen);

      // El almacén nace en la etapa 8: un dispositivo con operación anterior no
      // tiene ni un movimiento y abriría el inventario en ceros. Se carga aquí,
      // después de conectar, para que quede persistido como cualquier recepción.
      // Una terminal que espera al Hub no carga nada: el almacén del local ya
      // existe y le llegará por sincronización.
      if (!this.esperandoHub) this.cargarAlmacenInicial();

      // El enlace con el Hub va al final: si no hay Hub, o está apagado, el POS
      // ya quedó listo para operar en isla (TRD R3).
      sesion.alPublicarCredencial = (id, credenciales) =>
        sync.publicarCredencial(id, credenciales);

      sync.iniciar(
        (eventos) => this.aplicarDeOtros(eventos),
        () => void this.sembrarLocalVacio(),
        (credenciales) => void sesion.adoptarCredencialesDelHub(credenciales),
      );
    } catch (causa) {
      this.error = causa instanceof Error ? causa.message : "Error al cargar los datos";
      console.error("Fallo al rehidratar", causa);
    } finally {
      this.cargando = false;
    }
  }

  private async sembrar(): Promise<void> {
    const almacen = this.almacen;
    if (!almacen) return;

    /*
     * El salón sembrado con comandas de ejemplo es SOLO para la demostración.
     * Una instalación real arranca con las mesas vacías: el restaurante dibuja
     * su propio plano y toma sus propios pedidos. Meterle mesa-12 con una pasta
     * al pesto a Rodizio sería confuso el primer día.
     */
    if (MODO_DEMO) {
      const logs = sembrarSalon({
        catalogo,
        impuestoPorDefecto: impuestos[0]!,
        fabrica: fabricaPos,
      });
      const eventos = Object.values(logs).flat();
      await almacen.eventos.anexar(eventos);
      pos.hidratar(eventos.sort(compararEventos));
    } else {
      pos.hidratar([]);
    }

    // La identidad ya se rehidrató al arrancar, con el log completo delante.
    // Volver a hacerlo aquí con una lista vacía la borraría: es justo lo que
    // pasaba al estrenar un local desde una terminal ya emparejada.
    await this.sembrarUsuarios(almacen);
    await fiscal.hidratar([], almacen);
    inventario.hidratar([]);
    egresos.hidratar([]);
    tesoreria.hidratar([]);
    compras.hidratar([]);
    caja.hidratar([]);
    clientes.hidratar([]);
    prenomina.hidratar([]);
    opiniones.hidratar([]);
    reservas.hidratar([]);
    socios.hidratar([]);
  }

  /**
   * Escribe la semilla de usuarios, si es que en esta terminal procede.
   *
   * **Nunca en una terminal enlazada con un Hub**, y esa es la corrección: los
   * usuarios de juguete de la compilación de desarrollo —«Gonzalo DJA», «Marco»
   * y «Lucía», con PIN escritos en el código fuente— se estaban emitiendo como
   * `usuario_creado` en el log del local y viajando al Hub, donde quedaban
   * grabados como personal de verdad. Un programador que arranca `dev:pos`
   * contra el Hub del restaurante le mete tres cuentas que ya no salen solas.
   *
   * Un POS suelto en isla sí los sigue teniendo: es el escenario para el que
   * existen, probar sin dar de alta a nadie, y ahí no contaminan a ningún local.
   * En producción la semilla está vacía, así que esto no cambia nada.
   */
  private async sembrarUsuarios(almacen: Almacen): Promise<void> {
    if (sync.configurado) return;
    await sesion.sembrarUsuariosIniciales(almacen);
  }

  /**
   * Aplica lo que llegó de otras terminales.
   *
   * Los eventos ya se guardaron en el log local; aquí solo se reparten a los
   * stores para que la pantalla se entere. Cada uno reproyecta desde su log, así
   * que reaplicar algo que ya se tenía no rompe nada: las proyecciones son
   * funciones puras del log (ADR-02).
   */
  private aplicarDeOtros(eventos: readonly EventoBase[]): void {
    if (eventos.length === 0) return;
    // Ya llegó la operación del local: la terminal deja de estar en blanco.
    this.esperandoHub = false;
    const ordenados = [...eventos].sort(compararEventos);

    /*
     * EL PERSONAL DEL LOCAL, LO PRIMERO.
     *
     * Faltaba, y era la otra mitad del defecto: una terminal recién enlazada
     * guardaba en su disco los `usuario_creado` que le mandaba el Hub pero no se
     * los daba a nadie, así que la pantalla de acceso seguía enseñando la lista
     * con la que había arrancado hasta que se cerrara y volviera a abrir la
     * aplicación. Va antes que la operación porque las comandas se atribuyen a
     * un empleado y conviene que ese empleado ya exista al pintarlas.
     */
    const identidad = ordenados.filter(esEventoIdentidad);
    if (identidad.length > 0) sesion.integrar(identidad);

    const comanda = ordenados.filter((e) =>
      TIPOS_COMANDA.has((e as EventoComanda).tipo),
    ) as EventoComanda[];
    if (comanda.length > 0) pos.integrar(comanda);

    const inv = ordenados.filter((e) =>
      TIPOS_INVENTARIO.has((e as EventoInventario).tipo),
    ) as EventoInventario[];
    if (inv.length > 0) inventario.integrar(inv);

    const checadas = ordenados.filter((e) =>
      TIPOS_ASISTENCIA.has((e as EventoAsistencia).tipo),
    ) as EventoAsistencia[];
    if (checadas.length > 0) asistencia.integrar(checadas);

    const salidas = ordenados.filter((e) =>
      TIPOS_EGRESO.has((e as EventoEgreso).tipo),
    ) as EventoEgreso[];
    if (salidas.length > 0) egresos.integrar(salidas);

    const dinero = ordenados.filter((e) =>
      TIPOS_TESORERIA.has((e as EventoTesoreria).tipo),
    ) as EventoTesoreria[];
    if (dinero.length > 0) tesoreria.integrar(dinero);

    const compra = ordenados.filter((e) =>
      TIPOS_COMPRA.has((e as EventoCompra).tipo),
    ) as EventoCompra[];
    if (compra.length > 0) compras.integrar(compra);

    const cajaEv = ordenados.filter((e) =>
      TIPOS_CAJA.has((e as EventoCaja).tipo),
    ) as EventoCaja[];
    if (cajaEv.length > 0) caja.integrar(cajaEv);

    const clientesEv = ordenados.filter((e) =>
      TIPOS_CLIENTE.has((e as EventoCliente).tipo),
    ) as EventoCliente[];
    if (clientesEv.length > 0) clientes.integrar(clientesEv);

    const nomina = ordenados.filter((e) =>
      TIPOS_PRENOMINA.has((e as EventoPrenomina).tipo),
    ) as EventoPrenomina[];
    if (nomina.length > 0) prenomina.integrar(nomina);

    const opina = ordenados.filter((e) =>
      TIPOS_OPINION.has((e as EventoOpinion).tipo),
    ) as EventoOpinion[];
    if (opina.length > 0) opiniones.integrar(opina);

    const reserva = ordenados.filter((e) =>
      TIPOS_RESERVA.has((e as EventoReserva).tipo),
    ) as EventoReserva[];
    if (reserva.length > 0) reservas.integrar(reserva);

    const socio = ordenados.filter((e) =>
      TIPOS_SOCIO.has((e as EventoSocio).tipo),
    ) as EventoSocio[];
    if (socio.length > 0) socios.integrar(socio);

    /* La respuesta del Hub a un correo pedido desde la ficha o desde Reservas. */
    const correos = ordenados.filter((e) =>
      TIPOS_CORREO.has((e as EventoCorreo).tipo),
    ) as EventoCorreo[];
    if (correos.length > 0) correo.integrar(correos);

    /*
     * Los comprobantes. El Hub publica el `cfdi_timbrado` en cuanto el PAC
     * contesta —textualmente «para que la caja lo vea»— y esta rama no existía:
     * el evento llegaba, se guardaba en disco y la factura solo aparecía tras
     * recargar.
     */
    const cfdi = ordenados.filter((e) =>
      TIPOS_FISCALES.has((e as EventoFiscal).tipo),
    ) as EventoFiscal[];
    if (cfdi.length > 0) fiscal.integrar(cfdi);
  }

  /**
   * El Hub existe pero el local está en blanco: esta terminal lo abre.
   *
   * Una terminal emparejada no siembra, porque lo normal es que se una a un
   * local que ya opera. Pero si el Hub no tiene ni un evento nadie va a
   * mandarle nada nunca, y quedarse esperando sería un cuelgue silencioso. La
   * primera terminal que llega a un local vacío es la que lo pone en marcha.
   */
  private async sembrarLocalVacio(): Promise<void> {
    if (!this.esperandoHub || !this.almacen) return;
    this.esperandoHub = false;

    await this.sembrar();
    /*
     * Y ESTA TERMINAL PUEDE DAR DE ALTA AL RESPONSABLE.
     *
     * La regla general —una tablet emparejada no crea propietarios— protege al
     * negocio de quien tome la tablet del salón. Aquí no hay negocio que
     * proteger: el Hub acaba de decir que no tiene ni un evento, así que este
     * local no ha abierto nunca y alguien tiene que crear la primera cuenta.
     * Sin esto, una terminal enlazada a un Hub estrenado se quedaba sin
     * usuarios, sin alta y sin salida: «esta terminal todavía no ha recibido el
     * personal del restaurante» para siempre.
     */
    sesion.marcarTerminalPrincipal(true);
    this.cargarAlmacenInicial();
    // Lo sembrado sale hacia el Hub como cualquier otra operación.
    sync.empujar();
  }

  /**
   * Siembra las existencias de arranque, una sola vez, como una recepción de
   * compra: así el almacén se explica desde su primer movimiento y no aparece
   * como un saldo caído del cielo.
   */
  private cargarAlmacenInicial(): void {
    // Las existencias de arranque apuntan a los insumos de la DEMOSTRACIÓN. En
    // un local real esos insumos no existen, así que cargarlas no movería nada
    // y solo dejaría movimientos huérfanos en la bitácora.
    if (!MODO_DEMO || inventario.activo) return;
    for (const [insumoId, cantidad] of existenciasDemo()) {
      inventario.registrar(insumoId, cantidad, "recepcion", "Carga inicial del almacén");
    }
  }

  /** Borra todo lo guardado y recarga con la demostración de origen. */
  async reiniciarDemostracion(): Promise<void> {
    if (!this.almacen) return;
    await this.almacen.eventos.limpiar();
    await this.almacen.estado.limpiar();
    location.reload();
  }
}

export const arranque = new Arranque();
