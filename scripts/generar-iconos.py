#!/usr/bin/env python3
"""Genera src/modules/pages/iconos.js a partir de los SVG de Lucide de BookOS-HIG.

Los trazados se copian tal cual de los ficheros, nunca se escriben de memoria.
Para usar un icono nuevo: añade su nombre a NOMBRES y vuelve a ejecutarlo.
"""
import re, sys
from pathlib import Path

LUCIDE = Path(__file__).resolve().parents[2] / "BookOS-HIG" / "lucide" / "icons"
SALIDA = Path(__file__).resolve().parents[1] / "src" / "modules" / "pages" / "iconos.js"

NOMBRES = """
settings alarm-clock hourglass rotate-cw loader globe mail folder image film music
file-text notepad-text archive battery battery-medium triangle-alert arrow-up-right
check x arrow-left circle bell cloud-sun calendar calendar-days skip-back skip-forward
play zap
""".split()

CABECERA = """// Iconos de Lucide (ISC) copiados de BookOS-HIG/lucide/icons.
// GENERADO por scripts/generar-iconos.py: no se edita a mano.
"""

PIE = """};

// SVG en línea con el tamaño y el grosor que se pidan. `currentColor`: el icono
// toma el color del texto que lo rodea, que es lo que no hace un emoji.
export function ico(nombre,{size=16,sw=2,cls=''}={}){
    const d=LUCIDE[nombre];
    if(d===undefined)throw new Error(`icono de Lucide sin definir: ${nombre}`);
    return `<svg${cls?` class="${cls}"`:''} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
"""

def main():
    filas = []
    for n in NOMBRES:
        f = LUCIDE / f"{n}.svg"
        if not f.exists():
            sys.exit(f"no existe {f}")
        interior = re.search(r"<svg[^>]*>(.*)</svg>", f.read_text(encoding="utf-8"), re.S).group(1)
        interior = re.sub(r"\s+", " ", interior).strip().replace(" />", "/>")
        filas.append(f"    '{n}':`{interior}`,\n")
    SALIDA.write_text(CABECERA + "export const LUCIDE={\n" + "".join(filas) + PIE, encoding="utf-8")
    print(f"{len(NOMBRES)} iconos en {SALIDA}")

main()
