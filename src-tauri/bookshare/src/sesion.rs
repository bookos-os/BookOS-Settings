//! La conexión ya cifrada, común a quien envía y a quien recibe.
//!
//! Una tarea aparte lee las tramas del socket: así la máquina de estados puede
//! esperar a la vez a la red y a lo que ordene el usuario sin cortar una
//! lectura a medias (leer un mensaje no es cancelable a mitad).

use std::collections::HashMap;

use prost::Message;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::cifrado::Canal;
use crate::proto::compartir;
use crate::proto::conexion::payload_transfer_frame::payload_header::PayloadType;
use crate::proto::conexion::bandwidth_upgrade_negotiation_frame::EventType;
use crate::proto::conexion::v1_frame::FrameType;
use crate::proto::conexion::OfflineFrame;
use crate::{marcos, trama, Error};

/// Lo que llega por el canal, ya clasificado.
pub enum Llegada {
    /// Un mensaje de Quick Share (presentación, respuesta, cancelar…).
    Compartir(compartir::Frame),
    /// Una carga de bytes completa que no es un mensaje: el texto anunciado.
    Bytes { id: i64, datos: Vec<u8> },
    /// Un trozo de archivo.
    Trozo { id: i64, offset: i64, cuerpo: Vec<u8>, ultimo: bool },
    /// El otro aparato da la conexión por terminada.
    Desconexion,
}

pub struct Sesion {
    pub canal: Canal,
    /// TCP o RFCOMM: en caja para que nada más tenga que ser genérico.
    escritor: Box<dyn AsyncWrite + Unpin + Send>,
    tramas: mpsc::Receiver<Result<Vec<u8>, Error>>,
    /// Cargas de bytes a medio llegar.
    bytes: HashMap<i64, Vec<u8>>,
    /// Las cargas de bytes que no hay que leer como mensaje (textos).
    pub textos: Vec<i64>,
}

impl Sesion {
    pub fn nueva<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(socket: S, canal: Canal) -> Self {
        let (mut lector, escritor) = tokio::io::split(socket);
        // Pocas tramas en cola: si la máquina de estados va por detrás, el
        // lector deja de leer y TCP frena al otro lado.
        let (tx, tramas) = mpsc::channel(16);
        tokio::spawn(async move {
            loop {
                let leida = trama::leer(&mut lector).await;
                let fin = leida.is_err();
                if tx.send(leida).await.is_err() || fin {
                    break;
                }
            }
        });
        Self { canal, escritor: Box::new(escritor), tramas, bytes: HashMap::new(), textos: Vec::new() }
    }

    pub async fn mandar(&mut self, marco: &OfflineFrame) -> Result<(), Error> {
        let datos = self.canal.cifrar(marco);
        trama::escribir(&mut self.escritor, &datos).await
    }

    pub async fn mandar_compartir(&mut self, marco: &compartir::Frame) -> Result<(), Error> {
        for parte in marcos::compartir_en_bytes(marco) {
            self.mandar(&parte).await?;
        }
        Ok(())
    }

    pub async fn cerrar(&mut self) {
        let _ = self.mandar(&marcos::desconexion()).await;
        let _ = self.escritor.shutdown().await;
    }

    /// La siguiente llegada que importa. Los keep-alive se contestan aquí.
    pub async fn siguiente(&mut self) -> Result<Llegada, Error> {
        loop {
            let datos = self.trama().await?;
            if let Some(l) = self.procesar(&datos).await? {
                return Ok(l);
            }
        }
    }

    /// Solo espera la siguiente trama cifrada: se puede cancelar sin perder
    /// nada (es un `recv` de canal), así que es lo único que va en un
    /// `select!`. Tratarla, que puede escribir en el socket, va fuera.
    pub async fn trama(&mut self) -> Result<Vec<u8>, Error> {
        self.tramas.recv().await.ok_or(Error::Cortado)?
    }

    /// Como `siguiente`, pero sin esperar: para atender al otro lado entre
    /// trozo y trozo mientras se envía un archivo grande.
    pub async fn pendiente(&mut self) -> Result<Option<Llegada>, Error> {
        while let Ok(datos) = self.tramas.try_recv() {
            if let Some(l) = self.procesar(&datos?).await? {
                return Ok(Some(l));
            }
        }
        Ok(None)
    }

