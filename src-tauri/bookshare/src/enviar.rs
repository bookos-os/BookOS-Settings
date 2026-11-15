//! Lado de quien envía: abre la conexión, se presenta, espera a que el otro
//! acepte y manda los datos.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use prost::Message;
use rand::Rng;
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;

use crate::proto::compartir::{connection_response_frame::Status, file_metadata, text_metadata, v1_frame::FrameType, FileMetadata, TextMetadata};
use crate::proto::conexion::connection_response_frame::ResponseStatus;
use crate::proto::conexion::payload_transfer_frame::payload_header::PayloadType;
use crate::proto::conexion::OfflineFrame;
use crate::recibir::Informe;
use crate::sesion::{Llegada, Sesion};
use crate::{cifrado, info, marcos, protocolo, trama, Direccion, Elemento, Error, Estado, Evento, Orden, Texto, TipoAparato, TipoTexto};

/// Lo que mandan los Android: 512 KiB por trozo.
const TROZO: usize = 512 * 1024;
const PLAZO_CONECTAR: Duration = Duration::from_secs(5);
const PLAZO_SALUDO: Duration = Duration::from_secs(15);

pub enum Carga {
    Archivos(Vec<PathBuf>),
    Texto { texto: String, tipo: TipoTexto },
}

pub struct Envio {
    pub id: String,
    pub destino: SocketAddr,
    /// Cómo se llama el otro, según su anuncio: hasta que conteste no se sabe más.
    pub aparato: String,
    pub tipo: TipoAparato,
    /// Cómo nos presentamos.
    pub nombre_propio: String,
    pub carga: Carga,
    pub eventos: mpsc::UnboundedSender<Evento>,
    pub ordenes: mpsc::Receiver<Orden>,
}

enum Paso {
    Red(Vec<u8>),
    Orden(Orden),
}

/// Envía de principio a fin. Siempre deja un estado final publicado.
pub async fn enviar(e: Envio) {
    let Envio { id, destino, aparato, tipo, nombre_propio, carga, eventos, mut ordenes } = e;
    let mut informe = Informe::nuevo(id, Direccion::Saliente, eventos);
    informe.ev.aparato = aparato;
    informe.ev.tipo = tipo;
    informe.publicar();
    if let Err(e) = conversacion(destino, &nombre_propio, carga, &mut informe, &mut ordenes).await {
        if !informe.ev.estado.es_final() {
            informe.estado(Estado::Fallida(e.to_string()));
        }
    }
}

/// Tipo de Quick Share y MIME por la extensión: el otro lo usa para el icono y
/// para decidir dónde guardarlo (las fotos, a la galería).
fn tipo_archivo(ruta: &Path) -> (file_metadata::Type, &'static str) {
    use file_metadata::Type;
    let ext = ruta.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" => (Type::Image, "image/jpeg"),
        "png" => (Type::Image, "image/png"),
        "gif" => (Type::Image, "image/gif"),
        "webp" => (Type::Image, "image/webp"),
        "heic" => (Type::Image, "image/heic"),
        "mp4" => (Type::Video, "video/mp4"),
        "mkv" => (Type::Video, "video/x-matroska"),
        "webm" => (Type::Video, "video/webm"),
        "mov" => (Type::Video, "video/quicktime"),
        "mp3" => (Type::Audio, "audio/mpeg"),
        "ogg" | "opus" => (Type::Audio, "audio/ogg"),
        "flac" => (Type::Audio, "audio/flac"),
        "m4a" => (Type::Audio, "audio/mp4"),
        "wav" => (Type::Audio, "audio/wav"),
        "apk" => (Type::App, "application/vnd.android.package-archive"),
        "pdf" => (Type::Unknown, "application/pdf"),
        "txt" => (Type::Unknown, "text/plain"),
        "zip" => (Type::Unknown, "application/zip"),
        _ => (Type::Unknown, "application/octet-stream"),
    }
}

struct Saliente {
    id: i64,
    ruta: PathBuf,
    nombre: String,
    bytes: u64,
}

async fn leer_claro(socket: &mut TcpStream) -> Result<OfflineFrame, Error> {
    let datos = timeout(PLAZO_SALUDO, trama::leer(socket)).await.map_err(|_| Error::Tiempo("saludo"))??;
    Ok(OfflineFrame::decode(&*datos)?)
}

