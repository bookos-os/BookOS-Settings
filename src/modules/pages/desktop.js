// Native BookOS controls. Only keys implemented by the compositor are exposed.
import {tauriInvoke,getAssetUrl,appIconUrl,esc,renderHeader,renderCard,renderRowItem,renderToggle,setupToggle,toast,renderSkeleton,renderInfoItem,promptSudo,invokeWithAuth,renderServiceError,_tr,popoverSelect,renderSection,renderNavRow,getSetting,setSetting} from './_common.js';
import {getLang} from '../i18n.js';
const config=async()=>JSON.parse(await tauriInvoke('bookos_get_config'));
const parseServiceResult=raw=>{
    const value=typeof raw==='string'?JSON.parse(raw):raw;
    if(value?.ok===false)throw new Error(value.error||'Servicio BookOS no disponible');
    return value;
};
async function save(value,restart=false){
    await tauriInvoke('bookos_apply_config',{config:value});
    toast(restart?'Guardado. Se aplicará al volver a iniciar sesión.':'Guardado');
}
// Menú y deslizador propios en vez de <select> e <input type=number>: el menú
// nativo de WebKitGTK es un GtkMenu sin tema y la casilla numérica sale blanca
// y corta decimales («0,0799» en la posición del reloj).
function select(key,label,value,values){
    const current=values.find(([id])=>String(id)===String(value));
    const name=current?current[1]:String(value??'');
    return renderRowItem(label,'',`<button type="button" class="bk-select" data-choice="${esc(key)}" data-options="${esc(JSON.stringify(values))}" data-value="${esc(value??'')}" title="${esc(name)}" aria-haspopup="listbox"><span>${esc(name)}</span></button>`);
}
// La temperatura se dice con palabras además de en kelvin: «4000 K» no le
// dice nada a casi nadie, «Cálida» sí. 6500 K es el blanco del panel.
const tono=v=>v<4000?'Muy cálida':v<5500?'Cálida':v<6300?'Algo cálida':v<=6700?'Neutra':'Fría';
const formats={px:v=>`${Math.round(v)} px`,pct:v=>`${Math.round(v*100)} %`,dec:v=>(Math.round(v*10)/10).toLocaleString(getLang(),{minimumFractionDigits:1}),k:v=>`${_tr(tono(v))} · ${v} K`,ms:v=>`${v} ms`,rep:v=>v===0?_tr('Apagada'):`${v} ${_tr('por segundo')}`};
function range(key,label,value,min,max,step,format){
    return `<div class="detail-item bk-slider-row"><div class="detail-texts"><span class="dt">${_tr(label)}</span><span class="ds">${formats[format](value)}</span></div><input class="bk-range" type="range" aria-label="${esc(_tr(label))}" data-config="${esc(key)}" data-format="${format}" min="${min}" max="${max}" step="${step}" value="${esc(value)}"></div>`;
}
// Selector numérico con flechas para valores enteros cortos (un paso de 1 a
// 10 %): un deslizador de 25 posiciones obligaba a puntería para algo que se
// ajusta de uno en uno. El <input> lleva `data-config` y `data-numero` para que
// `page()` lo guarde igual que a un deslizador; las flechas solo cambian su
// valor y avisan.
const FLECHA='<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="%D"/></svg>';
function stepper(key,label,sub,value,min,max,unidad='%'){
    const control=`<span class="bk-stepper" data-stepper="${esc(key)}"><input class="bk-stepper-num" type="number" inputmode="numeric" data-config="${esc(key)}" data-numero="1" min="${min}" max="${max}" step="1" value="${esc(value)}" aria-label="${esc(_tr(label))}"><span class="bk-stepper-u">${esc(unidad)}</span><span class="bk-stepper-flechas"><button type="button" class="bk-stepper-btn" data-sentido="1" tabindex="-1" aria-label="${esc(_tr('Subir el valor'))}">${FLECHA.replace('%D','M18 15l-6-6-6 6')}</button><button type="button" class="bk-stepper-btn" data-sentido="-1" tabindex="-1" aria-label="${esc(_tr('Bajar el valor'))}">${FLECHA.replace('%D','M6 9l6 6 6-6')}</button></span></span>`;
    return renderRowItem(label,sub,control);
}
// Las flechas de un selector: un paso por pulsación y, manteniendo, repetición
// tras 450 ms cada 90 ms. El guardado va con retraso para no mandar una orden
// al compositor por cada paso intermedio.
function cablearStepper(c){
    c.querySelectorAll('.bk-stepper').forEach(caja=>{
        const num=caja.querySelector('.bk-stepper-num');
        const min=Number(num.min),max=Number(num.max);
        const botones=[...caja.querySelectorAll('.bk-stepper-btn')];
        let guardar=null;
        const refrescar=()=>{
            const n=Number(num.value);
            botones.forEach(b=>{b.disabled=b.dataset.sentido==='1'?n>=max:n<=min;});
        };
        const paso=sentido=>{
            const n=Math.min(max,Math.max(min,(Number(num.value)||min)+sentido));
            if(n===Number(num.value))return;
            num.value=n;refrescar();
            clearTimeout(guardar);
            guardar=setTimeout(()=>num.dispatchEvent(new Event('change')),400);
        };
        let espera=null,repite=null;
        const parar=()=>{clearTimeout(espera);clearInterval(repite);};
        botones.forEach(b=>{
            const sentido=Number(b.dataset.sentido);
            b.addEventListener('pointerdown',e=>{
                if(e.button!==0)return;
                paso(sentido);
                espera=setTimeout(()=>{repite=setInterval(()=>{paso(sentido);if(b.disabled)parar();},90);},450);
            });
            // Con teclado el clic llega sin puntero (detail 0); con ratón ya se
            // contó en pointerdown.
            b.addEventListener('click',e=>{if(e.detail===0)paso(sentido);});
        });
        ['pointerup','pointercancel','pointerleave'].forEach(ev=>caja.addEventListener(ev,parar));
        window.addEventListener('blur',parar);
        num.addEventListener('input',refrescar);
        refrescar();
    });
}
// Relleno desde el centro cuando el rango cruza el cero (balance, velocidad):
// relleno desde la izquierda se lee como «cuánto», no como «hacia dónde».
function fillRange(el){
    const min=Number(el.min),max=Number(el.max),pct=(el.value-min)/(max-min)*100,from=min<0&&max>0?-min/(max-min)*100:0;
    el.style.setProperty('--from',`${Math.min(from,pct)}%`);
    el.style.setProperty('--to',`${Math.max(from,pct)}%`);
}
// Tiempos en segundos para el compositor, pero en pasos humanos en la UI. Un
// valor puesto a mano en el TOML que no esté en la lista se añade tal cual
// para no mostrar una opción que no es la real.
function duration(key,label,value,steps){
    const name=v=>v===0?'Nunca':v<60?`${v} s`:v%3600===0?`${v/3600} h`:`${Math.round(v/60)} min`;
    const list=steps.includes(value)?steps:[...steps,value].sort((a,b)=>a-b);
    return select(key,label,value,list.map(v=>[v,name(v)]));
}
function toggle(key,label,value,subtitle=''){
    // data-custom: sin él setupToggle sustituye el subtítulo por «Activado».
    return renderRowItem(label,subtitle,renderToggle(key,!!value)).replace('class="ds"','class="ds" data-custom="1"');
}
// Una página larga de filas sueltas no se lee: build puede devolver grupos
// [título, filas] y cada uno sale en su tarjeta.
const cards=items=>Array.isArray(items[0])?items.map(([t,rows])=>(t?renderSection(t):'')+renderCard(rows)).join(''):renderCard(items);
async function page(c,title,build,restart=false){
    c.innerHTML=renderHeader(title)+renderSkeleton(2);
    try{
        const data=await config();
        c.innerHTML=renderHeader(title)+(restart?renderInfoItem('Estos cambios se aplicarán al volver a iniciar sesión.'):'')+cards(build(data));
        const store=async(key,value)=>{
            await save({[key]:value},restart||key==='escritorios');data[key]=value;
            // El compositor aplica la recarga de forma asíncrona.
            if(key.startsWith('tema'))setTimeout(()=>window.refrescarTema?.(),300);
        };
        c.querySelectorAll('[data-config]').forEach(el=>{
            const percent=el.closest('.bk-slider-row')?.querySelector('.ds');
            if(el.classList.contains('bk-range')){
                fillRange(el);
                el.addEventListener('input',()=>{fillRange(el);percent.textContent=formats[el.dataset.format](Number(el.value));});
            }
            // El valor a recuperar si el guardado falla es el último que se
            // aceptó, no `data[key]`: si el compositor no trae la clave (uno
            // más viejo que esta página) es `undefined` y el deslizador
            // saltaba al centro del rango.
            let aceptado=el.value;
            el.addEventListener('change',async()=>{
                const key=el.dataset.config;
                // Un número escrito a mano puede salirse del rango o venir
                // vacío: se recorta, o se vuelve al último valor bueno.
                if(el.dataset.numero){
                    const n=Math.round(Number(el.value));
                    el.value=Number.isFinite(n)&&el.value!==''?Math.min(Number(el.max),Math.max(Number(el.min),n)):aceptado;
                }
                const value=el.type==='range'||el.dataset.numero?Number(el.value):el.value;
                el.disabled=true;
                try{await store(key,value);aceptado=el.value;}
                catch(e){
                    el.value=aceptado;toast(String(e),'❌');
                    if(el.dataset.numero)el.dispatchEvent(new Event('input'));
                    if(percent){fillRange(el);percent.textContent=formats[el.dataset.format](Number(el.value));}
                }finally{el.disabled=false;}
            });
        });
        c.querySelectorAll('[data-choice]').forEach(el=>el.addEventListener('click',()=>{
            const key=el.dataset.choice,options=JSON.parse(el.dataset.options),row=el.closest('.detail-item');
            popoverSelect(row,{
                title:row.querySelector('.dt').textContent,
                options:options.map(([val,name])=>({val,label:esc(name)})),
                current:el.dataset.value,
                onSelect:async val=>{
                    const [id,name]=options.find(([id])=>String(id)===val);
                    el.disabled=true;
                    try{await store(key,id);el.dataset.value=id;el.title=name;el.querySelector('span').textContent=name;}
                    catch(e){toast(String(e),'❌');}
                    finally{el.disabled=false;}
                },
            });
        }));
        c.querySelectorAll('[data-toggle]').forEach(el=>{
            const key=el.dataset.toggle;
            setupToggle(key,async active=>{await save({[key]:active},restart);});
        });
    }catch(e){c.innerHTML=renderHeader(title)+renderInfoItem('No se pudo leer la configuración de BookOS',esc(String(e)));}
}
// Los valores de bookos-shell/src/tema.rs (claro, oscuro): el círculo tiene
// que ser el color que va a salir en el panel, no uno parecido.
const ACENTOS=[['azul','Azul','#007aff','#5c95ff'],['indigo','Índigo','#5856d6','#7d7aff'],['morado','Morado','#af52de','#c979f0'],
    ['rosa','Rosa','#ff2d55','#ff6482'],['rojo','Rojo','#ff3b30','#ff4a4a'],['naranja','Naranja','#ff9500','#f8a13a'],
    ['amarillo','Amarillo','#ffcc00','#f8db36'],['arena','Arena','#ffeec0','#ffeec0'],['verde','Verde','#34c759','#65ff8c'],
    ['turquesa','Turquesa','#009ba8','#40cbd4'],['grafito','Grafito','#6e6e73','#a1a1a6']];
