<div align="center">

**DOCUMENTO DE PRIMER ORDEN · PRODUCTO**

# MotRest — PRD

**Documento de Requisitos de Producto (Product Requirements Document)**

*ERP restaurantero AI-first de MOTRAE · Cliente ancla: Rodizio*

**Innovation already in motion**

</div>

---

> **Xalapa, Veracruz · México · Julio 2026 | Confidencial**
> MOTRAE · Tecnología y Sistemas · Desarrollo de Software · **MotRest**
> Documento complementario: [`MOTRAE_MotRest_TRD.md`](MOTRAE_MotRest_TRD.md) (requisitos técnicos y arquitectura).
> Fuente de verdad de producto: [`README.md`](../README.md) · Estándar de mercado: `entregables/MOTRAE_Benchmark_Software_Restaurantero.docx` (cap. 7).

---

## Índice

1. [Visión y problema](#1-visión-y-problema)
2. [Usuarios y roles](#2-usuarios-y-roles)
3. [Requisitos rectores del CEO](#3-requisitos-rectores-del-ceo)
4. [Alcance funcional: módulos y estándar mínimo del mercado](#4-alcance-funcional-módulos-y-estándar-mínimo-del-mercado)
5. [Las cinco capacidades AI-first](#5-las-cinco-capacidades-ai-first)
6. [Experiencia por dispositivo](#6-experiencia-por-dispositivo)
7. [Modelo comercial](#7-modelo-comercial)
8. [Roadmap por fases (F0–F4)](#8-roadmap-por-fases-f0f4)
9. [Métricas de éxito y restricciones](#9-métricas-de-éxito-y-restricciones)
- [Anexo A — Catálogo funcional completo (estándar del benchmark)](#anexo-a--catálogo-funcional-completo-estándar-del-benchmark)

---

## 1. Visión y problema

**MotRest es el sistema operativo restaurantero de MOTRAE: un ERP que no se limita a vender alimentos y bebidas, sino que administra el negocio completo.** Reúne lo que un buen punto de venta hace —servicio en mesa, cocina, caja y facturación— y le suma las capas que solo un ERP entrega: **finanzas, recursos humanos, compras e inteligencia de negocio**, gobernado por un **panel por roles** y potenciado por una capa **AI-first** que ningún competidor ofrece hoy.

### El problema

Un restaurante que crece termina operando sobre herramientas dispersas: un POS que solo cobra, contabilidad en otro programa, nómina en hojas de cálculo, compras por WhatsApp y decisiones a ciegas. El costo es concreto: costo por platillo desconocido, merma descubierta a fin de mes, compras reactivas, control basado en confianza y no en sistema.

### La oportunidad (validada por benchmark, julio 2026)

El benchmark de competencia (SoftRestaurant, Wansoft, OpenTable) concluye que **ninguno de los tres actores cubre más de dos tercios del estándar funcional del mercado**:

- **SoftRestaurant y Wansoft** dominan la operación interna (POS, cocina, inventario, fiscal) pero su analítica es descriptiva y carecen de capa de demanda.
- **OpenTable** domina la demanda y el CRM del comensal, pero no opera el negocio; apenas llegó a México (dic-2025).
- **La IA operativa —predicción de demanda, compras y turnos autónomos, menu engineering— es una brecha total del mercado**, y coincide exactamente con las cinco capacidades AI-first ya definidas para MotRest.

**Posicionamiento resultante:** paridad total con SoftRestaurant/Wansoft en operación y fiscal (piso competitivo, Anexo A) + la capa de demanda/CRM que nadie ofrece localmente + la capa AI-first como categoría nueva.

### Cliente ancla

**Rodizio** (pizzas y pasta, México). Su realidad manda sobre el diseño: **recetas mitad-y-mitad** (costeo a nivel ingrediente), **merma sensible** (masa, quesos, salsas), **picos de demanda** (viernes/fin de semana) y **cocina por estaciones** (horno, línea de pasta, ensamble, despacho).

---

## 2. Usuarios y roles

Cada persona ve y administra **exactamente lo que su puesto requiere** (jerarquía de visión y administración, módulo M9). Cada rol separa **visión** (qué ve) de **administración** (qué modifica o autoriza):

| Rol | Visión | Administración | Dispositivo principal |
|---|---|---|---|
| **Dirección / Propietario** | Todo el negocio: consolidado, P&L, flujo, KPIs | Configura todo, autoriza cambios estratégicos, precios y políticas | Teléfono (panel remoto + Copiloto WhatsApp), laptop |
| **Gerente de sucursal** | Su sucursal: ventas, costos, inventario, personal | Opera el día a día; autoriza descuentos/cortesías dentro de su límite | PC de caja, tablet, teléfono |
| **Administración / Contabilidad** | Finanzas: CFDI, CxP/CxC, nómina, reportes | Cierra periodos, timbra, concilia, gestiona nómina | Back-office web |
| **Compras / Almacén** | Inventario, proveedores, OC, mermas | Genera y recibe compras, ajusta stock, evalúa proveedores | Tablet, back-office web |
| **Chef / Jefe de cocina** | Cocina: recetas, costos de platillo, mermas, KDS | Edita recetas, controla producción y merma de su área | KDS, tablet |
| **Cajero** | Su caja: cuentas abiertas, cobros, corte | Cobra, abre/cierra caja; cancelaciones solo con autorización | PC de caja |
| **Mesero / Servicio** | Sus mesas y sus ventas | Toma comandas, envía a cocina, mueve mesas | Tablet / teléfono (comandero) |
| **Comensal** (usuario externo) | Carta, su cuenta, sus reservas, sus puntos | Reserva, ordena por QR/kiosco/en línea, paga, autofactura, opina | Su propio teléfono, kiosco |

Sobre esta jerarquía corre el **Copiloto del Dueño**: cada rol pregunta en lenguaje natural (chat, voz o WhatsApp) y el sistema responde **solo con la información que ese rol tiene permitido ver**.

---

## 3. Requisitos rectores del CEO

Requisitos dictados por Gonzalo Jácome (CEO, MOTRAE) que gobiernan todo el producto:

| # | Requisito | Implicación de producto |
|---|---|---|
| **R1** | **App descargable/instalable** en todos los dispositivos del restaurante | Instaladores nativos para Windows (caja), Android (tablets, KDS, kiosco) e iOS (iPad/iPhone); una sola base de código |
| **R2** | **Los dispositivos se conectan entre ellos** en el local | Red local (LAN/WiFi) con descubrimiento automático y emparejamiento por QR; la PC de caja actúa como cerebro del local |
| **R3** | **Funciona sin internet** | El restaurante nunca deja de vender: comandar, cobrar en efectivo, cocinar, imprimir y descontar inventario operan 100 % offline; sincronización al volver la conexión |
| **R4** | **Compatible con los renders ya hechos** | Las 7 pantallas HTML/CSS de `entregables/claude_design_motrest/` son la semilla del design system real: misma tecnología, mismos componentes, acento naranja |
| **R5** | **Cubrir el estándar funcional del benchmark** | Las 18 categorías y +90 funciones del cap. 7 del benchmark son el **piso mínimo** del producto (Anexo A: cobertura 1:1) |
| **R6** | Todo lo demás necesario para operar correctamente | Impresión térmica, cortes de caja, roles/permisos, seguridad, CFDI, multisucursal futura, degradación elegante de la IA sin internet |

---

## 4. Alcance funcional: módulos y estándar mínimo del mercado

### 4.1 Los nueve módulos

MotRest es un sistema único con módulos integrados sobre una **misma base de datos central**; el valor está en que todos se hablan entre sí.

| # | Módulo | Qué resuelve |
|---|---|---|
| **M1** | **Punto de Venta y Servicio** | Mesas, comandas, cuentas (juntar/dividir), delivery, drive-thru, mapa de salón, **pizzas mitad-y-mitad**, productos configurables, kiosco y carta QR |
| **M2** | **Cocina (KDS) y Recetas** | Pantalla de cocina por estación, recetas vivas, costeo por ingrediente, control de tiempos |
| **M3** | **Inventario y Almacén** | Stock en tiempo real, descuento por receta, caducidades, merma, conteos cíclicos, multialmacén |
| **M4** | **Compras y Proveedores** | Órdenes de compra, recepción, precios por proveedor, ingesta de CFDI XML, evaluación de desempeño |
| **M5** | **Finanzas y Contabilidad** | Estado de resultados, flujo de caja, CxP/CxC, **facturación CFDI 4.0 nativa**, autofactura, enlace contable |
| **M6** | **Recursos Humanos y Nómina** | Turnos, asistencia (checador), propinas, rotación, prenómina, costo laboral |
| **M7** | **CRM y Fidelización** | Ficha 360° del cliente, historial, puntos, monedero, gift cards, campañas, **reservas omnicanal y waitlist** |
| **M8** | **Inteligencia de Negocio** | Tableros por rol, pronóstico, simulación, alertas por WhatsApp (motor de las 5 capacidades) |
| **M9** | **Administración y Roles** | Configuración, seguridad, auditoría, panel por jerarquía, multisucursal/multiempresa |

### 4.2 El estándar mínimo del mercado (benchmark cap. 7)

El benchmark consolidó **18 categorías y 99 funcionalidades** que SoftRestaurant, Wansoft y OpenTable ya ofrecen entre los tres. **MotRest las adopta todas como piso competitivo** — el detalle función por función, con módulo, fase y modo de operación, está en el **Anexo A**. Mapeo de categorías a módulos:

| Categoría del benchmark | Módulo MotRest | Fase principal |
|---|---|---|
| 7.1 Operación de piso y servicio | M1 | F1 |
| 7.2 Punto de venta y cobro | M1 | F1 (núcleo) · F3/F4 (pagos integrados, kiosco) |
| 7.3 Reservaciones y acceso | M7 | F3 |
| 7.4 Cocina y producción | M2 | F1 |
| 7.5 Delivery, takeout y canales digitales | M1 + integraciones | F2 |
| 7.6 Inventario, compras y costeo | M3 + M4 | F1 (núcleo) · F2 (compras completas) |
| 7.7 Finanzas y administración | M5 | F2 |
| 7.8 Facturación y cumplimiento fiscal | M5 | F2 |
| 7.9 Recursos humanos y personal | M6 | F1 (checador, roles) · F2 (prenómina) |
| 7.10 CRM y experiencia del cliente | M7 | F3 |
| 7.11 Fidelización y recompensas | M7 | F2 (promociones) · F3 (lealtad) |
| 7.12 Marketing y generación de demanda | M7 + M8 | F3 · F4+ (marketplace: visión de red futura) |
| 7.13 Reportes, BI y analítica | M8 | F1 (básicos) · F2 (BI) · F4 (benchmarking) |
| 7.14 IA y automatización | 5 capacidades AI-first | F3 — **la brecha del mercado** |
| 7.15 Multisucursal y corporativo | M9 | F4 |
| 7.16 Integraciones y APIs | Transversal | F2–F4 |
| 7.17 Seguridad, administración y auditoría | M9 | F1 |
| 7.18 Infraestructura, nube, hardware y apps | Base técnica (TRD) | F1–F2 |

**Decisión registrada:** el *marketplace de comensales* y las funciones de red de OpenTable (visibilidad promovida, colecciones editoriales, alianzas de demanda) requieren una red de restaurantes que MotRest aún no tiene; se adoptan como **visión de red futura (post-F4)** y quedan en el Anexo A con esa marca — se cubren, no se omiten.

---

## 5. Las cinco capacidades AI-first

La materialización del carácter AI-first de MOTRAE; **ningún software restaurantero del mercado las ofrece hoy** (benchmark 7.14: "Ninguno — brecha del mercado"). Cada una es un sub-agente especializado orquestado por la plataforma (capas 03–04):

| # | Capacidad | Qué hace | Valor |
|---|---|---|---|
| **C1** | **Gemelo Digital Operativo + simulador "¿Qué pasaría si…?"** | Réplica viva del restaurante (cocina, estaciones, salón, personal) para simular antes de decidir | Decisiones probadas en digital antes del piso; Lean de DELTA OPS en software |
| **C2** | **Menu Engineering con IA y precios inteligentes** | Matriz margen × popularidad (estrella/vaca/enigma/perro) con recomendaciones y precios para horas valle | La carta se vuelve herramienta de rentabilidad |
| **C3** | **Compras y turnos autónomos por pronóstico** | Pronóstico de demanda (histórico, día, clima, eventos, temporada) que genera OC y sugiere turnos | Menos quiebres de stock, menos sobrecompra, nómina dimensionada |
| **C4** | **Voz del Cliente omnicanal** | Ingiere reseñas de Google, Uber Eats, Rappi y redes; sentimiento conectado a platillo/turno/estación | La reputación como sistema de mejora continua |
| **C5** | **Centinela de mermas y anomalías** | Vigila en tiempo real cancelaciones, cortesías, descuentos, cortes y consumos; alerta patrones inusuales por turno y empleado | Prevención de pérdidas basada en datos, no en confianza |

**Regla de degradación (R3):** las capacidades corren en la nube; sus **salidas** (pronósticos, sugerencias, alertas, matriz) se sincronizan al local y quedan **visibles offline con sello de fecha**. El Copiloto del Dueño y la Voz del Cliente son servicios de nube puros.

---

## 6. Experiencia por dispositivo

Una sola aplicación con perfiles por dispositivo (R1); todos conectados entre sí en el local (R2) y operando sin internet (R3). El detalle técnico está en el TRD §11.

| Dispositivo | Rol en el local | Experiencia |
|---|---|---|
| **PC de caja (Windows)** | **Cerebro del local** (hub + UI de caja) | Cobro, cortes y arqueos, administración local; pantalla POS completa a 3 columnas (mockup P1) |
| **Tablet Android / iPad** | Comandero de mesero / POS móvil | Mapa de salón, comanda en mesa, mitad-y-mitad con costeo en vivo, dividir/traspasar cuentas |
| **Pantalla de cocina (KDS)** | Producción por estación | Comandas por estación con timers y semáforo (mockup P2); tipografía de lectura a distancia; modo kiosco |
| **Teléfono del dueño (iPhone/Android)** | Panel de dirección remoto | Dashboard de KPIs en vivo (mockup P3), alertas, Copiloto por WhatsApp (mockup P6) |
| **Kiosco de autoservicio** | Autoatención del comensal | Ordenar y pagar en pantalla; modo kiosco bloqueado (fase F4) |
| **Teléfono del comensal (carta QR)** | Canal digital propio | Menú interactivo, pedido y pago desde su celular; autofactura CFDI desde el QR del ticket |
| **Impresoras térmicas ESC/POS** | Periféricos | Comandas por área (cocina/barra), tickets, pre-cuentas y cortes; red, USB o Bluetooth |

**Puente con los renders (R4):** las 7 pantallas de `entregables/claude_design_motrest/producto/` (P1 POS, P2 KDS, P3 Dashboard, P4 Menu Engineering, P5 Centinela, P6 Copiloto, P7 Reporte mensual) son la fuente del design system del producto: mismos componentes (sidebar de módulos, header con rol/sucursal, tiles de mesa, tickets KDS), tipografía Space Grotesk + Inter y **acento naranja `#F2853A`** (decisión vigente de Gonzalo, 2026-07-03).

---

## 7. Modelo comercial

Principio rector MOTRAE: **se cobra por resultado, no por licencia.**

- **Cobro híbrido "piso + upside":** suscripción base por local **+ 15–20 % del ahorro verificado** (merma, food cost) contra la línea base de la Fase 0.
- **Planes escalonados (MXN, puntos de partida negociables):** Base **$1,490/mes** (POS + KDS + recetas + inventario + reportes) · Pro **$2,990/mes** (+ finanzas/CFDI, RR. HH., compras, 2 capacidades AI) · Multisucursal **desde $4,990/mes** (todo + 5 capacidades + Copiloto + consolidación).
- **Fase 0 facturada:** diagnóstico DELTA OPS ($15,000–$25,000 MXN) como primer entregable de pago y línea base del cobro por resultado.
- **Ingresos adicionales:** procesamiento de pagos/fintech (spread por transacción), marketplace de módulos AI activables ($490–$990 MXN/mes c/u), Reporte de Rentabilidad Mensual con IA como entregable de retención.
- **Garantía / SLA de ahorro:** "reducimos tu merma X % en 90 días o no cobramos el variable".

La tendencia del mercado valida la dirección: SoftRestaurant, Wansoft by Clip y OpenTable ya monetizan con ingresos variables (timbres, comisiones de pago, cuota por comensal sentado).

---

## 8. Roadmap por fases (F0–F4)

Alineado al plan de implementación con Rodizio (README §9) y a la cobertura del estándar del benchmark:

| Fase | Foco | Entregable | Cobertura del estándar |
|---|---|---|---|
| **F0 — Diagnóstico** | Levantamiento DELTA OPS + validación de riesgos técnicos | Retrato 360° de Rodizio; spikes: impresora térmica real, sync nube, red local en hardware real; PRD/TRD aprobados | — |
| **F1 — Núcleo operativo** | El restaurante opera el día a día en MotRest, **100 % offline-capaz** | POS completo (mesas, mitad-y-mitad, dividir/traspasar, propinas), KDS por estación, impresión por área, cobro efectivo, cortes/arqueos, inventario por receta y mermas, checador PIN, roles y auditoría, modo isla | 7.1, 7.2 (núcleo), 7.4, 7.6 (núcleo), 7.9 (núcleo), 7.17 |
| **F2 — ERP completo** | Paridad total con SoftRestaurant/Wansoft | Sincronización nube, CFDI 4.0 + autofactura + complementos, finanzas (egresos, P&L, enlace contable), compras completas + ingesta XML, prenómina, delivery (agregadores + canal propio + carta QR), promociones/cupones, dashboards y back-office web | 7.5, 7.6, 7.7, 7.8, 7.9, 7.13 (descriptivo), 7.18 |
| **F3 — Capa AI + demanda** | La diferenciación: la brecha del mercado + capa OpenTable | Las 5 capacidades AI-first + Copiloto WhatsApp; reservas omnicanal, waitlist, no-shows; CRM 360°; lealtad, monedero, gift cards; campañas y encuestas | 7.3, 7.10, 7.11, 7.12, 7.13 (predictivo), **7.14** |
| **F4 — Crecimiento** | Escalar con Rodizio y abrir mercado | Multisucursal/multiempresa/franquicias, API pública, pagos integrados/CoDi, kiosco de autoservicio, benchmarking de mercado, failover automático | 7.15, 7.16, resto de 7.2 |

---

## 9. Métricas de éxito y restricciones

### Métricas de éxito (por fase)

- **F1:** Rodizio opera un servicio de viernes completo en MotRest sin papel y sin internet (prueba de fuego de R2+R3); 0 ventas perdidas por fallas de red; corte de caja cuadrado contra efectivo real.
- **F2:** 100 % de ventas facturables timbradas (directo o por cola); cierre mensual (P&L) generado por el sistema sin contador externo; paridad funcional verificada contra el Anexo A (categorías F1–F2 completas).
- **F3:** ahorro verificado en merma/food cost contra línea base F0 (habilita el cobro variable); pronóstico de demanda con error decreciente mes a mes; Copiloto respondiendo al dueño por WhatsApp.
- **F4:** segunda sucursal (o segundo restaurante) onboardeada en < 1 semana; API pública documentada y consumida por al menos un tercero.

### Restricciones

| Restricción | Detalle |
|---|---|
| **Marca** | Acento dominante **naranja `#F2853A`** (decisión de Gonzalo 2026-07-03; desplaza al verde del README §12 en artefactos de producto); degradado naranja→rojo con moderación; Space Grotesk + Inter |
| **Idioma** | Español (producto, documentación, UI); mercado inicial: México |
| **Offline obligatorio** | Ninguna función del núcleo operativo (F1) puede depender de internet; la nube degrada, nunca bloquea |
| **Fiscal** | CFDI 4.0 nativo (México); el ticket sale al momento aunque el timbrado espere conexión |
| **Seguridad** | Secretos y llaves nunca al repositorio; datos del comensal propiedad del restaurante |
| **ODS** | Alineación con ODS 9 (innovación) y ODS 12 (la merma predictiva reduce desperdicio de alimentos) |

---

## Anexo A — Catálogo funcional completo (estándar del benchmark)

Las **99 funcionalidades** de las 18 categorías del cap. 7 del benchmark, con fidelidad 1:1 — **ninguna se omite**. Columnas: módulo responsable, fase en que se entrega, modo de operación (**Offline** = funciona sin internet en el local; **Nube** = requiere internet, con degradación indicada; **Híbrido** = opera local con arbitraje o complemento en nube) e importancia según el benchmark.

**Simbología de fase:** F1–F4 = fases del roadmap · **Red** = visión de red futura (post-F4, requiere masa crítica de restaurantes MotRest).

### A.7.1 Operación de piso y servicio

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Gestión de mesas con plano de piso | M1 | F1 | Offline | Alta |
| Modalidades de servicio múltiples (comedor, rápido, domicilio, drive-thru, autoservicio) | M1 | F1 | Offline | Alta |
| Comandero móvil / app de meseros | M1 | F1 | Offline | Alta |
| División y traspaso de cuentas (por comensal, unir mesas, propinas) | M1 | F1 | Offline | Media |
| Optimización de acomodo (seating) | M1 + M7 | F3 | Nube (sugerencias cacheadas) | Media |
| Control de turnos de servicio y pacing | M1 + M7 | F3 | Híbrido | Media |

### A.7.2 Punto de venta y cobro

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| POS de venta (productos, promociones, impuestos, formas de pago) | M1 | F1 | Offline | Alta |
| Pagos integrados (terminal conectada al POS) | M1 | F4 | Nube (fallback: terminal externa) | Alta |
| Cobro con QR y wallets | M1 | F4 | Nube | Media |
| Corte de caja y arqueos (por turno/cajero, retiros, diferencias) | M1 | F1 | Offline (sellado por el hub) | Alta |
| Propinas por comensal (registro y reparto) | M1 | F1 | Offline | Media |
| Depósitos y prepagos de reservas | M7 | F3 | Nube | Media |
| Kiosco de autoservicio | M1 | F4 | Offline (LAN) | Media |

### A.7.3 Reservaciones y acceso

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Motor de reservaciones omnicanal | M7 | F3 | Nube (agenda replicada al local) | Alta |
| Widget de reservas para sitio propio | M7 | F3 | Nube | Media |
| Lista de espera digital (waitlist) con aviso por SMS/WhatsApp | M7 | F3 | Nube (vista local en caja) | Media |
| Protección contra no-shows (recordatorios, retención de tarjeta, cargos) | M7 | F3 | Nube | Alta |
| Gestión de eventos privados | M7 | F3 | Nube | Media |
| Experiencias con cobro anticipado (degustaciones, chef's table) | M7 | F3 | Nube | Media |

### A.7.4 Cocina y producción

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| KDS con comandas, tiempos y estatus por platillo | M2 | F1 | Offline | Alta |
| Impresión de comandas por área (cocina, barra, repostería) | M2 | F1 | Offline | Alta |
| Recall / historial de comandas en KDS | M2 | F1 | Offline | Baja |
| Monitor de tiempos de producción por platillo y estación | M2 + M8 | F2 | Offline | Media |
| Estados de curso por mesa (entrada→fuerte→postre→pagado) | M1 + M2 | F2 | Offline | Media |

### A.7.5 Delivery, takeout y canales digitales de venta

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Integración con agregadores de delivery (Uber Eats, Rappi, DiDi Food) | M1 + integraciones | F2 | Nube (comanda baja al KDS) | Alta |
| Canal de pedidos en línea propio (sin comisiones) | M1 + integraciones | F2 | Nube | Alta |
| Takeout / pick-up (en sitio y en línea) | M1 | F1 (sitio) · F2 (línea) | Offline / Nube | Media |
| Menú digital / carta QR con pedido y pago desde el celular | M1 | F2 | Nube (pedido baja al hub) | Media |
| Gestión de repartidores propios | M1 | F2 | Híbrido | Baja |

### A.7.6 Inventario, compras y costeo

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Inventario por ingrediente y multialmacén en tiempo real | M3 | F1 | Offline | Alta |
| Recetas y subrecetas con explosión de insumos | M2 + M3 | F1 | Offline | Alta |
| Costeo ideal vs. real (teórico contra consumo) | M3 | F2 | Offline | Alta |
| Control de mermas (registro, alertas, ajustes) | M3 | F1 | Offline | Alta |
| Órdenes de compra y proveedores (mín/máx, consumo) | M4 | F2 | Híbrido | Alta |
| Registro de compras por CFDI XML (ingesta automática) | M4 | F2 | Nube (propuesta baja al local) | Media |
| Producción / rendimientos (órdenes de preparaciones internas) | M2 + M3 | F2 | Offline | Media |

### A.7.7 Finanzas y administración

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Módulo de egresos y gastos (flujo de efectivo) | M5 | F2 | Híbrido | Alta |
| Estado de resultados consultable | M5 | F2 | Nube (caché local con fecha) | Alta |
| Enlace contable (CONTPAQi, Aspel, Microsip) | M5 | F2 | Nube | Media |
| Cuentas por cobrar (clientes corporativos, crédito) | M5 | F2 | Híbrido | Baja |
| Bitácoras y alertas antifraude | M5 + M9 | F1 (bitácora) · F3 (alertas IA) | Offline / Nube | Alta |

### A.7.8 Facturación y cumplimiento fiscal

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Emisión y timbrado CFDI 4.0 desde el POS | M5 | F2 | Nube (cola de timbrado offline; ticket inmediato) | Alta |
| Autofactura del cliente (portal / QR del ticket) | M5 | F2 | Nube | Alta |
| Cancelación de CFDI y complementos de pago | M5 | F2 | Nube | Media |
| Venta de timbres/folios dentro del ecosistema | M5 | F2 | Nube | Media |

### A.7.9 Recursos humanos y personal

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Reloj checador / control de asistencia (PIN; biometría opcional) | M6 | F1 | Offline | Alta |
| Prenómina / nómina (horas, propinas, incidencias) | M6 | F2 | Híbrido | Media |
| Roles y permisos por perfil con autorizaciones | M9 | F1 | Offline | Alta |
| Metas e incentivos del personal | M6 | F3 | Híbrido | Baja |
| Desempeño de meseros (venta, propinas, tiempos) | M6 + M8 | F2 | Offline | Media |

### A.7.10 CRM y experiencia del cliente

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Perfil 360° del comensal (visitas, gasto, preferencias, alergias) | M7 | F3 | Nube (ficha básica cacheada) | Alta |
| Mensajería directa con el comensal (SMS/DM/WhatsApp) | M7 | F3 | Nube | Media |
| Encuestas de satisfacción post-visita | M7 | F3 | Nube | Media |
| Reseñas verificadas (solo comensales que asistieron) | M7 | F3 | Nube | Media |
| Base de datos de huéspedes propia y segmentable | M7 | F3 | Nube | Alta |

### A.7.11 Fidelización y recompensas

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Programa de lealtad / puntos | M7 | F3 | Híbrido (acumula offline; canje arbitrado) | Alta |
| Monedero electrónico / prepago | M7 | F3 | Nube (saldo arbitrado) | Media |
| Tarjetas de regalo (gift cards) | M7 | F3 | Nube (saldo arbitrado) | Media |
| Promociones y cupones (descuentos, 2x1, happy hour) | M1 + M7 | F2 | Offline (motor de reglas replicado) | Alta |
| Clientes VIP / niveles | M7 | F3 | Nube | Baja |

### A.7.12 Marketing y generación de demanda

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Marketplace de comensales | Visión de red | Red | Nube | Alta |
| Campañas de visibilidad promovida | Visión de red | Red | Nube | Media |
| Incentivos de hora valle (puntos multiplicados) | M7 + M8 (precios inteligentes C2) | F3 | Nube | Media |
| Campañas de email automatizadas (win-back, cumpleaños) | M7 | F3 | Nube | Media |
| Colecciones editoriales / distinción | Visión de red | Red | Nube | Baja |
| Alianzas de demanda (Visa, Uber Eats) | Visión de red / integraciones | Red | Nube | Media |

### A.7.13 Reportes, Business Intelligence y analítica

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Reportes operativos completos (área/servicio/horario/producto/mesero) | M8 | F1 (básicos) · F2 (completos) | Offline | Alta |
| Dashboards en tiempo real desde el móvil del dueño | M8 | F2 | Nube (panel remoto) | Alta |
| BI con reportes avanzados multi-dimensión | M8 | F2 | Nube | Media |
| Alertas y reportes por mensajería (WhatsApp) | M8 | F2 | Nube | Media |
| Benchmarking de mercado (comparación con la zona) | M8 | F4 | Nube | Media |
| Encuestas y analítica de satisfacción integradas al reporteo | M7 + M8 | F3 | Nube | Media |

### A.7.14 Inteligencia artificial y automatización

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Automatización de compras por documento fiscal (XML→inventario) | M4 | F2 | Nube | Media |
| Etiquetado automático de clientes por comportamiento | M7 | F3 | Nube | Media |
| Alertas antifraude automáticas | C5 Centinela | F3 | Nube (sobre event log local) | Media |
| **Predicción de demanda (IA)** — brecha del mercado | C3 | F3 | Nube (pronóstico cacheado offline) | Alta |
| **Compras y turnos autónomos (IA)** — brecha del mercado | C3 | F3 | Nube (sugerencias cacheadas) | Alta |
| **Menu engineering asistido por IA** — brecha del mercado | C2 | F3 | Nube (matriz cacheada) | Alta |

### A.7.15 Multisucursal y corporativo

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Administración multisucursal centralizada | M9 | F4 | Nube | Alta |
| Consolidación de reportes corporativos | M8 + M9 | F4 | Nube | Media |
| Multiempresa / multi-razón social | M9 | F4 (modelo de datos desde F1) | Nube | Media |
| Gestión de franquicias (catálogo estándar, royalties) | M9 | F4 | Nube | Media |

### A.7.16 Integraciones y APIs

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| API pública documentada | Transversal | F4 (diseño publicable desde F2) | Nube | Alta |
| Integraciones POS ↔ reservas (gasto, estados, cierre) | M1 + M7 | F3 | Nube | Media |
| Integraciones de pago (terminales, procesadores, CoDi) | M1 + M5 | F4 | Nube | Alta |
| Integraciones contables y de nómina (CONTPAQi, Aspel, NOI, Microsip) | M5 + M6 | F2 | Nube | Media |
| Integraciones de delivery (agregadores al POS) | M1 | F2 | Nube | Alta |
| Canales de reserva externos (Google, Instagram, apps aliadas) | M7 | F3 | Nube | Media |

### A.7.17 Seguridad, administración y auditoría

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Roles y permisos granulares con autorizaciones | M9 | F1 | Offline | Alta |
| Bitácoras de auditoría (cancelaciones, descuentos, reimpresiones) | M9 | F1 | Offline (event log inmutable) | Alta |
| Respaldo y sincronización en nube | M9 / base técnica | F2 | Nube (+ respaldo local nocturno) | Alta |
| **Operación offline con resincronización** | Base técnica | F1 | Offline — **núcleo del diseño (R3)** | Alta |
| Control de folios y datos fiscales (certificados) | M5 + M9 | F2 | Nube | Media |

### A.7.18 Infraestructura, nube, hardware y apps móviles

| Funcionalidad | Módulo | Fase | Modo | Importancia |
|---|---|---|---|---|
| Back-office 100 % web | Base técnica | F2 | Nube | Alta |
| Plataforma cloud (híbrida LAN-first: local autónomo + nube) | Base técnica | F2 | Híbrido | Alta |
| Apps móviles del ecosistema (dueño, mesero, cliente) | Base técnica | F1–F3 | Offline / Nube según app | Alta |
| Hardware certificado / compatible (impresoras, KDS, cajones) | Base técnica | F1 | Local | Media |
| Independencia de hardware propietario (tablets/PC estándar) | Base técnica | F1 | Local | Media |
| Soporte 24/7 y capacitación (academia MotRest) | Servicio operativo MOTRAE | F1 en adelante | — | Alta |

**Verificación de cobertura:** 6+7+6+5+5+7+5+4+5+5+5+6+6+6+4+6+5+6 = **99 funcionalidades** en 18 categorías — coincide con el "estándar de 18 categorías y más de 90 funcionalidades" del benchmark (§7.19). Cobertura 1:1: ninguna función del estándar queda fuera del producto; las de "visión de red" quedan registradas con esa marca.

---

<div align="center">

**MOTRAE** · *Innovation already in motion*
PRD · MotRest · Confidencial · Julio 2026 · Xalapa, Veracruz · México

</div>
