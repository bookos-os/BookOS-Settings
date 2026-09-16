import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/modules/pages.js',import.meta.url),'utf8');
const start=source.indexOf('export async function renderFondos(');
const end=source.indexOf('// ── Paleta de colores ─',start);
const renderer=source.slice(start,end).replace('export ','');

test('opening the page does not scan or render previews; picker loads once in batches',async()=>{
    const calls=[];
    let previewLoaders=0;
    const button={addEventListener(type,fn){this.click=fn;}};
    const more={};
    const cards={html:'',insertAdjacentHTML(position,html){this.html+=html;}};
    const host={innerHTML:''};
    const panel={isConnected:true,parentElement:{},style:{display:'none'},innerHTML:'',
        addEventListener(type,fn){(this.handlers ||= []).push(fn);},scrollIntoView(){},
        querySelector:selector=>selector==='.wallpaper-grid'?cards:more};
    const container={innerHTML:'',querySelector:selector=>({'#wp-grid':panel,'#btn-change-wp':button,'#wp-preview-host':host}[selector])};
    const context=vm.createContext({
        window:{_navEpoch:1},document:{documentElement:{classList:{contains:()=>false}},
            getElementById:()=>null,createElement:()=>({setAttribute(){},addEventListener(){},remove(){}}),body:{appendChild(){}}},
        MutationObserver:class{observe(){}disconnect(){}},
        tauriInvoke:async command=>{
            calls.push(command);
            if(command==='get_current_wallpaper')return JSON.stringify({path:'/0.jpg'});
            if(command==='get_current_theme')return JSON.stringify({is_dark:false});
            if(command==='get_wallpapers')return JSON.stringify(Array.from({length:60},(_,i)=>({path:`/${i}.jpg`,name:`Wallpaper ${i}`})));
            throw new Error(command);
        },getSetting:async()=>false,t:s=>s,_tr:s=>s,esc:s=>s,
        renderHeader:()=>'',renderSkeleton:()=>'',renderRowItem:()=>'',renderToggle:()=>'',renderLoading:()=>'',
        renderError:()=>{throw new Error('unexpected error');},
        setupDynamicColor(){},getAssetUrl:s=>s,SVGI:{plus:'+'},
        setupWallpaperPreviews(){previewLoaders++;return Object.assign(()=>{},{observe(){}});},
    });
    vm.runInContext(renderer,context);
    await context.renderFondos(container);
    assert.ok(!calls.includes('get_wallpapers'));
    assert.equal(previewLoaders,0);
    assert.ok(!container.innerHTML.includes('<img'));
    assert.equal(cards.html,'');
    await button.click();
    assert.equal(calls.filter(c=>c==='get_wallpapers').length,1);
    assert.equal(previewLoaders,1);
    assert.equal((cards.html.match(/data-path=/g)||[]).length,24);
    assert.ok(host.innerHTML.includes('wp-screen-img'));
    await button.click();
    assert.equal(calls.filter(c=>c==='get_wallpapers').length,1);
    panel.handlers[0]({target:{closest:()=>more}});
    assert.equal((cards.html.match(/data-path=/g)||[]).length,48);
    panel.handlers[0]({target:{closest:()=>more}});
    assert.equal((cards.html.match(/data-path=/g)||[]).length,60);
    assert.equal(more.hidden,true);
});