async fn conversacion(
    destino: SocketAddr,
    nombre_propio: &str,
    carga: Carga,
    informe: &mut Informe,
    ordenes: &mut mpsc::Receiver<Orden>,
) -> Result<(), Error> {
    // Lo que se va a mandar, antes de conectar: un archivo que no se puede
    // leer se dice ya, no después de que el otro acepte.
    let mut salientes = Vec::new();
    let mut texto: Option<(i64, Vec<u8>, TipoTexto)> = None;
    match carga {
        Carga::Archivos(rutas) => {
            for ruta in rutas {
                let meta = tokio::fs::metadata(&ruta).await?;
                if !meta.is_file() {
                    return Err(protocolo(format!("{} no es un archivo", ruta.display())));
                }
                let nombre = ruta.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "archivo".into());
                informe.ev.elementos.push(Elemento { nombre: nombre.clone(), bytes: meta.len(), ruta: Some(ruta.clone()) });
                informe.ev.total += meta.len();
                salientes.push(Saliente { id: rand::rng().random(), ruta, nombre, bytes: meta.len() });
            }
            if salientes.is_empty() {
                return Err(protocolo("no hay nada que enviar"));
            }
        }
        Carga::Texto { texto: t, tipo } => {
            informe.ev.total = t.len() as u64;
            informe.ev.texto = Some(Texto { tipo, titulo: t.clone(), contenido: Some(t.clone()) });
            texto = Some((rand::rng().random(), t.into_bytes(), tipo));
        }
    }

    let mut socket = timeout(PLAZO_CONECTAR, TcpStream::connect(destino))
        .await
        .map_err(|_| Error::Tiempo("conectar"))??;
    socket.set_nodelay(true)?;
    let id_extremo = info::id_extremo();
    let peticion = marcos::peticion_conexion(&id_extremo, nombre_propio, info::info_aparato(nombre_propio, TipoAparato::Portatil));
    trama::escribir(&mut socket, &peticion.encode_to_vec()).await?;
    let canal = timeout(PLAZO_SALUDO, cifrado::cliente(&mut socket)).await.map_err(|_| Error::Tiempo("UKEY2"))??;
    informe.ev.pin = Some(canal.pin.clone());
    trama::escribir(&mut socket, &marcos::respuesta_conexion().encode_to_vec()).await?;
    let respuesta = leer_claro(&mut socket).await?;
    let acepta = respuesta.v1.and_then(|v| v.connection_response).map(|r| r.response() == ResponseStatus::Accept).unwrap_or(false);
    if !acepta {
        informe.estado(Estado::Rechazada);
        return Ok(());
    }

    let mut s = Sesion::nueva(socket, canal);
    s.mandar_compartir(&marcos::clave_emparejada()).await?;

    loop {
        let paso = tokio::select! {
            t = s.trama() => Paso::Red(t?),
            Some(o) = ordenes.recv() => Paso::Orden(o),
        };
        let llegada = match paso {
            Paso::Orden(Orden::Cancelar) => {
                s.mandar_compartir(&marcos::cancelar()).await?;
                s.cerrar().await;
                informe.estado(Estado::Cancelada);
                return Ok(());
            }
            Paso::Orden(_) => continue,
            Paso::Red(datos) => match s.procesar(&datos).await? {
                Some(l) => l,
                None => continue,
            },
        };
        match llegada {
            Llegada::Compartir(marco) => {
                let Some(v1) = marco.v1 else { continue };
                match v1.r#type() {
                    FrameType::PairedKeyEncryption => s.mandar_compartir(&marcos::resultado_clave()).await?,
                    FrameType::PairedKeyResult => {
                        s.mandar_compartir(&presentacion(&salientes, texto.as_ref())).await?;
                        informe.estado(Estado::EsperandoAceptacion);
                    }
                    FrameType::Response => {
                        let estado = v1.connection_response.map(|r| r.status()).unwrap_or(Status::Unknown);
                        if estado != Status::Accept {
                            s.cerrar().await;
                            informe.estado(Estado::Rechazada);
                            return Ok(());
                        }
                        informe.estado(Estado::Transfiriendo);
                        if mandar_datos(&mut s, &salientes, texto.take(), informe, ordenes).await? {
                            informe.estado(Estado::Cancelada);
                            return Ok(());
                        }
                        // Se espera a que el otro cierre: si se corta antes, el
                        // último trozo podía quedarse sin escribir en el móvil.
                        let _ = timeout(Duration::from_secs(5), async {
                            while !matches!(s.siguiente().await, Err(_) | Ok(Llegada::Desconexion)) {}
                        })
                        .await;
                        s.cerrar().await;
                        informe.estado(Estado::Terminada);
                        return Ok(());
                    }
                    FrameType::Cancel => {
                        s.cerrar().await;
                        informe.estado(Estado::Cancelada);
                        return Ok(());
                    }
                    _ => {}
                }
            }
            Llegada::Desconexion => {
                let estado = if informe.ev.estado == Estado::EsperandoAceptacion { Estado::Rechazada } else { Estado::Cancelada };
                informe.estado(estado);
                return Ok(());
            }
            Llegada::Bytes { .. } | Llegada::Trozo { .. } => {}
        }
    }
}

