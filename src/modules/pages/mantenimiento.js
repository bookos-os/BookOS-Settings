// Mantenimiento: estado del equipo y limpieza. Medir y borrar lo hace
// bookos-system (bookos-desktop); aquí solo se decide qué enseñar y se piden
// las contraseñas, que ese servicio no puede pedir.
import {tauriInvoke,elegirRuta,ci,esc,toast,showDialog,renderHeader,renderSection,renderCard,renderRowItem,renderNavRow,renderSkeleton,renderError,renderEmptyState,_tr} from './_common.js';
import {ico} from './iconos.js';
import {getLang} from '../i18n.js';

// Por debajo no compensa pedir una contraseña ni ofrecer el botón principal.
const LIBERABLE_MINIMO=50*1024*1024;
const GIB=1024**3;
const CACHES_VISIBLES=6;

const llamar=async(metodo,carga)=>JSON.parse(await tauriInvoke('mantenimiento',{metodo,carga:carga===undefined?null:JSON.stringify(carga)}));
const vigente=()=>{const epoca=window._navEpoch;return()=>window._navEpoch===epoca;};

function bytes(n){
    const unidades=['B','KB','MB','GB','TB'];
    let v=n,i=0;
    while(v>=1024&&i<unidades.length-1){v/=1024;i++;}
    const f=new Intl.NumberFormat(getLang(),{maximumFractionDigits:i<2||v>=100?0:1});
    return `${f.format(v)} ${unidades[i]}`;
}
const porcentaje=(parte,total)=>total>0?Math.min(100,Math.round(parte/total*100)):0;
const barra=(pct,tono='')=>`<div class="mt-barra" role="presentation"><div class="mt-barra-relleno${tono?` ${tono}`:''}" style="width:${pct}%"></div></div>`;
const usadoDisco=d=>Math.max(0,d.total-d.libre);
const nivelDisco=d=>d.libre<5*GIB||d.libre<d.total*.05?'critico':d.libre<d.total*.15?'aviso':'bien';
const caidos=r=>[...r.diagnostico.servicios_caidos,...r.diagnostico.servicios_usuario_caidos];
const liberable=t=>t?t.miniaturas+t.paquetes+t.registros:0;
const errorServicio='El servicio del sistema no responde o está desactualizado';

// Sobrevive a salir y volver a la página: recorrer `$HOME` cuesta hasta 12 s y el
// servicio solo admite una búsqueda a la vez, así que reentrar debe engancharse
// a la que ya corre en vez de chocar con ella.
const _busqueda={promesa:null,datos:null,error:false};
function buscar(){
    _busqueda.error=false;
    _busqueda.promesa??=llamar('escanear')
        .then(d=>{_busqueda.datos=d;})
        .catch(()=>{_busqueda.error=true;})
        .finally(()=>{_busqueda.promesa=null;});
    return _busqueda.promesa;
}
const quitarDeBusqueda=rutas=>{
    if(!_busqueda.datos)return;
    for(const clave of ['proyectos','grandes','comprimidos','descargas'])
        _busqueda.datos[clave]=_busqueda.datos[clave].filter(f=>!rutas.includes(f.ruta));
};

async function pedirContrasena(descripcion){
    const auth=await window.promptAuth?.({title:'Se necesita tu contraseña',description:descripcion,confirmLabel:'Continuar'});
    return auth?.password||null;
}
async function limpiarRoot(objetivo,password){
    const r=JSON.parse(await tauriInvoke('mantenimiento_root',{objetivo,password}));
    if(!r.ok)throw new Error(r.stderr||objetivo);
}
function avisarResultado(liberados,fallos){
    if(fallos>0)toast(`${_tr('Liberado hasta')} ${bytes(liberados)}. ${_tr('Algunos elementos no se pudieron borrar')}: ${fallos}`,'⚠️');
    else toast(`${_tr('Liberado hasta')} ${bytes(liberados)}`,'🧹');
}
const confirmar=(titulo,mensaje,texto)=>new Promise(res=>showDialog(_tr(titulo),_tr(mensaje),{confirmText:_tr(texto),cancelText:_tr('Cancelar'),onConfirm:()=>res(true),onCancel:()=>res(false)}));
// Mientras dura la acción el botón no se puede repetir: borrar decenas de gigas
// tarda, y un segundo clic lanzaría otra pasada sobre lo que ya se está borrando.
async function conBoton(b,fn){
    const texto=b.textContent;
    b.disabled=true;b.textContent=_tr('Limpiando…');
    try{return await fn();}
    finally{if(b.isConnected){b.disabled=false;b.textContent=texto;}}
}

