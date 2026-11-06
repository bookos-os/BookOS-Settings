// Asistente de voz: nombre, registro de tu voz y escucha.
// La página no decide nada: el asistente es el dueño del perfil y del registro
// (`org.bookos.Assistant`), y aquí se pinta el estado que devuelve. Por eso la
// fase del registro y el interruptor vienen siempre de su respuesta.
import{tauriInvoke}from'../../tauri-api.js';
import{esc,toast,addInterval,renderSkeleton,renderCard,renderSection,renderHeader,renderNavRow,renderToggle,setupToggle,chevron,_tr}from'./_common.js';
import{ico}from'./iconos.js';

const TITULO='Asistente de voz';
const POR_DEFECTO='Zenith';

const conNombre=(texto,nombre)=>_tr(texto).replaceAll('{n}',esc(nombre));
const llamadas=nombre=>`<span class="as-llamada">«Oye ${esc(nombre)}»</span><span class="as-llamada">«Okey ${esc(nombre)}»</span>`;

function panelVacio(icono,titulo,cuerpo,boton=''){
    return `<div class="detail-card as-panel">
        <div class="sudo-icon-wrap">${ico(icono,{size:26})}</div>
        <h3 class="as-titulo">${_tr(titulo)}</h3>
        <p class="as-cuerpo">${_tr(cuerpo)}</p>
        ${boton?`<div class="as-botones">${boton}</div>`:''}
    </div>`;
}

const PRIVACIDAD='Tu perfil de voz se guarda en este equipo. Las grabaciones se borran después de crear el perfil.';

function vistaNombre(nombre,error){
    return renderHeader(TITULO)+`<form class="detail-card as-panel" id="as-form-nombre" novalidate>
        <div class="sudo-icon-wrap">${ico('mic',{size:26})}</div>
        <h3 class="as-titulo">${_tr('¿Cómo quieres llamarme?')}</h3>
        <p class="as-cuerpo">${_tr('Elige el nombre que usarás para despertarme. Después te pediré que digas tu llamada tres veces para reconocer tu voz.')}</p>
        <div class="as-campo">
            <label class="ds" for="as-nombre">${_tr('Nombre del asistente')}</label>
            <input type="text" id="as-nombre" class="upd-auth-input" maxlength="24" autocomplete="off" spellcheck="false" value="${esc(nombre)}"${error?' aria-invalid="true" aria-describedby="as-error"':''}>
        </div>
        <div class="as-vista-previa" aria-live="polite" aria-label="${esc(_tr('Podrás decir'))}"><span class="ds">${_tr('Podrás decir')}</span><span class="as-llamadas" id="as-llamadas">${llamadas(nombre.trim()||POR_DEFECTO)}</span></div>
        <p class="as-aviso" id="as-error" role="alert"${error?'':' hidden'}>${esc(_tr(error||''))}</p>
        <div class="as-botones"><button type="submit" class="btn btn-primary as-foco">${_tr('Continuar')}</button></div>
    </form>`;
}

