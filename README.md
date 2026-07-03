<div align="center">

**DOCUMENTO MAESTRO · SOFTWARE**

# MotRest

**El sistema operativo del restaurante**

*ERP restaurantero AI-first de MOTRAE · Cliente ancla: Rodizio*

**Innovation already in motion**

</div>

---

> **Xalapa, Veracruz · México · 2026  |  Confidencial**
> MOTRAE · Tecnología y Sistemas · Desarrollo de Software · **MotRest**
> Este archivo es el **contexto canónico** de la carpeta `Software_para_Restaurantes_ERP`.

---

> ### 📌 Para el asistente de IA (Claude) y cualquier colaborador nuevo
>
> Este README es la **fuente de verdad** de la vertical de software restaurantero de MOTRAE. Fusiona en un solo lugar **la empresa** (quién es MOTRAE y cómo trabaja), **el producto** (MotRest y su aplicación a Rodizio) y **la estrategia** (10 ideas para llevar el ERP a la excelencia). Si vas a desarrollar, documentar o presentar cualquier pieza de este software, empieza aquí.
>
> - Trata esta información como fuente de verdad sobre MOTRAE y sobre MotRest.
> - Mantén el **tono de marca**: moderno, profesional, con energía y movimiento; AI-first; orientado a resultados medibles.
> - MOTRAE es el **proveedor**, no el cliente. El cliente ancla es **Rodizio**.
> - Al construir cualquier artefacto visual, aplica la [identidad de marca](#12-identidad-de-marca).
> - Para desarrollo asistido por IA, la guía operativa corta está en [`CLAUDE.md`](CLAUDE.md).
> - Si algo de un proyecto contradice este archivo, **pregunta** antes de asumir.

---

## Ficha rápida

| Campo | Dato |
|---|---|
| **Producto** | **MotRest** — sistema operativo restaurantero (ERP) de MOTRAE |
| **Qué es** | Un **ERP para restaurantes**: no solo vende alimentos y bebidas, **administra todo el negocio** |
| **Categoría** | Vertical gastronómica de la Plataforma SaaS AI-first de MOTRAE |
| **Cliente ancla** | **Rodizio** — pizzas y pasta |
| **Diferencial** | POS + cocina + inventario + **finanzas, RR. HH., compras e inteligencia**, con **panel por roles** y capa **AI-first** |
| **Respaldo** | Plataforma SaaS de MOTRAE · metodología **DELTA OPS** · ODS 9 y 12 |
| **Modelo comercial** | Suscripción por local + **cobro por resultado** (ahorro verificado), no por licencia |
| **Sede** | Xalapa, Veracruz · México |
| **Contacto** | motrae.gmg@gmail.com · 228 353 6911 · www.motrae.com |

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Qué es MOTRAE (contexto de empresa)](#2-qué-es-motrae-contexto-de-empresa)
3. [El reto operativo de un restaurante](#3-el-reto-operativo-de-un-restaurante)
4. [MotRest: qué es y qué incluye](#4-motrest-qué-es-y-qué-incluye)
5. [Más que un punto de venta: la diferencia MotRest](#5-más-que-un-punto-de-venta-la-diferencia-motrest)
6. [Panel por roles y jerarquía de visión y administración](#6-panel-por-roles-y-jerarquía-de-visión-y-administración)
7. [Cinco capacidades propias de MotRest](#7-cinco-capacidades-propias-de-motrest)
8. [MotRest dentro de MOTRAE](#8-motrest-dentro-de-motrae)
9. [Aplicación a Rodizio: plan por fases](#9-aplicación-a-rodizio-plan-por-fases)
10. [★ 10 ideas para un ERP restaurantero excelente](#10--10-ideas-para-un-erp-restaurantero-excelente)
11. [Glosario](#11-glosario)
12. [Identidad de marca](#12-identidad-de-marca)
13. [Datos de contacto](#13-datos-de-contacto)

---

## 1. Resumen ejecutivo

**MotRest es el sistema operativo restaurantero de MOTRAE: un ERP que no se limita a vender alimentos y bebidas, sino que administra el negocio completo.** Reúne en una sola plataforma lo que un buen punto de venta hace —servicio en mesa, cocina, caja y facturación— y le suma las capas que solo un ERP entrega: **finanzas, recursos humanos, compras e inteligencia de negocio**, todo gobernado por un **panel por roles** que da a cada persona la visión y el control que su puesto requiere.

MotRest es la **vertical gastronómica** de la Plataforma SaaS AI-first de MOTRAE. No se construye desde cero: **aplica a la cocina una plataforma que MOTRAE ya domina** —cuatro capas (infraestructura, datos, inteligencia y orquestación agéntica) y la metodología **DELTA OPS**—, ajustándola a la realidad de un restaurante.

Su cliente ancla es **Rodizio**, especialista en pizzas y pasta, cuya operación —recetas combinables, mermas sensibles y picos de demanda marcados— es el banco de pruebas ideal. Sobre esa base, MotRest activa **cinco capacidades AI-first propias** que ningún software restaurantero del mercado ofrece hoy (sección 7).

> En una frase: **MotRest convierte el punto de venta de un restaurante en el sistema operativo de todo su negocio.**

Este documento fusiona el **contexto de empresa** (sección 2), la **definición del producto y su aplicación a Rodizio** (secciones 3–9) y **10 ideas estratégicas** para llevar el ERP a la excelencia, fundamentadas en investigación de mercado 2026 (sección 10).

---

## 2. Qué es MOTRAE (contexto de empresa)

**MOTRAE** es una compañía **AI-first** (fundada en 2026, Xalapa, Veracruz, México) que transforma las operaciones y los sistemas productivos de las empresas mediante **ingeniería estratégica, optimización inteligente e innovación funcional**.

Opera sobre **dos motores que se retroalimentan**:

```
                    ┌──────────────────────────────┐
                    │            MOTRAE            │
                    │       Compañía AI-first      │
                    └───────────────┬──────────────┘
            ┌───────────────────────┴───────────────────────┐
            │                                                │
   ┌────────▼─────────┐                          ┌───────────▼──────────┐
   │    DELTA OPS      │   datos reales e         │   PLATAFORMA SaaS     │
   │  Consultoría y    │   inteligencia aplicada  │  Sistema operativo    │
   │  optimización     │ ◀──────────  ⇄  ───────▶ │  AI-first             │
   │  (7 pilares)      │                          │  (4 capas + consola)  │
   └──────────────────┘                          └──────────────────────┘
```

- **DELTA OPS** — consultoría y optimización empresarial con una **metodología propietaria de 7 pilares**. Entrega **reducciones de costos operativos del 10–30 %** bajo un único contrato con responsabilidad sobre el resultado. Es la puerta de entrada comercial y la fuente continua de datos reales de campo.
- **Plataforma SaaS** — sistema operativo empresarial de **arquitectura agéntica** (4 capas + consola) que esos datos alimentan, validan y refinan. **MotRest es una instancia vertical de esta plataforma.**

**Misión.** Transformar las operaciones y los sistemas productivos de las empresas integrando infraestructura, datos, inteligencia y orquestación en una sola plataforma AI-first, para que tomen decisiones precisas y alcancen resultados medibles bajo una única responsabilidad operativa.

**Visión.** Convertirnos en el **sistema operativo** de las empresas que dejan de gestionar herramientas dispersas para operar sobre una arquitectura unificada; ser el referente en Latinoamérica de optimización inteligente, alineados con los ODS 9 y 12 de la ONU.

**Principio comercial rector:** *se cobra por resultado y por desempeño, no por horas ni por licencia de software.* Esta idea gobierna el modelo de cobro de MotRest (sección 10).

| Valor de MOTRAE | Significado |
|---|---|
| **Innovación funcional** | La innovación se mide por el valor real que entrega, no por su novedad. |
| **Profesionalismo y excelencia operativa** | Rigor, método y estándares altos en cada intervención. |
| **Sostenibilidad y ciclo verde** | Soluciones que perduran y generan valor sostenible. |
| **Cercanía** | Relación directa y de confianza con cada cliente. |
| **Evolución y movimiento continuo** | Mejora permanente; nada se detiene. |
| **Responsabilidad por resultados** | Asumimos el resultado, no solo el esfuerzo. |

**Equipo fundador:** Producto, Arquitectura y Operación Técnica — **Gonzalo Jácome**; Operaciones, Ejecución de Campo y Desarrollo Comercial — **Gerson Rivera**.

---

## 3. El reto operativo de un restaurante

Un restaurante que crece termina operando sobre **herramientas dispersas**: un punto de venta que solo cobra, una contabilidad en otro programa, una nómina en hojas de cálculo, compras por WhatsApp y decisiones tomadas con información incompleta y a destiempo.

Esa dispersión tiene un costo concreto que MotRest elimina de raíz:

- **El costo real de cada platillo es una incógnita** cuando el costeo por receta no está ligado a compras y mermas.
- **La merma se descubre tarde**, al cerrar el mes, cuando ya no hay remedio.
- **Nómina y turnos se gestionan a mano**, desconectados de las ventas que los justifican.
- **Las compras son reactivas**: se compra cuando algo se acaba, no cuando los datos anticipan que se va a acabar.
- **La dirección decide a ciegas**, con reportes tardíos que no cruzan ventas, costos, personal y proveedores.
- **El control depende de la confianza, no del sistema**: cancelaciones, cortesías y descuentos rara vez se auditan en tiempo real.

MotRest existe para que un restaurante deje de operar con piezas sueltas y pase a operar sobre **un solo sistema.**

---

## 4. MotRest: qué es y qué incluye

MotRest es un sistema único con módulos integrados sobre una **misma base de datos central**. Cada módulo aporta una pieza del negocio; el valor está en que **todos se hablan entre sí**.

| # | Módulo | Qué resuelve |
|---|---|---|
| **M1** | **Punto de Venta y Servicio** | Mesas, comandas, cuentas (juntar/dividir), delivery, drive-thru, mapa de salón, **pizzas mitad-y-mitad** y productos configurables |
| **M2** | **Cocina (KDS) y Recetas** | Pantalla de cocina por estación, recetas vivas, costeo por ingrediente, control de tiempos de preparación |
| **M3** | **Inventario y Almacén** | Stock en tiempo real, descuento por receta, caducidades, **merma** y conteos cíclicos |
| **M4** | **Compras y Proveedores** | Órdenes de compra, recepción, precios por proveedor, evaluación de desempeño |
| **M5** | **Finanzas y Contabilidad** | Estado de resultados, flujo de caja, cuentas por pagar/cobrar, **facturación CFDI** nativa |
| **M6** | **Recursos Humanos y Nómina** | Turnos, asistencia, propinas, rotación, costo laboral por hora y por estación |
| **M7** | **CRM y Fidelización** | Ficha de cliente, historial, programa de puntos, campañas y reservas |
| **M8** | **Inteligencia de Negocio** | Tableros por rol, pronóstico, simulación y alertas (motor de las 5 capacidades de la sección 7) |
| **M9** | **Administración y Roles** | Configuración, seguridad, auditoría y el **panel por jerarquía** (sección 6) |

---

## 5. Más que un punto de venta: la diferencia MotRest

El mercado restaurantero mexicano está bien servido de **puntos de venta**. Los referentes —**Soft Restaurant®** y **Wansoft**— resuelven con solidez la venta: mesas, cuentas, delivery, control de inventario por receta, facturación CFDI e integración con apps. Son excelentes en su terreno.

Pero su diseño se detiene en la frontera del POS: la **contabilidad** se resuelve por enlace a un sistema externo, los **recursos humanos** quedan fuera y la **analítica** es descriptiva —muestra lo que pasó, no anticipa lo que viene. MotRest absorbe todo lo que un buen POS hace y lo convierte en la **capa de captura** de un ERP completo.

| Dimensión | Software restaurantero común *(POS)* | **MotRest (ERP AI-first)** |
|---|---|---|
| **Enfoque** | Vender alimentos y bebidas | **Vender y administrar todo el negocio** |
| **Inventario y costeo** | Por receta, básico | **Costeo en tiempo real a nivel ingrediente + merma predictiva** |
| **Finanzas / Contabilidad** | No nativa; enlace a sistema externo | **Nativa**: estado de resultados, flujo de caja y CFDI integrados |
| **RR. HH. / Nómina** | Limitada o ausente | **Módulo nativo**: turnos, asistencia, propinas, costo laboral |
| **Compras** | Órdenes y alertas de mínimos | **Compras autónomas por pronóstico de demanda** |
| **Multisucursal** | Consolida ventas | Consolida **operación, finanzas y personal** |
| **Analítica** | Descriptiva (qué pasó) | **Predictiva y prescriptiva** (qué pasará y qué hacer) |
| **Inteligencia artificial** | Marginal o inexistente | **AI-first nativo**: agentes especializados |
| **Roles y permisos** | Básicos | **Jerarquía de visión y administración** (sección 6) |
| **Prevención de pérdidas** | Reportes a fin de mes | **Centinela con detección de anomalías en tiempo real** |

> El software restaurantero común responde *“¿cuánto vendí?”*. MotRest responde además *“¿cuánto gané, por qué, qué va a pasar mañana y qué debo hacer hoy?”*.

---

## 6. Panel por roles y jerarquía de visión y administración

En MotRest **cada persona ve y administra exactamente lo que su puesto requiere.** No son solo “permisos de usuario”: es una **jerarquía de visión y administración del negocio** que refleja el organigrama real del restaurante. Cada rol separa dos dimensiones:

- **Visión** — *qué información puede ver* (su mesa, su estación, su sucursal o toda la empresa).
- **Administración** — *qué puede modificar o autorizar* (tomar un pedido, aplicar un descuento, cambiar un precio, cerrar el mes).

```
                         ┌─────────────────────────────┐
                         │   DIRECCIÓN / PROPIETARIO    │  Visión total · Admin total
                         │   (toda la empresa)          │
                         └──────────────┬───────────────┘
                ┌───────────────────────┼───────────────────────┐
        ┌───────▼────────┐     ┌────────▼────────┐      ┌────────▼────────┐
        │ GERENTE DE      │     │ ADMINISTRACIÓN /│      │ COMPRAS /       │
        │ SUCURSAL        │     │ CONTABILIDAD    │      │ ALMACÉN         │
        │ (su sucursal)   │     │ (finanzas)      │      │ (inventario)    │
        └───────┬─────────┘     └─────────────────┘      └─────────────────┘
        ┌───────┴───────────────┐
   ┌────▼─────┐  ┌──────▼─────┐  ┌─────▼──────┐
   │ CHEF /   │  │ CAJERO     │  │ MESERO /   │
   │ COCINA   │  │ (caja)     │  │ SERVICIO   │
   └──────────┘  └────────────┘  └────────────┘
```

| Rol | Visión (qué ve) | Administración (qué controla) |
|---|---|---|
| **Dirección / Propietario** | **Todo el negocio**: consolidado, P&L, flujo de caja, todos los KPIs | Configura todo, autoriza cambios estratégicos, define precios y políticas |
| **Gerente de sucursal** | Su sucursal: ventas, costos, inventario, personal, turnos | Opera el día a día, autoriza descuentos y cortesías dentro de su límite |
| **Administración / Contabilidad** | Finanzas: CFDI, cuentas por pagar/cobrar, nómina, reportes | Cierra periodos, timbra, concilia, gestiona nómina |
| **Compras / Almacén** | Inventario, proveedores, órdenes de compra, mermas | Genera y recibe compras, ajusta stock, evalúa proveedores |
| **Chef / Jefe de cocina** | Cocina: recetas, costos de platillo, mermas, KDS | Edita recetas, controla producción y merma de su área |
| **Cajero** | Su caja: cuentas abiertas, cobros, corte | Cobra, abre/cierra caja; cancelaciones solo con autorización |
| **Mesero / Servicio** | Sus mesas y sus ventas | Toma comandas, envía a cocina, mueve mesas |

**Acceso por lenguaje natural (Copiloto del Dueño).** Sobre esta jerarquía corre un copiloto conversacional: cada rol puede preguntar en lenguaje natural —por chat o voz, incluso por WhatsApp— *“¿cómo va el día?”* o *“¿qué platillo dejó más margen esta semana?”*, y el sistema responde **solo con la información que ese rol tiene permitido ver.**

---

## 7. Cinco capacidades propias de MotRest

Más allá de superar al POS tradicional, MotRest incorpora **cinco capacidades propias** que hoy **ningún software restaurantero del mercado ofrece**. Son la materialización del carácter **AI-first** de MOTRAE, llevado a la cocina.

### 7.1 Gemelo Digital Operativo + simulador “¿Qué pasaría si…?”
Un **gemelo digital** vivo del restaurante —cocina, estaciones, salón, mesas y personal— que permite **simular antes de decidir**: *¿qué pasa con los tiempos de espera si agrego un cocinero el viernes?*, *¿y si reorganizo la línea del horno?*. Es la metodología **Lean de DELTA OPS** convertida en software.
> **Valor:** decisiones de operación probadas en digital antes de aplicarlas en piso.

### 7.2 Menu Engineering con IA y precios inteligentes
Un agente clasifica cada platillo en la matriz **margen × popularidad** (estrella, vaca, enigma, perro) y recomienda qué impulsar, qué rediseñar y qué retirar, además de **precios inteligentes** para horas valle.
> **Valor:** la carta deja de ser una lista de precios y se vuelve una **herramienta de rentabilidad**.

### 7.3 Compras y turnos autónomos por pronóstico de demanda
MotRest **pronostica la demanda** cruzando histórico, día de la semana, clima, eventos locales y temporada, y con ese pronóstico **genera las órdenes de compra** y **sugiere los turnos** necesarios.
> **Valor:** menos quiebres de stock, menos merma por sobrecompra y una nómina dimensionada a la demanda real.

### 7.4 Voz del Cliente omnicanal
Un agente ingiere reseñas de **Google, Uber Eats, Rappi y redes sociales**, analiza el **sentimiento** y conecta cada queja o elogio con el **platillo, turno o estación** responsable.
> **Valor:** la reputación se vuelve un sistema de mejora continua.

### 7.5 Centinela de mermas y anomalías
Un modelo de **detección de anomalías** vigila en tiempo real cancelaciones, cortesías, descuentos, cortes de caja y consumos de inventario, los correlaciona con turno y empleado, y **alerta de inmediato** los patrones inusuales.
> **Valor:** prevención de pérdidas basada en datos, no en confianza.

---

## 8. MotRest dentro de MOTRAE

MotRest es la **vertical gastronómica de la Plataforma SaaS de MOTRAE**, construida sobre sus cuatro capas —infraestructura, datos, inteligencia y orquestación agéntica— y respaldada por la metodología **DELTA OPS**.

| Activo MOTRAE | Cómo opera en MotRest |
|---|---|
| **Plataforma SaaS (4 capas + consola)** | MotRest es una instancia vertical: misma arquitectura agéntica, aplicada a la cocina |
| **DELTA OPS (7 pilares)** | Diagnóstico de la operación, optimización Lean de la cocina y mejora continua |
| **Arquitectura agéntica** | Cada una de las 5 capacidades es un sub-agente especializado orquestado por el sistema |
| **Responsabilidad por resultado** | El modelo comercial cobra por desempeño, no por licencia de software |

**Las cuatro capas de la plataforma, aplicadas al restaurante:**

| # | Capa | En MotRest |
|---|---|---|
| **01** | **Infraestructura** | Mapeo in situ de la cocina y el salón · stack cloud/híbrido · gobernanza de accesos por rol |
| **02** | **Datos** | Captura de ventas, recetas, inventario y personal · conectores a apps de delivery y bancos |
| **03** | **Inteligencia** | Router multi-modelo (Claude, GPT, Gemini) para pronóstico, menu engineering y detección de anomalías |
| **04** | **Orquestación agéntica** | Orquestador + los 5 sub-agentes especializados + Copiloto del Dueño, con traza completa |

**Alineación con los ODS de la ONU:** **ODS 9** (industria, innovación e infraestructura) al modernizar la tecnología del restaurante, y **ODS 12** (producción y consumo responsables) porque la merma predictiva y las compras por pronóstico **reducen el desperdicio de alimentos**.

---

## 9. Aplicación a Rodizio: plan por fases

**Rodizio** (pizzas y pasta) es el cliente ancla. Su cocina es exigente y por eso es el mejor banco de pruebas:

- **Recetas vivas y combinables** — pizzas mitad-y-mitad y pastas a elección obligan a costear **a nivel de ingrediente**.
- **Mermas sensibles** — masa, harina, quesos y salsas con caducidad y desperdicio reales.
- **Picos de demanda marcados** — viernes y fines de semana tensionan cocina, servicio y compras.
- **Cocina por estaciones** — horno, línea de pasta, ensamble y despacho encadenados: caso ideal para optimización Lean.

Implementación escalonada, validada en cada paso:

| Fase | Foco | Entregable principal |
|---|---|---|
| **Fase 0 — Diagnóstico** | Levantamiento DELTA OPS de la operación de Rodizio | Retrato 360° de cocina, flujos y datos |
| **Fase 1 — Núcleo operativo** | Venta, mesas, KDS, recetas e inventario en MotRest | Operación diaria corriendo en el sistema |
| **Fase 2 — ERP completo** | Finanzas, RR. HH., compras y panel por roles | Negocio administrado de extremo a extremo |
| **Fase 3 — Capa AI-first** | Las 5 capacidades + Copiloto del Dueño | Pronóstico, simulación, voz del cliente y centinela activos |
| **Fase 4 — Crecimiento** | Consolidación y preparación multisucursal | MotRest listo para escalar con Rodizio |

> Los plazos por fase se definen en la propuesta comercial, tras el diagnóstico de la Fase 0.

---

## 10. ★ 10 ideas para un ERP restaurantero excelente

> Bloque estratégico y **backlog vivo**. Reúne ideas de **cómo cobrar, qué entregar, qué construir y cómo captar**, fundamentadas en investigación de mercado 2026.
>
> **Benchmarks de referencia** *(jul 2026)*: **Soft Restaurant** renta desde **$500–$900 MXN/mes** por restaurante; **Toast** **$69–$110 USD/mes** por local (≈ $1,250–$2,000 MXN) más procesamiento de pagos (2.49–3.5 %) y hardware de $799–$1,500 USD, con contratos de 2–3 años; **Square for Restaurants** desde gratis hasta **~$60 USD/mes** por local. Tendencias 2026: IA en pronóstico de demanda, KDS como *hub* de orquestación, inventario con IA (Square + MarketMan), precios dinámicos y consolidación **multisucursal** como el caso de mayor ROI.
>
> Las cifras en MXN de abajo son **puntos de partida negociables** para posicionar MotRest por encima de un POS y por debajo del costo total de Toast, justificados por el ROI del ERP.

### Idea 1 — Cobro híbrido “piso + upside” (suscripción + resultado)
- **Qué es.** Una mensualidad base por local **más** una comisión sobre el **ahorro verificado** (merma y food cost) o la mejora de margen durante los primeros 6–12 meses.
- **Por qué.** Materializa el principio MOTRAE de *cobrar por resultado, no por licencia*, y alinea el precio con el valor que el cliente sí puede medir.
- **Cómo.** Base mensual (ver Idea 2) + **15–20 % del ahorro** medido contra la línea base de la Fase 0.
- **Encaje MOTRAE.** Es el modelo diferencial frente a Soft Restaurant/Toast, que cobran licencia fija.

### Idea 2 — Planes escalonados con precios en MXN (Base / Pro / Multisucursal)
- **Qué es.** Tres planes que mapean a Foundation / Scale / Enterprise del SaaS de MOTRAE.
- **Propuesta de partida** *(por local, negociable)*:

| Plan | Precio de partida | Incluye |
|---|---|---|
| **Base** | **$1,490 MXN/mes** | POS + KDS + recetas + inventario + reportes básicos |
| **Pro** | **$2,990 MXN/mes** | Todo Base + finanzas/CFDI + RR. HH./nómina + compras + 2 capacidades AI (menu engineering, centinela) |
| **Multisucursal** | **desde $4,990 MXN/mes** o cotización | Todo Pro + las 5 capacidades + Copiloto del Dueño + consolidación multisucursal + Customer Success |

- **Por qué.** Posiciona por encima del POS puro (Soft Restaurant) y captura el valor del ERP + IA.
- **Encaje MOTRAE.** Espeja los planes escalables de la plataforma.

### Idea 3 — Fase 0 (Diagnóstico DELTA OPS) como primer entregable facturado
- **Qué es.** Vender el **diagnóstico 360°** como primer entregable de pago (desde **$15,000–$25,000 MXN** según tamaño), antes de instalar el software.
- **Por qué.** Ancla el valor con datos reales (línea base para el cobro por resultado), reduce la fricción de la venta y financia el onboarding.
- **Encaje MOTRAE.** Es literalmente el Pilar 1 de DELTA OPS aplicado al restaurante.

### Idea 4 — Ingreso por procesamiento de pagos / fintech
- **Qué es.** Capturar un *spread* sobre pagos con tarjeta, TPV y **CoDi**, integrando cobro al POS.
- **Por qué.** Es la mayor fuente de ingreso recurrente de Toast, Square y Clip-Wansoft; escala con las ventas del cliente sin fricción adicional.
- **Cómo.** Alianza con un adquirente/PSP; MotRest gana un margen por transacción además del SaaS.
- **Encaje MOTRAE.** Convierte cada venta del restaurante en ingreso recurrente para MOTRAE.

### Idea 5 — Marketplace de módulos AI activables (add-ons)
- **Qué es.** Vender las 5 capacidades como **módulos activables** de pago independiente (p. ej. Centinela de mermas o Voz del Cliente a **$490–$990 MXN/mes** cada uno).
- **Por qué.** Upsell natural, aumenta el ARPU y deja que el cliente crezca a su ritmo.
- **Encaje MOTRAE.** Réplica del *marketplace de skills* del SaaS: cada capacidad es un sub-agente versionado.

### Idea 6 — Entregable “Reporte de Rentabilidad Mensual con IA”
- **Qué es.** Un dashboard/PDF automático enviado por **WhatsApp/correo** cada mes: P&L, food cost, mermas evitadas, menu engineering y recomendaciones.
- **Por qué.** **Tangibiliza** el valor del software (el dueño ve lo que ganó y lo que le ahorró MotRest), que es la palanca #1 de **retención** en SaaS.
- **Encaje MOTRAE.** Cierra el ciclo del cobro por resultado: el mismo reporte sustenta la factura variable.

### Idea 7 — Copiloto del Dueño por WhatsApp como gancho de adopción
- **Qué es.** Interfaz conversacional donde el dueño pregunta *“¿cómo va el día?”* y recibe respuesta en segundos, respetando su nivel de permisos.
- **Por qué.** Es el diferenciador más demostrable y **viral** (se enseña en una comida); baja la barrera de adopción de un ERP.
- **Encaje MOTRAE.** Es la capa de orquestación agéntica hecha producto de cara al usuario.

### Idea 8 — Motor de contenido y captación (marketing)
- **Qué es.** Rodizio como **caso de éxito ancla** + contenido educativo (food cost, merma, menu engineering) en **video animado estilo MOTRAE** para redes.
- **Por qué.** El contenido educativo genera demanda entrante barata en un sector con dueños ávidos de márgenes.
- **Encaje MOTRAE.** Aprovecha la capacidad de video animado que MOTRAE ya produce internamente.

### Idea 9 — Programa “design partner” con Rodizio (y siguientes)
- **Qué es.** Precio preferente y trato cercano a cambio de **datos de operación y testimonios** durante la etapa temprana.
- **Por qué.** Construye la **asimetría informacional** del sector gastronómico: cada restaurante onboardeado mejora los modelos para el siguiente.
- **Encaje MOTRAE.** Es una de las cuatro barreras de entrada de MOTRAE aplicada a una vertical.

### Idea 10 — Garantía de resultado / SLA de ahorro
- **Qué es.** Compromiso comercial tipo *“reducimos tu merma X % en 90 días o no cobramos el variable”*.
- **Por qué.** Elimina el **riesgo percibido**, el mayor freno de compra de un ERP; convierte la objeción de precio en una apuesta compartida.
- **Encaje MOTRAE.** Es la expresión pura del valor *responsabilidad por resultados*.

> **Cómo se conectan:** las ideas **1–5** definen *cómo cobrar*; la **3 y la 6** definen *qué se entrega*; la **7** define *el producto gancho*; las **8–9** definen *cómo captar*; y la **10** cierra la venta. Juntas convierten a MotRest de “un software” en “un socio de rentabilidad”.

---

## 11. Glosario

| Término | Significado |
|---|---|
| **ERP** (*Enterprise Resource Planning*) | Sistema que integra y administra todas las áreas de un negocio (ventas, finanzas, compras, RR. HH., inventario) en una sola plataforma. |
| **POS** (*Point of Sale*) | Punto de venta: software/hardware para registrar ventas y cobrar. |
| **KDS** (*Kitchen Display System*) | Pantalla de cocina que muestra y ordena las comandas por estación. |
| **CFDI** | Comprobante Fiscal Digital por Internet: la factura electrónica válida ante el SAT en México. |
| **CoDi** | Cobro Digital: plataforma de pagos por QR de Banxico. |
| **Food cost** | Costo de los insumos de un platillo respecto a su precio de venta; métrica clave de rentabilidad. |
| **Merma** | Pérdida de inventario por desperdicio, caducidad, robo o error de porción. |
| **Menu engineering** | Análisis de la carta cruzando margen y popularidad para maximizar rentabilidad. |
| **Costeo por receta** | Cálculo del costo de un platillo sumando el costo de cada ingrediente de su receta. |
| **Pronóstico de demanda** | Estimación de ventas futuras para planear compras y personal. |
| **Gemelo digital** | Réplica virtual de la operación que permite simular escenarios sin afectar la realidad. |
| **Detección de anomalías** | Técnica de IA que identifica patrones inusuales (posible merma, fraude o error). |
| **AI-first** | La IA es el núcleo del producto y de la operación, no un agregado posterior. |
| **DELTA OPS** | Vertical de consultoría y optimización de MOTRAE, con metodología propietaria de 7 pilares. |
| **Arquitectura agéntica** | Diseño de software donde agentes de IA ejecutan tareas de forma autónoma y coordinada. |
| **ARPU** | *Average Revenue Per User*: ingreso promedio por cliente. |
| **ODS** | Objetivos de Desarrollo Sostenible de la ONU (MotRest se alinea con el 9 y el 12). |

---

## 12. Identidad de marca

> ⚠️ **Aplicar SIEMPRE estos estándares** al construir cualquier artefacto visual de MotRest / MOTRAE (web, app, landing, deck, documento, UI). La marca transmite **modernidad, energía, profesionalismo, futuro, evolución y movimiento**.

### Paleta de color

| Color | Hex | Uso |
|---|---|---|
| **Verde MOTRAE** | `#57AD30` | Color de marca, **acento dominante**, CTAs |
| Naranja energía | `#F2853A` | Inicio del degradado de energía, highlights |
| Rojo energía | `#E0392B` | Fin del degradado de energía |
| Pizarra | `#2D3A42` | Textos, encabezados, fondos sobrios |
| Negro profundo | `#14181A` | Fondos premium, alto contraste |
| Verde claro | `#E8F3E1` | Fondos suaves, tarjetas, tintes |
| Gris medio | `#8A969C` | Texto secundario, subtítulos |

> **Degradado de energía:** naranja (`#F2853A`) → rojo (`#E0392B`). Úsese con moderación. **El verde es el acento dominante.**

### Tipografía
- **Títulos / encabezados:** `Space Grotesk` (geométrica, futurista, con movimiento).
- **Texto / cuerpo:** `Inter` (alta legibilidad, profesional).
- **Respaldos del sistema:** `Segoe UI, Arial, sans-serif`.

### Slogan
> **Innovation already in motion**
> *La ingeniería que mueve al siguiente nivel industrial.*

---

## 13. Datos de contacto

| Campo | Dato |
|---|---|
| **Empresa** | MOTRAE México |
| **Ubicación** | Xalapa, Veracruz · México |
| **Email** | motrae.gmg@gmail.com |
| **Teléfono** | 228 353 6911 |
| **Web** | www.motrae.com |
| **Horario de atención** | Lunes a viernes · 9:00 a 18:00 |

**Documentos relacionados:**
- Guía operativa para el asistente de IA: [`CLAUDE.md`](CLAUDE.md)
- Documento de proyecto original: `Clientes\04_Cliente_Rodizio\MOTRAE_Proyecto_Software_Restaurantero_ERP.md`
- Contexto de empresa maestro: `Identidad y Presentativos\01_Identidad\Documentos_de_Primer_Orden\MOTRAE_Documento_Empresa.md`

---

<div align="center">

**MOTRAE** · *Innovation already in motion*
Documento Maestro · MotRest · Confidencial · 2026 · Xalapa, Veracruz · México

</div>
