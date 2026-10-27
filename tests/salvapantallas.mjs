import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../src/modules/pages/desktop.js',import.meta.url),'utf8'))
    .replace(/^import .*\n/gm,'').replace(/export /g,'');

function preparar(invoke){
    const avisos=[],imagenes=[];
    const miniaturas=['estela','rebote'].map(spMini=>({dataset:{spMini},isConnected:true,
        replaceChildren(img){this.imagen=img;}}));
    const atributos=new Map();
    const probar={addEventListener(_,fn){this.click=fn;},getAttribute:k=>atributos.get(k),
        setAttribute:(k,v)=>atributos.set(k,v),removeAttribute:k=>atributos.delete(k)};
    const c={innerHTML:'',querySelectorAll:s=>s==='[data-sp-mini]'?miniaturas:[],
        querySelector:s=>s==='#sp-probar'?probar:null};
    const contexto=vm.createContext({tauriInvoke:invoke,esc:String,_tr:String,
        renderHeader:String,renderSkeleton:()=>'',renderInfoItem:(...p)=>p.join(' '),
        renderCard:filas=>filas.join(''),renderRowItem:()=>'',renderToggle:()=>'',
        renderNavRow:()=>'',renderSection:()=>'',chevron:()=>'',setupToggle(){},
        toast:e=>avisos.push(e),
        document:{createElement(){const img={};imagenes.push(img);return img;}},
    });
    vm.runInContext(source,contexto);
    return {abrir:()=>contexto.screensaver(c),c,probar,miniaturas,imagenes,avisos};
}

test('la vista previa usa el compositor, evita llamadas dobles y muestra sus errores',async()=>{
    const llamadas=[];
    let rechazar;
    const pagina=preparar(async(command,args)=>{
        llamadas.push({command,args});
        if(command==='bookos_get_config')return JSON.stringify({salvapantallas_estilo:'rebote',salvapantallas_inactividad:300});
        if(command==='bookos_get_screensaver_preview')return '<svg xmlns="http://www.w3.org/2000/svg"/>';
        if(command==='bookos_preview_screensaver')return new Promise((_,reject)=>{rechazar=reject;});
        throw new Error(command);
    });
    await pagina.abrir();
    await new Promise(setImmediate);
    assert.equal(pagina.imagenes.length,2);
    pagina.imagenes.forEach(img=>img.onload());
    assert.ok(pagina.miniaturas.every(m=>m.imagen.src.startsWith('data:image/svg+xml;')));
    const pendiente=pagina.probar.click();
    await pagina.probar.click();
    assert.equal(llamadas.filter(l=>l.command==='bookos_preview_screensaver').length,1);
    assert.equal(llamadas.at(-1).args.estilo,'rebote');
    rechazar(new Error('escritorio bloqueado'));
    await pendiente;
    assert.match(pagina.avisos[0],/escritorio bloqueado/);
    assert.equal(pagina.probar.getAttribute('aria-busy'),undefined);
    assert.ok(!llamadas.some(l=>l.command==='bookos_apply_config'));
});

test('al navegar se descartan las miniaturas tardías y un fallo de conexión no inventa ajustes',async()=>{
    const pendientes=[];
    const pagina=preparar(async command=>{
        if(command==='bookos_get_config')return JSON.stringify({salvapantallas_estilo:'estela',salvapantallas_inactividad:0});
        return new Promise(resolve=>pendientes.push(resolve));
    });
    await pagina.abrir();
    pagina.miniaturas.forEach(m=>{m.isConnected=false;});
    pendientes.forEach(resolve=>resolve('<svg/>'));
    await new Promise(setImmediate);
    assert.equal(pagina.imagenes.length,0);
    const caida=preparar(async()=>{throw new Error('sin sesión BookOS');});
    await caida.abrir();
    assert.match(caida.c.innerHTML,/No se pudo leer la configuración de BookOS/);
    assert.match(caida.c.innerHTML,/sin sesión BookOS/);
    assert.equal(caida.probar.click,undefined);
});
