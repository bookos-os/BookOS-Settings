# Arquitectura: Book Share (BookOS)

Parte de `replica/recon.md` y `replica/features.csv`. Implementación propia del
protocolo Quick Share en Rust, sin `rqs_lib`.

## 1. Stack

La plantilla de la skill es para aplicaciones web; aquí es un servicio de
escritorio en Linux, así que cada capa se elige por lo que ya hay en BookOS.

| capa | elección | por qué |
| --- | --- | --- |
| proceso | binario propio `bookos-bookshare` (crate `bookshare/` en este repo) | tiene que recibir con Ajustes cerrado; el `--hidden` de Ajustes carga WebKit (~19 MB de suelo medido) y lo que es de fondo en BookOS va aparte (`bookos-budsd`, `bookos-assistant`) |
| arranque | unidad de usuario `bookos-bookshare.service` + activación D-Bus | mismo patrón que `bookos-budsd` y el asistente; `Type=dbus` |
| asincronía | `tokio` | ya es la del proyecto |
| D-Bus | `zbus` 4 | ya está; sirve para Avahi, BlueZ, la isla y la API propia |
| mDNS | **Avahi por D-Bus** (`org.freedesktop.Avahi`) | `avahi-daemon` está activo: no se abre el 5353 por nuestra cuenta ni se pelea con él; sustituye a `mdns-sd` (fork en GitHub) |
| aviso y escucha BLE | **BlueZ por D-Bus** (`LEAdvertisingManager1`, `Adapter1.SetDiscoveryFilter`) | BlueZ ofrece 12 instancias de aviso aquí; sustituye a `bluer` y `btleplug` |
| protobuf | `prost` + `prost-build` con los `.proto` de Google (Apache‑2.0) | ya están en el árbol; `protoc` 3.19.6 instalado |
| cifrado | `p256` (ECDH), `hkdf`, `hmac`, `sha2`, `libaes` (AES‑256‑CBC), `rand` | ya están en el `Cargo.lock`; no se reescribe criptografía |
| web para iPhone | servidor HTTP/1.1 propio sobre `tokio` (pocas rutas) | evita `hyper`/`axum`; sin TLS (misma red, token de un solo uso) |
| QR | **por decidir en el hito 5** | `qrcodegen` (un fichero, sin dependencias) o generarlo propio; se pregunta antes de añadir |
| interfaz | Ajustes (Tauri + JS), página Book Share | cliente de D-Bus como `asistente.rs` y `buds.rs` |

Se eliminan: `rqs_lib`, `bluer`, `btleplug`, `mdns-sd` (git), `sys_metrics`
(git), `ts-rs`, `get_if_addrs`, `tracing-subscriber`.

## 2. Datos (en lugar de un esquema SQL)

No hay base de datos: un ajuste y un historial, los dos del usuario.

```rust
// ~/.config/bookos/bookshare.json  (0600)
struct Ajustes {
    activo: bool,               // recibir en segundo plano
    visibilidad: Visibilidad,   // Visible | Temporal { hasta: u64 /* unix s */ } | Oculto
    nombre: Option<String>,     // None = hostname
}

// ~/.local/share/bookos/bookshare-historial.jsonl  (una línea por transferencia terminada)
struct Entrada {
    id: String, direccion: Direccion,          // Entrante | Saliente
    aparato: String, tipo: TipoAparato,        // Movil | Tableta | Portatil | Desconocido
    elementos: Vec<Elemento>,                  // nombre, bytes, ruta_final
    estado: Final,                             // Terminada | Rechazada | Cancelada | Fallida(motivo)
    inicio: u64, fin: u64,
}
```

En memoria del servicio:

```rust
struct Aparato { id: String /* ip:puerto */, nombre: String, tipo: TipoAparato,
                 ip: Ipv4Addr, puerto: u16, visto: Instant }      // caduca a los 30 s sin verse
struct Transferencia { id: String, direccion: Direccion, aparato: String,
                 estado: Estado, pin: Option<String>, elementos: Vec<Elemento>,
                 total: u64, hechos: u64 }
enum Estado { Conectando, EsperandoAceptacion, Transfiriendo,
              Terminada, Rechazada, Cancelada, Fallida(String) }
```

Reglas que no pueden fallar:
- Ningún byte se escribe en disco antes de aceptar.
- El nombre de archivo que manda el otro se sanea: sin `/`, sin `..`, sin
  control; si existe, `nombre (1).ext`.
- Se escribe a `nombre.part` y se renombra al terminar; si se corta, se borra.
- Todo cae en `~/Descargas/Book-Share` (vía `xdg-user-dir DOWNLOAD`).

## 3. API

### D-Bus `org.bookos.BookShare` en `/org/bookos/BookShare`

Mismo estilo que el asistente: cada método devuelve el estado en JSON y hay una
señal con los cambios.

| método | qué hace | flujo |
| --- | --- | --- |
| `GetState() → s` | activo, visibilidad, nombre, aparatos, transferencias | todos |
| `SetEnabled(b) → s` | arranca o para recibir; se guarda | F02 |
| `SetVisibility(s modo) → s` | `visible`, `temporal` (10 min), `oculto` | F05 |
| `StartDiscovery(s cliente) → s` | busca (Avahi + aviso BLE) mientras el cliente siga en el bus | F01 |
| `StopDiscovery() → s` | | F01 |
| `SendFiles(s aparato, as rutas) → s` | | F01, F06 |
| `SendText(s aparato, s texto, b es_url) → s` | | F06 |
| `Accept(s id) / Reject(s id) / Cancel(s id) → s` | | F02, F01 |
| `GetHistory(u limite) → s` | | S09 |
| `WebShare(as rutas) → s` / `WebReceive() → s` | QR para iPhone (hito 5) | F03, F04 |
| señal `StateChanged(s)` | cambios de aparatos, transferencias, visibilidad | |

