import {tauriInvoke,invalidateSystemCache} from '../tauri-api.js';
import {t} from './i18n.js';
let pairingDialog;
async function pairing(payload){
    const request=typeof payload==='string'?JSON.parse(payload):payload;
    pairingDialog?.remove();pairingDialog=null;
    if(!request)return;
    const dialog=document.createElement('dialog');pairingDialog=dialog;
    dialog.className='detail-card';dialog.style.cssText='max-width:420px;color:var(--tx);background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:24px';
    const title=document.createElement('h3');title.textContent=t('pairing_title');dialog.append(title);
    const message=document.createElement('p');
    message.textContent=request.kind==='display'?`${t('pairing_display')} ${request.value}`:request.kind==='confirm'?`${t('pairing_confirm')} ${request.value}`:t('pairing_authorize');
    dialog.append(message);
    let field;
    if(['pin','passkey'].includes(request.kind)){
        field=document.createElement('input');field.className='btn';field.placeholder=t('pairing_code');field.setAttribute('aria-label',t('pairing_code'));field.maxLength=request.kind==='passkey'?6:16;dialog.append(field);
    }
    const error=document.createElement('p');error.setAttribute('role','alert');dialog.append(error);
    const finish=async accepted=>{
        try{
            if(request.id)await tauriInvoke('system_answer_pairing',{id:request.id,accepted,value:field?.value||''});
            dialog.close();dialog.remove();if(pairingDialog===dialog)pairingDialog=null;
        }catch(e){error.textContent=String(e);}
    };
    for(const [label,accepted]of [[t('cancel'),false],[t(request.kind==='display'?'close':'confirm'),true]]){
        const button=document.createElement('button');button.className='btn';button.textContent=label;button.onclick=()=>finish(accepted);dialog.append(button);
    }
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
    document.body.append(dialog);dialog.showModal();field?.focus();
}
export async function startSystemEvents(){
    const listen=window.__TAURI__?.event?.listen;if(!listen)return;
    await listen('bookos-system-changed',({payload})=>{
        invalidateSystemCache();window.dispatchEvent(new CustomEvent('bookos-system-changed',{detail:payload}));
    });
    await listen('bookos-system-error',({payload})=>{
        invalidateSystemCache();window.dispatchEvent(new CustomEvent('bookos-system-changed',{detail:{error:payload}}));
    });
    await listen('bookos-pairing',({payload})=>{pairing(payload).catch(console.error);});
}
