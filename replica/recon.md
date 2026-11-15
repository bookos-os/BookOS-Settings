# Recon map: Samsung Quick Share para PC (Windows) → Book Share (BookOS)

Scope: enviar y recibir archivos, enlaces y texto entre el portátil BookOS y
móviles cercanos (Android por Quick Share; iPhone por una vía propia), con
visibilidad, aceptación, progreso e historial. Vive en Ajustes → Dispositivos
conectados → Book Share, en Rust (Tauri), y guarda en `~/Descargas/Book-Share`.
For: la usuaria de BookOS en su propio portátil (Galaxy Book5 Pro).
Date: 2026-11-06

## Reglas de esta réplica

- Solo fuentes públicas. **No se ha abierto ni descompilado `QuickShareSetup.exe`**
  (13,3 MB, en `~/Descargas`): está fuera de lo permitido y no hace falta.
- El protocolo de Quick Share ya está reimplementado de forma abierta en
  `rqs_lib` 0.11.5 (fork de rquickshare dentro de `src-tauri/rqs_lib`). La
  réplica es de funciones y flujos, no de código de Samsung.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Ayuda de Google: Quick Share entre Android y Windows | https://support.google.com/android/answer/13801258 | qué se puede compartir, visibilidad, recepción |
| 2 | Ayuda de Google: visibilidad «Todos» | https://support.google.com/nexus/answer/2781895 | «Todos» vuelve al modo anterior a los 10 min |
| 3 | 9to5Google: visibilidad en Windows (dic. 2024) | https://9to5google.com/2024/12/12/quick-share-windows-visibility/ | Todos / Contactos / Tus dispositivos / Nadie |
| 4 | SamMobile: actualización de visibilidad | https://sammobile.com/news/google-quick-share-update-computer-improved-visibility | — |
| 5 | Samsung: Quick Share entre teléfonos | https://www.samsung.com/ae/support/mobile-devices/how-to-use-quick-share-to-share-a-file-between-phones/ | cercanos, QR/enlace, contactos, Apple |
| 6 | Make Tech Easier: Quick Share de Samsung | https://maketecheasier.com/use-samsung-quick-share/ | enlace a iPhone por la nube de Samsung (3 días) |
| 7 | Neowin: Quick Share de Samsung en PC no Samsung | https://www.neowin.net/news/samsung-brings-its-windows-quick-share-file-transfer-app-to-non-samsung-laptops/ | alcance de la app de Windows |
| 8 | HelpDeskGeek: fallos de Quick Share en Windows 11 | https://helpdeskgeek.com/fix-samsung-quick-share-not-working-windows/ | problemas típicos: visibilidad, Bluetooth, red |
| 9 | Código abierto: `rqs_lib` (rquickshare) | `src-tauri/rqs_lib` | protocolo real: mDNS `_FC9F5ED42C8A._tcp`, aviso BLE `0xFE2C`, TCP |

No se ha ejecutado la app de Samsung ni se ha usado ninguna cuenta: no hay
capturas de referencia en `replica/screens/`. Las pantallas se infieren de la
ayuda pública; las marcadas «guess» hay que confirmarlas si la usuaria tiene la
app en un PC con Windows.

## Core loop

Ver en una lista los aparatos cercanos y mandarles algo con un toque; recibir
lo que mandan con una petición que se acepta y acaba en una carpeta conocida.

## Screens (app de Samsung)

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Principal | abrir la app | nombre del PC, visibilidad, zona para soltar archivos | cabecera con nombre, selector de visibilidad, zona de arrastre, botón «Seleccionar archivos» | inactivo, visible, oculto (guess) |
| S02 | Elegir destino | tras elegir/soltar archivos | lista de aparatos cercanos | tarjetas de aparato (icono, nombre, tipo), «Buscando…» | buscando, vacío, con aparatos |
| S03 | Enviando | tocar un aparato | progreso del envío | barra, porcentaje, «Cancelar» | esperando aceptación, enviando, terminado, rechazado, error |
| S04 | Petición entrante | otro aparato manda algo | aceptar o rechazar | notificación del sistema con nombre, archivos, PIN, Aceptar/Rechazar | pendiente, aceptada, rechazada, caducada |
| S05 | Recibiendo | aceptar | progreso y destino | barra, «Abrir carpeta» al terminar | recibiendo, terminado, cancelado |
| S06 | Ajustes | engranaje | nombre, visibilidad, carpeta, notificaciones | filas de ajuste | — |
| S07 | Visibilidad | S01 o S06 | quién te ve | Todos (10 min) / Contactos / Tus dispositivos / Nadie | — |
| S08 | Compartir por enlace/QR | opción de envío | para quien no tiene Quick Share (iPhone) | QR, enlace, caducidad | subiendo, listo, caducado |
| S09 | Historial | menú | lo enviado y recibido | lista por fecha | vacío, con elementos (guess) |
| S10 | Menú contextual del explorador | clic derecho → Compartir con Quick Share | enviar sin abrir la app | entrada de menú | — |

## Flows

