//! Lado de quien recibe: atiende una conexión entrante de principio a fin.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use prost::Message;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio::time::timeout;

use crate::archivos::Parcial;
use crate::proto::compartir::{connection_response_frame::Status, text_metadata, v1_frame::FrameType};
use crate::proto::conexion::{v1_frame, OfflineFrame};
use crate::sesion::{Llegada, Sesion};
use crate::{cifrado, info, marcos, protocolo, trama, Direccion, Elemento, Error, Estado, Evento, Orden, Texto, TipoAparato, TipoTexto};

/// Hasta aceptar, el otro aparato tiene que ir respondiendo. Pasado esto sin
/// nada (ni un keep-alive), se da por perdido.
const PLAZO_SALUDO: Duration = Duration::from_secs(15);

pub struct Recepcion {
    pub id: String,
    pub carpeta: PathBuf,
    pub eventos: mpsc::UnboundedSender<Evento>,
    pub ordenes: mpsc::Receiver<Orden>,
}

/// Publica el estado; el progreso, como mucho diez veces por segundo.
pub(crate) struct Informe {
    pub ev: Evento,
    tx: mpsc::UnboundedSender<Evento>,
    ultimo: Instant,
}

impl Informe {
    pub fn nuevo(id: String, direccion: Direccion, tx: mpsc::UnboundedSender<Evento>) -> Self {
        let ev = Evento {
            id,
            direccion,
            aparato: String::new(),
            tipo: TipoAparato::Desconocido,
            estado: Estado::Conectando,
            pin: None,
            elementos: Vec::new(),
            texto: None,
            total: 0,
            hechos: 0,
        };
        Self { ev, tx, ultimo: Instant::now() }
    }

    pub fn publicar(&mut self) {
        self.ultimo = Instant::now();
        let _ = self.tx.send(self.ev.clone());
    }

    pub fn estado(&mut self, estado: Estado) {
        self.ev.estado = estado;
        self.publicar();
    }

    pub fn progreso(&mut self, bytes: u64) {
        self.ev.hechos += bytes;
        if self.ultimo.elapsed() >= Duration::from_millis(100) {
            self.publicar();
        }
    }
}

enum Paso {
    Red(Vec<u8>),
    Orden(Orden),
}

async fn leer_claro<S: AsyncRead + Unpin>(socket: &mut S) -> Result<OfflineFrame, Error> {
    let datos = timeout(PLAZO_SALUDO, trama::leer(socket)).await.map_err(|_| Error::Tiempo("saludo"))??;
    Ok(OfflineFrame::decode(&*datos)?)
}

/// Atiende una conexión entrante, por TCP o por RFCOMM. Siempre deja un
/// estado final publicado.
pub async fn atender<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(socket: S, r: Recepcion) {
    let Recepcion { id, carpeta, eventos, mut ordenes } = r;
    let mut informe = Informe::nuevo(id, Direccion::Entrante, eventos);
    if let Err(e) = conversacion(socket, &carpeta, &mut informe, &mut ordenes).await {
        if !informe.ev.estado.es_final() {
            informe.estado(Estado::Fallida(e.to_string()));
        }
    }
}

