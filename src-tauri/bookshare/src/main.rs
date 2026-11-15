//! `bookos-bookshare`: servicio de usuario de Book Share.
//!
//! Variables para pruebas: `BOOKSHARE_PUERTO` cambia el puerto TCP y
//! `BOOKSHARE_SIN_RED=1` no usa Avahi ni Bluetooth (nada sale a la red local);
//! `BOOKSHARE_INCLUIR_LOCALES=1` deja ver otro servicio del mismo equipo.

use bookshare::servicio::{self, Api, Nucleo};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let puerto = std::env::var("BOOKSHARE_PUERTO").ok().and_then(|p| p.parse().ok()).unwrap_or(servicio::PUERTO);
    let sesion = zbus::Connection::session().await?;
    let sistema = if std::env::var_os("BOOKSHARE_SIN_RED").is_some() {
        None
    } else {
        match zbus::Connection::system().await {
            Ok(c) => Some(c),
            Err(e) => {
                eprintln!("bookshare: sin bus del sistema ({e}): no se anunciará ni buscará");
                None
            }
        }
    };
    if let Some(c) = &sistema {
        if let Err(e) = bookshare::bluez::reparar_nombre(c).await {
            eprintln!("bookshare: no se pudo revisar el nombre Bluetooth: {e}");
        }
    }
    let (nucleo, mut eventos) = Nucleo::nuevo(sesion.clone(), sistema, puerto);

    // El objeto antes que el nombre: con activación por D-Bus, la primera
    // llamada llega en cuanto el nombre existe.
    sesion.object_server().at(servicio::RUTA, Api(nucleo.clone())).await?;
    sesion.request_name(servicio::NOMBRE_BUS).await?;

    nucleo.aplicar().await;
    let n = nucleo.clone();
    tokio::spawn(async move {
        while let Some(ev) = eventos.recv().await {
            n.evento(ev).await;
        }
    });
    tokio::spawn(servicio::escuchar_isla(nucleo.clone()));
    let n = nucleo.clone();
    tokio::spawn(async move {
        if let Err(e) = servicio::escuchar_avisos(n).await {
            eprintln!("bookshare: sin botones en las notificaciones: {e}");
        }
    });
    eprintln!("bookshare: listo en el puerto {puerto}, guardando en {}", nucleo.carpeta.display());

    let mut terminar = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        _ = terminar.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    // Retirar el anuncio (si no, los demás nos verían un rato más sin poder
    // conectar) y devolver al Bluetooth su nombre.
    nucleo.apagar().await;
    Ok(())
}
