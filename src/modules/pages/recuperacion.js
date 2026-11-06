// Recuperación: puntos de restauración del sistema con snapper. El trabajo de
// verdad, y por qué no usa `snapper rollback`, está en bookos-restaurar
// (bookos-desktop/session), que comparte con la pantalla de recuperación.
import {tauriInvoke,esc,toast,showDialog,getSetting,setSetting,renderHeader,renderSection,renderCard,renderSkeleton,_tr} from './_common.js';
import {ico} from './iconos.js';
import {getLang} from '../i18n.js';

const contrasena=descripcion=>window.promptAuth?.({title:'Se necesita tu contraseña',description:descripcion,confirmLabel:'Continuar'}).then(a=>a?.password||null);
const pedir=(titulo,mensaje,texto)=>new Promise(res=>showDialog(_tr(titulo),mensaje,{confirmText:_tr(texto),confirmClass:'danger',cancelText:_tr('Cancelar'),onConfirm:()=>res(true),onCancel:()=>res(false)}));
// `sudo` escribe su propio aviso en stderr: el motivo real es la última línea.
const motivo=r=>String(r.stderr||r.error||'').trim().split('\n').at(-1)||_tr('Error desconocido');
const fecha=d=>{
    const f=new Date(String(d).replace(' ','T'));
    return isNaN(f)?d:new Intl.DateTimeFormat(getLang(),{dateStyle:'long',timeStyle:'short'}).format(f);
};
const POLITICAS=[
    ['packages','Al actualizar paquetes','Antes de cada actualización. Es lo más seguro'],
    ['osupdate','Al actualizar el sistema','Solo antes de subir de versión de BookOS'],
    ['never','Nunca','Solo los puntos que crees tú'],
];