fn presentacion(salientes: &[Saliente], texto: Option<&(i64, Vec<u8>, TipoTexto)>) -> crate::proto::compartir::Frame {
    let archivos = salientes
        .iter()
        .map(|f| {
            let (tipo, mime) = tipo_archivo(&f.ruta);
            FileMetadata {
                name: Some(f.nombre.clone()),
                r#type: Some(tipo.into()),
                payload_id: Some(f.id),
                size: Some(f.bytes as i64),
                mime_type: Some(mime.into()),
                id: Some(rand::rng().random()),
            }
        })
        .collect();
    let textos = texto
        .map(|(id, datos, tipo)| {
            let t = match tipo {
                TipoTexto::Url => text_metadata::Type::Url,
                TipoTexto::Direccion => text_metadata::Type::Address,
                TipoTexto::Telefono => text_metadata::Type::PhoneNumber,
                TipoTexto::Texto => text_metadata::Type::Text,
            };
            let titulo: String = String::from_utf8_lossy(datos).chars().take(100).collect();
            vec![TextMetadata {
                text_title: Some(titulo),
                r#type: Some(t.into()),
                payload_id: Some(*id),
                size: Some(datos.len() as i64),
                id: Some(rand::rng().random()),
            }]
        })
        .unwrap_or_default();
    marcos::presentacion(archivos, textos)
}