    pub async fn procesar(&mut self, datos: &[u8]) -> Result<Option<Llegada>, Error> {
        let marco = self.canal.descifrar(datos)?;
        let Some(v1) = marco.v1 else { return Ok(None) };
        match v1.r#type() {
            FrameType::KeepAlive => {
                if !v1.keep_alive.and_then(|k| k.ack).unwrap_or(false) {
                    self.mandar(&marcos::keep_alive(true)).await?;
                }
                Ok(None)
            }
            FrameType::Disconnection => Ok(Some(Llegada::Desconexion)),
            FrameType::PayloadTransfer => {
                let Some(pt) = v1.payload_transfer else { return Ok(None) };
                let (Some(cabecera), Some(trozo)) = (pt.payload_header, pt.payload_chunk) else { return Ok(None) };
                let id = cabecera.id();
                let ultimo = trozo.flags() & 1 == 1;
                match cabecera.r#type() {
                    PayloadType::File => {
                        Ok(Some(Llegada::Trozo { id, offset: trozo.offset(), cuerpo: trozo.body.unwrap_or_default(), ultimo }))
                    }
                    PayloadType::Bytes => {
                        if cabecera.total_size() > trama::TRAMA_MAX as i64 {
                            return Err(crate::protocolo("carga de bytes demasiado grande"));
                        }
                        let buffer = self.bytes.entry(id).or_default();
                        if trozo.offset() != buffer.len() as i64 {
                            return Err(crate::protocolo("trozo de bytes fuera de orden"));
                        }
                        buffer.extend(trozo.body.unwrap_or_default());
                        if !ultimo {
                            return Ok(None);
                        }
                        let datos = self.bytes.remove(&id).unwrap_or_default();
                        if self.textos.contains(&id) {
                            Ok(Some(Llegada::Bytes { id, datos }))
                        } else {
                            Ok(Some(Llegada::Compartir(compartir::Frame::decode(&*datos)?)))
                        }
                    }
                    _ => Ok(None),
                }
            }
            // El otro lado propone pasar a otro medio (punto de acceso, Wi-Fi
            // Direct…). No se sabe hacer: se le dice que falló, con lo mismo que
            // propuso, y Nearby sigue por el canal de ahora en vez de esperar.
            FrameType::BandwidthUpgradeNegotiation => {
                let Some(n) = v1.bandwidth_upgrade_negotiation else { return Ok(None) };
                if n.event_type() == EventType::UpgradePathAvailable {
                    self.mandar(&marcos::fallo_mejora(n.upgrade_path_info)).await?;
                }
                Ok(None)
            }
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::cifrado;
    use crate::proto::conexion::bandwidth_upgrade_negotiation_frame::{upgrade_path_info, UpgradePathInfo};
    use crate::proto::conexion::BandwidthUpgradeNegotiationFrame;
    use tokio::net::UnixStream;

    /// Un par de sesiones por sockets Unix, como las que llegan de BlueZ por
    /// RFCOMM: lo de encima del socket no puede depender de TCP.
    async fn par() -> (Sesion, Sesion) {
        let (mut a, mut b) = UnixStream::pair().unwrap();
        let (ca, cb) = tokio::join!(cifrado::cliente(&mut a), cifrado::servidor(&mut b));
        (Sesion::nueva(a, ca.unwrap()), Sesion::nueva(b, cb.unwrap()))
    }

    #[tokio::test]
    async fn una_propuesta_de_cambiar_de_medio_se_contesta_con_fallo() {
        let (mut movil, mut equipo) = par().await;
        let ruta = UpgradePathInfo { medium: Some(upgrade_path_info::Medium::WifiHotspot.into()), ..Default::default() };
        let propuesta = crate::marcos::offline(FrameType::BandwidthUpgradeNegotiation, |v1| {
            v1.bandwidth_upgrade_negotiation = Some(BandwidthUpgradeNegotiationFrame {
                event_type: Some(EventType::UpgradePathAvailable.into()),
                upgrade_path_info: Some(ruta.clone()),
                ..Default::default()
            })
        });
        movil.mandar(&propuesta).await.unwrap();
        // Y después, lo de siempre por el mismo canal.
        movil.mandar(&marcos::desconexion()).await.unwrap();
        assert!(matches!(equipo.siguiente().await.unwrap(), Llegada::Desconexion));

        let cifrada = movil.trama().await.unwrap();
        let respuesta = movil.canal.descifrar(&cifrada).unwrap();
        let n = respuesta.v1.unwrap().bandwidth_upgrade_negotiation.unwrap();
        assert_eq!(n.event_type(), EventType::UpgradeFailure);
        assert_eq!(n.upgrade_path_info, Some(ruta));
    }
}
