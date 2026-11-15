//! El servicio de fondo: recibe aunque Ajustes esté cerrado, busca cuando
//! alguien lo pide y lo cuenta todo por D-Bus (`org.bookos.BookShare`).

use std::collections::{BTreeMap, HashSet};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use zbus::Connection;

use crate::avahi::{self, Anuncio, Visto};
use crate::bluez::{self, Clasico, Emision};
use crate::enviar::{self, Carga, Envio};
use crate::recibir::{self, Recepcion};
use crate::{archivos, info, Direccion, Estado, Evento, Orden, TipoAparato, TipoTexto};

pub const NOMBRE_BUS: &str = "org.bookos.BookShare";
pub const RUTA: &str = "/org/bookos/BookShare";
/// El mismo puerto que usaba la versión con rqs_lib, por si ya hay una regla
/// de cortafuegos para él.
pub const PUERTO: u16 = 44551;
/// «Todos» durante 10 minutos, como en Android y en Quick Share para PC.
const TEMPORAL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibilidad {
    Visible,
    Temporal,
    Oculto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ajustes {
    pub activo: bool,
    pub visibilidad: Visibilidad,
    /// Hasta cuándo dura la visibilidad temporal (segundos UNIX).
    #[serde(default)]
    pub visible_hasta: u64,
    #[serde(default)]
    pub nombre: Option<String>,
}

impl Default for Ajustes {
    /// Visible: cada transferencia hay que aceptarla a mano, así que serlo no
    /// deja entrar nada; oculto por defecto, «Book Share no funciona».
    fn default() -> Self {
        Self { activo: true, visibilidad: Visibilidad::Visible, visible_hasta: 0, nombre: None }
    }
}

fn ruta_ajustes() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config"));
    base.join("bookos/bookshare.json")
}

fn ruta_historial() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/share"));
    base.join("bookos/bookshare-historial.jsonl")
}

fn ahora() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
pub struct Aparato {
    pub id: String,
    pub nombre: String,
    pub tipo: TipoAparato,
    pub ip: Ipv4Addr,
    pub puerto: u16,
}

struct Viva {
    ev: Evento,
    ordenes: mpsc::Sender<Orden>,
    aviso: Option<u32>,
}

#[derive(Default)]
struct Datos {
    ajustes: Ajustes,
    error: Option<String>,
    escucha: Option<JoinHandle<()>>,
    anuncio: Option<Anuncio>,
    /// Visible por Bluetooth clásico: solo en «Temporal».
    clasico: Option<Clasico>,
    /// Soltarlo para la escucha BLE.
    oido_ble: Option<mpsc::UnboundedSender<()>>,
    caducidad: Option<JoinHandle<()>>,
    aparatos: BTreeMap<String, Aparato>,
    /// Lo que emite Quick Share por BLE cerca pero no se ofrece para recibir:
    /// para decir en la página qué hacer en el móvil.
    cerca: Vec<String>,
    transferencias: BTreeMap<String, Viva>,
    /// Quién ha pedido buscar; al irse todos, se para.
    buscadores: HashSet<String>,
    /// La tarea que recoge lo que ve Avahi y el aviso BLE. Abortar la tarea
    /// suelta su receptor, y con eso Avahi libera su buscador.
    busqueda: Option<(JoinHandle<()>, Option<Emision>)>,
    siguiente_id: u64,
}

pub struct Nucleo {
    sesion: Connection,
    pub isla: crate::isla::Isla,
    sistema: Option<Connection>,
    datos: Mutex<Datos>,
    eventos: mpsc::UnboundedSender<Evento>,
    id_extremo: [u8; 4],
    puerto: u16,
    pub carpeta: PathBuf,
}

impl Nucleo {
    pub fn nuevo(sesion: Connection, sistema: Option<Connection>, puerto: u16) -> (Arc<Self>, mpsc::UnboundedReceiver<Evento>) {
        let (eventos, rx) = mpsc::unbounded_channel();
        let ajustes = std::fs::read_to_string(ruta_ajustes()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let nucleo = Arc::new(Self {
            sesion,
            isla: Default::default(),
            sistema,
            datos: Mutex::new(Datos { ajustes, ..Default::default() }),
            eventos,
            id_extremo: info::id_extremo(),
            puerto,
            carpeta: archivos::carpeta_book_share(),
        });
        (nucleo, rx)
    }

    fn nombre_propio(ajustes: &Ajustes) -> String {
        ajustes.nombre.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| {
            std::fs::read_to_string("/proc/sys/kernel/hostname").map(|h| h.trim().to_string()).unwrap_or_else(|_| "BookOS".into())
        })
    }