// ── Portada ──────────────────────────────────────────────────────────────
function estado(r,t){
    const d=nivelDisco(r.disco),fallos=caidos(r).length;
    const puede=liberable(t)>=LIBERABLE_MINIMO;
    const espacio=`${_tr('Quedan libres')} ${bytes(r.disco.libre)}.`;
    const consejo=puede?_tr('Puedes liberar espacio sin perder nada tuyo.'):_tr('Revisa qué ocupa más para ganar espacio.');
    if(d==='critico')return{tono:'critico',titulo:'Disco casi lleno',texto:`${espacio} ${consejo}`};
    if(d==='aviso')return{tono:'aviso',titulo:'Poco espacio',texto:`${espacio} ${consejo}`};
    if(fallos)return{tono:'aviso',titulo:'Revisa el diagnóstico',texto:_tr('Hay servicios que no han arrancado bien.')};
    return{tono:'bien',titulo:'Bueno',texto:puede?consejo:_tr('Todo en orden. No hay nada urgente que limpiar.')};
}
function heroHtml(r,t){
    const e=estado(r,t),cifra=liberable(t);
    const boton=!t?`<button type="button" class="mt-cta" disabled>${_tr('Calculando…')}</button>`
        :cifra>=LIBERABLE_MINIMO?`<button type="button" class="mt-cta" id="mt-liberar">${_tr('Liberar hasta')} ${bytes(cifra)}</button>`
        :e.tono==='bien'?'':`<button type="button" class="mt-cta" id="mt-revisar">${_tr('Revisar almacenamiento')}</button>`;
    // Con el disco justo, lo regenerable puede quedarse corto: que el camino a
    // lo que más ocupa se vea sin tener que buscarlo.
    const enlace=t&&cifra>=LIBERABLE_MINIMO&&e.tono!=='bien'?`<button type="button" class="mt-enlace" id="mt-revisar">${_tr('Revisar almacenamiento')}</button>`:'';
    return `<h3 class="mt-estado">${_tr(e.titulo)}</h3><p class="mt-estado-texto">${esc(e.texto)}</p>${boton}${enlace}`;
}
function medidor({id,icono,etiqueta,valor,detalle,pct,tono}){
    return `<button type="button" class="mt-medidor" id="${id}">
        <span class="mt-medidor-etiqueta">${ico(icono,{size:16})}${_tr(etiqueta)}</span>
        <span class="mt-medidor-fila"><strong>${esc(valor)}</strong><span>${esc(detalle)}</span></span>
        ${barra(pct,tono)}
    </button>`;
}
function medidores(r,bat){
    const d=r.disco,usado=usadoDisco(d),m=r.memoria,usadaMem=m.total-m.disponible;
    const nivel=nivelDisco(d);
    const estadoBat={charging:'Cargando','fully-charged':'Cargada',discharging:'Con batería'}[bat?.state];
    return (bat?medidor({id:'mt-bat',icono:'battery-medium',etiqueta:'Batería',valor:`${bat.percentage} %`,detalle:_tr(estadoBat),pct:Number(bat.percentage)}):'')
        +medidor({id:'mt-disco',icono:'hard-drive',etiqueta:'Almacenamiento',valor:`${porcentaje(usado,d.total)} % ${_tr('usado')}`,detalle:`${bytes(usado)} / ${bytes(d.total)}`,pct:porcentaje(usado,d.total),tono:nivel==='bien'?'':nivel})
        +medidor({id:'mt-mem',icono:'memory-stick',etiqueta:'Memoria',valor:`${porcentaje(usadaMem,m.total)} % ${_tr('usado')}`,detalle:`${bytes(usadaMem)} / ${bytes(m.total)}`,pct:porcentaje(usadaMem,m.total)});
}
// Salud = lo que carga hoy frente a lo que cargaba de fábrica.
function filasBateria(bat){
    const lleno=Number(bat.energy_full),diseno=Number(bat.energy_full_design);
    return [
        ...(lleno>0&&diseno>0?[renderRowItem('Salud de la batería','',`<span class="mt-tam">${Math.min(100,Math.round(lleno/diseno*100))} %</span>`)]:[]),
        ...(bat.cycle_count&&bat.cycle_count!=='0'?[renderRowItem('Ciclos de carga','',`<span class="mt-tam">${esc(bat.cycle_count)}</span>`)]:[]),
        renderNavRow('Estado de la batería','Salud, consumo y carga',{id:'mt-bat-det'}),
    ];
}
// sysfs de este equipo expone charge_* y no energy_*, así que las capacidades
// salen vacías (0 Wh); UPower sí las da, con coma decimal y la unidad pegada.
const numero=t=>parseFloat(String(t||'').replace(',','.'))||0;
async function leerBateria(){
    const [sys,up]=await Promise.all([
        ci('get_battery_sysfs').then(JSON.parse).catch(()=>null),
        ci('get_battery_status').then(JSON.parse).catch(()=>null),
    ]);
    if(!sys?.ok)return null;
    const pide=(a,b)=>Number(a)>0?Number(a):numero(b);
    return{...sys,
        energy_full:pide(sys.energy_full,up?.energy_full),
        energy_full_design:pide(sys.energy_full_design,up?.energy_full_design),
        energy:pide(sys.energy,up?.energy),
        energy_rate:pide(sys.energy_rate,up?.energy_rate)};
}
export async function renderMantenimiento(c){
    const sigue=vigente();
    const cabecera=renderHeader('Mantenimiento');
    c.innerHTML=cabecera+renderSkeleton(4);
    let r,bat;
    try{
        [r,bat]=await Promise.all([
            llamar('resumen'),
            leerBateria(),
        ]);
    }catch(e){
        if(sigue())c.innerHTML=cabecera+renderError(errorServicio,{onRetry:()=>renderMantenimiento(c)});
        return;
    }
    if(!sigue())return;
    const fallos=caidos(r).length;
    c.innerHTML=cabecera+`<section class="mt-hero" id="mt-hero" data-tono="${estado(r,null).tono}" aria-live="polite">${heroHtml(r,null)}</section>
        <div class="mt-medidores">${medidores(r,bat)}</div>`
        +(bat?renderSection('Batería')+renderCard(filasBateria(bat)):'')
        +renderSection('Cuidado del sistema')+renderCard([
            renderNavRow('Actualización de software','Sistema y aplicaciones',{id:'mt-act'}),
            renderNavRow('Recuperación','Instantáneas y restauración',{id:'mt-rec'}),
            renderNavRow('Diagnóstico',fallos?`${_tr('Servicios con errores')}: ${fallos}`:'Servicios y disco',{id:'mt-diag'}),
        ])
        +renderSection('Copia de los ajustes')+renderCard([
            renderRowItem('Exportar ajustes','Guarda la configuración de BookOS en un archivo',`<button type="button" class="btn btn-secondary btn-sm" id="mt-exp">${_tr('Exportar')}</button>`),
            renderRowItem('Importar ajustes','Restaura la configuración desde un archivo',`<button type="button" class="btn btn-secondary btn-sm" id="mt-imp">${_tr('Importar')}</button>`),
        ]);
    const abrir=hijo=>{window.pushSubNav?.(()=>renderMantenimiento(c));hijo();};
    const almacenamiento=()=>abrir(()=>renderAlmacenamiento(c));
    c.querySelector('#mt-bat')?.addEventListener('click',()=>abrir(()=>renderBateriaDetalle(c,bat)));
    c.querySelector('#mt-bat-det')?.addEventListener('click',()=>abrir(()=>renderBateriaDetalle(c,bat)));
    c.querySelector('#mt-disco').addEventListener('click',almacenamiento);
    c.querySelector('#mt-mem').addEventListener('click',()=>abrir(()=>renderMemoria(c,r)));
    c.querySelector('#mt-act').addEventListener('click',()=>window.openPage('actualizacion'));
    c.querySelector('#mt-rec').addEventListener('click',()=>window.openPage('recuperacion'));
    c.querySelector('#mt-diag').addEventListener('click',()=>abrir(()=>renderDiagnostico(c,r)));
    c.querySelector('#mt-exp').addEventListener('click',exportar);
    c.querySelector('#mt-imp').addEventListener('click',importar);

    const hero=c.querySelector('#mt-hero');
    const pintarHero=t=>{
        hero.innerHTML=heroHtml(r,t);
        hero.dataset.tono=estado(r,t).tono;
        hero.querySelector('#mt-revisar')?.addEventListener('click',almacenamiento);
        hero.querySelector('#mt-liberar')?.addEventListener('click',e=>liberar(e.currentTarget,t,()=>renderMantenimiento(c)));
    };
    try{
        const t=await llamar('tamanos');
        if(sigue())pintarHero(t);
    }catch(e){
        // Los medidores ya valen por sí solos: sin tamaños solo falta la cifra.
        if(sigue())pintarHero({miniaturas:0,paquetes:0,registros:0});
    }
}
// El botón principal solo toca lo que el sistema regenera. La papelera y las
// cachés de cada app se quedan fuera a propósito: ahí hay algo que decidir.
async function liberar(boton,t,alAcabar){
    const filas=[['Miniaturas',t.miniaturas],['Caché de paquetes',t.paquetes],['Registros antiguos del sistema',t.registros]].filter(([,b])=>b>0);
    const lista=`<ul class="mt-dialogo-lista">${filas.map(([n,b])=>`<li><span>${_tr(n)}</span><span>${bytes(b)}</span></li>`).join('')}</ul>`;
    if(!await confirmar('¿Liberar espacio?',lista,'Liberar'))return;
    const root=[['paquetes',t.paquetes],['registros',t.registros]].filter(([,b])=>b>0);
    let password=null;
    if(root.length){
        password=await pedirContrasena('La caché de paquetes y los registros del sistema solo se pueden limpiar como administrador.');
        // Sin contraseña se hace lo que no la necesita: cancelar el diálogo no
        // tiene por qué dejar también las miniaturas sin limpiar.
        if(!password&&!t.miniaturas)return;
    }
    await conBoton(boton,async()=>{
        let liberados=0,fallos=0;
        if(t.miniaturas){
            try{
                const m=await llamar('limpiar',{objetivo:'miniaturas'});
                liberados+=m.liberados;fallos+=m.fallos;
            }catch(e){fallos++;}
        }
        if(password)for(const [objetivo,b] of root){
            try{await limpiarRoot(objetivo,password);liberados+=b;}
            catch(e){fallos++;}
        }
        avisarResultado(liberados,fallos);
    });
    alAcabar();
}
async function exportar(){
    try{
        const dest=await elegirRuta('save',{defaultPath:'bookos_settings.json',filters:[{name:'JSON',extensions:['json']}]});
        if(dest){await tauriInvoke('export_settings',{dest});toast(`${_tr('Ajustes exportados a')} ${dest}`);}
    }catch(e){toast('No se pudieron exportar los ajustes','❌');}
}
async function importar(){
    try{
        const src=await elegirRuta('open',{filters:[{name:'JSON',extensions:['json']}]});
        if(src){await tauriInvoke('import_settings',{src});toast('Ajustes importados');setTimeout(()=>location.reload(),1500);}
    }catch(e){toast('No se pudieron importar los ajustes','❌');}
}