const colorAcento=(n,oscuro)=>{const a=ACENTOS.find(x=>x[0]===n)||ACENTOS[0];return oscuro?a[3]:a[2];};
// El color del icono tintado según el deslizador de intensidad: a la
// izquierda saturado y hondo, a la derecha lavado hacia blanco.
export const tinte=(h,s)=>`hsl(${h},${Math.round(90-(s/100)*55)}%,${Math.round(42+(s/100)*38)}%)`;
const ventana=`<span class="ap-ventana"><span class="ap-puntos"><i></i><i></i><i></i></span><span class="ap-linea"></span><span class="ap-linea corta"></span></span>`;
const opcion=(grupo,valor,nombre,actual,mini)=>`<button type="button" class="ap-opcion" role="radio" aria-checked="${valor===actual}" data-${grupo}="${valor}">${mini}<span class="ap-nombre">${esc(_tr(nombre))}</span></button>`;
const marcar=(c,grupo,valor)=>c.querySelectorAll(`[data-${grupo}]`).forEach(b=>b.setAttribute('aria-checked',String(b.dataset[grupo]===String(valor))));
async function guardar(d,clave,valor){
    await save({[clave]:valor});d[clave]=valor;
    // El compositor aplica la recarga de forma asíncrona.
    if(clave.startsWith('tema'))setTimeout(()=>window.refrescarTema?.(),300);
}
// Miniaturas que funcionan como radio. Se marca antes de guardar para que el
// clic responda al instante; si el compositor lo rechaza se vuelve a lo que
// había. El data-* es texto: si la clave es booleana se guarda como booleano.
function elegir(c,d,grupo,clave,alCambiar){
    c.querySelectorAll(`[data-${grupo}]`).forEach(b=>b.addEventListener('click',async()=>{
        const antes=d[clave],valor=typeof antes==='boolean'?b.dataset[grupo]==='true':b.dataset[grupo];
        if(valor===antes)return;
        marcar(c,grupo,valor);alCambiar?.(valor);
        try{await guardar(d,clave,valor);}
        catch(e){marcar(c,grupo,antes);alCambiar?.(antes);toast(String(e),'❌');}
    }));
}
const terminal=`<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
export async function appearance(c,icons){
    c.innerHTML=renderHeader('Apariencia')+renderSkeleton(3);
    let d;
    try{d=await config();}
    catch(e){c.innerHTML=renderHeader('Apariencia')+renderInfoItem('No se pudo leer la configuración de BookOS',esc(String(e)));return;}
    const [fondo,iconos,paleta]=await Promise.all([
        fondoMiniatura(),
        tauriInvoke('get_icon_style').then(r=>JSON.parse(r).mode).catch(()=>''),
        getSetting('ColorPalette','false'),
    ]);
    const oscuro=d.tema_efectivo==='oscuro';
    const color=n=>colorAcento(n,oscuro);
    const nombreAcento=n=>_tr((ACENTOS.find(x=>x[0]===n)||[,n])[1]);
    // Cada variante del tintado guarda su tono; la ficha enseña la del tema puesto.
    const variante=oscuro?'dark':'light',ls=(k,def)=>parseInt(localStorage.getItem(`bookos_tint_${variante}_${k}`)||def,10);
    const tono=ls('hue',210),fuerza=ls('strength',oscuro?70:45);
    const icono=(fondoFicha,glifo,trazo)=>`<span class="ap-icono" style="background:${fondoFicha}"><span class="ap-glifo" style="background:${glifo};color:${trazo}">${terminal}</span></span>`;
    const horas=`<div class="ap-horas"${d.tema==='automatico'?'':' hidden'}>
        ${renderRowItem('Tema claro desde','',`<input class="bk-time" data-config="tema_claro_desde" type="time" value="${esc(d.tema_claro_desde)}">`)}
        ${renderRowItem('Tema oscuro desde','',`<input class="bk-time" data-config="tema_oscuro_desde" type="time" value="${esc(d.tema_oscuro_desde)}">`)}
    </div>`;
    c.innerHTML=renderHeader('Apariencia')+`<div class="ap" style="--ap-acento:${color(d.acento)}${fondo?`;--ap-fondo:url('${esc(fondo)}')`:''}">
        <div class="theme-block">
            <div class="ap-cab"><span class="dt">${_tr('Tema')}</span></div>
            <div class="ap-opciones" role="radiogroup" aria-label="${esc(_tr('Tema'))}">
                ${opcion('tema','claro','Claro',d.tema,`<span class="ap-mini claro">${ventana}</span>`)}
                ${opcion('tema','oscuro','Oscuro',d.tema,`<span class="ap-mini oscuro">${ventana}</span>`)}
                ${opcion('tema','automatico','Automático',d.tema,`<span class="ap-mini auto"><span class="ap-capa claro">${ventana}</span><span class="ap-capa oscuro">${ventana}</span></span>`)}
            </div>
            ${horas}
        </div>
        ${renderSection('Color e iconos')}
        <div class="theme-block">
            <div class="ap-cab"><span class="dt">${_tr('Color de acento')}</span><span class="ap-valor" id="ap-acento-nombre">${esc(nombreAcento(d.acento))}</span></div>
            ${paleta==='true'?`<span class="ds ap-nota">${_tr('Ahora sigue al fondo de pantalla: el color que elijas durará hasta el próximo cambio de fondo.')}</span>`:''}
            <div class="ap-colores" role="radiogroup" aria-label="${esc(_tr('Color de acento'))}">
                ${ACENTOS.map(([id,nombre])=>`<button type="button" class="ap-color" role="radio" aria-checked="${id===d.acento}" data-acento="${id}" title="${esc(_tr(nombre))}" aria-label="${esc(_tr(nombre))}" style="--c:${color(id)}"></button>`).join('')}
            </div>
            <div class="theme-block-divider"></div>
            <div class="ap-cab"><span class="dt">${_tr('Estilo de iconos')}</span></div>
            <div class="ap-opciones iconos" role="radiogroup" aria-label="${esc(_tr('Estilo de iconos'))}">
                ${opcion('iconos','light','Claro',iconos,icono('#fff','#f2f2f7','#1c1c1e'))}
                ${opcion('iconos','dark','Oscuro',iconos,icono('#1c1c2e','#2c2c34','#fff'))}
                ${opcion('iconos','tinted','Tintado',iconos,icono(oscuro?'#1c1c2e':'#fff',tinte(tono,fuerza),'#fff'))}
            </div>
            ${renderNavRow('Personalizar el tintado','Tono, intensidad y logo de cada app',{id:'native-icons'})}
        </div>
    </div>`;

    elegir(c,d,'tema','tema',v=>{c.querySelector('.ap-horas').hidden=v!=='automatico';});
    elegir(c,d,'acento','acento',v=>{
        c.querySelector('.ap').style.setProperty('--ap-acento',color(v));
        c.querySelector('#ap-acento-nombre').textContent=nombreAcento(v);
    });
    c.querySelectorAll('.bk-time').forEach(el=>el.addEventListener('change',async()=>{
        const clave=el.dataset.config;
        try{await guardar(d,clave,el.value);}
        catch(e){el.value=d[clave];toast(String(e),'❌');}
    }));
    let iconoActual=iconos;
    c.querySelectorAll('[data-iconos]').forEach(b=>b.addEventListener('click',async()=>{
        const modo=b.dataset.iconos,antes=iconoActual;
        if(modo===antes)return;
        marcar(c,'iconos',modo);iconoActual=modo;
        toast(_tr('Aplicando iconos…'),'🔄');
        // El tintado reescribe ~8k SVG: tarda unos segundos y se hace con los
        // ajustes que dejó la subpágina para el tema que esté puesto.
        const extra=modo==='tinted'?{hue:tono,strength:fuerza,dark:oscuro,
            tintBase:localStorage.getItem('bookos_tint_base')!=='0',tintLogo:localStorage.getItem('bookos_tint_logo')==='1',logoHue:ls('logohue',tono)}:{};
        try{
            const r=JSON.parse(await tauriInvoke('set_icon_style',{mode:modo,...extra}));
            if(!r.ok)throw new Error(r.error||'');
            localStorage.setItem('bookos_icon_style',modo);
            toast(_tr('Iconos aplicados'),'✅');
        }catch(e){marcar(c,'iconos',antes);iconoActual=antes;toast(_tr('No se pudieron aplicar los iconos')+(e.message?': '+e.message:''),'❌');}
    }));
    c.querySelector('#native-icons').addEventListener('click',()=>{window.pushSubNav?.(()=>appearance(c,icons));icons?.();});
}
// De cálida a fría, como se lee la luz. La pista lleva los colores de verdad
// del tinte —los multiplicadores que aplica el compositor a 2500, 6500 y
// 8000 K—, así que se ve hacia dónde va antes de soltar.
function tonalidad(value){
    const fila=range('luz_nocturna_temperatura','Tonalidad',value,2500,8000,100,'k').replace('class="bk-range"','class="bk-range bk-temp"');
    const ejes=`<div class="bk-temp-ejes" aria-hidden="true"><span>${esc(_tr('Cálida'))}</span><span>${esc(_tr('Fría'))}</span></div>`;
    return fila.slice(0,-'</div>'.length)+ejes+'</div>';
}
// La luz nocturna. Los límites son los que valida bookos-comp (ajustes.rs).
export async function nightLight(c,{disponible=true}={}){
    await page(c,'Luz nocturna',d=>[
        ['',[
            select('luz_nocturna','Luz nocturna',d.luz_nocturna,[['no','Apagada'],['si','Encendida'],['programada','Programada']]),
            tonalidad(d.luz_nocturna_temperatura),
        ]],
        ['Horario',[
            renderRowItem('Desde','Con el modo programado',`<input class="bk-time" data-config="luz_nocturna_desde" type="time" value="${esc(d.luz_nocturna_desde)}">`),
            renderRowItem('Hasta','',`<input class="bk-time" data-config="luz_nocturna_hasta" type="time" value="${esc(d.luz_nocturna_hasta)}">`),
        ]],
        ...(disponible?[]:[['',[renderInfoItem('Esta sesión no puede teñir la pantalla','Solo funciona en una sesión de BookOS iniciada desde la pantalla de acceso. Lo que elijas se guarda igualmente.')]]]),
    ]);
}
// ── Pantalla de bloqueo ────────────────────────────────────────────────────
// La de bookos-desktop, la que pinta bookos-shell (bloqueo.rs) con las claves
// `bloqueo_*`. El editor de SDDM ya no cuelga de aquí: aquel tema QML era el
// bloqueo de la sesión Plasma y nada de lo que ajustaba se ve con Win+L.

// Medidas en píxeles lógicos de bloqueo.rs. La maqueta las pasa a `cqh` con el
// alto lógico de la pantalla, así guarda la proporción real a cualquier tamaño.
const LK={fecha:22,nombre:20,campoAncho:312,campoAlto:44,mediosAncho:372,mediosAlto:102,mediosArte:78,energia:44,margenEnergia:28,
    // Lo que mide el bloque de acceso bajo el avatar; con ello calcula bloqueo.rs
    // el piso de la tarjeta multimedia (`medios_y_asentada`).
    bajoAvatar:12+24+16+44+10+20+16+24};
// Los valores por defecto y los límites, de config.rs y ajustes.rs. Fuera de los
// límites el compositor rechaza la configuración entera.
const LK_DEF={bloqueo_reloj_y:.08,bloqueo_acceso_y:.36,bloqueo_medios_y:.68,bloqueo_reloj_tamano:144,bloqueo_avatar_tamano:132,bloqueo_reloj_fuente:'moderna',bloqueo_reloj_grosor:400};
// Los estilos de reloj de config.rs (`FuenteReloj`). Cuáles se pueden elegir lo
// dice el compositor en `bloqueo_reloj_fuentes`: solo los que tienen la fuente
// instalada, mirado en la misma base de fuentes con la que dibuja el bloqueo.
const LK_ESTILOS={moderna:'Moderna',neutra:'Neutra',redondeada:'Redondeada',clasica:'Clásica',display:'Display',mono:'Mono'};
const lkFamilia=(d,nombre=d.bloqueo_reloj_fuente)=>(d.bloqueo_reloj_fuentes||[]).find(f=>f.nombre===nombre)?.familia||'';
// La fecha va en Medium, como en bloqueo.rs: no sigue al grosor de la hora.
const lkLetra=(d,peso)=>{const f=lkFamilia(d);return `${f?`font-family:'${f}';`:''}font-weight:${peso}`;};
const LK_LIM={bloqueo_reloj_y:[.02,.4],bloqueo_acceso_y:[.18,.72],bloqueo_medios_y:[.42,.88],bloqueo_reloj_tamano:[72,220],bloqueo_avatar_tamano:[64,220]};
const lkLimitar=(k,v)=>Math.min(LK_LIM[k][1],Math.max(LK_LIM[k][0],v));
/// Cuántos píxeles lógicos se mete el reloj en el bloque de acceso (0 si no).
/// bloqueo.rs no lo impide —solo pone un piso a la música—, así que lo frena el
/// editor. Las líneas miden 1,3 veces la letra, el alto de línea de iced.
function lkSolape(d,alto){
    const finReloj=d.bloqueo_reloj_y*alto+d.bloqueo_reloj_tamano*1.3+(d.bloqueo_fecha!==false?LK.fecha*1.3:0);
    return Math.max(0,finReloj+8-d.bloqueo_acceso_y*alto);
}
/// El valor más cercano a `v` que no empeora el solape: si ya venía solapado de
/// antes, deja mover en la dirección que lo arregla. Por bisección y no
/// rechazando: un arrastre rápido salta muchos píxeles por evento, y rechazarlo
/// entero dejaba la pieza lejos del tope en vez de pegada a él.
function lkAjustar(d,clave,v,alto){
    const vale=x=>lkSolape({...d,[clave]:x},alto)<=lkSolape(d,alto);
    if(vale(v))return v;
    let bien=d[clave],mal=v;
    for(let i=0;i<14;i++){const m=(bien+mal)/2;if(vale(m))bien=m;else mal=m;}
    // Se redondea hacia el lado bueno, el de `bien`, para no meterse ni medio píxel.
    const r=bien>mal?Math.ceil:Math.floor;
    return LK_LIM[clave][1]>1?r(bien):r(bien*1000)/1000;
}
// Las piezas que se pueden tocar: qué clave mueven, cuál las redimensiona y
// cuál las enseña u oculta.
const LK_PIEZAS={
    reloj:{nombre:'Reloj',y:'bloqueo_reloj_y',tam:'bloqueo_reloj_tamano',ver:[['bloqueo_fecha','Fecha']]},
    acceso:{nombre:'Usuario',y:'bloqueo_acceso_y',tam:'bloqueo_avatar_tamano',ver:[['bloqueo_nombre','Nombre de usuario']]},
    medios:{nombre:'Controles multimedia',y:'bloqueo_medios_y',ver:[['bloqueo_medios','Mostrar']]},
    energia:{nombre:'Botón de apagado',ver:[['bloqueo_energia','Mostrar']],tip:'Apagar, reiniciar o suspender sin desbloquear'},
};

/// La pantalla de bloqueo dibujada en HTML con la configuración `d`. La misma
/// para la portada y para el editor: en el editor las piezas se pueden tocar y
/// las ocultas salen en fantasma para poder volver a encenderlas.
function lkMaqueta(d,{ancho,alto,fondo,usuario,editable=false,sel=''}){
    const q=px=>`${(px/alto*100).toFixed(3)}cqh`;
    const ver=k=>d[k]!==false;
    // Todas las piezas marcan la selección con las esquinas; solo las que tienen
    // tamaño las usan además como asas (`data-asa`).
    const esquinas=tam=>['tl','tr','bl','br'].map(x=>`<i class="ed-c ed-c-${x}"${tam?` data-asa="${x}"`:''}></i>`).join('');
    const pieza=(id,html,estilo,visible=true)=>{
        if(!editable&&!visible)return '';
        const p=LK_PIEZAS[id];
        return `<div class="lk-pieza lk-${id}${editable?' ed-el':''}${sel===id?' ed-sel':''}${visible?'':' lk-oculta'}" data-pieza="${id}" style="${estilo}"${editable?` tabindex="0" role="button" aria-label="${esc(_tr(p.nombre))}"`:''}>${html}${editable?esquinas(p.tam):''}</div>`;
    };
    const ini=esc((usuario.nombre||'?').charAt(0).toUpperCase());
    const foto=usuario.foto?`<span class="lk-foto" style="width:${q(d.bloqueo_avatar_tamano)};height:${q(d.bloqueo_avatar_tamano)};background-image:url('${esc(usuario.foto)}')"></span>`
        :`<span class="lk-foto" style="width:${q(d.bloqueo_avatar_tamano)};height:${q(d.bloqueo_avatar_tamano)};font-size:${q(d.bloqueo_avatar_tamano*.34)}">${ini}</span>`;
    const hoy=new Date();
    const hora=hoy.toLocaleTimeString(getLang(),{hour:'2-digit',minute:'2-digit'});
    const fecha=hoy.toLocaleDateString(getLang(),{weekday:'long',day:'numeric',month:'long'});
    const piso=d.bloqueo_acceso_y*alto+d.bloqueo_avatar_tamano+LK.bajoAvatar;
    const mediosY=Math.max(d.bloqueo_medios_y*alto,piso);
    return `<div class="ed-stage lk-stage${editable?' lk-editable':''}" style="aspect-ratio:${ancho}/${alto}">
        ${fondo?`<div class="ed-bg" style="background-image:url('${esc(fondo)}')"></div>`:''}<div class="lk-velo"></div>
        ${pieza('reloj',`<span class="lk-hora" style="font-size:${q(d.bloqueo_reloj_tamano)};${lkLetra(d,d.bloqueo_reloj_grosor??400)}">${esc(hora)}</span>${ver('bloqueo_fecha')?`<span class="lk-fecha" style="font-size:${q(LK.fecha)};${lkLetra(d,500)}">${esc(fecha)}</span>`:''}`,
            `top:${d.bloqueo_reloj_y*100}cqh`)}
        ${pieza('acceso',`${foto}${ver('bloqueo_nombre')?`<span class="lk-nombre" style="font-size:${q(LK.nombre)};margin-top:${q(12)}">${esc(usuario.nombre)}</span>`:''}<span class="lk-campo" style="width:${q(LK.campoAncho)};height:${q(LK.campoAlto)};margin-top:${q(16)}"></span>`,
            `top:${d.bloqueo_acceso_y*100}cqh`)}
        ${pieza('medios',`<span class="lk-arte" style="width:${q(LK.mediosArte)};height:${q(LK.mediosArte)}"></span><span class="lk-pista" style="font-size:${q(15)}"><b>${esc(_tr('Canción'))}</b><span>${esc(_tr('Artista'))}</span></span>`,
            `top:${(mediosY/alto*100).toFixed(3)}cqh;width:${q(LK.mediosAncho)};height:${q(LK.mediosAlto)};padding:0 ${q(12)};gap:${q(14)}`,ver('bloqueo_medios'))}
        ${pieza('energia',`<span class="lk-boton" style="width:${q(LK.energia)};height:${q(LK.energia)}"><svg viewBox="0 0 24 24" width="45%" height="45%" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0"/></svg></span>`,
            `left:${q(LK.margenEnergia)};bottom:${q(LK.margenEnergia)}`,ver('bloqueo_energia'))}
    </div>`;
}

// La miniatura y no el original: el fondo puede ser de 8K.
const fondoMiniatura=()=>tauriInvoke('get_current_wallpaper').then(r=>JSON.parse(r).path)
    .then(p=>p?tauriInvoke('wallpaper_preview',{path:p,hero:true}):'')
    .then(u=>u?getAssetUrl(u):'').catch(()=>'');
/// Lo que la maqueta necesita además de la configuración: el alto lógico de la
/// pantalla, el fondo y quién es el usuario.
async function lkContexto(){
    const [outs,fondo,ui]=await Promise.all([
        tauriInvoke('bookos_get_outputs').then(JSON.parse).catch(()=>[]),
        fondoMiniatura(),
        tauriInvoke('get_user_info').then(JSON.parse).catch(()=>({})),
    ]);
    const o=outs.find(x=>x.principal&&x.activa)||outs.find(x=>x.activa);
    return {ancho:o?.logico_ancho||1440,alto:o?.logico_alto||900,fondo,usuario:{nombre:ui.display_name||ui.username||_tr('Usuario'),foto:ui.avatar_data||''}};
}

export async function lockscreen(c){
    const title='Pantalla de bloqueo';
    c.innerHTML=renderHeader(title)+renderSkeleton(2);
    let d,ctx;
    try{[d,ctx]=await Promise.all([config(),lkContexto()]);}
    catch(e){c.innerHTML=renderHeader(title)+renderInfoItem('No se pudo leer la configuración de BookOS',esc(String(e)));return;}
    c.innerHTML=renderHeader(title)
        +`<div class="detail-card lk-portada"><div class="lk-marco">${lkMaqueta(d,ctx)}</div>
            <button type="button" class="btn btn-secondary" id="lk-personalizar">${_tr('Personalizar')}</button></div>`
        +renderCard([
            toggle('bloqueo_huella','Desbloquear con huella',d.bloqueo_huella,'Requiere un lector compatible y una huella registrada. La contraseña sigue disponible.'),
            duration('bloqueo_inactividad','Bloquear tras inactividad',d.bloqueo_inactividad,[0,60,120,300,600,900,1800,3600]),
            duration('suspension_inactividad','Suspender tras el bloqueo',d.suspension_inactividad,[0,60,300,600,1800,3600]),
        ])
        +renderCard([toggle('bloqueo_animaciones','Animaciones',d.bloqueo_animaciones,'Al bloquear y al desbloquear')]);
    const abrir=()=>{window.pushSubNav?.(()=>lockscreen(c));lockEditor(c,d,ctx);};
    c.querySelector('#lk-personalizar').addEventListener('click',abrir);
    c.querySelector('.lk-marco').addEventListener('click',abrir);
    c.querySelectorAll('[data-toggle]').forEach(el=>setupToggle(el.dataset.toggle,async v=>{await save({[el.dataset.toggle]:v});d[el.dataset.toggle]=v;}));
    c.querySelectorAll('[data-choice]').forEach(el=>el.addEventListener('click',()=>{
        const key=el.dataset.choice,options=JSON.parse(el.dataset.options),row=el.closest('.detail-item');
        popoverSelect(row,{
            title:row.querySelector('.dt').textContent,
            options:options.map(([val,name])=>({val,label:esc(name)})),
            current:el.dataset.value,
            onSelect:async val=>{
                const [id,name]=options.find(([id])=>String(id)===val);
                try{await save({[key]:id});d[key]=id;el.dataset.value=id;el.title=name;el.querySelector('span').textContent=name;}
                catch(e){toast(String(e),'❌');}
            },
        });
    }));
}

/// El editor: la pantalla de bloqueo en grande y se toca lo que se quiere
/// cambiar. Arrastrar una pieza la sube o la baja (en bloqueo.rs todo va
/// centrado: la posición es solo la altura) y tirar de una esquina del reloj o
/// de la foto cambia su tamaño. Cada gesto se guarda al soltar, como el resto de
/// Ajustes; el compositor aplica la composición nueva sin reiniciar el bloqueo.
function lockEditor(c,d,ctx){
    let sel='';
    const pintar=()=>{
        c.innerHTML=renderHeader('Personalizar')
            +`<div class="lk-editor">${lkMaqueta(d,{...ctx,editable:true,sel})}</div>`
            +hoja();
        enlazar();
    };
    const hoja=()=>{
        const p=LK_PIEZAS[sel];
        if(!p)return renderCard([renderInfoItem('Toca el reloj, el usuario, la música o el botón de apagado','Arrástralos para subirlos o bajarlos. Las esquinas del reloj y de la foto cambian su tamaño.')]);
        const filas=[];
        // Como en macOS: la hora de muestra dibujada en cada estilo, y el
        // grosor debajo. Solo con un compositor que ya conoce las claves.
        if(sel==='reloj'&&d.bloqueo_reloj_fuentes?.length){
            const grosor=d.bloqueo_reloj_grosor??400;
            filas.push(`<div class="detail-item"><div class="lk-estilos" role="radiogroup" aria-label="${esc(_tr('Estilo'))}">${d.bloqueo_reloj_fuentes.map(f=>{
                const on=f.nombre===d.bloqueo_reloj_fuente;
                return `<button type="button" class="lk-estilo${on?' on':''}" role="radio" aria-checked="${on}" data-estilo="${esc(f.nombre)}">
                    <span class="lk-estilo-muestra" style="font-family:'${esc(f.familia)}';font-weight:${grosor}">12</span>
                    <span class="lk-estilo-nombre">${esc(_tr(LK_ESTILOS[f.nombre]||f.nombre))}</span></button>`;
            }).join('')}</div></div>`,
            `<div class="detail-item detail-item-row disp-brillo">
                <span class="dt">${_tr('Grosor')}</span>
                <div class="disp-brillo-ctl"><span class="lk-grosor-a" style="font-weight:100">A</span><input class="bk-range" type="range" id="lk-grosor" min="100" max="900" step="100" value="${grosor}" aria-label="${esc(_tr('Grosor'))}"><span class="lk-grosor-a" style="font-weight:900">A</span></div>
            </div>`);
        }
        filas.push(...p.ver.map(([k,label])=>renderRowItem(label,'',renderToggle('lk-'+k,d[k]!==false))));
        if(p.y||p.tam)filas.push(`<div class="detail-item detail-item-row"><span class="ds">${esc(_tr(p.tam?'Arrastra para moverlo; las esquinas cambian el tamaño':'Arrastra para moverlo'))}</span><button type="button" class="btn btn-secondary" id="lk-restablecer">${_tr('Restablecer')}</button></div>`);
        else if(p.tip)filas.push(renderInfoItem(p.tip));
        return renderSection(p.nombre)+renderCard(filas);
    };
    // Guarda solo lo que ha cambiado; si el compositor dice que no, se vuelve
    // a lo de antes en vez de dejar en pantalla algo que no se aplicó.
    const guardar=async cambios=>{
        const antes=Object.fromEntries(Object.keys(cambios).map(k=>[k,d[k]]));
        Object.assign(d,cambios);
        try{await tauriInvoke('bookos_apply_config',{config:cambios});}
        catch(e){Object.assign(d,antes);toast(String(e),'❌');pintar();}
    };
    const enlazar=()=>{
        c.querySelector('.lk-stage').addEventListener('pointerdown',e=>{const stage=e.currentTarget;if(e.target===stage||e.target.classList.contains('ed-bg')||e.target.classList.contains('lk-velo')){sel='';pintar();}});
        c.querySelectorAll('[data-pieza]').forEach(el=>{
            const id=el.dataset.pieza,p=LK_PIEZAS[id];
            el.addEventListener('pointerdown',e=>{
                e.preventDefault();
                if(sel!==id){sel=id;pintar();}
                // Tras pintar, el escenario y la pieza son nodos nuevos.
                const stage=c.querySelector('.lk-stage');
                const pieza=c.querySelector(`[data-pieza="${id}"]`);
                const asa=e.target.closest('[data-asa]')?.dataset.asa;
                const clave=asa?p.tam:p.y;
                if(!clave)return;
                const altoStage=stage.getBoundingClientRect().height;
                const y0=e.clientY,v0=d[clave];
                // Las esquinas de arriba crecen hacia arriba y las de abajo hacia
                // abajo, como al redimensionar cualquier cosa.
                const signo=asa?.startsWith('t')?-1:1;
                let v=v0;
                const mover=ev=>{
                    const dy=(ev.clientY-y0)/altoStage;
                    v=lkLimitar(clave,asa?Math.round(v0+signo*dy*ctx.alto):Math.round((v0+dy)*1000)/1000);
                    v=lkAjustar(d,clave,v,ctx.alto);
                    if(v===d[clave])return;
                    d[clave]=v;
                    const nuevo=document.createElement('div');
                    nuevo.innerHTML=lkMaqueta(d,{...ctx,editable:true,sel});
                    // Solo se cambia el estilo de cada pieza: rehacer el DOM a
                    // mitad del gesto perdería el puntero capturado.
                    nuevo.querySelectorAll('[data-pieza]').forEach(n=>{
                        const viejo=stage.querySelector(`[data-pieza="${n.dataset.pieza}"]`);
                        viejo.style.cssText=n.style.cssText;
                        viejo.querySelectorAll('[style]').forEach((h,i)=>{const nh=n.querySelectorAll('[style]')[i];if(nh)h.style.cssText=nh.style.cssText;});
                    });
                };
                const soltar=()=>{
                    pieza.removeEventListener('pointermove',mover);
                    stage.classList.remove('dragging');
                    if(v!==v0){d[clave]=v0;guardar({[clave]:v});}
                };
                pieza.setPointerCapture(e.pointerId);
                stage.classList.add('dragging');
                pieza.addEventListener('pointermove',mover);
                pieza.addEventListener('pointerup',soltar,{once:true});
                pieza.addEventListener('pointercancel',soltar,{once:true});
            });
            // Teclado: flechas para subir y bajar, Mayús+flechas para el tamaño.
            el.addEventListener('keydown',async e=>{
                if(e.key==='Enter'||e.key===' '){e.preventDefault();sel=id;pintar();c.querySelector(`[data-pieza="${id}"]`).focus();return;}
                if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
                const clave=e.shiftKey?p.tam:p.y;
                if(!clave)return;
                e.preventDefault();
                const paso=(e.key==='ArrowUp'?-1:1)*(e.shiftKey?-4:.01);
                const v=lkAjustar(d,clave,lkLimitar(clave,Math.round((d[clave]+paso)*1000)/1000),ctx.alto);
                if(v===d[clave])return;
                sel=id;await guardar({[clave]:v});pintar();
                c.querySelector(`[data-pieza="${id}"]`).focus();
            });
        });
        LK_PIEZAS[sel]?.ver.forEach(([k])=>setupToggle('lk-'+k,async v=>{await guardar({[k]:v});pintar();}));
        c.querySelectorAll('[data-estilo]').forEach(b=>b.addEventListener('click',async()=>{
            if(b.dataset.estilo===d.bloqueo_reloj_fuente)return;
            await guardar({bloqueo_reloj_fuente:b.dataset.estilo});
            pintar();
        }));
        const grosor=c.querySelector('#lk-grosor');
        if(grosor){
            fillRange(grosor);
            // Mientras se arrastra solo cambia el dibujo; se guarda al soltar,
            // como los gestos de la maqueta.
            grosor.addEventListener('input',()=>{
                fillRange(grosor);
                c.querySelectorAll('.lk-hora,.lk-estilo-muestra').forEach(x=>{x.style.fontWeight=grosor.value;});
            });
            grosor.addEventListener('change',async()=>{await guardar({bloqueo_reloj_grosor:Number(grosor.value)});pintar();});
        }
        c.querySelector('#lk-restablecer')?.addEventListener('click',async()=>{
            const p=LK_PIEZAS[sel];
            const claves=[p.y,p.tam];
            if(sel==='reloj'&&d.bloqueo_reloj_fuentes)claves.push('bloqueo_reloj_fuente','bloqueo_reloj_grosor');
            await guardar(Object.fromEntries(claves.filter(Boolean).map(k=>[k,LK_DEF[k]])));
            pintar();
        });
    };
    pintar();
}
// Gestos del compositor (bookos-comp/src/gestos.rs). Solo se enseñan: no hay
// claves para cambiarlos, y una ficha sin efecto prometería algo que no hace.
const GESTOS=[
    ['exponer','Ver todas las ventanas','Tres dedos hacia arriba'],
    ['vista','Vista de escritorios','Cuatro dedos hacia arriba'],
    ['escritorio','Cambiar de escritorio','Cuatro dedos hacia los lados'],
    ['despejar','Ver el escritorio','Cuatro dedos hacia abajo'],
    ['launchpad','Abrir el launchpad','Pellizca con cuatro dedos'],
];
export async function input(c){
    // Con extremos en palabras, como los del teclado y el dock.
    const ejes=(fila,a,b)=>fila.slice(0,-'</div>'.length)+`<div class="bk-temp-ejes" aria-hidden="true"><span>${esc(_tr(a))}</span><span>${esc(_tr(b))}</span></div></div>`;
    await page(c,'Touchpad y ratón',d=>[
        ['',[
            ejes(range('velocidad_touchpad','Velocidad del touchpad',d.velocidad_touchpad,-1,1,.1,'dec'),'Lenta','Rápida'),
            ejes(range('velocidad_raton','Velocidad del ratón',d.velocidad_raton,-1,1,.1,'dec'),'Lenta','Rápida'),
            toggle('toque_para_clic','Tocar para hacer clic',d.toque_para_clic,'Un toque con un dedo hace clic'),
        ]],
        ['',[toggle('scroll_natural','Desplazamiento natural',d.scroll_natural,'El contenido sigue el movimiento de los dedos')]],
        ['',GESTOS.map(([id,titulo,como])=>`<div class="detail-item detail-item-row tp-gesto" data-gesto="${id}" tabindex="0"><div class="detail-texts"><span class="dt">${esc(_tr(titulo))}</span><span class="ds">${esc(_tr(como))}</span></div></div>`)],
    ]);
    const tarjetas=[...c.querySelectorAll('.detail-card')];
    if(tarjetas.length<3)return;
    // Como en macOS: la fila bajo el puntero (o con el foco) enseña en bucle
    // qué hace, con el touchpad a la izquierda y su efecto a la derecha.
    const pest=(id,label)=>`<button type="button" class="bk-seg-btn" role="tab" data-tp-pestana="${id}">${esc(_tr(label))}</button>`;
    tarjetas[0].insertAdjacentHTML('beforebegin',`<div class="tp-vista" aria-hidden="true">
        <div class="tp-pad">${'<i class="tp-dedo"></i>'.repeat(4)}</div>
        <div class="tp-pantalla"><div class="tp-doc">${'<span></span>'.repeat(9)}</div><i class="tp-otra"></i><div class="tp-franja">${'<i></i>'.repeat(3)}</div><div class="tp-rejilla">${'<i></i>'.repeat(8)}</div><i class="tp-boton"></i><i class="tp-cursor"></i></div>
    </div>
    <div class="bk-seg tp-pestanas" role="tablist">${pest('apuntar','Apuntar y clic')}${pest('desplazar','Desplazamiento')}${pest('gestos','Más gestos')}</div>`);
    const vista=c.querySelector('.tp-vista');
    const estado=()=>{
        vista.classList.toggle('natural',c.querySelector('[data-toggle="scroll_natural"]').classList.contains('active'));
        vista.classList.toggle('sin-toque',!c.querySelector('[data-toggle="toque_para_clic"]').classList.contains('active'));
    };
    // El recorrido del cursor crece con la velocidad: -1..1 se lleva a 0,6..2,4
    // veces lo que se mueve el dedo.
    const velocidad=el=>vista.style.setProperty('--k',1.5+Number(el.value)*.9);
    const mostrar=(demo,el)=>{vista.dataset.demo=demo;if(demo==='velocidad')velocidad(el);};
    const fila=(el,demo)=>{
        const f=el.closest('.detail-item');
        f.addEventListener('mouseenter',()=>mostrar(demo,el));
        f.addEventListener('focusin',()=>mostrar(demo,el));
    };
    for(const [clave,demo] of Object.entries({velocidad_touchpad:'velocidad',velocidad_raton:'velocidad',toque_para_clic:'toque',scroll_natural:'scroll'})){
        const el=c.querySelector(`[data-config="${clave}"],[data-toggle="${clave}"]`);
        fila(el,demo);
        if(el.type==='range')el.addEventListener('input',()=>velocidad(el));
        // Después del click de setupToggle, que es quien cambia la clase.
        else el.addEventListener('click',()=>requestAnimationFrame(estado));
    }
    c.querySelectorAll('.tp-gesto').forEach(el=>fila(el,el.dataset.gesto));
    // Cada pestaña abre con la demo de su primera fila: cambiar de pestaña y
    // seguir viendo la animación de la anterior despistaba.
    const PRIMERA={apuntar:'velocidad',desplazar:'scroll',gestos:'exponer'};
    const abrir=id=>{
        const n=Object.keys(PRIMERA).indexOf(id);
        tarjetas.forEach((t,i)=>{t.hidden=i!==n;});
        c.querySelectorAll('[data-tp-pestana]').forEach(b=>{const on=b.dataset.tpPestana===id;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
        mostrar(PRIMERA[id],c.querySelector('[data-config="velocidad_touchpad"]'));
    };
    c.querySelectorAll('[data-tp-pestana]').forEach(b=>b.addEventListener('click',()=>abrir(b.dataset.tpPestana)));
    estado();
    abrir('apuntar');
}
// La pestaña de los pasos sobrevive a volver a abrir la página.
let pestanaPasos='volumen';
export async function keyboard(c){
    let layouts=[],sistema='';
    try{layouts=JSON.parse(await tauriInvoke('list_keymaps_pretty'));}catch{}
    // Sin `teclado` en la config el compositor usa la del sistema; sin esto el
    // menú salía vacío porque ningún id coincidía con null.
    try{sistema=JSON.parse(await tauriInvoke('get_locale_info')).keymap.split(',')[0].trim();}catch{}
    // Los extremos con palabras, como el tamaño del dock: «600 ms» solo no
    // dice hacia dónde mover el deslizador.
    const ejes=(fila,a,b)=>fila.slice(0,-'</div>'.length)+`<div class="bk-temp-ejes" aria-hidden="true"><span>${esc(_tr(a))}</span><span>${esc(_tr(b))}</span></div></div>`;
    await page(c,'Teclado',d=>[
        ['',[
            ejes(range('teclado_velocidad','Velocidad de repetición',d.teclado_velocidad??25,0,60,1,'rep'),'Apagada','Rápida'),
            ejes(range('teclado_retardo','Retardo hasta repetir',d.teclado_retardo??600,150,1500,50,'ms'),'Corto','Largo'),
            // Cada cliente repite con lo que le dijo el compositor al recibir
            // el foco; aquí se prueba al momento porque el compositor reenvía
            // el cambio a los clientes ya abiertos.
            `<div class="detail-item"><input type="text" class="tec-prueba" placeholder="${esc(_tr('Mantén una tecla aquí para probar'))}" aria-label="${esc(_tr('Prueba de repetición'))}"></div>`,
        ]],
        ['Entrada de texto',[select('teclado','Distribución',d.teclado||sistema,layouts.map(x=>[x.id,x.name]))]],
        // Lo que mueve cada pulsación de las teclas de volumen y brillo y
        // cada repetición al mantenerlas (unas diez por segundo). Lo lee el
        // compositor de panel.conf.
        // Pestañas Volumen | Brillo como en Sonido (Salida | Entrada): las dos
        // teclas tienen los mismos dos pasos y juntas serían cuatro filas casi
        // iguales.
        ['Teclas de volumen y brillo',[
            `<div class="detail-item"><div class="bk-seg pasos-pestanas" role="tablist">${['volumen','brillo'].map(id=>`<button type="button" class="bk-seg-btn${pestanaPasos===id?' active':''}" role="tab" aria-selected="${pestanaPasos===id}" data-pestana="${id}">${_tr(id==='volumen'?'Volumen':'Brillo')}</button>`).join('')}</div></div>`,
            ...['volumen','brillo'].map(id=>`<div data-panel="${id}"${pestanaPasos===id?'':' hidden'}>${[
                stepper(`${id}_paso`,'Al pulsar','Cuánto cambia con cada pulsación · de 1 a 10 %',d[`${id}_paso`]??5,1,10),
                stepper(`${id}_paso_mantener`,'Al mantener','Cuánto cambia en cada repetición, unas diez por segundo · de 1 a 30 %',d[`${id}_paso_mantener`]??2,1,30),
            ].join('')}</div>`),
        ]],
        ['Atajos',[renderNavRow('Atajos y remapeo de teclas','Cambia lo que hace cada tecla en la app Teclas',{id:'tec-atajos'})]],
    ]);
    cablearStepper(c);
    c.querySelectorAll('[data-pestana]').forEach(b=>b.addEventListener('click',()=>{
        pestanaPasos=b.dataset.pestana;
        c.querySelectorAll('[data-pestana]').forEach(x=>{const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-selected',String(on));});
        c.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==pestanaPasos;});
    }));
    c.querySelector('#tec-atajos')?.addEventListener('click',async()=>{
        try{await tauriInvoke('open_teclas');}catch(e){toast(String(e),'❌');}
    });
}
// Un escritorio en miniatura con panel, ventana y dock: lo comparten las
// fichas de minimizar y las de cada escritorio.
const escritorioMini=(clase,conVentana=true)=>`<span class="ap-mini ${clase}"><span class="ap-panel"></span>${conVentana?ventana:''}<span class="ap-dock"><i></i><i></i><i></i><i></i></span></span>`;
// Solo lo que el escritorio cumple de verdad. El servidor de avisos
// (bookos-comp/src/notificaciones.rs) no tiene ajustes por aplicación, ni
// sonido, ni avisos en la pantalla de bloqueo: copiar esas filas de macOS
// sería poner interruptores que no hacen nada. Los tiempos y la posición del
// aviso están fijos en bookos-shell/src/toast.rs; se cuentan, no se ajustan.
export async function notifications(c){
    c.innerHTML=renderHeader('Notificaciones')+renderSkeleton(2);
    const [d,fondo,ajuste,dnd]=await Promise.all([
        config().catch(()=>({})),
        fondoMiniatura(),
        getSetting('UpdateNotifications','true'),
        tauriInvoke('get_dnd_status').then(parseServiceResult).catch(e=>({error:String(e)})),
    ]);
    const oscuro=d.tema_efectivo==='oscuro';
    const tono=`${oscuro?'oscuro':'claro'} ${d.efectos==='reducidos'?'solido':'cristal'}`;
    // La misma miniatura de escritorio que Apariencia, con la campana en el
    // panel y el aviso arriba a la derecha, donde lo pone toast.rs.
    const mini=clase=>`<span class="ap-mini ${tono} ${clase}"><span class="ap-panel"><span class="ap-campana"></span></span>${ventana}<span class="ap-aviso"><i></i><span class="ap-linea"></span><span class="ap-linea corta"></span></span><span class="ap-dock"><i></i><i></i><i></i><i></i></span></span>`;
    let silencio=dnd.error?null:dnd.dnd_active;
    c.innerHTML=renderHeader('Notificaciones')+`<div class="ap" style="--ap-acento:${colorAcento(d.acento,oscuro)}${fondo?`;--ap-fondo:url('${esc(fondo)}')`:''}">
        <div class="theme-block">
            <div class="ap-cab"><span class="dt">${_tr('Avisos')}</span><span class="ds">${_tr('Salen arriba a la derecha y se guardan en la campana del panel, que conserva los 20 últimos. Pasa el puntero por encima para verlo.')}</span></div>
            ${dnd.error?renderInfoItem('No molestar no disponible',esc(dnd.error)):`
            <div class="ap-opciones" role="radiogroup" aria-label="${esc(_tr('Avisos'))}">
                ${opcion('silencio','false','En pantalla',String(silencio),mini('avisa'))}
                ${opcion('silencio','true','No molestar',String(silencio),mini('calla'))}
            </div>
            <span class="ds ap-pie">${_tr('Con No molestar los avisos van directos a la campana; los urgentes salen igualmente. Para silenciar solo 1, 4 u 8 horas, abre la campana.')}</span>`}
            <div class="theme-block-divider"></div>
            ${renderRowItem('Probar un aviso','Se ven hasta tres a la vez, unos 5 segundos; los urgentes, 10.',`<button type="button" class="btn btn-secondary btn-sm" id="noti-probar">${_tr('Probar')}</button>`)}
        </div>
        <div class="theme-block">
            ${toggle('UpdateNotifications','Avisos de actualizaciones',ajuste!=='false','Ajustes avisa cuando hay una versión nueva de BookOS.')}
        </div>
    </div>`;
    c.querySelectorAll('[data-silencio]').forEach(b=>b.addEventListener('click',async()=>{
        const valor=b.dataset.silencio==='true',antes=silencio;
        if(valor===antes)return;
        marcar(c,'silencio',valor);silencio=valor;
        try{parseServiceResult(await tauriInvoke('toggle_dnd',{enable:valor}));}
        catch(e){marcar(c,'silencio',antes);silencio=antes;toast(String(e),'❌');}
    }));
    setupToggle('UpdateNotifications',active=>setSetting('UpdateNotifications',String(active)));
    const probar=c.querySelector('#noti-probar');
    probar.addEventListener('click',async()=>{
        probar.disabled=true;
        try{
            await tauriInvoke('probar_notificacion',{titulo:_tr('Así se ven los avisos'),cuerpo:_tr('Este es un aviso de prueba de Ajustes.')});
            // Con No molestar el aviso no sale en pantalla: sin esta pista
            // parece que el botón no funciona.
            if(silencio)toast(_tr('No molestar está activado: el aviso está en la campana.'));
        }catch(e){toast(String(e),'❌');}
        finally{probar.disabled=false;}
    });
}
export async function home(c){
    c.innerHTML=renderHeader('Escritorio')+renderSkeleton(3);
    let d;
    try{d=await config();}
    catch(e){c.innerHTML=renderHeader('Escritorio')+renderInfoItem('No se pudo leer la configuración de BookOS',esc(String(e)));return;}
    const pinned=d.dock||[];
    const [fondo,rutas]=await Promise.all([
        fondoMiniatura(),
        tauriInvoke('resolver_iconos',{nombres:pinned.map(l=>l.icono||'')}).then(JSON.parse).catch(()=>[]),
    ]);
    let n=d.escritorios;
    const names=Array.from({length:5},(_,i)=>d.nombres_escritorios?.[i]||`Escritorio ${i+1}`);
    // `dock_esquiva` llegó a GetConfig en el mismo cambio que hizo que el
    // compositor aplique en vivo el número de escritorios: sirve para saber
    // si hace falta avisar de que se aplica al volver a iniciar sesión.
    const enVivo=d.dock_esquiva!==undefined;
    // Las miniaturas pintan panel y dock como los pinta ahora el escritorio:
    // cristal con los efectos completos, sólidos con los reducidos.
    const oscuro=d.tema_efectivo==='oscuro',claroOscuro=oscuro?'oscuro':'claro',tono=`${claroOscuro} ${d.efectos==='reducidos'?'solido':'cristal'}`;
    let minimizar=d.efectos==='reducidos'?'ninguna':d.genio!==false?'genio':'escala';
    const size=d.dock_tamano??50;
    // Los lanzadores fijados de verdad. El launchpad es un icono del propio
    // compositor que no está instalado en ningún tema: va una copia en assets.
    // Lo que no se encuentre sale como inicial sobre un color.
    const cols=['var(--blue)','var(--green)','var(--orange)','var(--red)','var(--yellow)'];
    const tiles=(pinned.length?pinned.slice(0,7):[{},{},{},{},{}]).map((l,i)=>{
        const url=l.app_id==='launchpad'?'./assets/apps/launchpad.svg':appIconUrl(l.app_id,rutas[i]);
        return url?`<i class="con-icono"><img src="${esc(url)}" alt=""></i>`
            :`<i style="background:${cols[i%cols.length]}">${esc((l.etiqueta||'').trim().charAt(0).toUpperCase())}</i>`;
    }).join('');
    const dots=Array.from({length:5},(_,i)=>`<b${i<n?'':' hidden'}${i===0?' class="on"':''}></b>`).join('');
    const seg=[1,2,3,4,5].map(v=>`<button type="button" class="bk-seg-btn${v===n?' active':''}" data-desk="${v}" aria-pressed="${v===n}">${v}</button>`).join('');
    const tamano=range('dock_tamano','Tamaño',size,32,80,1,'px');
    const ejes=`<div class="bk-temp-ejes" aria-hidden="true"><span>${esc(_tr('Pequeño'))}</span><span>${esc(_tr('Grande'))}</span></div>`;
    const escritorios=names.map((nm,i)=>`<div class="esc-escritorio"${i<n?'':' hidden'}>
        ${escritorioMini(tono,false)}
        <input class="esc-nombre" data-i="${i}" maxlength="24" value="${esc(nm)}" aria-label="${esc(_tr('Nombre del escritorio'))} ${i+1}">
    </div>`).join('');
    c.innerHTML=renderHeader('Escritorio')+`<div class="ap esc" style="--ap-acento:${colorAcento(d.acento,oscuro)}${fondo?`;--ap-fondo:url('${esc(fondo)}')`:''}">
        <div class="esc-vista ${oscuro?'oscuro':'claro'}" aria-hidden="true">
            <div class="esc-panel"><div class="dock-desks">${dots}</div><span class="dock-desk-name">${esc(names[0])}</span></div>
            <div class="dock-bar" style="--dock:${size}px">${tiles}</div>
        </div>
        ${renderSection('Dock')}
        <div class="theme-block">
            ${tamano.slice(0,-'</div>'.length)+ejes+'</div>'}
            <div class="ap-cab"><span class="dt">${_tr('Animación al minimizar')}</span><span class="ds">${_tr('Pasa el puntero por encima para verla. «Sin animación» también quita el desenfoque del panel y del dock.')}</span></div>
            <div class="ap-opciones" role="radiogroup" aria-label="${esc(_tr('Animación al minimizar'))}">
                ${opcion('minimizar','genio','Efecto genio',minimizar,escritorioMini(`${claroOscuro} cristal genio`))}
                ${opcion('minimizar','escala','Efecto escala',minimizar,escritorioMini(`${claroOscuro} cristal escala`))}
                ${opcion('minimizar','ninguna','Sin animación',minimizar,escritorioMini(`${claroOscuro} solido sin-animacion`))}
            </div>
            ${enVivo?`<div class="theme-block-divider"></div>
            ${toggle('dock_esquiva','Ocultar el dock automáticamente',d.dock_esquiva,'Se aparta cuando una ventana llega a él y vuelve al llevar el puntero abajo · Meta+Alt+D')}
            ${toggle('panel_esquiva','Ocultar la barra superior automáticamente',d.panel_esquiva,'Igual que el dock, pero arriba · Meta+Alt+B')}`:''}
        </div>
        ${renderSection('Escritorios')}
        <div class="theme-block">
            <div class="ap-cab esc-cab"><span class="dt">${_tr('Número de escritorios')}</span><div class="bk-seg" role="group" aria-label="${esc(_tr('Número de escritorios'))}">${seg}</div></div>
            <div class="esc-escritorios">${escritorios}</div>
        </div>
        <p class="page-foot">${enVivo?'':_tr('El número de escritorios se aplica al volver a iniciar sesión.')+' '}${_tr('Los lanzadores se fijan y se retiran desde el dock o el launchpad.')}</p>
    </div>`;
    // Tres fichas para dos claves: el compositor no tiene «minimizar sin
    // animación» suelto, se lo salta cuando los efectos están reducidos
    // (bookos-comp/src/ventanas.rs). Por eso esta es la única ficha de
    // `efectos`: Apariencia tenía otra igual con otro nombre.
    c.querySelectorAll('[data-minimizar]').forEach(b=>b.addEventListener('click',async()=>{
        const valor=b.dataset.minimizar,antes=minimizar;
        if(valor===antes)return;
        const cambios=valor==='ninguna'?{efectos:'reducidos'}:{genio:valor==='genio',efectos:'completos'};
        marcar(c,'minimizar',valor);minimizar=valor;
        try{await save(cambios);Object.assign(d,cambios);}
        catch(e){marcar(c,'minimizar',antes);minimizar=antes;toast(String(e),'❌');}
    }));
    const bar=c.querySelector('.dock-bar'),slider=c.querySelector('[data-config="dock_tamano"]'),valor=slider.closest('.bk-slider-row').querySelector('.ds');
    fillRange(slider);
    slider.addEventListener('input',()=>{fillRange(slider);valor.textContent=formats.px(Number(slider.value));bar.style.setProperty('--dock',`${slider.value}px`);});
    slider.addEventListener('change',async()=>{
        try{await guardar(d,'dock_tamano',Number(slider.value));}
        catch(e){
            slider.value=d.dock_tamano;fillRange(slider);valor.textContent=formats.px(d.dock_tamano);
            bar.style.setProperty('--dock',`${d.dock_tamano}px`);toast(String(e),'❌');
        }
    });
    if(enVivo)['dock_esquiva','panel_esquiva'].forEach(k=>setupToggle(k,async v=>{await save({[k]:v});}));
    const segEl=c.querySelector('.bk-seg');
    segEl.addEventListener('click',async e=>{
        const btn=e.target.closest('[data-desk]');if(!btn)return;
        const v=Number(btn.dataset.desk);if(v===n)return;
        try{
            await save({escritorios:v},!enVivo);
            n=v;
            segEl.querySelectorAll('[data-desk]').forEach(x=>{const on=x===btn;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));});
            c.querySelectorAll('.dock-desks b').forEach((b,i)=>{b.hidden=i>=v;});
            c.querySelectorAll('.esc-escritorio').forEach((r,i)=>{r.hidden=i>=v;});
        }catch(err){toast(String(err),'❌');}
    });
    // Nombres: el compositor los guarda separados por comas, así que se quitan.
    // La vista previa enseña el escritorio cuyo nombre se está editando.
    const label=c.querySelector('.dock-desk-name'),puntos=c.querySelectorAll('.dock-desks b');
    c.querySelectorAll('.esc-nombre').forEach(inp=>{
        const i=Number(inp.dataset.i);
        const enseñar=()=>{label.textContent=inp.value||`Escritorio ${i+1}`;puntos.forEach((b,k)=>b.classList.toggle('on',k===i));};
        inp.addEventListener('focus',enseñar);
        inp.addEventListener('input',enseñar);
        inp.addEventListener('change',async()=>{
            const v=inp.value.replace(/,/g,' ').trim()||`Escritorio ${i+1}`;
            const prev=names[i];
            inp.value=v;names[i]=v;
            try{await save({nombres_escritorios:names.slice(0,n)});}
            catch(err){names[i]=prev;inp.value=prev;toast(String(err),'❌');}
        });
    });
}
export async function accessibility(c){
    await page(c,'Accesibilidad',d=>[
        toggle('alto_contraste','Alto contraste',d.alto_contraste),
        select('efectos','Efectos de ventanas y desenfoque',d.efectos,[['completos','Completos'],['reducidos','Reducidos']]),
        toggle('bloqueo_animaciones','Animaciones del bloqueo',d.bloqueo_animaciones),
        toggle('actividades_animaciones','Animaciones de actividades',d.actividades_animaciones),
    ]);
}
export async function advanced(c){
    await page(c,'Funciones avanzadas',d=>[
        toggle('actividades','Actividades dinámicas',d.actividades),
        toggle('temporizador_siempre_visible','Temporizador siempre visible',d.temporizador_siempre_visible),
        toggle('actividades_animaciones','Animaciones',d.actividades_animaciones),
    ]);
    // renderCard produce .detail-card: buscar «.card» no encontraba nada y esta
    // sección no llegaba a mostrarse nunca.
    const card=c.querySelector('.detail-card'); if(!card)return;
    card.insertAdjacentHTML('afterend',renderSection('Energía y firmware')+renderCard([renderInfoItem('Comprobando capacidades…')]));
    const list=card.nextElementSibling.nextElementSibling;
    try{
        const controls=JSON.parse(await tauriInvoke('get_firmware_power_controls'));
        list.innerHTML=controls.length?controls.map(x=>renderRowItem(x.label,'',renderToggle('fw-'+x.id,x.value))).join(''):renderInfoItem('El kernel o el firmware no exponen controles compatibles.');
        controls.forEach(x=>setupToggle('fw-'+x.id,async active=>{
            const r=await invokeWithAuth('set_firmware_power_control',{id:x.id,enabled:active},{description:'Este ajuste modifica el firmware y requiere permisos de administrador.'});
            if(!r?.ok)throw new Error(r?.error||'No se pudo aplicar el ajuste');
        }));
    }catch(e){list.innerHTML=renderInfoItem('No se pudieron leer las capacidades del firmware.');}
}

// Último HTML pintado por contenedor. StateChanged llega con cualquier cambio
// del sistema (batería, red…), no solo de audio: sin esto la página se
// repintaba entera, con esqueleto incluido, y eso era el parpadeo.
const soundHtml=new WeakMap();
/// El nombre de un dispositivo de audio tal como se reconoce.
///
/// PipeWire los llama por el chip: «Core Ultra 200V Series Processors HD Audio
/// Speaker». Todo lo que va hasta «Audio» es igual en todos los del portátil y
/// no distingue nada; lo que dice qué es, es lo de después. Los de Bluetooth o
/// USB no llevan ese prefijo y se quedan como vienen.
function nombreAudio(desc){
    const entero=String(desc).replace(/^Monitor of /,'');
    const resto=entero.replace(/^.*?\b(?:HD )?Audio(?:\s+|$)/,'');
    if(!resto)return _tr('Audio del portátil');
    const conocidos=[
        [/^Speaker$/i,'Altavoces del portátil'],
        [/^Headphones?$/i,'Auriculares'],
        [/^Stereo Microphone$/i,'Micrófono estéreo'],
        [/^Digital Microphone$/i,'Micrófono del portátil'],
        [/^Headset Microphone$/i,'Micrófono de los auriculares'],
        [/^(HDMI \/ DisplayPort \d+) Output$/i,'$1'],
    ];
    for(const [re,nombre] of conocidos)if(re.test(resto))return _tr(resto.replace(re,nombre));
    // Algo que no se conoce se deja entero: cortado, «USB Audio Device» se
    // quedaba en «Device».
    return entero;
}

/// Qué es cada dispositivo, en la columna de la derecha, como «Tipo» en macOS.
/// Bluetooth y USB se reconocen por el nombre del nodo de PipeWire; HDMI por el
/// tipo del puerto. Todo lo demás cuelga del chip del portátil.
function tipoAudio(x){
    const n=String(x.name||'');
    if(n.startsWith('bluez_'))return 'Bluetooth';
    if(/usb/i.test(n))return 'USB';
    return (x.ports||[]).find(p=>p.name===x.activePort)?.type==='HDMI'?'HDMI':_tr('Integrado');
}
/// PipeWire deja creados los nodos de las tres salidas HDMI y del micrófono de
/// los auriculares aunque no haya nada enchufado, con el puerto «not
/// available». Ofrecerlos es ofrecer un sitio por el que no va a sonar nada.
/// El que está en uso se enseña siempre, para no dejar la lista sin marca.
const conectado=(x,actual)=>x.name===actual||!(x.ports||[]).length||x.ports.some(p=>p.availability!=='not available');
const _ICONO_AUDIO={
    altavoz:'<path d="M11 5 6 9H3v6h3l5 4z"/>',
    ondas:'<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    cruz:'<path d="m16 9 6 6M22 9l-6 6"/>',
    micro:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    tachado:'<path d="M4 4l16 16"/>',
};
const _MARCA='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const iconoAudio=(...partes)=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${partes.map(x=>_ICONO_AUDIO[x]).join('')}</svg>`;
// La pestaña y la vista viven fuera de la función: cada StateChanged repinta
// la página y sin esto se volvería siempre a Salida, o de Avanzado a Sonido.
let pestanaSonido='salida';
let vistaSonido='inicio';

