//! Tramas sobre TCP: cuatro bytes de longitud en big-endian y el mensaje.

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::Error;

/// Los trozos de archivo son de 512 KiB; con cifrado y cabeceras no pasan de
/// poco más. 5 MiB deja margen y evita que una longitud inventada reserve
/// gigas de memoria.
pub const TRAMA_MAX: usize = 5 * 1024 * 1024;

pub async fn leer<R: AsyncRead + Unpin>(r: &mut R) -> Result<Vec<u8>, Error> {
    let mut largo = [0u8; 4];
    match r.read_exact(&mut largo).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Err(Error::Cortado),
        Err(e) => return Err(e.into()),
    }
    let largo = u32::from_be_bytes(largo) as usize;
    if largo > TRAMA_MAX {
        return Err(crate::protocolo(format!("trama de {largo} bytes")));
    }
    let mut datos = vec![0u8; largo];
    r.read_exact(&mut datos).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::UnexpectedEof { Error::Cortado } else { e.into() }
    })?;
    Ok(datos)
}

pub async fn escribir<W: AsyncWrite + Unpin>(w: &mut W, datos: &[u8]) -> Result<(), Error> {
    // Longitud y datos en una sola escritura: con dos, Nagle podía mandar la
    // cabecera sola y el otro lado esperar el resto en otro paquete.
    let mut todo = Vec::with_capacity(4 + datos.len());
    todo.extend_from_slice(&(datos.len() as u32).to_be_bytes());
    todo.extend_from_slice(datos);
    w.write_all(&todo).await?;
    Ok(())
}