function vistaPerfil(e,aviso){
    const{nombre,perfil,escucha}=e;
    const icono=perfil?'check':'mic-off';
    const estadoVoz=e.error_perfil?'Tu perfil de voz no se puede usar':perfil?'Perfil de voz registrado':'Voz sin registrar';
    const claseVoz=e.error_perfil?'mal':perfil?'bien':'';
    const textoEscucha={
        apagada:perfil?'Di «Oye {n}» u «Okey {n}» seguido de tu petición.':'Registra tu voz para poder activarla.',
        preparando:'Cargando tu perfil de voz…',
        activa:'Escuchando. Di «Oye {n}» u «Okey {n}» seguido de tu petición.',
        pausada:'En pausa mientras hablas conmigo.',
        silenciada:'En pausa: el micrófono está silenciado.',
        error:'No se ha podido activar.',
    }[escucha];
    const filaMicro=escucha==='silenciada'?
        `<div class="detail-item detail-item-row as-fila-aviso"><div class="detail-texts"><span class="dt">${_tr('El micrófono está silenciado')}</span><span class="ds">${_tr('No puedo oírte hasta que lo actives.')}</span></div><button type="button" class="btn btn-secondary btn-sm" id="as-activar-micro">${_tr('Activar')}</button></div>`:'';
    const filaError=escucha==='error'&&e.error_escucha?
        `<div class="detail-item as-fila-aviso" role="alert"><span class="dt as-mal">${_tr('La escucha se ha detenido')}</span><span class="ds">${esc(_tr(e.error_escucha))}</span></div>`:'';
    return renderHeader(TITULO)
        +`<div class="detail-card">
            <div class="as-perfil">
                <div class="as-perfil-icono ${claseVoz}">${ico(icono,{size:22})}</div>
                <div class="detail-texts"><span class="as-perfil-nombre">${esc(nombre)}</span><span class="as-perfil-estado ${claseVoz}">${_tr(estadoVoz)}</span></div>
            </div>
            <div class="detail-item detail-item-row">
                <div class="detail-texts"><span class="dt">${_tr('Activar por voz')}</span><span class="ds" data-custom="1">${conNombre(textoEscucha,nombre)}</span></div>
                ${renderToggle('as-escucha',e.activacion).replace('<button ',`<button ${perfil&&!e.error_perfil?'':'disabled '}aria-label="${esc(_tr('Activar por voz'))}" `)}
            </div>
            ${filaMicro}${filaError}
        </div>`
        +(aviso?`<p class="as-aviso as-aviso-suelto" role="alert">${esc(_tr(aviso))}</p>`:'')
        +(e.error_perfil?`<p class="as-aviso as-aviso-suelto" role="alert">${esc(_tr(e.error_perfil))}</p>`:'')
        +renderSection('Perfil')
        +renderCard([
            renderNavRow('Nombre','',{id:'as-cambiar-nombre',right:`<span class="as-valor">${esc(nombre)}</span>${chevron()}`}),
            renderNavRow(perfil?'Volver a registrar mi voz':'Registrar mi voz',perfil?'Tu perfil actual se conserva hasta que guardes el nuevo.':'Dirás tu llamada tres veces. Tardarás menos de un minuto.',{id:'as-registrar'}),
        ])
        +`<p class="ds as-nota">${_tr(PRIVACIDAD)} ${_tr('La escucha no distingue una grabación de tu voz de tu voz en directo.')} ${_tr('Puedes hablarme también con el atajo Meta+Alt+A, sin activar la escucha.')}</p>`;
}

