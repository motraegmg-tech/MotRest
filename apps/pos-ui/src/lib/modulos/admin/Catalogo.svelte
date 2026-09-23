<script module lang="ts">
  /**
   * M9 · Insumos del almacén y estaciones de cocina.
   *
   * Es la última pieza que estaba escrita en el código. Con esto, dar de alta un
   * restaurante desde cero ya no exige tocar el repositorio.
   *
   * ## Lo que se vende tal cual
   *
   * Aquí viven tres de las cinco entradas al alta de reventa (ver
   * `reventa.svelte.ts`): el importador de la carta aprende a marcar categorías
   * enteras (D), hay una tabla de captura rápida para el refrigerador completo
   * (E) y un insumo ya capturado puede saltar a la carta (B inversa).
   *
   * Todo eso vive en este bloque de módulo y no dentro del componente por una
   * razón práctica: es la parte que hay que poder PROBAR. Un alta que crea un
   * producto, un insumo, una receta y un movimiento de almacén tiene cuatro
   * sitios donde fallar a medias, y una prueba que no pudiera llamarla tendría
   * que reescribir el recorrido entero, que es tanto como no probar nada.
   */
  import {
    UNIDADES,
    formatearCantidad,
    interpretarCarta,
    pesos,
    type BorradorEstacion,
    type BorradorInsumo,
    type CartaImportada,
    type ID,
    type ProblemaMenu,
    type Unidad,
  } from "@motrest/dominio";
  import { mxn } from "../../formato";
  import { inventario } from "../../inventario.svelte";
  import { local } from "../../local.svelte";
  import { menu } from "../../menu.svelte";
  import { rutas } from "../../nav/rutas.svelte";
  import {
    AYUDA_CARGA_RAPIDA,
    CATEGORIA_INSUMO_POR_DEFECTO,
    altaDeReventa,
    estaEnLaCarta,
    ponerEnLaCarta,
  } from "../../reventa.svelte";

  type Vista = "insumos" | "categorias" | "estaciones" | "carta" | "reventa";
  const VISTAS: Vista[] = ["insumos", "categorias", "estaciones", "carta", "reventa"];

  /** Los nombres de categoría se comparan recortados y en minúsculas, como en el importador. */
  function clave(nombre: string): string {
    return nombre.trim().toLowerCase();
  }

  /** Lo que hay que enseñarle al usuario cuando algo no entró, en una frase. */
  function motivoDe(problemas: readonly ProblemaMenu[]): string {
    return problemas
      .filter((p) => p.gravedad === "error")
      .map((p) => p.mensaje)
      .join(". ");
  }

  export interface FalloDeAlta {
    nombre: string;
    motivo: string;
  }

  export interface ResultadoImportacion {
    creados: number;
    categorias: number;
    /** De los creados, cuántos quedaron vinculados a su propio insumo. */
    reventa: number;
    fallos: FalloDeAlta[];
  }

  /**
   * Importa la carta pegada dando de alta como REVENTA lo que caiga en las
   * categorías que el usuario marcó en la previa (propuesta D).
   *
   * ## Por qué no se reimplementa el importador entero
   *
   * `menu.importarCarta` sigue haciendo su trabajo: se le pasa la misma previa
   * con las líneas de reventa quitadas. Crear las categorías es lo delicado
   * —hay que decidir qué texto queda, con qué acentos y qué mayúsculas, y luego
   * volver a encontrarlas por ese mismo texto— y tener dos sitios que lo
   * decidan es tener dos sitios que pueden recortar distinto: el día que uno
   * cambiara, media carta se colgaría de una categoría y la otra media de otra
   * con el mismo nombre. Así hay uno solo, y además las crea TODAS —también las
   * marcadas—, porque `previa.categorias` viaja intacta aunque sus líneas no.
   */
  export function importarCartaConReventa(
    previa: CartaImportada,
    deReventa: ReadonlySet<string>,
  ): ResultadoImportacion {
    const marcadas = new Set([...deReventa].map(clave));
    const esDeReventa = (categoria: string) => marcadas.has(clave(categoria));

    const normales = previa.lineas.filter((l) => !esDeReventa(l.categoria));
    const base = menu.importarCarta({ ...previa, lineas: normales });

    // Las categorías ya existen —las creó la línea de arriba—, así que ahora sí
    // se pueden buscar por nombre para colgar de ellas los productos.
    const porNombre = new Map(menu.categorias.map((c) => [clave(c.nombre), c.id]));
    const impuesto_id = menu.impuestos[0]?.id ?? "";

    const fallos: FalloDeAlta[] = [];
    let reventa = 0;

    for (const categoria of previa.categorias_detectadas) {
      if (!esDeReventa(categoria.nombre)) continue;
      const id = porNombre.get(clave(categoria.nombre));
      if (!id) {
        fallos.push({ nombre: categoria.nombre, motivo: "No se pudo crear la categoría" });
        continue;
      }
      /*
       * La categoría queda MARCADA de reventa (propuesta C). Es la mitad que se
       * olvida: el refresco número treinta y uno se da de alta tres semanas
       * después, a mano, y nadie se acuerda de vincularlo. Marcada la
       * categoría, nace vinculado sin que nadie tenga que acordarse de nada.
       */
      menu.marcarCategoriaDeReventa(id, true);
    }

    for (const linea of previa.lineas) {
      if (linea.estado === "error" || !esDeReventa(linea.categoria)) continue;
      const categoria_id = porNombre.get(clave(linea.categoria));
      if (!categoria_id) continue; // ya se reportó arriba, una vez por categoría

      const r = altaDeReventa({
        nombre: linea.nombre,
        categoria_id,
        // El costo de la línea es lo que cuesta COMPRAR la pieza, que para algo
        // que se vende tal cual es exactamente el costo de su insumo.
        costo: linea.costo,
        precio: linea.precio,
        impuesto_id,
        /*
         * El insumo se guarda en una categoría de despensa con el mismo nombre
         * que la de la carta. Mandarlos todos a «Bebidas» pondría las botellas
         * de vino junto a los refrescos el día que alguien marque también
         * «Vinos»: el almacén se ordena como está ordenada la carta, que es el
         * único orden que el restaurantero ya tiene en la cabeza.
         */
        categoriaInsumo: linea.categoria.trim(),
        // La carta pegada no dice cuántas hay en el refrigerador. Se cargan en
        // «Carga rápida de alimentos y bebidas» o en Inventario; inventar un número sería peor.
      });

      if (r.creado) reventa += 1;
      else
        fallos.push({
          nombre: linea.nombre,
          motivo: motivoDe(r.problemas) || "No se pudo dar de alta",
        });
    }

    return { creados: base.creados + reventa, categorias: base.categorias, reventa, fallos };
  }

  // --- Alta rápida de embotellados (propuesta E) ---------------------------------------

  export interface RenglonRapido {
    id: string;
    nombre: string;
    /** A cómo se compra UNA, en pesos y tal como se teclea. */
    costo: string;
    /** A cómo se vende, con el impuesto dentro. */
    precio: string;
    /** Cuántas hay ahorita en el refrigerador. */
    existencia: string;
  }

  let renglonesCreados = 0;
  export function renglonRapido(): RenglonRapido {
    renglonesCreados += 1;
    return { id: `rr-${renglonesCreados}`, nombre: "", costo: "", precio: "", existencia: "" };
  }

  /** Un renglón que nadie tocó. Ni se valida ni se da de alta: no es un error, es un hueco. */
  export function renglonVacio(r: RenglonRapido): boolean {
    return [r.nombre, r.costo, r.precio, r.existencia].every((v) => v.trim() === "");
  }

  /** Qué le impide a este renglón darse de alta. `null` = está listo. */
  export function problemaDelRenglon(r: RenglonRapido): string | null {
    if (renglonVacio(r)) return null;
    if (r.nombre.trim().length < 2) return "El nombre necesita al menos dos letras";

    const precio = Number(r.precio);
    // Vacío sí es un olvido; «0» es una decisión (se permite desde sep-2026).
    if (r.precio.trim() === "" || !Number.isFinite(precio) || precio < 0) {
      return "Falta a cómo se vende";
    }
    if (r.costo.trim() !== "" && (!Number.isFinite(Number(r.costo)) || Number(r.costo) < 0)) {
      return "No se entiende lo que cuesta";
    }
    if (
      r.existencia.trim() !== "" &&
      (!Number.isFinite(Number(r.existencia)) || Number(r.existencia) < 0)
    ) {
      return "No se entiende cuántas tienes";
    }
    return null;
  }

  /** Lo que no impide el alta pero hay que ver antes de darla. */
  export function avisoDelRenglon(r: RenglonRapido): string | null {
    if (renglonVacio(r) || problemaDelRenglon(r)) return null;
    const costo = Number(r.costo) || 0;
    if (costo <= 0) return "Sin costo: su insumo nace en $0 y el margen saldrá en 100 %";
    if (costo > Number(r.precio)) return "Te cuesta más de lo que la vendes";
    return null;
  }

  export interface ResumenRapido {
    altas: number;
    fallos: FalloDeAlta[];
    /** Lo que hay que devolver a la tabla: lo que falló, tal como se tecleó. */
    pendientes: RenglonRapido[];
  }

  /**
   * Da de alta la tanda entera. Cada renglón son cuatro cosas de una vez:
   * producto, insumo, receta de 1 pz y la existencia que hay ahorita.
   */
  export function altaRapidaDeReventa(
    renglones: readonly RenglonRapido[],
    opciones: { categoria_id: ID; categoriaInsumo: string; impuesto_id: ID },
  ): ResumenRapido {
    const fallos: FalloDeAlta[] = [];
    const pendientes: RenglonRapido[] = [];
    let altas = 0;

    for (const r of renglones) {
      if (renglonVacio(r)) continue;
      const nombre = r.nombre.trim() || "Renglón sin nombre";

      const problema = problemaDelRenglon(r);
      if (problema) {
        pendientes.push(r);
        fallos.push({ nombre, motivo: problema });
        continue;
      }

      const resultado = altaDeReventa({
        nombre: r.nombre.trim(),
        categoria_id: opciones.categoria_id,
        costo: pesos(Number(r.costo) || 0),
        precio: pesos(Number(r.precio)),
        impuesto_id: opciones.impuesto_id,
        existencia: Number(r.existencia) || 0,
        categoriaInsumo: opciones.categoriaInsumo,
      });

      /*
       * El criterio es `creado` y no `ok`.
       *
       * El alta devuelve `ok: false` también cuando el producto SÍ quedó creado
       * y lo único que falló fue sembrar la existencia. Devolver ese renglón a
       * la tabla haría que el usuario lo intentara otra vez y chocara con «ya
       * existe un producto con ese nombre»: se quedaría convencido de que el
       * sistema perdió su captura cuando pasó justo lo contrario.
       */
      if (resultado.creado) {
        altas += 1;
        const pendiente = motivoDe(resultado.problemas);
        if (!resultado.ok && pendiente) fallos.push({ nombre, motivo: pendiente });
        continue;
      }

      pendientes.push(r);
      fallos.push({ nombre, motivo: motivoDe(resultado.problemas) || "No se pudo dar de alta" });
    }

    return { altas, fallos, pendientes };
  }

  /*
   * `estaEnLaCarta` —la inversa de `insumoEspejoDe`— vivía aquí y se mudó a
   * `reventa.svelte.ts`, junto al resto del motor: Inventario y Compras van a
   * querer la misma pregunta, y dos copias de esto acabarían contestando
   * distinto el día que la forma del vínculo cambie.
   */
