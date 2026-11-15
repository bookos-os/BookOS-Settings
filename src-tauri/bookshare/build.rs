// Los .proto son los de Google (Apache-2.0), sin cambios: definen el formato
// de las tramas de Quick Share que hablan los Android.
fn main() {
    let protos = [
        "proto/device_to_device_messages.proto",
        "proto/offline_wire_formats.proto",
        "proto/securegcm.proto",
        "proto/securemessage.proto",
        "proto/ukey.proto",
        "proto/wire_format.proto",
    ];
    for p in protos {
        println!("cargo:rerun-if-changed={p}");
    }
    prost_build::compile_protos(&protos, &["proto"]).expect("los .proto de Quick Share compilan");
}
