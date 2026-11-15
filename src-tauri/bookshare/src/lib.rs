//! Book Share: implementación propia del protocolo Quick Share de Android.
//!
//! Recibe y envía archivos y texto por la red local con el mismo protocolo que
//! usan los Android (Nearby Connections sobre TCP, cifrado con UKEY2). Este
//! crate es el protocolo; el servicio que lo anuncia por mDNS y lo expone por
//! D-Bus va aparte.

pub mod archivos;
pub mod avahi;
pub mod avisos;
pub mod bluez;
pub mod cifrado;
pub mod enviar;
pub mod info;
pub mod isla;
pub mod marcos;
pub mod proto;
pub mod recibir;
pub mod servicio;
pub mod sesion;
pub mod trama;

use std::path::PathBuf;

use serde::Serialize;

pub use info::TipoAparato;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("error de red: {0}")]
    Io(#[from] std::io::Error),
    #[error("trama mal formada: {0}")]
    Decodificar(#[from] prost::DecodeError),
    #[error("protocolo: {0}")]
    Protocolo(String),
    #[error("la firma del mensaje no coincide")]
    Firma,
    #[error("el otro aparato cortó la conexión")]
    Cortado,
    #[error("tiempo agotado: {0}")]
    Tiempo(&'static str),
}

pub(crate) fn protocolo(texto: impl Into<String>) -> Error {
    Error::Protocolo(texto.into())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direccion {
    Entrante,
    Saliente,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "estado", content = "motivo", rename_all = "snake_case")]
pub enum Estado {
    Conectando,
    EsperandoAceptacion,
    Transfiriendo,
    Terminada,
    Rechazada,
    Cancelada,
    Fallida(String),
}

impl Estado {
    pub fn es_final(&self) -> bool {
        matches!(self, Estado::Terminada | Estado::Rechazada | Estado::Cancelada | Estado::Fallida(_))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Elemento {
    pub nombre: String,
    pub bytes: u64,
    /// Dónde quedó al terminar de recibirlo.
    pub ruta: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TipoTexto {
    Texto,
    Url,
    Direccion,
    Telefono,
}

#[derive(Debug, Clone, Serialize)]
pub struct Texto {
    pub tipo: TipoTexto,
    /// El título que manda el otro antes de aceptar (para enlaces, la URL).
    pub titulo: String,
    /// El contenido, cuando ya ha llegado.
    pub contenido: Option<String>,
}

/// Lo que se sabe de una transferencia en cada momento. Se manda entero en
/// cada cambio: quien lo pinta no tiene que acumular nada.
#[derive(Debug, Clone, Serialize)]
pub struct Evento {
    pub id: String,
    pub direccion: Direccion,
    pub aparato: String,
    pub tipo: TipoAparato,
    #[serde(flatten)]
    pub estado: Estado,
    /// Las cuatro cifras que enseñan los dos aparatos para comprobar que se
    /// habla con quien se cree.
    pub pin: Option<String>,
    pub elementos: Vec<Elemento>,
    pub texto: Option<Texto>,
    pub total: u64,
    pub hechos: u64,
}

/// Lo que puede ordenar el usuario a una transferencia en curso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Orden {
    Aceptar,
    Rechazar,
    Cancelar,
}