// ── Almacenamiento ───────────────────────────────────────────────────────
const CATEGORIAS={
    proyectos:{titulo:'Compilaciones de proyectos',sub:'target y node_modules: se regeneran al compilar',ayuda:'Se borran directamente. El proyecto no se toca: la próxima compilación las vuelve a crear, y tardará más.',accion:'Borrar',borra:true},
    grandes:{titulo:'Archivos grandes',sub:'De más de 200 MB',ayuda:'Van a la papelera: el espacio no se recupera hasta que la vacíes.',accion:'Mover a la papelera'},
    descargas:{titulo:'Descargas antiguas',sub:'Sin tocar desde hace más de 90 días',ayuda:'Van a la papelera: el espacio no se recupera hasta que la vacíes.',accion:'Mover a la papelera'},
    comprimidos:{titulo:'Comprimidos ya extraídos',sub:'Tienen al lado una carpeta con su contenido',ayuda:'Van a la papelera: el espacio no se recupera hasta que la vacíes.',accion:'Mover a la papelera'},
};
const sumar=filas=>filas.reduce((s,f)=>s+f.bytes,0);
const fila=(titulo,sub,tam,boton)=>`<div class="detail-item detail-item-row"><div class="detail-texts"><span class="dt">${titulo}</span>${sub?`<span class="ds">${sub}</span>`:''}</div><div class="mt-fila-der"><span class="mt-tam">${tam}</span>${boton}</div></div>`;
const botonLimpiar=(id,texto,activo=true)=>`<button type="button" class="btn btn-secondary btn-sm" id="${id}"${activo?'':' disabled'}>${_tr(texto)}</button>`;

