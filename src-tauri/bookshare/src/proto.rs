//! Mensajes generados de los .proto de Google por `build.rs`.

#![allow(clippy::all, missing_docs)]

pub mod securegcm {
    include!(concat!(env!("OUT_DIR"), "/securegcm.rs"));
}
pub mod securemessage {
    include!(concat!(env!("OUT_DIR"), "/securemessage.rs"));
}
/// Nearby Connections: conexión, carga útil, keep-alive.
pub mod conexion {
    include!(concat!(env!("OUT_DIR"), "/location.nearby.connections.rs"));
}
/// Quick Share: presentación, respuesta, cancelar.
pub mod compartir {
    include!(concat!(env!("OUT_DIR"), "/sharing.nearby.rs"));
}