/// Manda el contenido. Devuelve `true` si se canceló a medias.
async fn mandar_datos(
    s: &mut Sesion,
    salientes: &[Saliente],
    texto: Option<(i64, Vec<u8>, TipoTexto)>,
    informe: &mut Informe,
    ordenes: &mut mpsc::Receiver<Orden>,
) -> Result<bool, Error> {
    if let Some((id, datos, _)) = texto {
        let total = datos.len() as i64;
        informe.progreso(datos.len() as u64);
        s.mandar(&marcos::trozo(id, PayloadType::Bytes, total, None, 0, datos, false)).await?;
        s.mandar(&marcos::trozo(id, PayloadType::Bytes, total, None, total, Vec::new(), true)).await?;
        return Ok(false);
    }
    let mut buffer = vec![0u8; TROZO];
    for f in salientes {
        let mut archivo = tokio::fs::File::open(&f.ruta).await?;
        let total = f.bytes as i64;
        let mut offset = 0i64;
        while offset < total {
            // Entre trozo y trozo: contestar keep-alives y ver si alguien canceló.
            if matches!(ordenes.try_recv(), Ok(Orden::Cancelar)) {
                s.mandar_compartir(&marcos::cancelar()).await?;
                s.cerrar().await;
                return Ok(true);
            }
            match s.pendiente().await? {
                Some(Llegada::Desconexion) => return Err(Error::Cortado),
                Some(Llegada::Compartir(m)) if m.v1.as_ref().is_some_and(|v| v.r#type() == FrameType::Cancel) => {
                    s.cerrar().await;
                    return Ok(true);
                }
                _ => {}
            }
            let leidos = archivo.read(&mut buffer).await?;
            if leidos == 0 {
                return Err(protocolo(format!("{} se ha acortado mientras se enviaba", f.ruta.display())));
            }
            let leidos = leidos.min((total - offset) as usize);
            s.mandar(&marcos::trozo(f.id, PayloadType::File, total, Some(f.nombre.clone()), offset, buffer[..leidos].to_vec(), false))
                .await?;
            offset += leidos as i64;
            informe.progreso(leidos as u64);
        }
        s.mandar(&marcos::trozo(f.id, PayloadType::File, total, Some(f.nombre.clone()), total, Vec::new(), true)).await?;
    }
    Ok(false)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::recibir::{atender, Recepcion};
    use tokio::net::TcpListener;

    struct Prueba {
        carpeta: PathBuf,
        rx_entrante: mpsc::UnboundedReceiver<Evento>,
        rx_saliente: mpsc::UnboundedReceiver<Evento>,
        orden_entrante: mpsc::Sender<Orden>,
        orden_saliente: mpsc::Sender<Orden>,
    }

    /// Un receptor y un emisor de verdad, por TCP en 127.0.0.1.
    async fn montar(nombre: &str, carga: Carga) -> Prueba {
        let carpeta = std::env::temp_dir().join(format!("bookshare-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&carpeta);
        let escucha = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let destino = escucha.local_addr().unwrap();
        let (tx_e, rx_entrante) = mpsc::unbounded_channel();
        let (orden_entrante, ordenes_e) = mpsc::channel(4);
        let c = carpeta.clone();
        tokio::spawn(async move {
            let (socket, _) = escucha.accept().await.unwrap();
            atender(socket, Recepcion { id: "in".into(), carpeta: c, eventos: tx_e, ordenes: ordenes_e }).await;
        });
        let (tx_s, rx_saliente) = mpsc::unbounded_channel();
        let (orden_saliente, ordenes_s) = mpsc::channel(4);
        tokio::spawn(enviar(Envio {
            id: "out".into(),
            destino,
            aparato: "Prueba".into(),
            tipo: TipoAparato::Movil,
            nombre_propio: "Book de prueba".into(),
            carga,
            eventos: tx_s,
            ordenes: ordenes_s,
        }));
        Prueba { carpeta, rx_entrante, rx_saliente, orden_entrante, orden_saliente }
    }

    async fn hasta(rx: &mut mpsc::UnboundedReceiver<Evento>, f: impl Fn(&Evento) -> bool) -> Evento {
        timeout(Duration::from_secs(20), async {
            loop {
                let ev = rx.recv().await.expect("el canal sigue abierto");
                if f(&ev) {
                    return ev;
                }
            }
        })
        .await
        .expect("llega el estado esperado")
    }

    fn archivo_de_prueba(nombre: &str, bytes: usize) -> (PathBuf, Vec<u8>) {
        let datos: Vec<u8> = (0..bytes).map(|i| (i * 7 % 251) as u8).collect();
        let ruta = std::env::temp_dir().join(format!("{}-{}", std::process::id(), nombre));
        std::fs::write(&ruta, &datos).unwrap();
        (ruta, datos)
    }

    #[tokio::test]
    async fn un_archivo_grande_llega_entero_y_con_el_mismo_pin() {
        let (ruta, datos) = archivo_de_prueba("grande.bin", 5 * 1024 * 1024 + 123);
        let (vacio, _) = archivo_de_prueba("vacio.txt", 0);
        let mut p = montar("grande", Carga::Archivos(vec![ruta.clone(), vacio.clone()])).await;

        let pide = hasta(&mut p.rx_entrante, |e| e.estado == Estado::EsperandoAceptacion).await;
        let espera = hasta(&mut p.rx_saliente, |e| e.estado == Estado::EsperandoAceptacion).await;
        assert_eq!(pide.pin, espera.pin, "los dos enseñan el mismo PIN");
        assert_eq!(pide.aparato, "Book de prueba");
        assert_eq!(pide.total, datos.len() as u64);
        assert!(pide.elementos.iter().all(|e| e.ruta.is_none()), "nada escrito antes de aceptar");
        assert!(!p.carpeta.exists() || std::fs::read_dir(&p.carpeta).unwrap().count() == 0);

        p.orden_entrante.send(Orden::Aceptar).await.unwrap();
        let fin = hasta(&mut p.rx_entrante, |e| e.estado.es_final()).await;
        assert_eq!(fin.estado, Estado::Terminada);
        assert_eq!(fin.hechos, datos.len() as u64);
        let recibido = fin.elementos[0].ruta.clone().unwrap();
        assert_eq!(std::fs::read(&recibido).unwrap(), datos);
        assert_eq!(std::fs::read(fin.elementos[1].ruta.clone().unwrap()).unwrap(), b"");
        let fin_s = hasta(&mut p.rx_saliente, |e| e.estado.es_final()).await;
        assert_eq!(fin_s.estado, Estado::Terminada);
        let sobras: Vec<_> = std::fs::read_dir(&p.carpeta).unwrap().filter_map(|e| e.ok()).filter(|e| e.path().extension().is_some_and(|x| x == "part")).collect();
        assert!(sobras.is_empty(), "no quedan .part");
        let _ = p.orden_saliente;
        std::fs::remove_dir_all(&p.carpeta).unwrap();
        std::fs::remove_file(ruta).unwrap();
        std::fs::remove_file(vacio).unwrap();
    }

    #[tokio::test]
    async fn un_enlace_llega_como_texto() {
        let url = "https://bookos.example/descargas?x=1".to_string();
        let mut p = montar("enlace", Carga::Texto { texto: url.clone(), tipo: TipoTexto::Url }).await;
        let pide = hasta(&mut p.rx_entrante, |e| e.estado == Estado::EsperandoAceptacion).await;
        assert_eq!(pide.texto.as_ref().unwrap().tipo, TipoTexto::Url);
        p.orden_entrante.send(Orden::Aceptar).await.unwrap();
        let fin = hasta(&mut p.rx_entrante, |e| e.estado.es_final()).await;
        assert_eq!(fin.estado, Estado::Terminada);
        assert_eq!(fin.texto.unwrap().contenido.unwrap(), url);
    }

    #[tokio::test]
    async fn rechazar_no_escribe_nada_y_avisa_al_que_envia() {
        let (ruta, _) = archivo_de_prueba("rechazado.jpg", 1000);
        let mut p = montar("rechazo", Carga::Archivos(vec![ruta.clone()])).await;
        hasta(&mut p.rx_entrante, |e| e.estado == Estado::EsperandoAceptacion).await;
        p.orden_entrante.send(Orden::Rechazar).await.unwrap();
        assert_eq!(hasta(&mut p.rx_entrante, |e| e.estado.es_final()).await.estado, Estado::Rechazada);
        assert_eq!(hasta(&mut p.rx_saliente, |e| e.estado.es_final()).await.estado, Estado::Rechazada);
        assert!(!p.carpeta.exists());
        std::fs::remove_file(ruta).unwrap();
    }

    #[tokio::test]
    async fn cancelar_a_medias_no_deja_archivos_a_medias() {
        let (ruta, _) = archivo_de_prueba("cancelado.bin", 40 * 1024 * 1024);
        let mut p = montar("cancelar", Carga::Archivos(vec![ruta.clone()])).await;
        hasta(&mut p.rx_entrante, |e| e.estado == Estado::EsperandoAceptacion).await;
        p.orden_entrante.send(Orden::Aceptar).await.unwrap();
        hasta(&mut p.rx_entrante, |e| e.estado == Estado::Transfiriendo && e.hechos > 0).await;
        p.orden_saliente.send(Orden::Cancelar).await.unwrap();
        let fin = hasta(&mut p.rx_entrante, |e| e.estado.es_final()).await;
        assert!(matches!(fin.estado, Estado::Cancelada | Estado::Fallida(_)), "{:?}", fin.estado);
        assert_eq!(hasta(&mut p.rx_saliente, |e| e.estado.es_final()).await.estado, Estado::Cancelada);
        // El .part se borra al soltarse.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(std::fs::read_dir(&p.carpeta).unwrap().count(), 0);
        std::fs::remove_dir_all(&p.carpeta).unwrap();
        std::fs::remove_file(ruta).unwrap();
    }
}