function htmlBusqueda(){
    if(_busqueda.promesa)return renderCard([`<div class="detail-item detail-item-row"><div class="detail-texts"><span class="dt">${_tr('Buscando en tu carpeta personal…')}</span><span class="ds">${_tr('Puede tardar un poco. Puedes seguir usando Ajustes.')}</span></div>${ico('loader',{size:18,cls:'mt-girando'})}</div>`]);
    const d=_busqueda.datos;
    if(!d)return renderCard([renderRowItem('Buscar qué ocupa más',_busqueda.error?'La búsqueda ha fallado. Prueba otra vez.':'Compilaciones, archivos grandes y descargas antiguas',`<button type="button" class="btn btn-secondary btn-sm" id="mt-buscar">${_tr('Buscar')}</button>`)]);
    const maximo=d.carpetas[0]?.bytes||1;
    return renderCard(Object.entries(CATEGORIAS).map(([clave,{titulo,sub}])=>renderNavRow(titulo,sub,{id:`mt-cat-${clave}`,right:`<span class="mt-fila-der"><span class="mt-tam">${d[clave].length?bytes(sumar(d[clave])):_tr('Nada')}</span>${chevronHtml}</span>`})))
        +renderSection('Lo que más ocupa en tu carpeta')
        +renderCard(d.carpetas.map(f=>`<div class="detail-item mt-carpeta"><div class="mt-carpeta-fila"><span class="dt">${esc(f.nombre)}</span><span class="mt-tam">${bytes(f.bytes)}</span></div>${barra(porcentaje(f.bytes,maximo))}</div>`));
}
const chevronHtml=`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--tx2)" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>`;