```
F01 Mandar fotos del PC a un Android
    S01 → seleccionar archivos → S02 → tocar aparato → S03 → terminado
    happy path clicks: 3 (seleccionar, elegir, aceptar en el móvil)
    edge: nadie cercano, el móvil no está visible, rechazo, se va de la red a mitad, archivo enorme

F02 Recibir de un Android
    móvil comparte → S04 → Aceptar → S05 → «Abrir carpeta»
    happy path clicks: 1
    edge: visibilidad «Nadie», PIN distinto, carpeta sin permisos, nombre repetido, se cancela en el móvil

F03 Mandar a un iPhone
    S01 → seleccionar → S08 → el iPhone escanea el QR → descarga
    happy path clicks: 2 en el PC + escanear
    edge: iPhone en otra red, caducidad, archivos muy grandes

F04 Recibir de un iPhone (no existe en Samsung; propio de Book Share)
    S08 «Recibir de iPhone» → QR → Safari en el iPhone → elegir fotos → subir → llega a Book-Share
    edge: otra red, subida cortada, varias a la vez

F05 Hacerse visible un rato
    S07 → Todos → vuelve solo al modo anterior a los 10 min

F06 Mandar desde otra app (explorador, navegador)
    S10 / botón compartir → S02 → S03
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Tarjeta de aparato | móvil, tableta, portátil, desconocido | buscando, disponible, enviando, no responde | S02 |
| Selector de visibilidad | Todos (temporal), Nadie (+ Contactos/Tus dispositivos: skip) | activo, cuenta atrás | S01, S06, S07 |
| Petición entrante | archivos, texto, enlace, wifi | pendiente, aceptada, rechazada, caducada | S04 |
| Barra de progreso | envío, recepción | indeterminada, %, terminada, error | S03, S05 |
| QR | enviar, recibir | generando, listo, caducado | S08 |
| Fila de historial | enviado, recibido | completado, fallido | S09 |
| Zona de arrastre | — | reposo, encima | S01 |

## Inferred data model

```
Aparato     id (ip:puerto), nombre, tipo (móvil|tableta|portátil|desconocido),
            ip, puerto, visto_por (mdns|ble|wifi-direct), última_vez
            evidence: rqs_lib EndpointInfo, S02
            confidence: high

Transferencia  id, dirección (entrante|saliente), aparato, estado (pendiente|
            esperando_aceptación|transfiriendo|terminada|rechazada|cancelada|
            error), pin, elementos[], bytes_totales, bytes_hechos, inicio, fin
            evidence: rqs_lib ChannelMessage/State, S03–S05
            confidence: high

Elemento    nombre, tamaño, tipo (archivo|texto|url|wifi), ruta_final
            evidence: rqs_lib TransferMetadata
            confidence: high

Visibilidad modo (visible|temporal|oculto), caduca_en
            evidence: fuentes 2–3, rqs_lib Visibility
            confidence: high

EnlaceWeb   token, dirección (enviar|recibir), elementos[], caduca_en, url, qr
            evidence: S08, fuente 6 (la versión Samsung es en la nube; la nuestra, local)
            confidence: medium

Historial   transferencia terminada + fecha
            evidence: S09
            confidence: guess
```

Relaciones: Aparato 1‑n Transferencia; Transferencia 1‑n Elemento; EnlaceWeb 1‑n Elemento.

## Estado actual de Book Share en Ajustes (auditoría del código)

Lo que ya hay: `rqs_lib` integrado (`src-tauri/src/quickshare.rs`), interruptor,
visibilidad sí/no, lista de cercanos, enviar archivos, aceptar/rechazar con PIN,
progreso en la isla (`isla.rs`), Wi‑Fi Direct (`p2p.rs`), KDE Connect y la hoja
de compartir enlaces del navegador. La carpeta ya es `~/Descargas/Book-Share`.

Problemas encontrados, con su causa:

1. **Solo recibe con la página abierta.** `pages.js` para el servicio en
   `clearPageIntervals` al salir; el interruptor no se guarda. Un móvil no
   puede mandar nada si Ajustes no está en esa página.
2. **El descubrimiento se atasca.** `mdns_discovery.rs` hace
   `TcpStream::connect` *dentro* del bucle de eventos y sin plazo: un aparato que
   no responde bloquea todos los demás hasta el plazo del sistema.
3. **Aparatos fantasma.** Los que se van sin anunciar su baja se quedan en la
   lista: no hay caducidad por última vez visto.
4. **El aviso BLE para despertar a los Android dura lo que la búsqueda**, y la
   búsqueda solo vive con la página abierta.
5. **Visibilidad pobre**: solo sí/no; `Visibility::Temporarily` existe en la
   librería con 60 s, no 10 min, y no se usa.
6. **Textos de prueba en la interfaz** («Abre Nearby Share en el S22 Ultra»).
7. **Interfaz con estilos en línea** y botones fuera de los componentes del HIG.
8. **iPhone: nada.** Quick Share no existe en iOS.

## Feature matrix

See `features.csv`. Must: 18, should: 8, could: 5, skip: 5.

## Out of scope (cannot or should not be cloned)

- **Visibilidad «Contactos» y «Tus dispositivos»**: dependen de certificados
  firmados por la cuenta de Google/Samsung. Sin su servidor no se pueden emitir.
- **Enlace en la nube de Samsung** (3 días): es su servidor. Se sustituye por
  un servidor web local en la misma red (F03/F04).
- **AirDrop**: protocolo de Apple sobre AWDL; en Linux exige tarjetas Wi‑Fi
  concretas en modo monitor (OWL). No es viable de forma fiable.
- **Mejora de banda a Wi‑Fi Direct/hotspot dentro del protocolo**: `rqs_lib` no
  la implementa; sin ella hace falta la misma red. Se mantiene el puente Wi‑Fi
  Direct de NetworkManager que ya existe, como experimental.
- **Integración con el ecosistema Samsung** (Galaxy Book, cuenta, «Private Share»).

## Size

Screens 10 (8 a construir), flows 6, entities 6. Hard parts: servicio en
segundo plano con la ventana cerrada y su notificación de petición entrante;
descubrimiento fiable (mDNS + BLE + caducidad) en redes reales; servidor web
local seguro para iPhone (token, caducidad, subida por partes). Size: **L**
(varias semanas), por fases: primero F01/F02 fiables, luego iPhone, luego extras.
