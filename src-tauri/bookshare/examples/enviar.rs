//! Envía un archivo o un enlace a una dirección concreta, sin descubrimiento.
//! `cargo run --example enviar -- 192.168.1.20:44551 foto.jpg` (o una URL).

use bookshare::enviar::{enviar, Carga, Envio};
use bookshare::{TipoAparato, TipoTexto};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let destino = args.next().expect("destino ip:puerto").parse().expect("ip:puerto");
    let que = args.next().expect("archivo o URL");
    let carga = if que.starts_with("http") { Carga::Texto { texto: que, tipo: TipoTexto::Url } } else { Carga::Archivos(vec![que.into()]) };
    let (tx, mut rx) = mpsc::unbounded_channel();
    let (_ordenes_tx, ordenes) = mpsc::channel(1);
    tokio::spawn(enviar(Envio { id: "cli".into(), destino, aparato: "?".into(), tipo: TipoAparato::Desconocido, nombre_propio: "Prueba de Book Share".into(), carga, eventos: tx, ordenes }));
    while let Some(ev) = rx.recv().await {
        println!("{:?} pin={:?} {}/{}", ev.estado, ev.pin, ev.hechos, ev.total);
        if ev.estado.es_final() {
            break;
        }
    }
}
