// Acerca del portátil: datos fijos de esta máquina. El uso en vivo vive en
// Mantenimiento; repetirlo aquí daría dos sitios que mirar para lo mismo.
import {tauriInvoke,getAssetUrl,esc,toast,promptSudo,renderHeader,renderSection,renderCard,renderRowItem,renderNavRow,renderSkeleton,renderError,_tr} from './_common.js';
import {ico} from './iconos.js';

// Pantalla de cada dibujo, en coordenadas de su viewBox (los trazados
// Vector_10, Vector_12 y Vector_3 de cada SVG): el fondo se coloca encima de
// ella. El 360 se mira antes porque su nombre contiene el del Book5 Pro.
const DIBUJOS=[
    {si:'Book5 Pro 360',src:'portatil-book5-pro-360.svg',w:304,h:223,x:11,y:5.4,sw:282,sh:147},
    {si:'Book5 Pro',src:'portatil-book5-pro.svg',w:264,h:223,x:10,y:5.4,sw:244,sh:147},
    {si:'',src:'portatil.svg',w:380,h:217,x:29,y:6.4,sw:322,sh:181},
];
const HOSTNAME_VALIDO=/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const SERIE_TAPADA='••••••••••';

const fila=(titulo,valor)=>renderRowItem(titulo,'',`<span class="ac-valor">${esc(valor)}</span>`);
const baldosa=(icono,etiqueta,valor)=>`<div class="ac-baldosa"><span class="mt-medidor-etiqueta">${ico(icono,{size:16})}${_tr(etiqueta)}</span><strong title="${esc(valor)}">${esc(valor)}</strong></div>`;
const pantalla=salidas=>{
    const s=salidas.find(x=>x.integrada)||salidas.find(x=>x.principal)||salidas[0];
    const m=s?.modos.find(x=>x.actual);
    return m?`${m.ancho} × ${m.alto}`:'';
};