export async function renderSnapshots(c){
    const epoca=window._navEpoch;
    const cabecera=renderHeader('Recuperación');
    c.innerHTML=cabecera+renderSkeleton(4);
    const [so,lista,politica]=await Promise.all([
        tauriInvoke('get_snapshot_support').then(JSON.parse).catch(()=>({supported:false,fs:'',snapper:false,restaurable:false})),
        tauriInvoke('list_bookos_snapshots').then(JSON.parse).catch(()=>({ok:false,error:'error',snapshots:[]})),
        getSetting('SnapshotPolicy','osupdate'),
    ]);
    if(window._navEpoch!==epoca)return;
    const puntos=[...lista.snapshots].reverse();
    const repintar=()=>renderSnapshots(c);

    // Un estado por cada situación real, en vez de banderas sueltas.
    const estado=so.fs!=='btrfs'?'sin-btrfs':!lista.ok?'sin-activar':puntos.length?'protegido':'vacio';
    const avisoLimpieza=lista.ok&&so.limpieza===false?`<p class="mt-ayuda">${_tr('La limpieza automática está apagada: los puntos antiguos no se borran y retienen espacio.')}</p><button type="button" class="btn btn-secondary btn-sm" id="re-activar">${_tr('Activar limpieza')}</button>`:'';
    const hero={
        'sin-btrfs':['No disponible',`${_tr('Los puntos de restauración necesitan un disco con Btrfs y este usa')} ${esc(so.fs||'—')}.`,''],
        'sin-activar':['Recuperación sin activar','Guarda el estado del sistema para poder volver atrás si una actualización sale mal.','<button type="button" class="mt-cta" id="re-activar">'+_tr('Activar')+'</button>'],
        'vacio':['Sin puntos todavía','Crea el primero ahora que todo funciona.','<button type="button" class="mt-cta" id="re-crear">'+_tr('Crear punto')+'</button>'],
        'protegido':['Protegido',puntos[0]?`${_tr('Último punto')}: ${fecha(puntos[0].date)}`:'','<button type="button" class="mt-cta" id="re-crear">'+_tr('Crear punto')+'</button>'],
    }[estado];
    c.innerHTML=cabecera+`<section class="ac-hero re-hero">
            <h3 class="mt-estado re-estado">${_tr(hero[0])}</h3>
            <p class="mt-estado-texto">${_tr(hero[1])}</p>
            ${hero[2]}
            ${avisoLimpieza}
        </section>
        ${estado==='sin-btrfs'?'':`<p class="mt-ayuda">${_tr('Restaurar devuelve el sistema, sus programas y su configuración. Tus archivos de la carpeta personal no cambian.')}</p>`}`
        +(puntos.length?renderSection('Puntos de restauración')+renderCard(puntos.map(p=>`<div class="detail-item detail-item-row">
            <div class="detail-texts"><span class="dt mt-corta">${esc(p.description||_tr('Punto de restauración'))}</span><span class="ds">${esc(fecha(p.date))}</span></div>
            <div class="mt-fila-der">
                <button type="button" class="ac-icono" data-borrar="${esc(p.number)}" aria-label="${esc(_tr('Borrar'))}" title="${esc(_tr('Borrar'))}">${ico('x',{size:15})}</button>
                <button type="button" class="btn btn-secondary btn-sm" data-restaurar="${esc(p.number)}"${so.restaurable?'':` disabled title="${esc(_tr('Este sistema no puede restaurar: revisa que el escritorio esté actualizado y use la distribución de discos de BookOS'))}"`}>${_tr('Restaurar')}</button>
            </div>
        </div>`)):'')
        +(lista.ok?renderSection('Crear puntos automáticamente')+renderCard(POLITICAS.map(([v,t,s])=>`<div class="detail-item detail-item-row nav-row" role="button" tabindex="0" data-politica="${v}" aria-pressed="${politica===v}">
            <div class="detail-texts"><span class="dt">${_tr(t)}</span><span class="ds">${_tr(s)}</span></div>
            ${politica===v?`<span class="mt-ok">${ico('check',{size:18})}</span>`:''}
        </div>`)):'');

    c.querySelector('#re-activar')?.addEventListener('click',async e=>{
        const b=e.currentTarget;
        const pwd=await contrasena('Se instalará snapper si falta y se preparará la configuración. Solo se guardarán los 10 puntos más recientes, y los anteriores se borrarán.');
        if(!pwd||!b.isConnected)return;
        b.disabled=true;b.textContent=_tr('Activando…');
        const r=JSON.parse(await tauriInvoke('recuperacion_activar',{password:pwd}));
        if(r.ok)toast('Recuperación activada');else toast(`${_tr('No se pudo activar')}: ${motivo(r)}`,'❌');
        repintar();
    });
    c.querySelector('#re-crear')?.addEventListener('click',async e=>{
        const b=e.currentTarget;
        b.disabled=true;b.textContent=_tr('Creando…');
        const r=JSON.parse(await tauriInvoke('create_snapshot',{description:_tr('Punto manual')}));
        if(r.ok)toast('Punto de restauración creado');else toast(`${_tr('No se pudo crear')}: ${motivo(r)}`,'❌');
        repintar();
    });
    c.querySelectorAll('[data-politica]').forEach(f=>f.addEventListener('click',()=>{setSetting('SnapshotPolicy',f.dataset.politica);repintar();}));
    c.querySelectorAll('[data-borrar]').forEach(b=>b.addEventListener('click',async()=>{
        if(!await pedir('¿Borrar este punto?',_tr('Ya no podrás volver a él.'),'Borrar'))return;
        const r=JSON.parse(await tauriInvoke('recuperacion_borrar',{numero:b.dataset.borrar}));
        if(!r.ok)toast(`${_tr('No se pudo borrar')}: ${motivo(r)}`,'❌');
        repintar();
    }));
    c.querySelectorAll('[data-restaurar]').forEach(b=>b.addEventListener('click',async()=>{
        const p=puntos.find(x=>x.number===b.dataset.restaurar);
        const aviso=`${esc(fecha(p.date))}.<br>${_tr('Los programas y ajustes del sistema volverán a ese momento, y se perderá lo instalado después. Antes se guarda otro punto para poder deshacerlo. Después hay que reiniciar.')}`;
        if(!await pedir('¿Restaurar el sistema?',aviso,'Restaurar'))return;
        const pwd=await contrasena('Restaurar el sistema necesita permisos de administrador.');
        if(!pwd||!b.isConnected)return;
        b.disabled=true;b.textContent=_tr('Restaurando…');
        const r=JSON.parse(await tauriInvoke('recuperacion_restaurar',{numero:p.number,password:pwd}));
        if(!r.ok){toast(`${_tr('No se pudo restaurar')}: ${motivo(r)}`,'❌');repintar();return;}
        // Hasta reiniciar sigue corriendo el sistema anterior: nada de lo que se
        // cambie ahora sobrevivirá, así que no se vuelve a ofrecer la lista.
        c.innerHTML=cabecera+`<section class="ac-hero re-hero"><h3 class="mt-estado re-estado">${_tr('Reinicia para terminar')}</h3><p class="mt-estado-texto">${_tr('El sistema está restaurado. Lo que cambies antes de reiniciar se perderá.')}</p><button type="button" class="mt-cta" id="re-reiniciar">${_tr('Reiniciar ahora')}</button></section>`;
        c.querySelector('#re-reiniciar').addEventListener('click',()=>tauriInvoke('reiniciar_equipo'));
    }));
}