    pub async fn estado_json(&self) -> String {
        let d = self.datos.lock().await;
        serde_json::json!({
            "ok": true,
            "activo": d.ajustes.activo,
            "recibiendo": d.escucha.is_some(),
            "visibilidad": d.ajustes.visibilidad,
            "visible_hasta": d.ajustes.visible_hasta,
            "anunciado": d.anuncio.is_some(),
            "visible_bluetooth": d.clasico.is_some(),
            "nombre": Self::nombre_propio(&d.ajustes),
            "buscando": d.busqueda.is_some(),
            "bluetooth": d.busqueda.as_ref().map(|(_, e)| e.is_some()),
            "carpeta": self.carpeta,
            "aparatos": d.aparatos.values().collect::<Vec<_>>(),
            "cerca": d.cerca,
            "transferencias": d.transferencias.values().map(|v| &v.ev).collect::<Vec<_>>(),
            "error": d.error,
        })
        .to_string()
    }

    pub async fn notificar(&self) {
        let estado = self.estado_json().await;
        let _ = self.sesion.emit_signal(None::<()>, RUTA, NOMBRE_BUS, "StateChanged", &(estado,)).await;
    }

    async fn guardar(&self, ajustes: &Ajustes) {
        let ruta = ruta_ajustes();
        if let Some(p) = ruta.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        if let Ok(t) = serde_json::to_string_pretty(ajustes) {
            let _ = std::fs::write(&ruta, t);
        }
    }

