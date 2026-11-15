//! Constructores de los mensajes del protocolo, para no repetir el envoltorio
//! de versiones y tipos en cada sitio.

use prost::Message;
use rand::Rng;

use crate::proto::compartir::{
    self, connection_response_frame::Status as Respuesta, paired_key_result_frame, FileMetadata, IntroductionFrame,
    TextMetadata,
};
use crate::proto::conexion::{
    self, connection_response_frame::ResponseStatus, os_info::OsType, payload_transfer_frame, v1_frame::FrameType,
    OfflineFrame,
};

pub(crate) fn offline(tipo: FrameType, rellenar: impl FnOnce(&mut conexion::V1Frame)) -> OfflineFrame {
    let mut v1 = conexion::V1Frame { r#type: Some(tipo.into()), ..Default::default() };
    rellenar(&mut v1);
    OfflineFrame { version: Some(conexion::offline_frame::Version::V1.into()), v1: Some(v1) }
}

pub fn peticion_conexion(id_extremo: &[u8; 4], nombre: &str, info: Vec<u8>) -> OfflineFrame {
    offline(FrameType::ConnectionRequest, |v1| {
        v1.connection_request = Some(conexion::ConnectionRequestFrame {
            endpoint_id: Some(String::from_utf8_lossy(id_extremo).into_owned()),
            endpoint_name: Some(nombre.as_bytes().to_vec()),
            endpoint_info: Some(info),
            mediums: vec![conexion::connection_request_frame::Medium::WifiLan.into()],
            ..Default::default()
        })
    })
}

pub fn respuesta_conexion() -> OfflineFrame {
    offline(FrameType::ConnectionResponse, |v1| {
        v1.connection_response = Some(conexion::ConnectionResponseFrame {
            response: Some(ResponseStatus::Accept.into()),
            os_info: Some(conexion::OsInfo { r#type: Some(OsType::Linux.into()) }),
            ..Default::default()
        })
    })
}

pub fn keep_alive(ack: bool) -> OfflineFrame {
    offline(FrameType::KeepAlive, |v1| v1.keep_alive = Some(conexion::KeepAliveFrame { ack: Some(ack) }))
}

/// «No he podido pasar a ese medio», con la misma ruta que propuso el otro.
pub fn fallo_mejora(
    ruta: Option<conexion::bandwidth_upgrade_negotiation_frame::UpgradePathInfo>,
) -> OfflineFrame {
    use conexion::bandwidth_upgrade_negotiation_frame::EventType;
    offline(FrameType::BandwidthUpgradeNegotiation, |v1| {
        v1.bandwidth_upgrade_negotiation = Some(conexion::BandwidthUpgradeNegotiationFrame {
            event_type: Some(EventType::UpgradeFailure.into()),
            upgrade_path_info: ruta,
            ..Default::default()
        })
    })
}

pub fn desconexion() -> OfflineFrame {
    offline(FrameType::Disconnection, |v1| v1.disconnection = Some(Default::default()))
}

/// Un trozo de carga útil. `ultimo` marca el final (flag 1, cuerpo vacío).
pub fn trozo(
    id: i64,
    tipo: payload_transfer_frame::payload_header::PayloadType,
    total: i64,
    nombre: Option<String>,
    offset: i64,
    cuerpo: Vec<u8>,
    ultimo: bool,
) -> OfflineFrame {
    offline(FrameType::PayloadTransfer, |v1| {
        v1.payload_transfer = Some(conexion::PayloadTransferFrame {
            packet_type: Some(payload_transfer_frame::PacketType::Data.into()),
            payload_header: Some(payload_transfer_frame::PayloadHeader {
                id: Some(id),
                r#type: Some(tipo.into()),
                total_size: Some(total),
                is_sensitive: Some(false),
                file_name: nombre,
                ..Default::default()
            }),
            payload_chunk: Some(payload_transfer_frame::PayloadChunk {
                flags: Some(if ultimo { 1 } else { 0 }),
                offset: Some(offset),
                body: Some(cuerpo),
            }),
            ..Default::default()
        })
    })
}

/// Los mensajes de Quick Share viajan como carga útil de bytes: un trozo con
/// todo y otro vacío que cierra.
pub fn compartir_en_bytes(marco: &compartir::Frame) -> [OfflineFrame; 2] {
    use payload_transfer_frame::payload_header::PayloadType;
    let datos = marco.encode_to_vec();
    let id = rand::rng().random::<i64>();
    let total = datos.len() as i64;
    [
        trozo(id, PayloadType::Bytes, total, None, 0, datos, false),
        trozo(id, PayloadType::Bytes, total, None, total, Vec::new(), true),
    ]
}

fn compartir(tipo: compartir::v1_frame::FrameType, rellenar: impl FnOnce(&mut compartir::V1Frame)) -> compartir::Frame {
    let mut v1 = compartir::V1Frame { r#type: Some(tipo.into()), ..Default::default() };
    rellenar(&mut v1);
    compartir::Frame { version: Some(compartir::frame::Version::V1.into()), v1: Some(v1) }
}

/// Sin cuenta de Google no hay certificados que firmar: se manda relleno
/// aleatorio y el otro lado contesta «Unable», que es lo que hace un Android
/// con visibilidad «Todos».
pub fn clave_emparejada() -> compartir::Frame {
    use compartir::v1_frame::FrameType;
    compartir(FrameType::PairedKeyEncryption, |v1| {
        v1.paired_key_encryption = Some(compartir::PairedKeyEncryptionFrame {
            secret_id_hash: Some(rand::rng().random::<[u8; 6]>().to_vec()),
            signed_data: Some((0..72).map(|_| rand::rng().random()).collect()),
            ..Default::default()
        })
    })
}

pub fn resultado_clave() -> compartir::Frame {
    use compartir::v1_frame::FrameType;
    compartir(FrameType::PairedKeyResult, |v1| {
        v1.paired_key_result =
            Some(compartir::PairedKeyResultFrame { status: Some(paired_key_result_frame::Status::Unable.into()) })
    })
}

pub fn presentacion(archivos: Vec<FileMetadata>, textos: Vec<TextMetadata>) -> compartir::Frame {
    use compartir::v1_frame::FrameType;
    compartir(FrameType::Introduction, |v1| {
        v1.introduction =
            Some(IntroductionFrame { file_metadata: archivos, text_metadata: textos, ..Default::default() })
    })
}

pub fn respuesta(estado: Respuesta) -> compartir::Frame {
    use compartir::v1_frame::FrameType;
    compartir(FrameType::Response, |v1| {
        v1.connection_response = Some(compartir::ConnectionResponseFrame { status: Some(estado.into()) })
    })
}

pub fn cancelar() -> compartir::Frame {
    compartir(compartir::v1_frame::FrameType::Cancel, |_| {})
}