async function renderAlmacenamiento(c,todasLasCaches=false){
    const sigue=vigente();
    const cabecera=renderHeader('Almacenamiento');
    c.innerHTML=cabecera+renderSkeleton(5);
    let r,t;
    try{[r,t]=await Promise.all([llamar('resumen'),llamar('tamanos')]);}
    catch(e){
        if(sigue())c.innerHTML=cabecera+renderError(errorServicio,{onRetry:()=>renderAlmacenamiento(c)});
        return;
    }
    if(!sigue())return;
    const repintar=()=>renderAlmacenamiento(c,todasLasCaches);
    const usado=usadoDisco(r.disco),nivel=nivelDisco(r.disco);
    const caches=todasLasCaches?t.caches:t.caches.slice(0,CACHES_VISIBLES);
    const conLlave=_tr('Pide contraseña');
    c.innerHTML=cabecera+`<div class="mt-grande">
            <div class="mt-grande-fila"><span class="mt-grande-num">${porcentaje(usado,r.disco.total)} %</span><span class="mt-grande-et">${_tr('usado')}</span><span class="mt-grande-det">${bytes(usado)} / ${bytes(r.disco.total)}</span></div>
            ${barra(porcentaje(usado,r.disco.total),nivel==='bien'?'':nivel)}
            <p class="ds">${_tr('Las cifras son un máximo: con la compresión de btrfs, lo que se recupera puede ser menos.')}</p>
        </div>`
        +renderSection('Se regenera solo')+renderCard([
            fila(_tr('Miniaturas'),_tr('Se vuelven a crear al abrir las carpetas'),bytes(t.miniaturas),botonLimpiar('mt-l-min','Limpiar',t.miniaturas>0)),
            fila(_tr('Caché de paquetes'),conLlave,bytes(t.paquetes),botonLimpiar('mt-l-paq','Limpiar',t.paquetes>0)),
            fila(_tr('Registros antiguos del sistema'),conLlave,bytes(t.registros),botonLimpiar('mt-l-reg','Limpiar',t.registros>0)),
            ...(t.flatpak?[fila(_tr('Flatpak sin uso'),conLlave,'',botonLimpiar('mt-l-fla','Limpiar'))]:[]),
        ])
        +renderSection('Tus archivos')+renderCard([
            fila(_tr('Papelera'),_tr('Se borra para siempre'),bytes(t.papelera),botonLimpiar('mt-l-pap','Vaciar',t.papelera>0)),
        ])
        +`<div id="mt-busqueda">${htmlBusqueda()}</div>`
        +(t.caches.length?renderSection('Caché de aplicaciones')+renderCard([
            ...caches.map((f,i)=>fila(esc(f.nombre),'',bytes(f.bytes),botonLimpiar(`mt-c-${i}`,'Limpiar'))),
            ...(!todasLasCaches&&t.caches.length>CACHES_VISIBLES?[`<button type="button" class="mt-ver-mas" id="mt-c-mas">${_tr('Ver todas')} (${t.caches.length})</button>`]:[]),
        ]):'');

    const limpieza=(id,titulo,mensaje,carga)=>c.querySelector(id)?.addEventListener('click',async e=>{
        const b=e.currentTarget;
        if(mensaje&&!await confirmar(titulo,mensaje,'Limpiar'))return;
        await conBoton(b,async()=>{
            try{const x=await llamar('limpiar',carga);avisarResultado(x.liberados,x.fallos);}
            catch(err){toast('No se pudo limpiar','❌');}
        });
        if(sigue())repintar();
    });
    limpieza('#mt-l-min','','',{objetivo:'miniaturas'});
    limpieza('#mt-l-pap','¿Vaciar la papelera?','Lo que hay dentro se borrará para siempre.',{objetivo:'papelera'});
    caches.forEach((f,i)=>limpieza(`#mt-c-${i}`,`¿Limpiar ${esc(f.nombre)}?`,'Si la app está abierta, ciérrala antes. Lo borrado se vuelve a descargar o generar cuando haga falta, y puede costar tiempo.',{objetivo:'cache_app',nombre:f.nombre}));
    const conRoot=(id,objetivo,cifra,descripcion)=>c.querySelector(id)?.addEventListener('click',async e=>{
        const b=e.currentTarget;
        const password=await pedirContrasena(descripcion);
        if(!password)return;
        await conBoton(b,async()=>{
            try{await limpiarRoot(objetivo,password);if(cifra)avisarResultado(cifra,0);else toast('Limpieza completada','🧹');}
            catch(err){toast('No se pudo limpiar','❌');}
        });
        if(sigue())repintar();
    });
    conRoot('#mt-l-paq','paquetes',t.paquetes,'La caché de paquetes solo se puede limpiar como administrador.');
    conRoot('#mt-l-reg','registros',t.registros,'Los registros del sistema solo se pueden limpiar como administrador. Se conservan los 200 MB más recientes.');
    conRoot('#mt-l-fla','flatpak',0,'Se quitarán los componentes de Flatpak que ninguna aplicación usa.');
    c.querySelector('#mt-c-mas')?.addEventListener('click',()=>renderAlmacenamiento(c,true));

    const zona=c.querySelector('#mt-busqueda');
    const cablearBusqueda=()=>{
        zona.querySelector('#mt-buscar')?.addEventListener('click',esperarBusqueda);
        for(const clave of Object.keys(CATEGORIAS))
            zona.querySelector(`#mt-cat-${clave}`)?.addEventListener('click',()=>{window.pushSubNav?.(repintar);renderLista(c,clave);});
    };
    const esperarBusqueda=async()=>{
        const p=buscar();
        zona.innerHTML=htmlBusqueda();
        await p;
        if(!sigue()||!zona.isConnected)return;
        zona.innerHTML=htmlBusqueda();
        cablearBusqueda();
    };
    if(_busqueda.promesa)esperarBusqueda();
    else cablearBusqueda();
}
function renderLista(c,clave){
    const cat=CATEGORIAS[clave];
    const filas=_busqueda.datos[clave];
    const cabecera=renderHeader(cat.titulo);
    if(!filas.length){
        c.innerHTML=cabecera+renderEmptyState('','No hay nada aquí','Ya está todo limpio en esta categoría.');
        return;
    }
    const nombre=ruta=>{
        const partes=ruta.split('/');
        return clave==='proyectos'?partes.slice(-2).join('/'):partes.at(-1);
    };
    const carpeta=ruta=>ruta.split('/').slice(0,clave==='proyectos'?-2:-1).join('/').replace(/^\/home\/[^/]+/,'~');
    c.innerHTML=cabecera+`<p class="mt-ayuda">${_tr(cat.ayuda)}</p>`
        +renderCard(filas.map((f,i)=>`<label class="detail-item detail-item-row mt-selec">
            <input type="checkbox" data-i="${i}">
            <div class="detail-texts"><span class="dt mt-corta">${esc(nombre(f.ruta))}</span><span class="ds mt-corta" title="${esc(f.ruta)}">${esc(carpeta(f.ruta))}</span></div>
            <span class="mt-tam">${bytes(f.bytes)}</span>
        </label>`))
        +`<div class="mt-pie"><span id="mt-total" aria-live="polite"></span><button type="button" class="mt-cta" id="mt-actuar" disabled></button></div>`;
    const casillas=[...c.querySelectorAll('.mt-selec input')];
    const elegidas=()=>casillas.filter(x=>x.checked).map(x=>filas[Number(x.dataset.i)]);
    const boton=c.querySelector('#mt-actuar'),total=c.querySelector('#mt-total');
    const pintar=()=>{
        const e=elegidas();
        total.textContent=e.length?`${e.length} · ${bytes(sumar(e))}`:_tr('Elige qué quitar');
        boton.textContent=_tr(cat.accion);
        boton.disabled=!e.length;
    };
    casillas.forEach(x=>x.addEventListener('change',pintar));
    pintar();
    boton.addEventListener('click',async()=>{
        const e=elegidas(),rutas=e.map(f=>f.ruta);
        if(cat.borra&&!await confirmar('¿Borrar estas compilaciones?',`${e.length} · ${bytes(sumar(e))}. ${_tr(cat.ayuda)}`,'Borrar'))return;
        boton.disabled=true;boton.textContent=_tr('Limpiando…');
        const hechas=[];let liberados=0,fallos=0;
        if(cat.borra){
            for(const f of e){
                try{
                    const x=await llamar('limpiar',{objetivo:'proyecto',ruta:f.ruta});
                    liberados+=x.liberados;fallos+=x.fallos;
                    if(!x.fallos)hechas.push(f.ruta);
                }catch(err){fallos++;}
            }
            avisarResultado(liberados,fallos);
        }else{
            try{
                const x=await llamar('papelera',rutas);
                hechas.push(...x.movidos);fallos=x.fallos;
                toast(fallos?`${_tr('Movidos a la papelera')}: ${hechas.length}. ${_tr('Con error')}: ${fallos}`:`${_tr('Movidos a la papelera')}: ${hechas.length}`,fallos?'⚠️':'🧹');
            }catch(err){toast('No se pudieron mover a la papelera','❌');}
        }
        quitarDeBusqueda(hechas);
        renderLista(c,clave);
    });
}