async fn conversacion<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    mut socket: S,
    carpeta: &std::path::Path,
    informe: &mut Informe,
    ordenes: &mut mpsc::Receiver<Orden>,
) -> Result<(), Error> {
    // 1. Quién es.
    let peticion = leer_claro(&mut socket).await?;
    let v1 = peticion.v1.ok_or_else(|| protocolo("petición vacía"))?;
    if v1.r#type() != v1_frame::FrameType::ConnectionRequest {
        return Err(protocolo("se esperaba una petición de conexión"));
    }
    let pc = v1.connection_request.ok_or_else(|| protocolo("petición sin datos"))?;
    let (tipo, nombre) = info::leer_info_aparato(pc.endpoint_info())
        .unwrap_or((TipoAparato::Desconocido, String::from_utf8_lossy(pc.endpoint_name()).into_owned()));
    informe.ev.aparato = nombre;
    informe.ev.tipo = tipo;
    informe.publicar();

    // 2. Claves.
    let canal = timeout(PLAZO_SALUDO, cifrado::servidor(&mut socket)).await.map_err(|_| Error::Tiempo("UKEY2"))??;
    informe.ev.pin = Some(canal.pin.clone());

    // 3. Las dos respuestas de conexión, todavía en claro.
    let respuesta = leer_claro(&mut socket).await?;
    let acepta = respuesta
        .v1
        .and_then(|v| v.connection_response)
        .map(|r| r.response() == crate::proto::conexion::connection_response_frame::ResponseStatus::Accept)
        .unwrap_or(false);
    if !acepta {
        return Err(protocolo("el otro aparato no aceptó la conexión"));
    }
    trama::escribir(&mut socket, &marcos::respuesta_conexion().encode_to_vec()).await?;

    let mut s = Sesion::nueva(socket, canal);
    s.mandar_compartir(&marcos::clave_emparejada()).await?;

    // Lo anunciado: id de carga → archivo a medio escribir.
    let mut anunciados: Vec<(i64, String, u64)> = Vec::new();
    let mut parciales: Vec<(i64, usize, Parcial)> = Vec::new();
    let mut texto_id: Option<i64> = None;

    loop {
        let paso = tokio::select! {
            t = s.trama() => Paso::Red(t?),
            Some(o) = ordenes.recv() => Paso::Orden(o),
        };
        let llegada = match paso {
            Paso::Red(datos) => match s.procesar(&datos).await? {
                Some(l) => l,
                None => continue,
            },
            Paso::Orden(orden) => {
                match (orden, &informe.ev.estado) {
                    (Orden::Aceptar, Estado::EsperandoAceptacion) => {
                        for (i, (id, nombre, bytes)) in anunciados.iter().enumerate() {
                            match Parcial::crear(carpeta, nombre, *bytes) {
                                Ok(p) => parciales.push((*id, i, p)),
                                Err(e) => {
                                    s.mandar_compartir(&marcos::respuesta(Status::NotEnoughSpace)).await?;
                                    s.cerrar().await;
                                    informe.estado(Estado::Fallida(format!("no se pudo escribir en {}: {e}", carpeta.display())));
                                    return Ok(());
                                }
                            }
                        }
                        s.mandar_compartir(&marcos::respuesta(Status::Accept)).await?;
                        informe.estado(Estado::Transfiriendo);
                        // Archivos vacíos: no llegará ningún trozo con datos,
                        // solo el último; nada más que hacer aquí.
                    }
                    (Orden::Rechazar, Estado::EsperandoAceptacion) => {
                        s.mandar_compartir(&marcos::respuesta(Status::Reject)).await?;
                        s.cerrar().await;
                        informe.estado(Estado::Rechazada);
                        return Ok(());
                    }
                    (Orden::Cancelar | Orden::Rechazar, _) => {
                        s.mandar_compartir(&marcos::cancelar()).await?;
                        s.cerrar().await;
                        informe.estado(Estado::Cancelada);
                        return Ok(());
                    }
                    _ => {}
                }
                continue;
            }
        };

        match llegada {
            Llegada::Compartir(marco) => {
                let Some(v1) = marco.v1 else { continue };
                match v1.r#type() {
                    FrameType::PairedKeyEncryption => s.mandar_compartir(&marcos::resultado_clave()).await?,
                    FrameType::PairedKeyResult => {}
                    FrameType::Introduction => {
                        let intro = v1.introduction.ok_or_else(|| protocolo("presentación vacía"))?;
                        if !intro.file_metadata.is_empty() {
                            for f in &intro.file_metadata {
                                let bytes = f.size().max(0) as u64;
                                anunciados.push((f.payload_id(), f.name().to_string(), bytes));
                                informe.ev.elementos.push(Elemento { nombre: crate::archivos::sanear(f.name()), bytes, ruta: None });
                                informe.ev.total += bytes;
                            }
                        } else if let Some(t) = intro.text_metadata.first() {
                            let tipo = match t.r#type() {
                                text_metadata::Type::Url => TipoTexto::Url,
                                text_metadata::Type::Address => TipoTexto::Direccion,
                                text_metadata::Type::PhoneNumber => TipoTexto::Telefono,
                                _ => TipoTexto::Texto,
                            };
                            texto_id = Some(t.payload_id());
                            s.textos.push(t.payload_id());
                            informe.ev.texto = Some(Texto { tipo, titulo: t.text_title().to_string(), contenido: None });
                            informe.ev.total = t.size().max(0) as u64;
                        } else {
                            // Credenciales de Wi-Fi u otra cosa que no sabemos guardar.
                            s.mandar_compartir(&marcos::respuesta(Status::UnsupportedAttachmentType)).await?;
                            s.cerrar().await;
                            informe.estado(Estado::Rechazada);
                            return Ok(());
                        }
                        informe.estado(Estado::EsperandoAceptacion);
                    }
                    FrameType::Cancel => {
                        s.cerrar().await;
                        informe.estado(Estado::Cancelada);
                        return Ok(());
                    }
                    _ => {}
                }
            }
            Llegada::Bytes { id, datos } if Some(id) == texto_id => {
                informe.ev.hechos = datos.len() as u64;
                if let Some(t) = informe.ev.texto.as_mut() {
                    t.contenido = Some(String::from_utf8_lossy(&datos).into_owned());
                }
                s.cerrar().await;
                informe.estado(Estado::Terminada);
                return Ok(());
            }
            Llegada::Bytes { .. } => {}
            Llegada::Trozo { id, offset, cuerpo, ultimo } => {
                if informe.ev.estado != Estado::Transfiriendo {
                    return Err(protocolo("llegan datos sin haber aceptado"));
                }
                let Some(pos) = parciales.iter().position(|(pid, _, _)| *pid == id) else {
                    return Err(protocolo("trozo de un archivo no anunciado"));
                };
                let parcial = &mut parciales[pos].2;
                if offset as u64 != parcial.escritos {
                    return Err(protocolo("trozo de archivo fuera de orden"));
                }
                if !cuerpo.is_empty() {
                    parcial.escribir(&cuerpo)?;
                    informe.progreso(cuerpo.len() as u64);
                }
                if ultimo {
                    let (_, indice, parcial) = parciales.remove(pos);
                    let ruta = parcial.terminar()?;
                    informe.ev.elementos[indice].ruta = Some(ruta);
                    if parciales.is_empty() {
                        s.cerrar().await;
                        informe.estado(Estado::Terminada);
                        return Ok(());
                    }
                    informe.publicar();
                }
            }
            Llegada::Desconexion => {
                // Si se va antes de terminar, los .part se borran solos al soltarlos.
                let estado = if matches!(informe.ev.estado, Estado::Transfiriendo) {
                    Estado::Fallida("el otro aparato cortó la transferencia".into())
                } else {
                    Estado::Cancelada
                };
                informe.estado(estado);
                return Ok(());
            }
        }
    }
}