</script>

<script lang="ts">
  import type { EstacionKds, Insumo } from "@motrest/dominio";
  import Ordenar from "../../listas/Ordenar.svelte";
  import {
    ordenRecordado,
    ordenar,
    ordenesComunes,
    type OpcionOrden,
  } from "../../listas/listas.svelte";
  import { subirAlPrincipio } from "../../subir";

  /*
   * La pestaña se puede pedir desde la URL (`…/catalogo?ver=estaciones`).
   *
   * Existe para poder enlazar aquí desde Cocina → Menú: las estaciones se
   * configuran en esta pantalla, y quien las busca las busca junto al menú. Un
   * enlace que deja al usuario en la pestaña equivocada no resuelve nada.
   */
  const pedida = rutas.actual.params.ver;
  let vista = $state<Vista>(
    VISTAS.includes(pedida as Vista) ? (pedida as Vista) : "insumos",
  );
  let problemas = $state<ProblemaMenu[]>([]);

  /*
   * EL FORMULARIO Y LOS AVISOS ESTÁN ARRIBA; LOS BOTONES QUE LOS LLENAN, ABAJO.
   *
   * Pedido de Gonzalo, con este mismo ejemplo: en Insumos y estaciones se
   * pulsaba «Editar» en un insumo de la mitad de la despensa y el formulario se
   * llenaba arriba, fuera de cuadro, así que parecía que el botón no hacía nada.
   * Lo mismo con lo que sale mal en un renglón —renombrar, mover, dar de baja,
   * ponerlo en la carta—: el motivo se escribe encima de todo, donde nadie
   * estaba mirando. Ver `subir.ts`.
   */
  let raiz = $state<HTMLDivElement | null>(null);

  /** Publica lo que dijo el catálogo y, si dijo algo, sube a enseñarlo. */
  function publicar(lista: ProblemaMenu[]) {
    problemas = lista;
    if (lista.length > 0) subirAlPrincipio(raiz);
  }

  /**
   * Cambiar de pestaña a mano cancela la vuelta automática a Insumos.
   *
   * El regreso se gana yendo del desplegable del insumo a crear la categoría y
   * creándola; si el usuario se desvía por el camino ya no está en ese trámite,
   * y aparecerse en Insumos un rato después sería un salto sin explicación.
   */
  function irA(v: Vista) {
    vista = v;
    problemas = [];
    volverAInsumos = false;
  }

  // --- Insumo en edición ---
  let insumoId = $state<string | null>(null);
  let iNombre = $state("");
  let iUnidad = $state<Unidad>("g");
  let iCostoPesos = $state("");
  let iMinimo = $state("");
  let iCategoria = $state("");

  // --- Estación en edición ---
  let estacionId = $state<string | null>(null);
  let eNombre = $state("");
  let eObjetivo = $state("10");
  let eLimite = $state("15");

  const puedeEditar = $derived(menu.permisos.editarProductos);

  /*
   * Vincular un producto con su insumo es ESCRIBIRLE UNA RECETA de un renglón.
   *
   * Por eso el permiso que manda aquí es el de recetas y no el de productos:
   * sin él `guardarRecetaDe` rechaza el gesto y el alta quedaría a medias —el
   * producto creado, el insumo creado y nada uniéndolos—, que es exactamente el
   * estado inconsistente que todo esto vino a evitar. Mejor no ofrecerlo.
   */
  const puedeVincular = $derived(menu.permisos.editarRecetas);

  function limpiarInsumo() {
    insumoId = null;
    iNombre = "";
    iUnidad = "g";
    iCostoPesos = "";
    iMinimo = "";
    iCategoria = "";
    problemas = [];
  }

  function editarInsumo(id: string) {
    const i = menu.insumos.find((x) => x.id === id);
    if (!i) return;
    insumoId = id;
    iNombre = i.nombre;
    iUnidad = i.unidad_base;
    iCostoPesos = (i.costo_unitario / 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    iMinimo = String(i.stock_minimo);
    iCategoria = i.categoria ?? "";
    problemas = [];
    // Vale igual para el «Editar» de la tabla que para el de una categoría
    // desplegada: los dos llenan el formulario de arriba de Insumos.
    subirAlPrincipio(raiz);
  }

  function guardarInsumo() {
    const borrador: BorradorInsumo = {
      nombre: iNombre,
      unidad_base: iUnidad,
      costo_unitario: pesos(Number(iCostoPesos) || 0),
      stock_minimo: Number(iMinimo) || 0,
      categoria: iCategoria,
    };
    const r = insumoId
      ? menu.actualizarInsumo(insumoId, borrador)
      : menu.crearInsumo(borrador);
    problemas = r.problemas;
    if (r.ok) limpiarInsumo();
  }

  function borrarInsumo(id: string) {
    publicar(menu.borrarInsumo(id).problemas);
  }

  // --- Categorías de insumo -----------------------------------------------------------
  //
  // Pedido de Gonzalo: «ahorita sí se puede llenar qué categoría es el insumo,
  // pero no hay un apartado donde se puedan ver todos los productos de esa
  // categoría, ni agregar, editar, o eliminar categoría».
  //
  // El campo sigue siendo texto en la ficha del insumo —convertirlo en un id
  // obligaría a migrar todo lo capturado en los locales que ya operan— pero
  // ahora existe el catálogo de las que hay, y renombrar una las reescribe
  // todas de golpe.

  let categoriaNueva = $state("");
  /** La categoría que se está renombrando, por su nombre actual. */
  let catEditando = $state<string | null>(null);
  let catNombre = $state("");
  /** Cuál está desplegada, para ver sus insumos. */
  let catAbierta = $state<string | null>(null);
  /** A dónde se mueven los insumos de una categoría que se quiere vaciar. */
  let catDestino = $state("");

  const categorias = $derived(menu.categoriasInsumo);
  const sinCategoria = $derived(menu.insumosSinCategoria);

  /**
   * La tabla de insumos, agrupada por categoría.
   *
   * Era la despensa entera seguida, sin un solo corte — y en la pantalla que
   * administra precisamente las categorías, que es donde peor se veía. Es el
   * mismo tratamiento que ya reciben las existencias y el conteo cíclico en
   * Inventario, y por el mismo motivo: con ciento y pico de insumos, encontrar
   * los quesos era recorrer la pantalla completa.
   *
   * Dos grafías de la misma categoría son UN solo grupo. La categoría se guarda
   * como texto libre en la ficha, así que un local puede tener «Lácteos» en un
   * insumo y «lacteos» en otro; sin este filtro `insumosDe` —que compara sin
   * acentos ni mayúsculas— devolvería los mismos insumos en los dos grupos y la
   * tabla enseñaría dos veces el mismo bote.
   */
  const insumosAgrupados = $derived.by(() => {
    const vistas = new Set<string>();
    const grupos = categorias
      .filter((nombre) => {
        const clave = nombre
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .trim()
          .toLowerCase();
        if (vistas.has(clave)) return false;
        vistas.add(clave);
        return true;
      })
      .map((nombre) => ({ nombre, insumos: menu.insumosDe(nombre) }))
      // Una categoría declarada y vacía no se pinta: un encabezado sin nada
      // debajo solo mete ruido entre los dos que sí tienen algo.
      .filter((g) => g.insumos.length > 0);

    if (sinCategoria.length > 0) {
      grupos.push({ nombre: "Sin categoría", insumos: sinCategoria });
    }
    const opcion = opcionesInsumos.find((o) => o.id === ordenInsumos);
    return grupos.map((g) => ({ ...g, insumos: ordenar(g.insumos, opcion) }));
  });

  // --- «Ordenar» en las tres listas del catálogo (1.5.6, pedido de Gonzalo) -----------
  //
  // Insumos, categorías de insumo y estaciones. Aquí ordenar cambia solo la
  // VISTA de esta terminal —a diferencia de la carta, que es de todos—: el
  // almacén no tiene un orden que alguien más vea. Se recuerda por terminal.
  //
  // Ni los insumos ni las estaciones guardan su fecha de alta, pero sí el orden
  // en que se capturaron (el lugar en el catálogo, el `orden` de la estación):
  // eso es «más recientes / más antiguos», y es el de siempre, así que la
  // pantalla no se abre cambiada.

  const lugarDelInsumo = $derived(new Map(menu.insumos.map((x, i) => [x.id, i])));
  const opcionesInsumos = ordenesComunes<Insumo>({
    nombre: (i) => i.nombre,
    fecha: (i) => lugarDelInsumo.get(i.id),
  });
  let ordenInsumos = $state(ordenRecordado("catalogo.insumos", "antiguos"));

  const opcionesCategorias: OpcionOrden<string>[] = [
    ...ordenesComunes<string>({ nombre: (c) => c }),
    {
      id: "llenas",
      etiqueta: "Más insumos primero",
      comparar: (a, b) => menu.insumosDe(b).length - menu.insumosDe(a).length,
    },
  ];
  let ordenCategorias = $state(ordenRecordado("catalogo.categorias", "az"));
  const categoriasVistas = $derived(
    ordenar(categorias, opcionesCategorias.find((o) => o.id === ordenCategorias)),
  );

  const opcionesEstaciones: OpcionOrden<EstacionKds>[] = [
    ...ordenesComunes<EstacionKds>({ nombre: (e) => e.nombre, fecha: (e) => e.orden }),
    {
      id: "productos",
      etiqueta: "Más productos primero",
      comparar: (a, b) => menu.cuantosEnEstacion(b.id) - menu.cuantosEnEstacion(a.id),
    },
  ];
  let ordenEstaciones = $state(ordenRecordado("catalogo.estaciones", "antiguos"));
  const estacionesVistas = $derived(
    ordenar(menu.estaciones, opcionesEstaciones.find((o) => o.id === ordenEstaciones)),
  );

  // --- El atajo de «agregar una nueva categoría» desde la ficha del insumo -------------
  //
  // Pedido de Gonzalo: capturando un insumo, la categoría se elige de una lista
  // y, si la que hace falta no está, se crea desde ahí mismo sin perder lo que
  // ya se llevaba escrito del insumo. Antes había que memorizar el nombre, irse
  // a Categorías, crearla, volver y teclear la ficha otra vez desde cero.

  /**
   * El valor con el que el desplegable pide abrir el alta de una categoría.
   *
   * Es un centinela y no un texto legible porque la categoría del insumo se
   * guarda como TEXTO: si el atajo se llamara «Nueva categoría» a secas, el día
   * que alguien diera de alta una categoría con ese nombre el desplegable
   * dejaría de poder crear ninguna.
   */
  const NUEVA_CATEGORIA = "::nueva::";

  /**
   * Lo que se enseña en el desplegable de categoría del insumo.
   *
   * Incluye a la fuerza la categoría que trae el insumo que se está editando,
   * aunque no aparezca en el catálogo. Sin eso, abrir una ficha vieja con una
   * categoría que nadie declaró dejaba el desplegable en blanco y al guardar le
   * borraba la categoría al insumo sin que nadie lo hubiera pedido.
   */
  const opcionesCategoria = $derived(
    iCategoria.trim() !== "" && !categorias.includes(iCategoria)
      ? [...categorias, iCategoria]
      : categorias,
  );

  /** Si se llegó a Categorías desde la ficha del insumo, para saber si hay que volver. */
  let volverAInsumos = $state(false);
  /** El campo de la categoría nueva, para poder dejar el cursor dentro al llegar. */
  let campoCategoriaNueva = $state<HTMLInputElement | null>(null);

  /*
   * Enfocar ese campo al llegar por el atajo, en el cuadro siguiente.
   *
   * Tiene que ser después de pintar: el input nace con el cambio de pestaña, y
   * enfocarlo en el mismo tick apuntaría a un elemento que todavía no está en la
   * página. Quien llega aquí viene a teclear una palabra y a volver, no a buscar
   * dónde hacer clic.
   */
  $effect(() => {
    if (!volverAInsumos || !campoCategoriaNueva) return;
    const campo = campoCategoriaNueva;
    const cuadro = requestAnimationFrame(() => campo.focus());
    return () => cancelAnimationFrame(cuadro);
  });

  /**
   * Elegir «agregar una nueva» no escribe nada en el insumo: salta a Categorías.
   *
   * La ficha a medio llenar se queda tal cual —el borrador vive en este mismo
   * componente y sobrevive al cambio de pestaña—, y la bandera es la que hace
   * que al terminar de crear la categoría el sistema devuelva al usuario a lo
   * que estaba capturando en vez de abandonarlo en otra pantalla.
   */
  function alElegirCategoria(e: Event & { currentTarget: EventTarget & HTMLSelectElement }) {
    const elegida = e.currentTarget.value;
    if (elegida !== NUEVA_CATEGORIA) {
      iCategoria = elegida;
      return;
    }
    vista = "categorias";
    problemas = [];
    volverAInsumos = true;
  }

  /**
   * El nombre tal y como quedó guardado en el catálogo.
   *
   * La categoría se guarda con el texto recortado que se tecleó, pero si ya
   * andaba escrita en alguna ficha con otro acento o mayúscula, la que manda es
   * la del catálogo: dejar en el insumo un nombre que no está en la lista lo
   * pintaría sin categoría en el desplegable.
   */
  function comoQuedoEnElCatalogo(nombre: string): string {
    const igual = (a: string, b: string) =>
      a.localeCompare(b, "es", { sensitivity: "base" }) === 0;
    return menu.categoriasInsumo.find((c) => igual(c, nombre)) ?? nombre;
  }

  function crearCategoria() {
    const tecleada = categoriaNueva.trim();
    const r = menu.crearCategoriaInsumo(categoriaNueva);
    problemas = r.problemas;
    if (!r.ok) return;
    categoriaNueva = "";

    // La vuelta automática solo se gana viniendo del desplegable del insumo.
    // Quien entró a Categorías por su cuenta se queda aquí: dar de alta tres
    // categorías seguidas es lo normal al ordenar la despensa, y saltar a otra
    // pantalla después de cada una se sentiría como un error del sistema.
    if (!volverAInsumos) return;
    iCategoria = comoQuedoEnElCatalogo(tecleada);
    vista = "insumos";
    volverAInsumos = false;
  }

  function abrirEdicionCategoria(nombre: string) {
    catEditando = nombre;
    catNombre = nombre;
    problemas = [];
  }

  function guardarCategoria() {
    if (!catEditando) return;
    const r = menu.renombrarCategoriaInsumo(catEditando, catNombre);
    publicar(r.problemas);
    if (r.ok) {
      // La desplegada sigue el nuevo nombre: si no, el panel abierto se
      // quedaría apuntando a una categoría que ya no existe y se vería vacío.
      if (catAbierta === catEditando) catAbierta = catNombre.trim();
      catEditando = null;
    }
  }

  function borrarCategoria(nombre: string) {
    const r = menu.borrarCategoriaInsumo(nombre);
    publicar(r.problemas);
    if (r.ok && catAbierta === nombre) catAbierta = null;
  }

  /** Vacía una categoría moviendo sus insumos a otra, para poder borrarla. */
  function moverInsumos(desde: string) {
    if (!catDestino.trim()) return;
    const r = menu.moverInsumosDeCategoria(desde, catDestino);
    publicar(r.problemas);
    if (r.ok) catDestino = "";
  }

  function limpiarEstacion() {
    estacionId = null;
    eNombre = "";
    eObjetivo = "10";
    eLimite = "15";
    problemas = [];
  }

  function editarEstacion(id: string) {
    const e = menu.estaciones.find((x) => x.id === id);
    if (!e) return;
    estacionId = id;
    eNombre = e.nombre;
    eObjetivo = String(e.minutos_objetivo);
    eLimite = String(e.minutos_limite);
    problemas = [];
    subirAlPrincipio(raiz);
  }

  function guardarEstacion() {
    const borrador: BorradorEstacion = {
      nombre: eNombre,
      minutos_objetivo: Number(eObjetivo) || 0,
      minutos_limite: Number(eLimite) || 0,
    };
    const r = estacionId
      ? menu.actualizarEstacion(estacionId, borrador)
      : menu.crearEstacion(borrador);
    problemas = r.problemas;
    if (r.ok) limpiarEstacion();
  }

  // --- Cargar la carta en bloque -------------------------------------------------------

  let textoCarta = $state("");
  let importado = $state<ResultadoImportacion | null>(null);

  const previa = $derived(
    textoCarta.trim() === ""
      ? null
      : interpretarCarta(textoCarta, {
          categoriasExistentes: menu.categorias.map((c) => c.nombre),
        }),
  );

  /*
   * QUÉ DE LA CARTA PEGADA SE VENDE TAL CUAL (propuesta D).
   *
   * Es donde un restaurante nuevo captura de verdad: pega su carta entera de una
   * vez. Si las bebidas no se marcan aquí, hay que volver a pasar por las treinta
   * una por una — y nadie vuelve.
   *
   * Solo se guardan las casillas que el usuario TOCÓ. El valor por defecto de
   * cada categoría se lee del catálogo en el momento de pintarla: una que ya
   * estaba marcada de reventa aparece marcada sola, y así pegar una carta
   * corregida no obliga a volver a decir lo mismo.
   */
  let reventaEnLaPrevia = $state<Record<string, boolean>>({});

  function marcadaDeReventa(nombre: string): boolean {
    const k = nombre.trim().toLowerCase();
    const elegida = reventaEnLaPrevia[k];
    if (elegida !== undefined) return elegida;
    return menu.categorias.some(
      (c) => c.nombre.trim().toLowerCase() === k && c.reventa === true,
    );
  }

  function alternarReventa(nombre: string) {
    const k = nombre.trim().toLowerCase();
    reventaEnLaPrevia = { ...reventaEnLaPrevia, [k]: !marcadaDeReventa(nombre) };
  }

  const categoriasDeReventa = $derived(
    puedeVincular
      ? (previa?.categorias_detectadas ?? []).filter((c) => marcadaDeReventa(c.nombre))
      : [],
  );
  const productosDeReventa = $derived(
    categoriasDeReventa.reduce((n, c) => n + c.lineas, 0),
  );
  /** Líneas marcadas que no traen costo: su insumo nacería en $0. No se esconde. */
  const sinCostoEnReventa = $derived(
    categoriasDeReventa.reduce((n, c) => n + c.sin_costo, 0),
  );

  function confirmarImportacion() {
    if (!previa) return;
    importado = importarCartaConReventa(
      previa,
      new Set(categoriasDeReventa.map((c) => c.nombre)),
    );
    textoCarta = "";
    reventaEnLaPrevia = {};
  }

  const EJEMPLO = [
    "Pizzas",
    "Margarita | 249 | 62",
    "Pepperoni | 269 | 71",
    "Bebidas",
    "Limonada | 45 | 8",
  ].join("\n");

  // --- Carga rápida de alimentos y bebidas: el refrigerador entero de corrido (propuesta E) ------------------

  let renglones = $state<RenglonRapido[]>([renglonRapido(), renglonRapido(), renglonRapido()]);
  /** La categoría de la CARTA donde cae toda la tanda. Se elige una sola vez. */
  let rCategoria = $state("");
  /** Y la categoría de la DESPENSA donde se guardan sus insumos. */
  let rDespensa = $state(CATEGORIA_INSUMO_POR_DEFECTO);
  let resumenRapido = $state<ResumenRapido | null>(null);

  const listos = $derived(
    renglones.filter((r) => !renglonVacio(r) && problemaDelRenglon(r) === null).length,
  );

  function agregarRenglon() {
    renglones = [...renglones, renglonRapido()];
  }

  function darDeAltaTodo() {
    if (!rCategoria) return;
    const resumen = altaRapidaDeReventa(renglones, {
      categoria_id: rCategoria,
      categoriaInsumo: rDespensa.trim() || CATEGORIA_INSUMO_POR_DEFECTO,
      impuesto_id: menu.impuestos[0]?.id ?? "",
    });
    resumenRapido = resumen;

    /*
     * Lo que falló SE QUEDA ESCRITO. Vaciar la tabla al terminar castigaría
     * justo al que se equivocó en un renglón de veinte: tendría que volver a
     * teclear los veinte, y esa es la última vez que alguien abre esta
     * pantalla. El renglón en blanco del final es para seguir capturando.
     */
    renglones = [...resumen.pendientes, renglonRapido()];

    // La categoría queda marcada de reventa, como en el importador y por lo
    // mismo: lo que se agregue aquí dentro dentro de tres semanas nacerá ya
    // vinculado sin que nadie tenga que acordarse.
    if (resumen.altas > 0) menu.marcarCategoriaDeReventa(rCategoria, true);
  }

  // --- «Ponerlo en la carta»: el insumo que pasa a venderse (propuesta B, inversa) ------
  //
  // Quien cargó sus refrescos como insumos para poder contarlos se encuentra con
  // que no se pueden vender, y volver a teclear los mismos treinta nombres en el
  // Menú es el momento exacto en que se abandona la tarea.

  /** El insumo cuyo formulario de «ponerlo en la carta» está abierto. */
  let enLaCarta = $state<string | null>(null);
  let cCategoria = $state("");
  let cPrecio = $state("");

  function abrirEnLaCarta(insumoId: string) {
    enLaCarta = insumoId;
    cCategoria = menu.categorias[0]?.id ?? "";
    cPrecio = "";
    problemas = [];
  }

  function confirmarEnLaCarta() {
    if (!enLaCarta || !cCategoria) return;
    const r = ponerEnLaCarta(enLaCarta, {
      categoria_id: cCategoria,
      precio: pesos(Number(cPrecio) || 0),
      impuesto_id: menu.impuestos[0]?.id ?? "",
    });
    publicar(r.problemas);
    // Se cierra por `creado` y no por `ok`, por lo mismo que en el alta
    // rápida: el producto puede haber quedado creado con un aviso colgando.
    if (r.creado) {
      enLaCarta = null;
      cPrecio = "";
    }
  }
</script>

<div class="seccion" bind:this={raiz}>
  <div class="encabezado">
    <div>
      <h1>Catálogo del local</h1>
      <p class="sub">
        Insumos del almacén y estaciones de cocina. Con esto, dar de alta un
        restaurante nuevo no requiere tocar el código.
      </p>
    </div>
    <div class="pestanas">
      <button class:on={vista === "insumos"} onclick={() => irA("insumos")}>
        Insumos
      </button>
      <button class:on={vista === "categorias"} onclick={() => irA("categorias")}>
        Categorías
      </button>
      <button class:on={vista === "estaciones"} onclick={() => irA("estaciones")}>
        Estaciones
      </button>
      <button class:on={vista === "carta"} onclick={() => irA("carta")}>
        Local y carta
      </button>
      <button class:on={vista === "reventa"} title={AYUDA_CARGA_RAPIDA} onclick={() => irA("reventa")}>
        Carga rápida de alimentos y bebidas
      </button>
    </div>
  </div>

  {#if !puedeEditar}
    <p class="nota">Tu perfil puede consultar el catálogo, pero no modificarlo.</p>
  {/if}

  {#each problemas as p (p.campo + p.mensaje)}
    <p class:error={p.gravedad === "error"} class:advertencia={p.gravedad === "advertencia"}>
      {p.gravedad === "advertencia" ? "⚠ " : ""}{p.mensaje}
    </p>
  {/each}

  {#if vista === "insumos"}
    {#if puedeEditar}
      <section class="tarjeta">
        <h2>{insumoId ? "Editar insumo" : "Nuevo insumo"}</h2>
        <div class="campos">
          <label class="ancho">
            <span>Nombre</span>
            <input bind:value={iNombre} placeholder="Mozzarella, masa madre, limón…" />
          </label>
          <label>
            <span>Unidad base</span>
            <select bind:value={iUnidad} disabled={insumoId !== null}>
              {#each UNIDADES as u (u.valor)}
                <option value={u.valor}>{u.etiqueta} ({u.valor})</option>
              {/each}
            </select>
          </label>
          <label>
            <span>Costo por {iUnidad}</span>
            <div class="moneda">
              <i>$</i>
              <input type="number" inputmode="decimal" step="0.0001" bind:value={iCostoPesos} placeholder="0.00" />
            </div>
          </label>
          <label>
            <span>Mínimo ({iUnidad})</span>
            <input type="number" inputmode="decimal" bind:value={iMinimo} placeholder="0" />
          </label>
          <label>
            <span>Categoría</span>
            <!--
              Lista y no texto libre: escribirla a mano es como nacían «Lacteos»
              y «lácteos», dos categorías para el sistema y una sola para el
              almacenista. La última opción da de alta la que falte sin perder
              nada de lo que ya se llevaba capturado de este insumo.
            -->
            <select value={iCategoria} onchange={alElegirCategoria}>
              <option value="">— Sin categoría —</option>
              {#each opcionesCategoria as c (c)}
                <option value={c}>{c}</option>
              {/each}
              <option value={NUEVA_CATEGORIA}>＋ Agregar una nueva categoría…</option>
            </select>
          </label>
        </div>
        {#if insumoId}
          <p class="pista">
            La unidad base no se puede cambiar: las existencias registradas están
            expresadas en ella, y cambiarla convertiría 5 000 g en 5 000 kg. Para
            usar otra unidad, da de alta un insumo nuevo.
          </p>
        {/if}
        <div class="botones">
          {#if insumoId}
            <button class="secundario" onclick={limpiarInsumo}>Cancelar</button>
          {/if}
          <button class="principal" onclick={guardarInsumo}>
            {insumoId ? "Guardar cambios" : "Agregar insumo"}
          </button>
        </div>
      </section>
    {/if}

    <section class="tarjeta">
      <div class="cab-lista">
        <h2>Insumos ({menu.insumos.length})</h2>
        {#if menu.insumos.length > 1}
          <Ordenar opciones={opcionesInsumos} bind:valor={ordenInsumos} recordar="catalogo.insumos" />
        {/if}
      </div>
      <table>
        <thead>
          <tr>
            <th>Insumo</th>
            <th>Unidad</th>
            <th class="num">Costo unitario</th>
            <th class="num">Mínimo</th>
            <th class="num">Existencia</th>
            <th class="num">Recetas</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each insumosAgrupados as grupo (grupo.nombre)}
          <tr class="cab-cat">
            <th colspan="7">
              {grupo.nombre}
              <span class="cuantos-cat">{grupo.insumos.length}</span>
            </th>
          </tr>
          {#each grupo.insumos as insumo (insumo.id)}
            {@const usos = menu.recetasQueUsan(insumo.id).length}
            <tr>
              <td>
                <b>{insumo.nombre}</b>
                {#if insumo.categoria}<small>{insumo.categoria}</small>{/if}
              </td>
              <td>{insumo.unidad_base}</td>
              <td class="num">{mxn(insumo.costo_unitario)}</td>
              <td class="num tenue">{formatearCantidad(insumo.stock_minimo, insumo.unidad_base)}</td>
              <td class="num">
                {formatearCantidad(inventario.cantidad(insumo.id), insumo.unidad_base)}
              </td>
              <td class="num tenue">{usos > 0 ? usos : "—"}</td>
              <td class="acciones">
                {#if puedeEditar}
                  <!--
                    Solo para lo que se cuenta POR PIEZAS y todavía no se vende.
                    Un insumo en gramos no se puede poner en la carta tal cual
                    —nadie pide «180 g de harina»— y uno que ya tiene su producto
                    espejo se duplicaría en el menú.
                  -->
                  {#if puedeVincular && insumo.unidad_base === "pz" && !estaEnLaCarta(insumo.id)}
                    <button onclick={() => abrirEnLaCarta(insumo.id)}>
                      Ponerlo en la carta
                    </button>
                  {/if}
                  <button onclick={() => editarInsumo(insumo.id)}>Editar</button>
                  <button
                    class="peligro"
                    onclick={() => borrarInsumo(insumo.id)}
                    disabled={usos > 0}
                    title={usos > 0 ? "Lo usa una receta" : "Dar de baja"}
                  >
                    Baja
                  </button>
                {/if}
              </td>
            </tr>
            {#if enLaCarta === insumo.id}
              <tr class="fila-carta">
                <td colspan="7">
                  <div class="poner">
                    <span class="que">
                      <b>{insumo.nombre}</b> se pondrá a la venta con su propio
                      insumo detrás: cada una que se cobre descontará una del
                      almacén.
                    </span>
                    <label>
                      <span>En qué categoría de la carta</span>
                      <select bind:value={cCategoria}>
                        {#each menu.categorias as c (c.id)}
                          <option value={c.id}>{c.nombre}</option>
                        {/each}
                      </select>
                    </label>
                    <label>
                      <span>Precio de venta</span>
                      <div class="moneda">
                        <i>$</i>
                        <input
                          type="number"
                          inputmode="decimal"
                          step="0.01"
                          bind:value={cPrecio}
                          placeholder="0.00"
                          onkeydown={(e) => {
                            if (e.key === "Enter") confirmarEnLaCarta();
                            if (e.key === "Escape") enLaCarta = null;
                          }}
                        />
                      </div>
                    </label>
                    <div class="acciones-poner">
                      <button class="mini" onclick={() => (enLaCarta = null)}>Cancelar</button>
                      <button
                        class="mini principal-mini"
                        onclick={confirmarEnLaCarta}
                        disabled={!cCategoria || !(Number(cPrecio) > 0)}
                      >
                        Ponerlo en la carta
                      </button>
                    </div>
                  </div>
                  <p class="pista">
                    El costo sale de la ficha del insumo ({mxn(insumo.costo_unitario)}
                    por pieza) y el precio se teclea <b>con el impuesto dentro</b>,
                    como está escrito en la carta. La existencia no se toca: la
                    que ya tiene registrada sigue siendo la suya.
                  </p>
                </td>
              </tr>
            {/if}
          {/each}
          {:else}
            <tr>
              <td colspan="7" class="tenue">
                Todavía no hay insumos. Se dan de alta en el formulario de arriba.
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {:else if vista === "categorias"}
    <!--
      LAS CATEGORÍAS DE INSUMO, con sus insumos dentro.

      Antes la categoría solo se podía escribir en la ficha del insumo, y ahí se
      quedaba: no había forma de ver qué había en «Lácteos», ni de corregir un
      nombre mal tecleado. Renombrar aquí reescribe la categoría en todos sus
      insumos de una vez.
    -->
    {#if puedeEditar}
      <section class="tarjeta">
        <h2>Nueva categoría</h2>
        <div class="fila-cat">
          <!--
            El Enter también la crea: quien llega aquí desde la ficha del insumo
            viene a teclear una palabra, y obligarlo a buscar el botón con el
            mouse rompe el único gesto que tenía en la mano.
          -->
          <input
            bind:this={campoCategoriaNueva}
            bind:value={categoriaNueva}
            placeholder="Lácteos, cárnicos, abarrotes…"
            onkeydown={(e) => {
              if (e.key === "Enter" && categoriaNueva.trim().length >= 2) crearCategoria();
            }}
          />
          <button
            class="principal"
            onclick={crearCategoria}
            disabled={categoriaNueva.trim().length < 2}
          >
            Agregar
          </button>
        </div>
        {#if volverAInsumos}
          <!--
            Avisar del salto ANTES de darlo. Cambiar de pantalla sin anunciarlo
            se siente como un error del sistema, aunque sea justo lo que se pidió.
          -->
          <p class="pista">
            Al agregarla vuelves solo a <b>Insumos</b>, con el insumo que estabas
            capturando tal como lo dejaste y esta categoría ya puesta.
          </p>
        {/if}
      </section>
    {/if}

    <section class="tarjeta">
      <div class="cab-lista">
        <h2>Categorías ({categorias.length})</h2>
        {#if categorias.length > 1}
          <Ordenar
            opciones={opcionesCategorias}
            bind:valor={ordenCategorias}
            recordar="catalogo.categorias"
          />
        {/if}
      </div>

      {#if categorias.length === 0}
        <p class="pista">
          Todavía no hay ninguna. Se crean aquí o se van formando solas conforme
          se escriba una categoría al dar de alta un insumo.
        </p>
      {:else}
        <div class="lista-cat">
          {#each categoriasVistas as cat (cat)}
            {@const dentro = menu.insumosDe(cat)}
            <div class="cat">
              <div class="cab-cat">
                {#if catEditando === cat}
                  <input
                    class="editar-cat"
                    bind:value={catNombre}
                    onkeydown={(e) => {
                      if (e.key === "Enter") guardarCategoria();
                      if (e.key === "Escape") catEditando = null;
                    }}
                  />
                  <button class="mini principal-mini" onclick={guardarCategoria}>Guardar</button>
                  <button class="mini" onclick={() => (catEditando = null)}>Cancelar</button>
                {:else}
                  <button
                    class="nombre-cat"
                    onclick={() => (catAbierta = catAbierta === cat ? null : cat)}
                  >
                    <span class="flecha">{catAbierta === cat ? "▾" : "▸"}</span>
                    <b>{cat}</b>
                    <span class="cuantos">{dentro.length}</span>
                  </button>
                  {#if puedeEditar}
                    <button class="mini" onclick={() => abrirEdicionCategoria(cat)}>Renombrar</button>
                    <!--
                      Eliminar solo cuando está VACÍA. Un insumo cuya categoría
                      desaparece no se rompe —el campo es texto— pero queda
                      colgando de un nombre que ya no sale en ninguna lista.
                    -->
                    {#if dentro.length === 0}
                      <button class="mini peligro" onclick={() => borrarCategoria(cat)}>
                        Eliminar
                      </button>
                    {/if}
                  {/if}
                {/if}
              </div>

              {#if catAbierta === cat}
                <div class="dentro">
                  {#if dentro.length === 0}
                    <p class="pista">Sin insumos. Se puede eliminar.</p>
                  {:else}
                    <table>
                      <thead>
                        <tr>
                          <th>Insumo</th>
                          <th class="num">Existencia</th>
                          <th class="num">Costo</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each dentro as i (i.id)}
                          <tr>
                            <td>{i.nombre}</td>
                            <td class="num">
                              {formatearCantidad(inventario.cantidad(i.id), i.unidad_base)}
                            </td>
                            <td class="num">{mxn(i.costo_unitario)} / {i.unidad_base}</td>
                            <td>
                              {#if puedeEditar}
                                <button
                                  class="mini"
                                  onclick={() => { irA("insumos"); editarInsumo(i.id); }}
                                >
                                  Editar
                                </button>
                              {/if}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>

                    {#if puedeEditar}
                      <!--
                        Para poder BORRAR una categoría hay que vaciarla primero,
                        y moverlos de uno en uno por la ficha de cada insumo era
                        el trabajo que hacía que nadie ordenara nunca la despensa.
                      -->
                      <div class="mover">
                        <span>Mover estos {dentro.length} insumos a:</span>
                        <input bind:value={catDestino} placeholder="Otra categoría" list="cats" />
                        <button
                          class="mini"
                          onclick={() => moverInsumos(cat)}
                          disabled={catDestino.trim().length < 2}
                        >
                          Mover
                        </button>
                      </div>
                    {/if}
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <datalist id="cats">
        {#each categorias as c (c)}<option value={c}></option>{/each}
      </datalist>

      <!--
        Los que no tienen categoría se enseñan aparte y NO como una categoría
        más: son los que se van a perder de vista, y esconderlos en el conteo
        haría creer que la despensa está ordenada cuando no lo está.
      -->
      {#if sinCategoria.length > 0}
        <div class="sin-cat">
          <b>{sinCategoria.length} insumo(s) sin categoría</b>
          <p class="pista">
            {sinCategoria.map((i) => i.nombre).join(", ")}
          </p>
        </div>
      {/if}
    </section>

  {:else if vista === "estaciones"}
    {#if puedeEditar}
      <section class="tarjeta">
        <h2>{estacionId ? "Editar estación" : "Nueva estación"}</h2>
        <div class="campos">
          <label class="ancho">
            <span>Nombre</span>
            <input bind:value={eNombre} placeholder="Horno, barra, parrilla…" />
          </label>
          <label>
            <span>Objetivo (min)</span>
            <input type="number" inputmode="numeric" bind:value={eObjetivo} />
          </label>
          <label>
            <span>Límite (min)</span>
            <input type="number" inputmode="numeric" bind:value={eLimite} />
          </label>
        </div>
        <p class="pista">
          Pasado el <b>objetivo</b> el platillo se pinta en ámbar; pasado el
          <b>límite</b>, en rojo. Cada estación tiene su propio ritmo: una barra
          sirve en minutos y un horno tarda un cuarto de hora.
        </p>
        <div class="botones">
          {#if estacionId}
            <button class="secundario" onclick={limpiarEstacion}>Cancelar</button>
          {/if}
          <button class="principal" onclick={guardarEstacion}>
            {estacionId ? "Guardar cambios" : "Agregar estación"}
          </button>
        </div>
      </section>
    {/if}

    <section class="tarjeta">
      <div class="cab-lista">
        <h2>Estaciones ({menu.estaciones.length})</h2>
        {#if menu.estaciones.length > 1}
          <Ordenar
            opciones={opcionesEstaciones}
            bind:valor={ordenEstaciones}
            recordar="catalogo.estaciones"
          />
        {/if}
      </div>
      <table>
        <thead>
          <tr>
            <th>Estación</th>
            <th class="num">Objetivo</th>
            <th class="num">Límite</th>
            <th class="num">Productos</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each estacionesVistas as estacion (estacion.id)}
            {@const cuantos = menu.cuantosEnEstacion(estacion.id)}
            <tr>
              <td><b>{estacion.nombre}</b></td>
              <td class="num">{estacion.minutos_objetivo} min</td>
              <td class="num">{estacion.minutos_limite} min</td>
              <td class="num tenue">{cuantos}</td>
              <td class="acciones">
                {#if puedeEditar}
                  <button onclick={() => editarEstacion(estacion.id)}>Editar</button>
                  <button
                    class="peligro"
                    onclick={() => publicar(menu.borrarEstacion(estacion.id).problemas)}
                    title={cuantos > 0 ? `${cuantos} producto(s) quedarán sin ruteo` : "Eliminar"}
                  >
                    Eliminar
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="pista">
        Al eliminar una estación sus productos quedan <b>sin ruteo</b>: siguen
        vendiéndose y aparecen en la vista de todas las estaciones del tablero,
        en vez de desaparecer de cocina sin aviso.
      </p>
    </section>
  {:else if vista === "reventa"}
    <!--
      ALTA RÁPIDA DE EMBOTELLADOS (propuesta E).

      Pensada para cargar el refrigerador entero de corrido. Cada renglón da de
      alta cuatro cosas a la vez —el producto, su insumo, la receta de 1 pz que
      los une y cuántas hay—, que es lo que antes costaba cuatro pantallas por
      bebida. Con treinta bebidas eran ciento veinte vueltas y el final era
      siempre el mismo: las bebidas se quedaban fuera del inventario.
    -->
    <section class="tarjeta">
      <h2>Carga rápida de alimentos y bebidas</h2>
      <p class="pista">
        Para lo que se compra hecho y se vende igual: refrescos, cervezas, agua,
        pan, postres o botanas empacadas. Escribe la tanda completa y dale de alta
        de una vez.
      </p>

      {#if !puedeEditar}
        <p class="nota">Tu perfil puede consultar el catálogo, pero no modificarlo.</p>
      {:else if !puedeVincular}
        <p class="nota">
          Vincular un producto con su insumo es escribirle una receta de un
          renglón, y tu perfil no puede editar recetas. Pídeselo a quien
          administre el catálogo.
        </p>
      {:else}
        <!--
          Categoría de la carta y categoría de la despensa se eligen UNA vez
          para toda la tanda: quien carga el refrigerador carga refrescos, y
          repetir el mismo par de datos treinta veces es el trabajo que hace que
          la pantalla no se use.
        -->
        <div class="campos">
          <label>
            <span>Se venden en la carta, dentro de</span>
            <select bind:value={rCategoria}>
              <option value="">— Elige la categoría —</option>
              {#each menu.categorias as c (c.id)}
                <option value={c.id}>{c.nombre}{c.reventa ? " · se vende tal cual" : ""}</option>
              {/each}
            </select>
          </label>
          <label>
            <span>Y se guardan en la despensa, dentro de</span>
            <input
              bind:value={rDespensa}
              list="cats-despensa"
              placeholder={CATEGORIA_INSUMO_POR_DEFECTO}
            />
          </label>
        </div>
        <datalist id="cats-despensa">
          {#each menu.categoriasInsumo as c (c)}<option value={c}></option>{/each}
        </datalist>

        {#if menu.categorias.length === 0}
          <p class="advertencia">
            ⚠ Todavía no hay ninguna categoría en la carta. Créala primero desde
            Cocina → Menú; sin ella los productos no tienen de dónde colgarse.
          </p>
        {/if}

        <table class="rapida">
          <thead>
            <tr>
              <th>Nombre</th>
              <th class="num">La compras a</th>
              <th class="num">La vendes a</th>
              <th class="num">Cuántas tienes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each renglones as r, i (r.id)}
              {@const problema = problemaDelRenglon(r)}
              {@const aviso = avisoDelRenglon(r)}
              <tr>
                <td>
                  <input bind:value={r.nombre} placeholder="Coca-Cola 600 ml" />
                </td>
                <td class="num">
                  <div class="moneda">
                    <i>$</i>
                    <input
                      type="number"
                      inputmode="decimal"
                      step="0.01"
                      bind:value={r.costo}
                      placeholder="0.00"
                    />
                  </div>
                </td>
                <td class="num">
                  <div class="moneda">
                    <i>$</i>
                    <input
                      type="number"
                      inputmode="decimal"
                      step="0.01"
                      bind:value={r.precio}
                      placeholder="0.00"
                    />
                  </div>
                </td>
                <td class="num">
                  <!--
                    El Enter del último campo agrega renglón: capturar treinta
                    bebidas es un gesto de teclado, y obligar a soltarlo para
                    buscar el botón con el mouse treinta veces es el detalle que
                    convierte una tarea de cinco minutos en una de veinte.
                  -->
                  <input
                    type="number"
                    inputmode="numeric"
                    step="1"
                    bind:value={r.existencia}
                    placeholder="0"
                    onkeydown={(e) => {
                      if (e.key === "Enter") agregarRenglon();
                    }}
                  />
                </td>
                <td class="acciones">
                  {#if renglones.length > 1}
                    <button
                      class="peligro"
                      title="Quitar este renglón"
                      onclick={() => (renglones = renglones.filter((_, j) => j !== i))}
                    >
                      Quitar
                    </button>
                  {/if}
                </td>
              </tr>
              {#if problema || aviso}
                <tr class="dicho">
                  <td colspan="5">
                    <span class:error={problema !== null} class:advertencia={problema === null}>
                      {problema ?? `⚠ ${aviso}`}
                    </span>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>

        <div class="botones">
          <button class="boton-agregar" onclick={agregarRenglon}>＋ Renglón</button>
          <button
            class="principal"
            disabled={listos === 0 || rCategoria === ""}
            onclick={darDeAltaTodo}
          >
            Dar de alta {listos} de reventa
          </button>
        </div>

        {#if resumenRapido}
          {#if resumenRapido.altas > 0}
            <p class="ok" role="status">
              Listo: {resumenRapido.altas} producto(s) en la carta, con su insumo
              y su existencia cargada.
            </p>
          {/if}
          {#if resumenRapido.fallos.length > 0}
            <!--
              El resumen es honesto: cuál falló y por qué. Y lo que falló sigue
              escrito en la tabla de arriba — perder lo tecleado es lo que hace
              que la gente no vuelva a abrir una pantalla de captura.
            -->
            <div class="fallos">
              <b>{resumenRapido.fallos.length} con problema</b>
              <ul>
                {#each resumenRapido.fallos as f (f.nombre + f.motivo)}
                  <li><b>{f.nombre}</b> — {f.motivo}</li>
                {/each}
              </ul>
              <p class="pista">
                Los que no entraron siguen escritos arriba, tal como los dejaste.
              </p>
            </div>
          {/if}
        {/if}

        <p class="pista">
          El precio se teclea <b>con el impuesto dentro</b>, como está escrito en
          la carta. La existencia entra como <b>ajuste por conteo</b> y no como
          compra: estás diciendo cuántas hay ahorita, no registrando una entrada
          de proveedor, y meterlo como compra inflaría el resultado del día.
        </p>
      {/if}
    </section>
  {:else}
    <!--
      La jornada operativa. Vive junto a la carta porque las dos son ajustes del
      LOCAL, no operación.
    -->
    <section class="tarjeta">
      <h2>Jornada del local</h2>
      <p class="pista">
        A qué hora cierra contablemente el día. Un servicio que termina a la una
        de la madrugada pertenece a la noche en que empezó: con el corte a las
        <b>5:00</b>, el viernes cuenta como viernes en el resultado del día y en
        el pronóstico. Cortar a medianoche partiría el servicio en dos.
      </p>
      {#if puedeEditar}
        <label class="jornada">
          <span>Cierre de la jornada</span>
          <select
            value={String(local.horaCorte)}
            onchange={(e) => local.fijarHoraCorte(Number(e.currentTarget.value))}
          >
            {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
              <option value={String(h)}>
                {String(h).padStart(2, "0")}:00{h === 5 ? " (recomendado)" : ""}
              </option>
            {/each}
          </select>
        </label>
      {/if}
    </section>

    <!--
      Cargar la carta en bloque. Nunca se importa a ciegas: primero se muestra
      renglón por renglón lo que va a quedar, y solo entonces se confirma.
    -->
    <section class="tarjeta">
      <h2>Cargar la carta</h2>
      <p class="pista">
        Pega aquí la carta y se da de alta completa. Sirve un copiado de Excel,
        o una lista escrita por secciones. El orden de columnas es
        <b>Categoría · Producto · Precio · Costo</b>, y el costo puede faltar.
      </p>

      {#if puedeEditar}
        <textarea
          bind:value={textoCarta}
          rows="8"
          placeholder={EJEMPLO}
          spellcheck="false"
        ></textarea>

        {#if importado}
          <p class="ok" role="status">
            Listo: {importado.creados} platillos dados de alta
            {#if importado.categorias > 0}y {importado.categorias} categorías creadas{/if}.
            {#if importado.reventa > 0}
              De ellos, {importado.reventa} quedaron vinculados a su propio insumo;
              carga cuántos tienes en Inventario o en «Carga rápida de alimentos y bebidas».
            {/if}
          </p>
        {/if}

        {#if importado && importado.fallos.length > 0}
          <!--
            Lo que no entró se dice con nombre y motivo. Un contador que dice
            «58 de 60» deja al usuario buscando cuáles dos faltan en una lista
            de sesenta, y lo que hace es volver a pegar la carta entera.
          -->
          <div class="fallos">
            <b>{importado.fallos.length} no se pudieron dar de alta</b>
            <ul>
              {#each importado.fallos as f (f.nombre + f.motivo)}
                <li><b>{f.nombre}</b> — {f.motivo}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if previa}
          <div class="marcador-import">
            <span class="cuenta alta">{previa.altas} se darán de alta</span>
            {#if previa.avisos > 0}
              <span class="cuenta aviso">{previa.avisos} con aviso</span>
            {/if}
            {#if previa.errores > 0}
              <span class="cuenta error">{previa.errores} con error</span>
            {/if}
            {#if previa.categorias.length > 0}
              <span class="cuenta nueva">
                {previa.categorias.length} categorías nuevas: {previa.categorias.join(", ")}
              </span>
            {/if}
          </div>

          {#if previa.categorias_detectadas.length > 0}
            <!--
              QUÉ DE ESTO SE VENDE TAL CUAL (propuesta D).
              Se pregunta por categoría y no por línea: nadie va a marcar
              treinta casillas de bebidas una por una, y quien pega su carta la
              tiene ya ordenada en secciones que son exactamente esa respuesta.
            -->
            <div class="reventa-cats">
              <p class="titulo-reventa">¿Qué de esto se vende tal cual?</p>
              <p class="pista">
                Lo que se compra hecho —refrescos, cervezas, botellas— se da de
                alta con su propio insumo en piezas y una receta de 1 pz. Así
                entra al almacén en el mismo gesto, en vez de pedir otras tres
                vueltas por otras tres pantallas.
              </p>
              <div class="cats-previa">
                {#each previa.categorias_detectadas as c (c.nombre)}
                  <label class="cat-previa" class:puesta={marcadaDeReventa(c.nombre)}>
                    <input
                      type="checkbox"
                      checked={marcadaDeReventa(c.nombre)}
                      disabled={!puedeVincular}
                      onchange={() => alternarReventa(c.nombre)}
                    />
                    <span class="nom">{c.nombre}</span>
                    <span class="cuantas">{c.lineas}</span>
                    {#if !c.nueva}<span class="ya">ya existe</span>{/if}
                  </label>
                {/each}
              </div>

              {#if !puedeVincular}
                <p class="pista">
                  Vincular un producto con su insumo es escribirle una receta, y
                  tu perfil no puede editarlas. Se darán de alta como platillos
                  normales.
                </p>
              {:else if productosDeReventa > 0}
                <p class="pista">
                  {productosDeReventa} producto(s) se crearán con su insumo detrás.
                  La carta no dice cuántos hay en el refrigerador: esa existencia
                  se carga después, en <b>Carga rápida de alimentos y bebidas</b> o en Inventario.
                </p>
                {#if sinCostoEnReventa > 0}
                  <p class="advertencia">
                    ⚠ {sinCostoEnReventa} línea(s) marcadas no traen costo: su
                    insumo quedará en <b>$0</b> y el valor del almacén no contará
                    lo que hay en el refrigerador hasta que lo captures.
                  </p>
                {/if}
              {/if}
            </div>
          {/if}

          {#if previa.sin_costos}
            <p class="advertencia">
              ⚠ Ninguna línea trae costo. Los platillos se crearán, pero el
              <b>food cost</b>, el margen y la ingeniería de menú saldrán en
              100 % hasta que captures los costos.
            </p>
          {/if}

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Categoría</th>
                <th>Producto</th>
                <th class="num">Precio</th>
                <th class="num">Costo</th>
                <th>Qué pasa</th>
              </tr>
            </thead>
            <tbody>
              {#each previa.lineas as l (l.renglon)}
                <tr class={l.estado}>
                  <td class="tenue">{l.renglon}</td>
                  <td>{l.categoria || "—"}</td>
                  <td><b>{l.nombre || "—"}</b></td>
                  <td class="num">{l.estado === "error" ? "—" : mxn(l.precio)}</td>
                  <td class="num tenue">{l.costo > 0 ? mxn(l.costo) : "—"}</td>
                  <td class="detalle-import">
                    {#if l.estado === "alta"}
                      <span class="tenue">Se da de alta</span>
                    {:else}
                      {l.detalle}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          <div class="botones">
            <button class="secundario" onclick={() => (textoCarta = "")}>Limpiar</button>
            <button
              class="principal"
              disabled={previa.altas === 0}
              onclick={confirmarImportacion}
            >
              Dar de alta {previa.altas} platillos{productosDeReventa > 0
                ? ` (${productosDeReventa} con su insumo)`
                : ""}
            </button>
          </div>
          {#if previa.errores > 0}
            <p class="pista">
              Las líneas con error <b>no se importan</b>. Corrígelas en el texto
              y vuelve a revisar, o dales de alta a mano después.
            </p>
          {/if}
        {/if}
      {:else}
        <p class="nota">Tu perfil no puede modificar la carta.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  /* --- Categorías de insumo --- */
  .fila-cat {
    display: flex;
    gap: 0.5rem;
  }
  .fila-cat input {
    flex: 1;
    max-width: 22rem;
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
  }
  .lista-cat {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .cat {
    border: 1px solid var(--borde);
    border-radius: 10px;
    overflow: hidden;
  }
  .cab-cat {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.7rem;
    background: #faf9f8;
  }
  .nombre-cat {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    text-align: left;
    font: inherit;
    color: var(--pizarra);
  }
  .nombre-cat .flecha {
    color: var(--gris);
    font-size: 0.8rem;
    width: 0.8rem;
  }
  .nombre-cat b {
    font-family: var(--font-titulo);
    font-size: 0.98rem;
  }
  .nombre-cat .cuantos {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--gris);
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
  }
  .editar-cat {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1.5px solid var(--acento);
    border-radius: 8px;
    font-family: var(--font-titulo);
    font-size: 0.98rem;
    font-weight: 600;
  }
  .dentro {
    padding: 0.6rem 0.7rem 0.8rem;
  }
  .dentro table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .dentro th {
    text-align: left;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid var(--borde);
  }
  .dentro td {
    padding: 0.4rem;
    border-bottom: 1px solid #f2f0ee;
  }
  .dentro .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .mover {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.7rem;
    padding-top: 0.6rem;
    border-top: 1px dashed var(--borde);
    font-size: 0.8rem;
    color: var(--gris);
  }
  .mover input {
    padding: 0.4rem 0.55rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
  }
  .sin-cat {
    margin-top: 0.9rem;
    padding: 0.7rem 0.85rem;
    background: #fffaf5;
    border: 1px solid var(--acento);
    border-radius: 10px;
    font-size: 0.85rem;
  }
  .sin-cat b {
    color: var(--acento-texto);
  }
  .mini.principal-mini {
    border-color: var(--acento);
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .mini.peligro {
    color: #e0392b;
  }
  .mini.peligro:hover {
    border-color: #e0392b;
  }
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 70rem;
  }
  .encabezado > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
    max-width: 38rem;
  }
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
  .tarjeta {
    padding: 1.1rem 1.25rem;
    overflow-x: auto;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  /* El título de la lista y su botón de «Ordenar», en la misma línea. */
  .cab-lista {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.85rem;
  }
  .cab-lista h2 {
    margin-bottom: 0;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .campos label {
    flex: 1;
    min-width: 9rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  select:disabled {
    background: var(--fondo);
    color: var(--gris);
  }
  .moneda {
    position: relative;
    display: flex;
    align-items: center;
  }
  .moneda i {
    position: absolute;
    left: 0.65rem;
    font-style: normal;
    font-weight: 600;
    color: var(--gris);
  }
  .moneda input {
    padding-left: 1.4rem;
  }
  .pista {
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .nota {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.85rem;
    color: var(--gris);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.87rem;
  }
  th {
    text-align: left;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  th.num,
  td.num {
    text-align: right;
    white-space: nowrap;
  }
  /*
   * El corte por categoría dentro de la tabla de insumos. Mismo tratamiento que
   * en Inventario, para que la despensa se lea igual en las dos pantallas.
   */
  tr.cab-cat th {
    padding: 0.7rem 0 0.35rem;
    border-bottom: 2px solid var(--borde);
    font-size: 0.78rem;
    color: var(--acento-texto);
  }
  .cuantos-cat {
    margin-left: 0.5rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--gris);
    text-transform: none;
    letter-spacing: normal;
  }
  td {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--borde);
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
  }
  .acciones {
    text-align: right;
    white-space: nowrap;
  }
  .acciones button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.25rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    margin-left: 0.3rem;
  }
  .acciones button:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .acciones .peligro:hover:not(:disabled) {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .acciones button:disabled {
    opacity: 0.35;
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.85rem;
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.6rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .advertencia {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--acento-2);
  }

  /* --- Cargar carta --- */
  textarea {
    width: 100%;
    margin-top: 0.85rem;
    padding: 0.75rem 0.9rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    resize: vertical;
    background: #fff;
  }
  textarea:focus {
    outline: none;
    border-color: var(--acento);
  }
  .marcador-import {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: 0.85rem 0;
  }
  .cuenta {
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    background: var(--fondo);
    color: var(--gris);
  }
  .cuenta.alta {
    background: #eef7e8;
    color: #3f6b2c;
  }
  .cuenta.aviso {
    background: #fff5ec;
    color: var(--acento-2);
  }
  .cuenta.error {
    background: #fdeae8;
    color: var(--peligro);
  }
  tr.error td {
    background: #fdf4f3;
  }
  tr.aviso td {
    background: #fffaf5;
  }
  .detalle-import {
    font-size: 0.8rem;
    line-height: 1.4;
    white-space: normal;
    max-width: 20rem;
  }
  .ok {
    margin-top: 0.85rem;
    background: #eef7e8;
    border: 1px solid #b6d9a0;
    border-radius: var(--r-md);
    padding: 0.7rem 0.95rem;
    font-size: 0.86rem;
    font-weight: 600;
    color: #3f6b2c;
  }
  .jornada {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-width: 18rem;
    margin-top: 0.85rem;
  }
  .jornada span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .jornada select {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    background: #fff;
  }
  .jornada select:focus {
    outline: none;
    border-color: var(--acento);
  }

  /* --- Lo que se vende tal cual: previa del importador (D) --- */
  .reventa-cats {
    margin: 0.85rem 0;
    padding: 0.8rem 0.95rem;
    background: #fffaf5;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
  }
  .titulo-reventa {
    font-family: var(--font-titulo);
    font-size: 0.92rem;
    font-weight: 600;
  }
  .reventa-cats .pista {
    margin-top: 0.4rem;
  }
  .cats-previa {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.7rem;
  }
  .cat-previa {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.7rem 0.35rem 0.55rem;
    background: #fff;
    border: 1.5px solid var(--borde);
    border-radius: 999px;
    font-size: 0.83rem;
    cursor: pointer;
  }
  /* El contorno naranja es el acuse: se ve de un golpe qué se marcó. */
  .cat-previa.puesta {
    border-color: var(--acento);
    background: var(--claro);
  }
  .cat-previa input {
    /* La regla general de `input` de esta pantalla es para campos de texto; una
       casilla con ese relleno y ancho completo se vuelve un recuadro enorme. */
    width: auto;
    padding: 0;
    margin: 0;
    accent-color: var(--acento);
  }
  .cat-previa .nom {
    font-weight: 600;
  }
  .cat-previa .cuantas {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--gris);
    background: var(--fondo);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
  }
  .cat-previa .ya {
    font-size: 0.7rem;
    color: var(--gris);
  }

  /* --- Lo que no entró, con nombre y motivo --- */
  .fallos {
    margin-top: 0.85rem;
    padding: 0.7rem 0.95rem;
    background: #fdf4f3;
    border: 1px solid #f0c6c1;
    border-radius: var(--r-md);
    font-size: 0.85rem;
  }
  .fallos b {
    color: var(--peligro);
  }
  .fallos ul {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
    line-height: 1.6;
  }
  .fallos li b {
    color: var(--pizarra);
  }

  /* --- Alta rápida de embotellados (E) --- */
  .rapida td {
    padding: 0.3rem 0.35rem;
    vertical-align: middle;
  }
  .rapida td:first-child {
    padding-left: 0;
  }
  .rapida input {
    padding: 0.45rem 0.55rem;
    font-size: 0.86rem;
  }
  .rapida .num input {
    text-align: right;
    min-width: 6.5rem;
  }
  .rapida .moneda input {
    padding-left: 1.3rem;
  }
  .dicho td {
    padding: 0 0 0.45rem;
    border-bottom: 1px solid var(--borde);
  }
  .dicho span {
    font-size: 0.78rem;
  }
  /* «+ Renglón» a la izquierda; el contorno y la sombra los pone
     `.boton-agregar` (base.css), la misma de toda la app. */
  .botones .boton-agregar {
    margin-right: auto;
    padding: 0.6rem 1.1rem;
  }

  /* --- «Ponerlo en la carta» desde un insumo (B, inversa) --- */
  .fila-carta > td {
    background: #fffaf5;
    padding: 0.8rem 0.9rem;
  }
  .poner {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.7rem;
  }
  .poner .que {
    flex-basis: 100%;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .poner label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 11rem;
  }
  .poner label > span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .acciones-poner {
    display: flex;
    gap: 0.4rem;
    padding-bottom: 0.1rem;
  }
</style>