function vistaRegistro(e,aviso){
    const r=e.registro;
    const hechas=r.tomas.filter(Boolean).length;
    const silenciado=e.microfono_silenciado&&(r.fase==='lista');
    const error=aviso||r.error;
    const barra=`<div class="as-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${hechas}" aria-label="${esc(_tr('Tomas registradas'))}">${r.tomas.map((hecha,i)=>`<i class="${hecha?'hecha':(i===r.toma&&r.fase!=='revision'?'actual':'')}"></i>`).join('')}</div>`;
    const avisoHtml=error?`<p class="as-aviso" role="alert">${esc(_tr(error))}${r.oido?` <span class="as-oido">${_tr('He entendido:')} «${esc(r.oido)}»</span>`:''}</p>`:'';
    let cuerpo,botones;
    const cancelar=(texto='Cancelar')=>`<button type="button" class="btn btn-secondary" data-as="asistente_registro_cancelar" id="as-cancelar">${_tr(texto)}</button>`;
    switch(r.fase){
        case'preparar':
            cuerpo=`<div class="sudo-icon-wrap">${ico('mic',{size:26})}</div>
                <h3 class="as-titulo">${_tr('Reconocer tu voz')}</h3>
                <p class="as-cuerpo">${_tr('Necesito un modelo local de 41 MB para distinguir tu voz. Solo hace falta Internet esta vez; después funciona sin conexión.')}</p>${avisoHtml}`;
            botones=cancelar()+`<button type="button" class="btn btn-primary as-foco" data-as="asistente_registro_preparar" id="as-preparar">${_tr(r.error?'Reintentar':'Descargar modelo')}</button>`;
            break;
        case'preparando':
            cuerpo=`<div class="as-cargando" role="status"><div class="spinner" aria-hidden="true"></div><span class="dt">${_tr('Preparando el reconocimiento de tu voz…')}</span></div>`;
            botones=cancelar();
            break;
        case'revision':
            cuerpo=`${barra}<div class="sudo-icon-wrap as-ok">${ico('check',{size:26})}</div>
                <h3 class="as-titulo">${_tr('Tu voz coincide en las tres tomas')}</h3>
                <p class="as-cuerpo">${_tr('Guarda el perfil o repite la toma que quieras.')}</p>${avisoHtml}`;
            botones=cancelar()+`<button type="button" class="btn btn-primary as-foco" data-as="asistente_registro_guardar" id="as-guardar">${_tr('Guardar perfil')}</button>`;
            break;
        default:{
            const grabando=r.fase==='grabando',comprobando=r.fase==='comprobando';
            const estado=grabando
                ?`<p class="as-estado" role="status"><i class="as-punto" aria-hidden="true"></i>${_tr('Te escucho. Dila como cuando me llames; pararé solo cuando acabes.')}</p>`
                :comprobando
                ?`<div class="as-cargando" role="status"><div class="spinner" aria-hidden="true"></div><span class="dt">${_tr('Comprobando la grabación…')}</span></div>`
                :silenciado
                ?''
                :`<p class="as-estado" role="status">${_tr('Busca un lugar tranquilo, pulsa grabar y dila con tu voz habitual.')}</p>`;
            cuerpo=`${barra}<span class="as-eyebrow">${_tr('Toma')} ${r.toma+1} ${_tr('de')} 3</span>
                <p class="as-frase" lang="es">«${esc(r.frases[r.toma])}»</p>
                <div class="as-nivel"${grabando?'':' hidden'}><i id="as-nivel" style="transform:scaleX(${r.nivel})"></i></div>
                ${estado}
                ${silenciado?`<p class="as-aviso" role="alert">${_tr('El micrófono está silenciado. Actívalo para registrar tu voz.')}</p>`:''}
                ${silenciado?'':avisoHtml}`;
            botones=grabando
                ?`<button type="button" class="btn btn-secondary" data-as="asistente_registro_cancelar_toma" id="as-descartar">${_tr('Descartar toma')}</button><button type="button" class="btn btn-primary as-foco" data-as="asistente_registro_terminar_toma" id="as-terminar">${_tr('He terminado')}</button>`
                :comprobando
                ?`<button type="button" class="btn btn-secondary as-foco" data-as="asistente_registro_cancelar_toma" id="as-descartar">${_tr('Descartar toma')}</button>`
                :silenciado
                ?cancelar('Cancelar registro')+`<button type="button" class="btn btn-primary as-foco" id="as-activar-micro">${_tr('Activar micrófono')}</button>`
                :cancelar('Cancelar registro')+`<button type="button" class="btn btn-primary as-foco" data-as="asistente_registro_grabar" id="as-grabar">${ico('mic',{size:14})} ${_tr(r.error?'Volver a grabar':'Grabar')}</button>`;
        }
    }
    const verTomas=r.fase!=='preparar'&&r.fase!=='preparando';
    // Solo se puede repetir con el micrófono cerrado: cambiar de toma a mitad
    // de una grabación dejaría una comprobación contestando a la toma anterior.
    const repetible=r.fase==='lista'||r.fase==='revision';
    const filas=r.tomas.map((hecha,i)=>{
        const actual=i===r.toma&&r.fase!=='revision';
        return`<div class="detail-item detail-item-row as-toma${actual?' actual':''}">
            <div class="as-toma-marca ${hecha?'hecha':''}" aria-hidden="true">${hecha?ico('check',{size:14,sw:2.6}):i+1}</div>
            <div class="detail-texts"><span class="dt">${_tr('Toma')} ${i+1}</span><span class="ds as-resumen" lang="es">${esc(r.frases[i])}</span></div>
            ${hecha&&repetible?`<button type="button" class="btn btn-secondary btn-sm" data-as-repetir="${i}" id="as-repetir-${i}" aria-label="${esc(_tr('Repetir la toma'))} ${i+1}">${_tr('Repetir')}</button>`
              :`<span class="as-toma-estado">${_tr(hecha?'Registrada':actual&&r.fase==='grabando'?'Grabando':actual&&r.fase==='comprobando'?'Comprobando':actual?'Siguiente':'Pendiente')}</span>`}
        </div>`;
    }).join('');
    return renderHeader(TITULO)
        +`<div class="detail-card as-panel as-registro">${cuerpo}<div class="as-botones">${botones}</div></div>`
        +(verTomas?renderSection('Tus tres tomas')+`<div class="detail-card">${filas}</div>`:'')
        +`<p class="ds as-nota">${_tr(PRIVACIDAD)}</p>`;
}