export async function renderAcerca(c){
    const epoca=window._navEpoch;
    const cabecera=renderHeader('Acerca del portátil');
    c.innerHTML=cabecera+renderSkeleton(4);
    let i,salidas,fondo,version;
    try{
        [i,salidas,fondo,version]=await Promise.all([
            tauriInvoke('get_system_info').then(JSON.parse),
            // Sin compositor BookOS no hay censo: se queda sin esa baldosa.
            tauriInvoke('bookos_get_outputs').then(JSON.parse).catch(()=>[]),
            tauriInvoke('get_current_wallpaper').then(r=>JSON.parse(r).path||'').catch(()=>''),
            tauriInvoke('get_bookos_release',{lang:'es'}).then(r=>JSON.parse(r).installed.replace(/^BookOS\s*/,'')).catch(()=>''),
        ]);
    }catch(e){
        if(window._navEpoch===epoca)c.innerHTML=cabecera+renderError('No se pudo leer la información del equipo',{onRetry:()=>renderAcerca(c)});
        return;
    }
    if(window._navEpoch!==epoca)return;
    const d=DIBUJOS.find(x=>i.model.includes(x.si));
    const pct=(v,t)=>`${v/t*100}%`;
    const res=pantalla(salidas);
    const chips=[version?`BookOS ${version}`:'BookOS',i.distro,i.product].filter(Boolean);
    c.innerHTML=cabecera+`<section class="ac-hero">
            <div class="ac-portatil" style="aspect-ratio:${d.w}/${d.h}" aria-hidden="true">
                <img src="./assets/${d.src}" alt="">
                ${fondo?`<img class="ac-fondo" id="ac-fondo" alt="" decoding="async" hidden style="left:${pct(d.x,d.w)};top:${pct(d.y,d.h)};width:${pct(d.sw,d.w)};height:${pct(d.sh,d.h)}">`:''}
            </div>
            <div class="ac-nombre" id="ac-nombre">
                <h3 id="ac-host">${esc(i.hostname)}</h3>
                <button type="button" class="ac-icono" id="ac-editar" aria-label="${esc(_tr('Cambiar nombre'))}" title="${esc(_tr('Cambiar nombre'))}">${ico('pencil',{size:15})}</button>
            </div>
            <form class="ac-editor" id="ac-editor" hidden>
                <input id="ac-input" maxlength="63" spellcheck="false" autocomplete="off" aria-label="${esc(_tr('Nombre del equipo'))}">
                <button type="submit" class="btn btn-primary btn-sm">${_tr('Guardar')}</button>
                <button type="button" class="btn btn-secondary btn-sm" id="ac-cancelar">${_tr('Cancelar')}</button>
            </form>
            ${i.model&&i.model!=='—'?`<p class="ac-modelo">${esc(i.model)}</p>`:''}
            <div class="gen-chips">${chips.map(x=>`<span>${esc(x)}</span>`).join('')}</div>
        </section>
        <div class="ac-baldosas">
            ${baldosa('cpu','Procesador',i.cpu)}
            ${baldosa('memory-stick','Memoria',i.ram)}
            ${baldosa('hard-drive','Almacenamiento',i.disk)}
            ${res?baldosa('monitor','Pantalla',res):''}
        </div>`
        +renderSection('BookOS')+renderCard([
            ...(version?[fila('Versión',version)]:[]),
            fila('Base',i.distro),
            fila('Kernel',i.kernel),
            renderNavRow('Actualización de software','',{id:'ac-act'}),
        ])
        +renderSection('Este equipo')+renderCard([
            ...i.gpus.map(g=>fila('Gráfica',g)),
            ...(i.bios?[fila('BIOS',[i.bios,i.bios_date].filter(Boolean).join(' · '))]:[]),
            ...(i.serial?[renderRowItem('Número de serie','',`<span class="ac-serie"><span class="ac-valor" id="ac-serie">${SERIE_TAPADA}</span><button type="button" class="ac-icono" id="ac-ojo" aria-pressed="false" aria-label="${esc(_tr('Mostrar número de serie'))}">${ico('eye',{size:15})}</button></span>`)]:[]),
        ])
        +renderCard([renderRowItem('Información del sistema','Para pegarla al informar de un fallo. No incluye el número de serie.',`<button type="button" class="btn btn-secondary btn-sm" id="ac-copiar">${_tr('Copiar')}</button>`)]);

    // Si no hay miniatura se queda la pantalla del dibujo, que ya es correcta.
    if(fondo)tauriInvoke('wallpaper_preview',{path:fondo,hero:true}).then(url=>{
        const img=c.querySelector('#ac-fondo');
        if(!img)return;
        img.onload=()=>{img.hidden=false;};
        img.src=getAssetUrl(url);
    }).catch(()=>{});
    c.querySelector('#ac-act').addEventListener('click',()=>window.openPage('actualizacion'));
    const ojo=c.querySelector('#ac-ojo');
    ojo?.addEventListener('click',async()=>{
        const ver=ojo.getAttribute('aria-pressed')!=='true';
        // El serial ya está leído (el grupo wheel puede verlo); la contraseña es el
        // gesto de confirmación antes de enseñarlo, no una barrera de acceso al archivo.
        if(ver&&!await window.promptAuth?.({title:'Se necesita tu contraseña',description:'El número de serie se muestra solo a quien administra el equipo.',confirmLabel:'Mostrar'}))return;
        if(!ojo.isConnected)return;
        ojo.setAttribute('aria-pressed',String(ver));
        ojo.innerHTML=ico(ver?'eye-off':'eye',{size:15});
        c.querySelector('#ac-serie').textContent=ver?i.serial:SERIE_TAPADA;
    });
    c.querySelector('#ac-copiar').addEventListener('click',()=>{
        const texto=[
            `${i.model} (${i.product})`,chips[0],`Base: ${i.distro}`,`Kernel: ${i.kernel}`,`CPU: ${i.cpu}`,`RAM: ${i.ram}`,
            ...i.gpus.map(g=>`GPU: ${g}`),`Disco: ${i.disk}`,...(res?[`Pantalla: ${res}`]:[]),...(i.bios?[`BIOS: ${i.bios} ${i.bios_date}`.trim()]:[]),
        ].join('\n');
        navigator.clipboard.writeText(texto).then(()=>toast(_tr('Copiado'),'📋')).catch(()=>toast('No se pudo copiar','❌'));
    });

    const nombre=c.querySelector('#ac-nombre'),editor=c.querySelector('#ac-editor'),input=c.querySelector('#ac-input'),host=c.querySelector('#ac-host');
    const editar=si=>{
        nombre.hidden=si;editor.hidden=!si;
        if(si){input.value=host.textContent;input.select();input.focus();}
        else c.querySelector('#ac-editar').focus();
    };
    c.querySelector('#ac-editar').addEventListener('click',()=>editar(true));
    c.querySelector('#ac-cancelar').addEventListener('click',()=>editar(false));
    input.addEventListener('keydown',e=>{if(e.key==='Escape')editar(false);});
    editor.addEventListener('submit',async e=>{
        e.preventDefault();
        const v=input.value.trim();
        if(v===host.textContent){editar(false);return;}
        if(!HOSTNAME_VALIDO.test(v)){toast('Usa solo letras, números y guiones','❌');return;}
        if(!await promptSudo('cambiar el nombre del equipo','hostnamectl',['set-hostname',v])||!host.isConnected)return;
        host.textContent=v;
        editar(false);
        toast('Nombre del equipo actualizado');
    });
}