// ── Memoria ──────────────────────────────────────────────────────────────
function renderMemoria(c,r){
    const m=r.memoria,usada=m.total-m.disponible,pct=porcentaje(usada,m.total);
    const swapUsada=m.swap_total-m.swap_libre,maximo=r.apps[0]?.bytes||1;
    c.innerHTML=renderHeader('Memoria')+`<div class="mt-grande">
            <div class="mt-grande-fila"><span class="mt-grande-num">${pct} %</span><span class="mt-grande-et">${_tr('usado')}</span><span class="mt-grande-det">${bytes(usada)} / ${bytes(m.total)}</span></div>
            ${barra(pct)}
            <p class="ds">${_tr('Usar la memoria no es malo: el sistema la reparte solo y no hace falta vaciarla. Cierra una app solo si no la necesitas.')}</p>
        </div>`
        +(m.swap_total?renderCard([renderRowItem('Memoria de intercambio','',`<span class="mt-tam">${bytes(swapUsada)} / ${bytes(m.swap_total)}</span>`)]):'')
        +renderSection('Apps abiertas')
        +(r.apps.length?renderCard(r.apps.map(a=>`<div class="detail-item mt-carpeta"><div class="mt-carpeta-fila"><span class="dt">${esc(a.nombre)}</span><span class="mt-tam">${bytes(a.bytes)}</span></div>${barra(porcentaje(a.bytes,maximo))}</div>`))
            :renderEmptyState('','No hay datos de apps','Solo se miden las abiertas desde el escritorio.'))
        +`<div id="mt-monitor"></div>`;
    tauriInvoke('which_app',{app:'bookos-system-monitor'}).then(raw=>{
        const hueco=c.querySelector('#mt-monitor');
        if(!hueco||!JSON.parse(raw).found)return;
        hueco.innerHTML=renderCard([renderNavRow('Monitor del sistema','Procesos, CPU y temperatura',{id:'mt-abrir-monitor'})]);
        hueco.querySelector('#mt-abrir-monitor').addEventListener('click',()=>tauriInvoke('launch_app',{app:'bookos-system-monitor'}));
    }).catch(()=>{});
}