export async function sound(c,vista){
    if(vista)vistaSonido=vista;
    const titulo=vistaSonido==='avanzado'?'Avanzado':'Sonido';
    const mounted=soundHtml.has(c)&&c.querySelector('.audio-page');
    if(!mounted)c.innerHTML=renderHeader(titulo)+renderSkeleton(2);
    try{
        // El chasquido lo pone el compositor: fuera de una sesión BookOS no
        // hay a quién preguntar, y la página de sonido sigue valiendo sin él.
        const [d,escritorio]=await Promise.all([tauriInvoke('get_audio_devices').then(parseServiceResult),config().catch(()=>null)]);
        // Repintar con un menú abierto o arrastrando un deslizador lo cierra o
        // lo suelta en la cara del usuario. Solo los deslizadores: con el foco
        // en una fila de dispositivo o en la pestaña, bloquear el repintado
        // dejaba la marca en el dispositivo anterior.
        if(document.getElementById('bk-popover')||c.querySelector('.audio-page input:focus'))return;
        const out=d.output,input=d.input;
        // Mismo diseño que el brillo de Pantallas: etiqueta a la izquierda y el
        // deslizador entre un icono pequeño y uno grande. El de la izquierda
        // silencia, como el altavoz del panel; un interruptor aparte permitía
        // leer «0 %» con «Silenciar» apagado sin saber si sonaba algo.
        const control=(id,label,value,silencio,icono,iconoFin)=>`<div class="detail-item detail-item-row disp-brillo">
            <span class="dt">${_tr(label)}</span>
            <div class="disp-brillo-ctl">${silencio?`<button type="button" class="audio-silencio" data-silencio="${id}" aria-pressed="${silencio.on}" aria-label="${_tr('Silenciar')}" title="${_tr(silencio.on?'Activar sonido':'Silenciar')}">${icono}</button>`:icono}
            <input class="bk-range" type="range" min="0" max="100" value="${value||0}" data-audio="${id}" aria-label="${esc(_tr(label))}"${silencio?.on?' data-mudo':''}>${iconoFin}</div>
        </div>`;
        const lista=(list,actual,menu)=>list.map(x=>{
            const on=x.name===actual;
            return `<div class="detail-item detail-item-row nav-row audio-disp${on?' on':''}" role="radio" tabindex="0" aria-checked="${on}" data-disp="${esc(x.name)}" data-lista="${menu}">
                <span class="audio-check" aria-hidden="true">${on?_MARCA:''}</span>
                <span class="dt">${esc(nombreAudio(x.description||x.name))}</span>
                <span class="ds">${esc(tipoAudio(x))}</span>
            </div>`;
        }).join('');
        // El desplegable nativo de WebKitGTK es un menú GTK sin tema; el
        // popover de la app es el mismo que usan Pantalla y el resto.
        const menus=[];
        const selectRow=(title,sub,apply,list,current)=>{
            const label=list.find(x=>x.value===current)?.label||current||'';
            menus.push({title:_tr(title),list,current,apply});
            return renderRowItem(title,sub,`<button type="button" class="bk-select" data-menu="${menus.length-1}" title="${esc(label)}" aria-haspopup="listbox"><span>${esc(label)}</span></button>`);
        };

        // El volumen arriba y los dispositivos debajo: es lo que se toca cada
        // día, y la lista aquí son uno o dos. macOS la pone primero porque la
        // suya puede llevar diez altavoces AirPlay.
        const salida=[];
        if(!out)salida.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún altavoz o auricular'));
        else salida.push(control('output','Volumen',out.volume,{on:out.muted},
                iconoAudio('altavoz',...(out.muted?['cruz']:[])),iconoAudio('altavoz','ondas')),
            lista((d.sinks||[]).filter(x=>conectado(x,d.defaultSink)),d.defaultSink,'salida'));
        // Balance y perfil se ajustan una vez y se olvidan: en la portada
        // pesaban tanto como el volumen, y el botón del perfil, con su nombre
        // largo en inglés, era lo que más llamaba la atención de la tarjeta.
        const avanzado=[];
        if(out){
            avanzado.push(`<div class="detail-item detail-item-row disp-brillo">
                <span class="dt">${_tr('Balance')}</span>
                <div class="disp-brillo-ctl"><span class="audio-lado">${_tr('I')}</span><input class="bk-range" aria-label="${_tr('Balance')}" id="audio-balance" type="range" min="-100" max="100" value="${out.balance||0}"><span class="audio-lado">${_tr('D')}</span></div>
            </div>`);
            // El perfil decide qué salidas existen (con o sin el conector de
            // auriculares, por ejemplo). Solo sale si hay entre qué elegir.
            for(const card of d.cards||[]){
                const profiles=(Array.isArray(card.profiles)?card.profiles:Object.entries(card.profiles||{}).map(([name,p])=>({name,...p})))
                    .filter(p=>p.available!=='no');
                if(profiles.length>1)avanzado.push(selectRow('Perfil de la tarjeta',esc(nombreAudio(card.properties?.['device.description']||card.name)),
                    profile=>['set_audio_profile',{card:card.name,profile}],profiles.map(p=>({value:p.name,label:p.description||p.name})),card.active_profile));
            }
        }
        const entrada=[];
        // Los «Monitor of …» son lo que suena por una salida, no micrófonos.
        const microfonos=(d.sources||[]).filter(x=>!String(x.name||'').endsWith('.monitor')&&conectado(x,d.defaultSource));
        if(!input)entrada.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún micrófono'));
        else entrada.push(control('input','Volumen de entrada',input.volume,{on:input.muted},
            iconoAudio('micro',...(input.muted?['tachado']:[])),iconoAudio('micro')),lista(microfonos,d.defaultSource,'entrada'));

        const pest=(id,label)=>`<button type="button" class="bk-seg-btn${pestanaSonido===id?' active':''}" role="tab" aria-selected="${pestanaSonido===id}" data-pestana="${id}">${_tr(label)}</button>`;
        let h=renderHeader(titulo)+'<div class="audio-page">';
        if(vistaSonido==='avanzado')h+=renderCard(avanzado.length?avanzado:[renderInfoItem('Sin dispositivo de audio','No se detectó ningún altavoz o auricular')]);
        else{
            h+=renderCard([`<div class="detail-item"><div class="bk-seg audio-pestanas" role="tablist">${pest('salida','Salida')}${pest('entrada','Entrada')}</div></div>`,
                `<div data-panel="salida"${pestanaSonido==='salida'?'':' hidden'}>${salida.join('')}</div>`,
                `<div data-panel="entrada"${pestanaSonido==='entrada'?'':' hidden'}>${entrada.join('')}</div>`]);
            // speech-dispatcher deja abierto un flujo de reposo aunque nadie hable:
            // no es una aplicación que el usuario reconozca ni quiera ajustar.
            const apps=(d.apps||[]).filter(a=>!/^speech-dispatcher/.test(a.name||''));
            if(apps.length)h+=renderSection('Aplicaciones')+renderCard(apps.map(app=>
                control(`app:${app.index}`,esc(app.name||'Aplicación'),app.volume,null,iconoAudio('altavoz'),iconoAudio('altavoz','ondas'))));
            if(out&&escritorio)h+=renderSection('Efectos de sonido')+renderCard([
                toggle('audio-feedback','Sonido al cambiar el volumen',escritorio.sonido_volumen!==false,'Con las teclas de volumen')]);
            if(avanzado.length)h+=renderCard([renderNavRow('Avanzado','Balance y perfil de la tarjeta',{id:'audio-avanzado'})]);
        }
        h+='</div>';
        if(mounted&&soundHtml.get(c)===h)return;
        c.innerHTML=h;
        soundHtml.set(c,h);
        // Sin repintar aquí: el servicio emite StateChanged tras aplicar el
        // cambio y renderSonido ya escucha esa señal. Repintar también desde
        // aquí pedía los dispositivos dos veces por cada gesto.
        const action=async(el,cmd,args)=>{try{parseServiceResult(await tauriInvoke(cmd,args));}catch(e){toast(String(e),'❌');await sound(c);}};
        c.querySelectorAll('[data-pestana]').forEach(b=>b.addEventListener('click',()=>{
            pestanaSonido=b.dataset.pestana;
            c.querySelectorAll('[data-pestana]').forEach(x=>{const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-selected',String(on));});
            c.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==pestanaSonido;});
        }));
        c.querySelectorAll('.bk-range').forEach(fillRange);
        c.querySelector('#audio-balance')?.addEventListener('input',e=>fillRange(e.target));
        c.querySelector('#audio-balance')?.addEventListener('change',e=>action(e.target,'set_balance',{balance:Number(e.target.value)}));
        c.querySelectorAll('[data-audio]').forEach(el=>{
            el.addEventListener('input',()=>fillRange(el));
            el.addEventListener('change',()=>{
                const id=el.dataset.audio,value=Number(el.value);
                // Soltar el deslizador devuelve el foco: si no, el guardia de
                // arriba se saltaría todos los repintados siguientes.
                el.blur();
                return id.startsWith('app:')?action(el,'set_app_volume',{index:Number(id.slice(4)),volume:value}):action(el,'system_set_volume',{input:id==='input',value});
            });
        });
        c.querySelectorAll('[data-silencio]').forEach(b=>b.addEventListener('click',()=>{
            const muted=b.getAttribute('aria-pressed')!=='true';
            b.setAttribute('aria-pressed',String(muted));
            return b.dataset.silencio==='input'?action(b,'set_mic_muted',{muted}):action(b,'system_set_mute',{input:false,muted});
        }));
        c.querySelectorAll('[data-disp]').forEach(r=>r.addEventListener('click',()=>{
            if(r.classList.contains('on'))return;
            // La marca se mueve ya: el StateChanged que la confirma tarda lo
            // que tarde WirePlumber, y mientras la fila pulsada parecía muerta.
            r.parentElement.querySelectorAll('.audio-disp').forEach(x=>{const on=x===r;x.classList.toggle('on',on);x.setAttribute('aria-checked',String(on));x.querySelector('.audio-check').innerHTML=on?_MARCA:'';});
            const name=r.dataset.disp;
            return r.dataset.lista==='salida'?action(r,'set_default_sink',{name}):action(r,'set_default_source',{name});
        }));
        c.querySelectorAll('[data-menu]').forEach(el=>el.addEventListener('click',()=>{
            const menu=menus[el.dataset.menu];
            popoverSelect(el.closest('.detail-item'),{
                title:menu.title,
                options:menu.list.map(x=>({val:x.value,label:esc(x.label)})),
                current:menu.current,
                onSelect:value=>{
                    const label=menu.list.find(x=>x.value===value)?.label||value;
                    el.querySelector('span').textContent=label;el.title=label;
                    return action(el,...menu.apply(value));
                },
            });
        }));
        c.querySelector('#audio-avanzado')?.addEventListener('click',()=>{
            window.pushSubNav?.(()=>sound(c,'inicio'));
            sound(c,'avanzado');
        });
        // setupToggle ya revierte el interruptor y avisa si esto lanza.
        setupToggle('audio-feedback',active=>tauriInvoke('bookos_apply_config',{config:{sonido_volumen:active}}));
    }catch(e){soundHtml.delete(c);c.innerHTML=renderHeader(titulo)+renderServiceError(e,'audio');}
}
export async function security(c){
    c.innerHTML=renderHeader('Seguridad y privacidad')+renderSkeleton(2);
    try{
        const [fw,cam,mic]=await Promise.all(['get_firewall_status','get_camera_enabled','get_mic_muted'].map(cmd=>tauriInvoke(cmd).then(JSON.parse)));
        c.innerHTML=renderHeader('Seguridad y privacidad')+renderCard([
            toggle('native-fw','Cortafuegos',fw.active),toggle('native-camera','Cámara',cam.enabled),toggle('native-mic','Micrófono',!mic.muted),
            renderRowItem('Bloqueo y suspensión','', '<button class="btn" id="native-lock">Configurar</button>')]);
        setupToggle('native-fw',async enable=>{if(!await promptSudo(enable?'activar el cortafuegos':'desactivar el cortafuegos','ufw',[enable?'enable':'disable']))throw new Error('No se pudo cambiar el cortafuegos');});
        setupToggle('native-camera',enabled=>tauriInvoke('set_camera_enabled',{enabled}));
        setupToggle('native-mic',enabled=>tauriInvoke('set_mic_muted',{muted:!enabled}));
        c.querySelector('#native-lock')?.addEventListener('click',()=>{window.pushSubNav?.(()=>security(c));lockscreen(c);});
    }catch(e){c.innerHTML=renderHeader('Seguridad y privacidad')+renderInfoItem('No se pudo leer el estado',esc(String(e)));}
}