// Mismo patrón que los demás diálogos con campo de texto, más la vista previa.
function dialogoNombre(actual,guardar){
    // Por id: la fila que abrió el diálogo se repinta al guardar el nombre.
    const previo=document.activeElement?.id;
    const ov=document.createElement('div');
    ov.className='bk-overlay';
    ov.innerHTML=`<div class="bk-dialog" role="dialog" aria-modal="true" aria-labelledby="as-dlg-t">
        <div class="bk-dialog-title" id="as-dlg-t">${_tr('¿Cómo quieres llamarme?')}</div>
        <input type="text" class="upd-auth-input as-dlg-input" maxlength="24" autocomplete="off" spellcheck="false" aria-label="${esc(_tr('Nombre del asistente'))}" value="${esc(actual)}">
        <div class="as-vista-previa" aria-live="polite"><span class="as-llamadas">${llamadas(actual)}</span></div>
        <p class="as-aviso" role="alert" hidden></p>
        <p class="bk-dialog-msg">${_tr('Conservo tu voz registrada. Si no te entiendo bien con este nombre, vuelve a registrar tu voz.')}</p>
        <div class="bk-dialog-btns"><button class="bk-dbtn cancel" type="button">${_tr('Cancelar')}</button><button class="bk-dbtn confirm" type="button">${_tr('Guardar')}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const entrada=ov.querySelector('input'),error=ov.querySelector('.as-aviso');
    const cerrar=()=>{ov.remove();document.removeEventListener('keydown',tecla,true);document.getElementById(previo)?.focus();};
    const aceptar=async()=>{
        const motivo=await guardar(entrada.value);
        if(motivo){error.textContent=_tr(motivo);error.hidden=false;entrada.focus();}
        else cerrar();
    };
    function tecla(e){
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cerrar();}
        else if(e.key==='Enter'&&document.activeElement===entrada){e.preventDefault();aceptar();}
        else if(e.key==='Tab'){
            const f=[entrada,...ov.querySelectorAll('button')];
            const i=f.indexOf(document.activeElement);
            if(e.shiftKey&&i===0){e.preventDefault();f[f.length-1].focus();}
            else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();}
        }
    }
    document.addEventListener('keydown',tecla,true);
    entrada.addEventListener('input',()=>{
        ov.querySelector('.as-llamadas').innerHTML=llamadas(entrada.value.trim()||actual);
        error.hidden=true;
    });
    ov.querySelector('.cancel').onclick=cerrar;
    ov.querySelector('.confirm').onclick=aceptar;
    ov.addEventListener('click',e=>{if(e.target===ov)cerrar();});
    (window._pageCleanups||=[]).push(cerrar);
    entrada.focus();entrada.select();
}

export async function renderAsistente(c){
    c.innerHTML=renderHeader(TITULO)+renderSkeleton(3);
    const epoca=window.navEpoch();
    let estado=null,aviso='',firma='',faseAnterior,nombreInicial=null,errorNombre='';

    const pintar=()=>{
        // El nivel llega diez veces por segundo: no vale repintar la página por
        // él, se perdería el foco y el lector de pantalla repetiría el estado.
        const copia=estado.registro?{...estado,registro:{...estado.registro,nivel:0}}:estado;
        const nueva=JSON.stringify(copia)+aviso+errorNombre;
        if(nueva===firma){
            const nivel=c.querySelector('#as-nivel');
            if(nivel)nivel.style.transform=`scaleX(${estado.registro?.nivel||0})`;
            return;
        }
        firma=nueva;
        const activo=document.activeElement;
        const conFoco=activo?.id?`#${activo.id}`:activo?.dataset?.toggle?`[data-toggle="${activo.dataset.toggle}"]`:'';
        const enElBody=activo===document.body;
        const enLaPagina=activo?.closest?.('.as-panel,.detail-card');
        if(estado.registro)c.innerHTML=vistaRegistro(estado,aviso);
        else if(estado.primera_vez)c.innerHTML=vistaNombre(nombreInicial??estado.nombre,errorNombre);
        else c.innerHTML=vistaPerfil(estado,aviso);
        conectar();
        // Sin esto, cada cambio de fase dejaba el foco en el body y el teclado
        // tenía que recorrer otra vez la cabecera para llegar a «Grabar».
        const mismo=conFoco&&c.querySelector(conFoco);
        const fase=estado.registro?.fase;
        if(mismo)mismo.focus();
        else if(enLaPagina||(enElBody&&fase!==faseAnterior))c.querySelector('.as-foco,#as-registrar')?.focus();
        faseAnterior=fase;
    };

    const aplicar=texto=>{
        const nuevo=JSON.parse(texto);
        if(nuevo.ok===false){aviso=nuevo.error;firma='';pintar();return false;}
        estado=nuevo;
        pintar();
        return true;
    };

    const pedir=async(comando,argumentos={})=>{
        aviso='';
        try{return aplicar(await tauriInvoke(comando,argumentos));}
        catch(e){sinServicio(e);return false;}
    };

    const sinServicio=e=>{
        firma='';
        const noInstalado=String(e)==='no-instalado';
        c.innerHTML=renderHeader(TITULO)+(noInstalado
            ?panelVacio('mic-off','El asistente no está instalado','Instálalo con bookos-ai/assistant/install.sh y vuelve a abrir esta página.',`<button type="button" class="btn btn-primary" id="as-reintentar">${_tr('Reintentar')}</button>`)
            :panelVacio('triangle-alert','El asistente no responde','Comprueba que bookos-assistant.service esté en marcha y vuelve a intentarlo.',`<button type="button" class="btn btn-primary" id="as-reintentar">${_tr('Reintentar')}</button>`));
        c.querySelector('#as-reintentar')?.addEventListener('click',refrescar);
        if(!noInstalado)console.error('[asistente]',e);
    };

    const refrescar=async()=>{
        try{aplicar(await tauriInvoke('get_asistente_estado'));}
        catch(e){sinServicio(e);}
    };

    function conectar(){
        const formulario=c.querySelector('#as-form-nombre');
        if(formulario){
            const entrada=c.querySelector('#as-nombre');
            entrada.addEventListener('input',()=>{
                nombreInicial=entrada.value;
                c.querySelector('#as-llamadas').innerHTML=llamadas(entrada.value.trim()||POR_DEFECTO);
            });
            formulario.addEventListener('submit',async e=>{
                e.preventDefault();
                nombreInicial=entrada.value;
                let respuesta;
                try{
                    // Vacío vale como aceptar la propuesta que muestra la vista previa.
                    respuesta=JSON.parse(await tauriInvoke('asistente_registro_empezar',{nombre:entrada.value.trim()||POR_DEFECTO}));
                }catch(er){sinServicio(er);return;}
                errorNombre=respuesta.ok===false?respuesta.error:'';
                if(errorNombre){pintar();c.querySelector('#as-nombre')?.focus();return;}
                estado=respuesta;pintar();
            });
            if(document.activeElement===document.body){entrada.focus();entrada.select();}
        }
        c.querySelectorAll('[data-as]').forEach(b=>b.addEventListener('click',async()=>{
            const guardar=b.id==='as-guardar';
            if(await pedir(b.dataset.as)&&guardar){
                toast('Perfil de voz registrado');
                c.querySelector('[data-toggle="as-escucha"]')?.focus();
            }
        }));
        c.querySelectorAll('[data-as-repetir]').forEach(b=>b.addEventListener('click',()=>pedir('asistente_registro_repetir',{toma:Number(b.dataset.asRepetir)})));
        c.querySelector('#as-activar-micro')?.addEventListener('click',()=>pedir('asistente_activar_microfono'));
        c.querySelector('#as-registrar')?.addEventListener('click',()=>pedir('asistente_registro_empezar',{nombre:estado.nombre}));
        c.querySelector('#as-cambiar-nombre')?.addEventListener('click',()=>dialogoNombre(estado.nombre,async nombre=>{
            try{
                const r=JSON.parse(await tauriInvoke('asistente_nombre',{nombre}));
                if(r.ok===false)return r.error;
                estado=r;pintar();toast('Nombre actualizado');
                return'';
            }catch(e){return String(e);}
        }));
        if(c.querySelector('[data-toggle="as-escucha"]'))setupToggle('as-escucha',async activar=>{
            aviso='';
            const r=JSON.parse(await tauriInvoke('asistente_escucha',{activar}));
            if(r.ok===false)throw r.error;
            estado=r;pintar();
        });
    }

    try{
        const inicial=await tauriInvoke('get_asistente_estado');
        if(window.isStale(epoca))return;
        aplicar(inicial);
    }catch(e){
        if(!window.isStale(epoca))sinServicio(e);
        return;
    }
    const dejar=await window.__TAURI__.event.listen('asistente-estado',ev=>{
        if(!window.isStale(epoca))aplicar(ev.payload);
    });
    if(window.isStale(epoca)){dejar();return;}
    // Salir de la página con el micrófono abierto no puede dejarlo abierto.
    (window._pageCleanups||=[]).push(()=>{
        dejar();
        if(estado?.registro)tauriInvoke('asistente_registro_cancelar').catch(()=>{});
    });
    // Silenciar el micrófono desde el panel no avisa a nadie: se ve al preguntar.
    addInterval(refrescar,3000);
}