// ── Batería ──────────────────────────────────────────────────────────────
// Lectura del estado desde sysfs. Cambiar el límite de carga o el perfil vive
// en la página Batería de ajustes; aquí solo se mira y se enlaza.
function renderBateriaDetalle(c,bat){
    const pct=Number(bat.percentage),lleno=Number(bat.energy_full),diseno=Number(bat.energy_full_design);
    const ahora=Number(bat.energy),ritmo=Number(bat.energy_rate);
    const horas=ritmo>0?(bat.state==='charging'?lleno-ahora:bat.state==='discharging'?ahora:0)/ritmo:0;
    const hm=h=>`${Math.floor(h)} h ${Math.round((h-Math.floor(h))*60)} min`;
    const estado={charging:'Cargando','fully-charged':'Cargada',discharging:'Con batería'}[bat.state];
    const salud=lleno>0&&diseno>0?Math.min(100,Math.round(lleno/diseno*100)):0;
    const fila=(t,v,color)=>renderRowItem(t,'',`<span class="mt-tam"${color?` style="color:${color}"`:''}>${esc(v)}</span>`);
    c.innerHTML=renderHeader('Batería')+`<div class="mt-grande">
            <div class="mt-grande-fila"><span class="mt-grande-num">${pct} %</span><span class="mt-grande-et">${_tr(estado)}</span>${horas>0?`<span class="mt-grande-det">${hm(horas)} ${_tr(bat.state==='charging'?'para completar':'restantes')}</span>`:''}</div>
            ${barra(pct,pct<=15&&bat.state==='discharging'?'critico':'')}
            ${bat.state==='discharging'&&ritmo>0&&lleno>0?`<p class="ds">${_tr('Una carga completa dura aproximadamente')} ${hm(lleno/ritmo)}</p>`:''}
        </div>`
        +renderSection('Información de la batería')+renderCard([
            ...(salud?[fila('Salud de la batería',`${salud} %`,salud>=80?'var(--green)':salud>=60?'var(--orange)':'var(--red)')]:[]),
            ...(lleno>0?[fila('Capacidad',`${lleno.toFixed(0)} Wh`)]:[]),
            ...(diseno>0?[fila('Capacidad de diseño',`${diseno.toFixed(0)} Wh`)]:[]),
            ...(ritmo>0?[fila('Consumo actual',`${ritmo.toFixed(1)} W`)]:[]),
            ...(bat.cycle_count&&bat.cycle_count!=='0'?[fila('Ciclos de carga',bat.cycle_count)]:[]),
        ])
        +renderCard([
            renderNavRow('Protección de la batería','Límite de carga para alargar su vida útil',{id:'mt-bat-aj'}),
            renderNavRow('Perfil energético','Ahorro, equilibrado o rendimiento',{id:'mt-bat-perfil'}),
            renderNavRow('Opciones avanzadas','Gráfico de nivel, tapa y suspensión',{id:'mt-bat-av'}),
        ]);
    for(const id of ['#mt-bat-aj','#mt-bat-perfil','#mt-bat-av'])c.querySelector(id).addEventListener('click',()=>window.openPage('bateria'));
}