Para enviar desde otras apps: `bookos-bookshare --send RUTA…` abre Ajustes en
Book Share con los archivos elegidos (sustituye a `--share-url` cuando toque).

### Petición entrante con Ajustes cerrado

La isla de BookOS ya muestra el progreso (`isla.rs`). Para Aceptar/Rechazar hay
que comprobar si `bookos-shell` admite acciones propias en una actividad; si no,
notificación de freedesktop con acciones. Se decide leyendo el código del
escritorio en el hito 2.

### HTTP para iPhone (hito 5)

| ruta | qué hace |
| --- | --- |
| `GET /s/{token}` | página para descargar lo compartido |
| `GET /s/{token}/{n}` | descarga del elemento n |
| `GET /r/{token}` | página para subir |
| `POST /r/{token}` | subida en streaming a `Book-Share` |

Token aleatorio de 128 bits en la URL del QR; caduca a los 10 min o al cerrar
la hoja; el servidor solo escucha mientras haya un QR abierto.

## 4. El protocolo (lo que hay que escribir)

Módulos del crate `bookshare`:

| módulo | contenido |
| --- | --- |
| `trama` | tramas con longitud de 4 bytes big‑endian sobre TCP |
| `ukey2` | ClientInit / ServerInit / ClientFinished, ECDH P‑256, auth string y PIN de 4 cifras |
| `canal` | SecureMessage + DeviceToDeviceMessage: AES‑256‑CBC + HMAC‑SHA256, claves por HKDF, números de secuencia |
| `conexion` | OfflineFrame: ConnectionRequest/Response, PayloadTransfer (bytes y archivos en trozos), KeepAlive, Disconnection |
| `compartir` | Sharing Frame: PairedKeyEncryption/Result, Introduction, Response, Cancel |
| `recibir`, `enviar` | las dos máquinas de estado |
| `mdns` | anunciar y buscar `_FC9F5ED42C8A._tcp` por Avahi; nombre del servicio y TXT `n` |
| `ble` | aviso con datos de servicio `0xFE2C` al buscar; escucha de avisos ajenos para volver a anunciarse |
| `archivos` | carpeta, saneado de nombres, `.part`, renombrado |
| `web` | hito 5 |
| `dbus`, `main` | servicio |

El cliente y el servidor se escriben a la vez y se prueban **contra sí mismos**
(enviar de este equipo a este equipo por loopback): así cada parte del protocolo
tiene una prueba sin necesidad de un móvil. La prueba con un Android real queda
para la usuaria.

## 5. Lo que muerde

- **Compatibilidad con Android**: cualquier campo mal puesto en el TXT de mDNS,
  en la Introduction o en el aviso BLE hace que el móvil no nos vea, sin error.
  Se toma como referencia el comportamiento documentado del protocolo y los
  `.proto`; la prueba final es con el móvil.
- **Cortafuegos**: el puerto TCP de recepción tiene que estar abierto en la red
  local. Ajustes tiene página de UFW; hay que comprobar el estado y avisar.
- **Archivos grandes**: escritura en streaming, nunca en memoria; espacio libre
  comprobado antes de aceptar.
- **Nombres maliciosos** (`../../.bashrc`): saneado obligatorio y con prueba.
- **Seguridad**: nada se acepta solo; el PIN se muestra para comparar.
- **Redes que cambian**: Avahi reanuncia; los aparatos caducan a los 30 s.
- **Varias transferencias a la vez**: cada una en su tarea, con su id.
- **Bluetooth apagado**: se busca solo por mDNS y se dice en la interfaz.
- **iPhone**: la web solo funciona en la misma red; HTTP sin TLS → token de un
  solo uso, caducidad corta y servidor apagado fuera de uso.

## 6. Orden de construcción

1. **Corte vertical: el protocolo contra sí mismo.** Crate `bookshare` con
   `trama`, `ukey2`, `canal`, `conexion`, `compartir`, `recibir`, `enviar`,
   `archivos`. Prueba: un archivo de 50 MB y un texto pasan por loopback, el PIN
   coincide en los dos lados, un nombre `../x` queda saneado.
2. **Servicio y recepción en segundo plano.** `mdns` (anunciar), `ble`
   (escucha), D-Bus, unidad de systemd, petición entrante con Ajustes cerrado.
   Pantallas S04, S05. Prueba de verdad: mandar desde el móvil de la usuaria.
3. **Enviar y descubrir.** Búsqueda por Avahi con caducidad, aviso BLE,
   `SendFiles`. Página nueva de Book Share en Ajustes con el HIG (S01–S03, S06,
   S07). Se quita `rqs_lib` y `quickshare.rs`.
4. **Visibilidad temporal, historial, nombre** (S07, S09).
5. **iPhone por QR** (S08, F03, F04).
6. **Extras**: arrastrar y soltar, enviar desde el explorador, Wi‑Fi Direct.