    /// Pone en marcha o para lo que digan los ajustes: escuchar, anunciarse,
    /// atender avisos BLE y la caducidad de la visibilidad temporal.
    pub fn aplicar(self: &Arc<Self>) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        // En caja y con Send explícito: la caducidad de «Temporal» vuelve a
        // llamar a aplicar desde su tarea, y un async recursivo no lo prueba solo.
        Box::pin(self.aplicar_dentro())
    }

    async fn aplicar_dentro(self: &Arc<Self>) {
        let mut d = self.datos.lock().await;
        if d.ajustes.visibilidad == Visibilidad::Temporal && d.ajustes.visible_hasta <= ahora() {
            d.ajustes.visibilidad = Visibilidad::Oculto;
        }
        // Escuchar.
        if d.ajustes.activo && d.escucha.is_none() {
            match TcpListener::bind(("0.0.0.0", self.puerto)).await {
                Ok(escucha) => {
                    d.error = None;
                    let yo = Arc::clone(self);
                    d.escucha = Some(tokio::spawn(async move { yo.aceptar(escucha).await }));
                }
                Err(e) => d.error = Some(format!("no se puede recibir en el puerto {}: {e}", self.puerto)),
            }
        } else if !d.ajustes.activo {
            if let Some(h) = d.escucha.take() {
                h.abort();
            }
        }
        // Anunciarse.
        let anunciar = d.ajustes.activo && d.escucha.is_some() && d.ajustes.visibilidad != Visibilidad::Oculto;
        if anunciar && d.anuncio.is_none() {
            if let Some(sistema) = &self.sistema {
                match Anuncio::nuevo(sistema, &self.id_extremo, &Self::nombre_propio(&d.ajustes), self.puerto).await {
                    Ok(a) => {
                        d.anuncio = Some(a);
                        // El anuncio se rehace al cambiar nombre o visibilidad;
                        // la escucha no. BlueZ cuenta los escaneos por conexión:
                        // una segunda daba «InProgress» y, al cerrarse la
                        // primera, su StopDiscovery dejaba sin escuchar (pasó).
                        if d.oido_ble.is_none() {
                            d.oido_ble = self.escuchar_ble(sistema.clone());
                        }
                    }
                    Err(e) => d.error = Some(format!("no se pudo anunciar por mDNS: {e}")),
                }
            }
        } else if !anunciar {
            d.oido_ble = None;
            if let Some(a) = d.anuncio.take() {
                a.retirar().await;
            }
        }
        // Bluetooth clásico, para quien no comparte red. Solo en «Temporal»:
        // cambia el nombre Bluetooth del equipo y lo hace visible a cualquiera,
        // y eso no puede quedarse así siempre (ChromeOS hace igual).
        let clasico = anunciar && d.ajustes.visibilidad == Visibilidad::Temporal;
        if clasico && d.clasico.is_none() {
            if let Some(sistema) = &self.sistema {
                let alias = info::nombre_bluetooth(&self.id_extremo, &Self::nombre_propio(&d.ajustes), TipoAparato::Portatil);
                let (tx, mut rx) = mpsc::unbounded_channel::<std::os::unix::net::UnixStream>();
                let pausado = pausar_aviso(&mut d).await;
                let empezado = Clasico::empezar(sistema, &alias, tx).await;
                reanudar_aviso(sistema, &mut d, pausado).await;
                match empezado {
                    Ok(c) => {
                        d.clasico = Some(c);
                        let yo = Arc::clone(self);
                        // Termina sola cuando se para el perfil y se suelta su emisor.
                        tokio::spawn(async move {
                            while let Some(s) = rx.recv().await {
                                match tokio::net::UnixStream::from_std(s) {
                                    Ok(s) => yo.recibir(s).await,
                                    Err(e) => eprintln!("bookshare: conexión Bluetooth inservible: {e}"),
                                }
                            }
                        });
                    }
                    Err(e) => eprintln!("bookshare: sin Bluetooth clásico ({e}); solo red local"),
                }
            }
        } else if !clasico {
            self.parar_clasico(&mut d).await;
        }
        // Caducidad de «Temporal».
        if let Some(h) = d.caducidad.take() {
            h.abort();
        }
        if d.ajustes.visibilidad == Visibilidad::Temporal {
            let espera = d.ajustes.visible_hasta.saturating_sub(ahora());
            let yo = Arc::clone(self);
            d.caducidad = Some(tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(espera)).await;
                yo.datos.lock().await.ajustes.visibilidad = Visibilidad::Oculto;
                let a = yo.datos.lock().await.ajustes.clone();
                yo.guardar(&a).await;
                yo.aplicar().await;
                yo.notificar().await;
            }));
        }
    }

    /// Cuando un Android cercano empieza a compartir, se repite el anuncio.
    fn escuchar_ble(self: &Arc<Self>, sistema: Connection) -> Option<mpsc::UnboundedSender<()>> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let tx_ble = tx.clone();
        tokio::spawn(async move {
            if let Err(e) = bluez::escuchar(sistema, tx_ble).await {
                eprintln!("bookshare: sin escucha BLE ({e}); solo mDNS");
            }
        });
        let yo = Arc::clone(self);
        tokio::spawn(async move {
            while rx.recv().await.is_some() {
                let d = yo.datos.lock().await;
                if let Some(a) = &d.anuncio {
                    let _ = a.repetir(&yo.id_extremo, &Self::nombre_propio(&d.ajustes), yo.puerto).await;
                }
            }
        });
        Some(tx)
    }

    async fn aceptar(self: Arc<Self>, escucha: TcpListener) {
        loop {
            let Ok((socket, _)) = escucha.accept().await else { continue };
            let _ = socket.set_nodelay(true);
            self.recibir(socket).await;
        }
    }

    async fn recibir<S>(&self, socket: S)
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let (tx, ordenes) = mpsc::channel(4);
        let id = {
            let mut d = self.datos.lock().await;
            d.siguiente_id += 1;
            let id = format!("in-{}", d.siguiente_id);
            d.transferencias.insert(id.clone(), Viva { ev: provisional(&id, Direccion::Entrante), ordenes: tx, aviso: None });
            id
        };
        let r = Recepcion { id, carpeta: self.carpeta.clone(), eventos: self.eventos.clone(), ordenes };
        tokio::spawn(recibir::atender(socket, r));
    }

    /// Un cambio en una transferencia: se guarda, se avisa y, si es final, al
    /// historial.
    pub async fn evento(self: &Arc<Self>, ev: Evento) {
        self.isla.publicar(&self.sesion, &ev).await;
        let (aviso_previo, nuevo_aviso) = {
            let mut d = self.datos.lock().await;
            let Some(v) = d.transferencias.get_mut(&ev.id) else { return };
            let previo = v.ev.estado.clone();
            v.ev = ev.clone();
            (v.aviso, previo != ev.estado)
        };
        // Las notificaciones van en su tarea: si el servidor tarda (o D-Bus
        // intenta activar uno que no existe, 25 s medidos en un bus de prueba),
        // el progreso y el historial no pueden esperar por ellas.
        if nuevo_aviso {
            match (&ev.direccion, &ev.estado) {
                (Direccion::Entrante, Estado::EsperandoAceptacion) => {
                    let (yo, ev) = (Arc::clone(self), ev.clone());
                    tokio::spawn(async move {
                        let id = crate::avisos::pedir(&yo.sesion, &ev).await;
                        if let Some(v) = yo.datos.lock().await.transferencias.get_mut(&ev.id) {
                            v.aviso = id;
                        }
                    });
                }
                (_, e) if e.es_final() => {
                    guardar_historial(&ev);
                    if let (Direccion::Entrante, Estado::Terminada, None, [uno]) = (&ev.direccion, &ev.estado, &ev.texto, ev.elementos.as_slice()) {
                        if let Some(ruta) = uno.ruta.as_ref().filter(|r| archivos::se_abre_solo(r)) {
                            if let Err(e) = tokio::process::Command::new("xdg-open").arg(ruta).spawn() {
                                eprintln!("bookshare: no se pudo abrir {}: {e}", ruta.display());
                            }
                        }
                    }
                    let (sesion, ev2) = (self.sesion.clone(), ev.clone());
                    tokio::spawn(async move {
                        if let Some(id) = aviso_previo {
                            crate::avisos::cerrar(&sesion, id).await;
                        }
                        crate::avisos::resultado(&sesion, &ev2).await;
                    });
                    // Se deja a la vista unos segundos y se retira.
                    let yo = Arc::clone(self);
                    let id = ev.id.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_secs(8)).await;
                        yo.datos.lock().await.transferencias.remove(&id);
                        yo.notificar().await;
                    });
                }
                _ => {}
            }
        }
        self.notificar().await;
    }

    pub async fn ordenar(&self, id: &str, orden: Orden) -> Result<(), String> {
        let tx = self.datos.lock().await.transferencias.get(id).map(|v| v.ordenes.clone()).ok_or("esa transferencia ya no existe")?;
        tx.send(orden).await.map_err(|_| "esa transferencia ya ha terminado".to_string())
    }

    /// La notificación de una petición entrante devuelve aquí su botón.
    pub async fn accion_aviso(&self, aviso: u32, accion: &str) {
        let objetivo = {
            let d = self.datos.lock().await;
            d.transferencias.values().find(|v| v.aviso == Some(aviso)).map(|v| v.ev.clone())
        };
        match (accion, objetivo) {
            ("aceptar", Some(ev)) => {
                let _ = self.ordenar(&ev.id, Orden::Aceptar).await;
            }
            ("rechazar", Some(ev)) => {
                let _ = self.ordenar(&ev.id, Orden::Rechazar).await;
            }
            _ => crate::avisos::accion_resultado(aviso, accion).await,
        }
    }

    pub async fn empezar_busqueda(self: &Arc<Self>, cliente: String) {
        let mut d = self.datos.lock().await;
        d.buscadores.insert(cliente.clone());
        if d.busqueda.is_some() {
            return;
        }
        let Some(sistema) = self.sistema.clone() else {
            d.busqueda = Some((tokio::spawn(async {}), None));
            return;
        };
        let (tx, mut rx) = mpsc::unbounded_channel();
        let tx_av = tx.clone();
        let s = sistema.clone();
        let propio = info::nombre_mdns(&self.id_extremo);
        tokio::spawn(async move {
            if let Err(e) = avahi::buscar(s, tx_av, propio).await {
                eprintln!("bookshare: búsqueda mDNS: {e}");
            }
        });
        let emision = match Emision::empezar(&sistema).await {
            Ok(e) => Some(e),
            Err(e) => {
                eprintln!("bookshare: sin aviso BLE ({e}); los Android tendrán Quick Share abierto para vernos");
                None
            }
        };
        d.aparatos.clear();
        d.cerca.clear();
        // Mira cada pocos segundos qué hay cerca por BLE. Termina con la
        // búsqueda: al abortarse la tarea de abajo, el canal se cierra.
        let yo = Arc::clone(self);
        tokio::spawn(async move {
            while !tx.is_closed() {
                let cerca = bluez::cerca(&sistema).await.unwrap_or_default();
                let cambia = {
                    let mut d = yo.datos.lock().await;
                    let cambia = d.cerca != cerca;
                    d.cerca = cerca;
                    cambia
                };
                if cambia {
                    yo.notificar().await;
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
        let yo = Arc::clone(self);
        // Nunca termina sola: Avahi guarda un emisor hasta que se cierre este
        // receptor (antes eso dejaba un buscador vivo por cada búsqueda;
        // medido publicando un aparato tras parar). La aborta parar_busqueda.
        let recogida = tokio::spawn(async move {
            while let Some(v) = rx.recv().await {
                {
                    let mut d = yo.datos.lock().await;
                    match v {
                        Visto::Aparece { clave, nombre, tipo, ip, puerto } => {
                            // Avahi lo ve por cada interfaz (Wi-Fi, Tailscale, lo):
                            // se queda la dirección de la red local.
                            let mejor = d.aparatos.get(&clave).is_none_or(|a| rango(ip) < rango(a.ip));
                            if mejor {
                                d.aparatos.insert(clave.clone(), Aparato { id: clave, nombre, tipo, ip, puerto });
                            }
                        }
                        Visto::Desaparece { clave } => {
                            d.aparatos.remove(&clave);
                        }
                    }
                }
                yo.notificar().await;
            }
        });
        d.busqueda = Some((recogida, emision));
        // Si el cliente desaparece del bus sin parar la búsqueda (Ajustes se
        // cierra o se cae), se le quita igual.
        let yo = Arc::clone(self);
        let sesion = self.sesion.clone();
        tokio::spawn(async move {
            let Ok(dbus) = zbus::fdo::DBusProxy::new(&sesion).await else { return };
            let Ok(mut cambios) = dbus.receive_name_owner_changed_with_args(&[(0, cliente.as_str())]).await else { return };
            // Si ya se fue antes de suscribirse (un `gdbus call` se va en el
            // acto; medido), no llegará ningún aviso: se mira ahora.
            let sigue = match zbus::names::BusName::try_from(cliente.as_str()) {
                Ok(n) => dbus.name_has_owner(n).await.unwrap_or(false),
                Err(_) => false,
            };
            if !sigue {
                yo.parar_busqueda(&cliente).await;
                return;
            }
            while let Some(c) = cambios.next().await {
                if c.args().map(|a| a.new_owner().is_none()).unwrap_or(false) {
                    yo.parar_busqueda(&cliente).await;
                    break;
                }
            }
        });
    }

    pub async fn parar_busqueda(&self, cliente: &str) {
        let emision = {
            let mut d = self.datos.lock().await;
            d.buscadores.remove(cliente);
            if !d.buscadores.is_empty() {
                return;
            }
            d.aparatos.clear();
            d.cerca.clear();
            d.busqueda.take().and_then(|(recogida, e)| {
                recogida.abort();
                e
            })
        };
        if let Some(e) = emision {
            e.parar().await;
        }
        self.notificar().await;
    }

    pub async fn enviar(self: &Arc<Self>, aparato: &str, carga: Carga) -> Result<String, String> {
        let (destino, nombre, tipo, propio, id, ordenes) = {
            let mut d = self.datos.lock().await;
            let a = d.aparatos.get(aparato).cloned().ok_or("ese aparato ya no está cerca")?;
            d.siguiente_id += 1;
            let id = format!("out-{}", d.siguiente_id);
            let (tx, ordenes) = mpsc::channel(4);
            d.transferencias.insert(id.clone(), Viva { ev: provisional(&id, Direccion::Saliente), ordenes: tx, aviso: None });
            (SocketAddr::from((a.ip, a.puerto)), a.nombre, a.tipo, Self::nombre_propio(&d.ajustes), id, ordenes)
        };
        tokio::spawn(enviar::enviar(Envio { id: id.clone(), destino, aparato: nombre, tipo, nombre_propio: propio, carga, eventos: self.eventos.clone(), ordenes }));
        Ok(id)
    }

    pub async fn cambiar(self: &Arc<Self>, f: impl FnOnce(&mut Ajustes)) {
        let ajustes = {
            let mut d = self.datos.lock().await;
            f(&mut d.ajustes);
            d.ajustes.clone()
        };
        self.guardar(&ajustes).await;
        // Retirar y volver a anunciar: si cambió el nombre, el anuncio viejo sobra.
        {
            let mut d = self.datos.lock().await;
            if let Some(a) = d.anuncio.take() {
                a.retirar().await;
            }
            self.parar_clasico(&mut d).await;
        }
        self.aplicar().await;
        self.notificar().await;
    }

    pub async fn apagar(&self) {
        let mut d = self.datos.lock().await;
        if let Some(a) = d.anuncio.take() {
            a.retirar().await;
        }
        if let Some((_, Some(e))) = d.busqueda.take() {
            e.parar().await;
        }
        if let Some(c) = d.clasico.take() {
            c.parar().await;
        }
    }

    async fn parar_clasico(&self, d: &mut Datos) {
        let Some(c) = d.clasico.take() else { return };
        let pausado = pausar_aviso(d).await;
        c.parar().await;
        if let Some(sistema) = &self.sistema {
            reanudar_aviso(sistema, d, pausado).await;
        }
    }
}

/// El controlador Bluetooth de este equipo (Intel) no deja cambiar la
/// visibilidad con un anuncio LE puesto: el kernel registra «Opcode 0x2036
/// failed: -16», BlueZ contesta Busy y se queda creyendo que sigue visible
/// (pasó al apagarla mientras la página buscaba). Se retira el de la
/// búsqueda durante el cambio.
async fn pausar_aviso(d: &mut Datos) -> bool {
    match d.busqueda.as_mut().and_then(|(_, e)| e.take()) {
        Some(e) => {
            e.parar().await;
            true
        }
        None => false,
    }
}

async fn reanudar_aviso(sistema: &Connection, d: &mut Datos, pausado: bool) {
    if let (true, Some((_, e))) = (pausado, d.busqueda.as_mut()) {
        *e = Emision::empezar(sistema).await.ok();
    }
}

/// Preferencia de direcciones: red local privada, luego cualquier otra, y la
/// de Tailscale (100.64/10) y el bucle local al final.
fn rango(ip: Ipv4Addr) -> u8 {
    let o = ip.octets();
    if ip.is_private() {
        0
    } else if ip.is_loopback() {
        3
    } else if o[0] == 100 && (64..128).contains(&o[1]) {
        2
    } else {
        1
    }
}

fn provisional(id: &str, direccion: Direccion) -> Evento {
    Evento {
        id: id.into(),
        direccion,
        aparato: String::new(),
        tipo: TipoAparato::Desconocido,
        estado: Estado::Conectando,
        pin: None,
        elementos: Vec::new(),
        texto: None,
        total: 0,
        hechos: 0,
    }
}

fn guardar_historial(ev: &Evento) {
    use std::io::Write;
    let ruta = ruta_historial();
    if let Some(p) = ruta.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let mut linea = serde_json::to_value(ev).unwrap_or_default();
    linea["fin"] = ahora().into();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(ruta) {
        let _ = writeln!(f, "{linea}");
    }
}

pub fn historial(limite: usize) -> Vec<serde_json::Value> {
    let texto = std::fs::read_to_string(ruta_historial()).unwrap_or_default();
    let mut v: Vec<_> = texto.lines().rev().take(limite).filter_map(|l| serde_json::from_str(l).ok()).collect();
    v.shrink_to_fit();
    v
}

/// La API por D-Bus. Cada método devuelve el estado entero en JSON (o
/// `{"ok":false,"error":…}`), igual que el asistente de voz.
pub struct Api(pub Arc<Nucleo>);

fn fallo(e: impl std::fmt::Display) -> String {
    serde_json::json!({"ok": false, "error": e.to_string()}).to_string()
}

#[zbus::interface(name = "org.bookos.BookShare")]
impl Api {
    async fn get_state(&self) -> String {
        self.0.estado_json().await
    }

    async fn set_enabled(&self, activo: bool) -> String {
        self.0.cambiar(|a| a.activo = activo).await;
        self.0.estado_json().await
    }

    /// `visible`, `temporal` (10 minutos) u `oculto`.
    async fn set_visibility(&self, modo: String) -> String {
        let v = match modo.as_str() {
            "visible" => Visibilidad::Visible,
            "temporal" => Visibilidad::Temporal,
            "oculto" => Visibilidad::Oculto,
            _ => return fallo(format!("visibilidad desconocida: {modo}")),
        };
        self.0
            .cambiar(|a| {
                a.visibilidad = v;
                a.visible_hasta = if v == Visibilidad::Temporal { ahora() + TEMPORAL.as_secs() } else { 0 };
            })
            .await;
        self.0.estado_json().await
    }

    async fn set_name(&self, nombre: String) -> String {
        let nombre = nombre.trim().to_string();
        self.0.cambiar(|a| a.nombre = if nombre.is_empty() { None } else { Some(nombre) }).await;
        self.0.estado_json().await
    }

    async fn start_discovery(&self, #[zbus(header)] cabecera: zbus::message::Header<'_>) -> String {
        let cliente = cabecera.sender().map(|s| s.to_string()).unwrap_or_default();
        self.0.empezar_busqueda(cliente).await;
        self.0.notificar().await;
        self.0.estado_json().await
    }

    async fn stop_discovery(&self, #[zbus(header)] cabecera: zbus::message::Header<'_>) -> String {
        let cliente = cabecera.sender().map(|s| s.to_string()).unwrap_or_default();
        self.0.parar_busqueda(&cliente).await;
        self.0.estado_json().await
    }

    async fn send_files(&self, aparato: String, rutas: Vec<String>) -> String {
        match self.0.enviar(&aparato, Carga::Archivos(rutas.into_iter().map(PathBuf::from).collect())).await {
            Ok(_) => self.0.estado_json().await,
            Err(e) => fallo(e),
        }
    }

    async fn send_text(&self, aparato: String, texto: String, es_url: bool) -> String {
        let tipo = if es_url { TipoTexto::Url } else { TipoTexto::Texto };
        match self.0.enviar(&aparato, Carga::Texto { texto, tipo }).await {
            Ok(_) => self.0.estado_json().await,
            Err(e) => fallo(e),
        }
    }

    async fn accept(&self, id: String) -> String {
        self.orden(&id, Orden::Aceptar).await
    }

    async fn reject(&self, id: String) -> String {
        self.orden(&id, Orden::Rechazar).await
    }

    async fn cancel(&self, id: String) -> String {
        self.orden(&id, Orden::Cancelar).await
    }

    /// Abre la carpeta de lo recibido; solo esa, nunca una ruta que pase el cliente.
    async fn open_folder(&self) -> String {
        let _ = std::fs::create_dir_all(&self.0.carpeta);
        match tokio::process::Command::new("xdg-open").arg(&self.0.carpeta).spawn() {
            Ok(_) => self.0.estado_json().await,
            Err(e) => fallo(e),
        }
    }

    async fn get_history(&self, limite: u32) -> String {
        serde_json::json!({"ok": true, "historial": historial(limite as usize)}).to_string()
    }
}

impl Api {
    async fn orden(&self, id: &str, orden: Orden) -> String {
        match self.0.ordenar(id, orden).await {
            Ok(()) => self.0.estado_json().await,
            Err(e) => fallo(e),
        }
    }
}

/// «Cancelar» en la isla.
pub async fn escuchar_isla(nucleo: Arc<Nucleo>) {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let n = Arc::clone(&nucleo);
    tokio::spawn(async move {
        while let Some(id) = rx.recv().await {
            let _ = n.ordenar(&id, Orden::Cancelar).await;
        }
    });
    crate::isla::esperar_cancelar(&nucleo.sesion, &nucleo.isla, |id| {
        let _ = tx.send(id);
    })
    .await;
}

/// Las notificaciones devuelven sus botones por señal: se atienden aquí.
pub async fn escuchar_avisos(nucleo: Arc<Nucleo>) -> zbus::Result<()> {
    let regla = zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("org.freedesktop.Notifications")?
        .member("ActionInvoked")?
        .build();
    let mut senales = zbus::MessageStream::for_match_rule(regla, &nucleo.sesion, Some(8)).await?;
    while let Some(Ok(m)) = senales.next().await {
        if let Ok((id, accion)) = m.body().deserialize::<(u32, String)>() {
            nucleo.accion_aviso(id, &accion).await;
        }
    }
    Ok(())
}