// ── Diagnóstico ──────────────────────────────────────────────────────────
function renderDiagnostico(c,r){
    const d=r.diagnostico,lista=[...d.servicios_caidos,...d.servicios_usuario_caidos];
    const trim=d.ultimo_trim?new Intl.DateTimeFormat(getLang(),{dateStyle:'long'}).format(new Date(d.ultimo_trim*1000)):_tr('Sin datos');
    const ok=`<span class="mt-ok">${ico('check',{size:15})}${_tr('Todo correcto')}</span>`;
    const aviso=txt=>`<span class="mt-mal">${ico('triangle-alert',{size:15})}<span class="mt-tam">${esc(txt)}</span></span>`;
    const nivel=nivelDisco(r.disco),m=r.memoria,usada=porcentaje(m.total-m.disponible,m.total);
    const swapUsada=m.swap_total-m.swap_libre;
    c.innerHTML=renderHeader('Diagnóstico')
        +renderSection('Servicios')+renderCard(lista.length
            ?lista.map(s=>renderRowItem(esc(s),'No ha arrancado bien',`<span class="mt-mal">${ico('triangle-alert',{size:15})}</span>`))
            :[renderRowItem('Servicios del sistema','',ok),renderRowItem('Servicios de usuario','',ok)])
        +renderSection('Disco')+renderCard([
            renderRowItem('Espacio libre','',nivel==='bien'?`<span class="mt-ok">${ico('check',{size:15})}${bytes(r.disco.libre)}</span>`:aviso(bytes(r.disco.libre))),
            renderRowItem('Último mantenimiento del SSD (TRIM)','',`<span class="mt-tam">${esc(trim)}</span>`),
        ])
        +renderSection('Memoria')+renderCard([
            renderRowItem('Memoria disponible','',usada<90?`<span class="mt-ok">${ico('check',{size:15})}${bytes(m.disponible)}</span>`:aviso(bytes(m.disponible))),
            ...(m.swap_total?[renderRowItem('Memoria de intercambio','',`<span class="mt-tam">${bytes(swapUsada)} / ${bytes(m.swap_total)}</span>`)]:[]),
        ]);
}
