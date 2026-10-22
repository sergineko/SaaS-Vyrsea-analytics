import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { existsSync,mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const target=process.argv[2]??'http://127.0.0.1:8788/';
const candidates=[process.env.CHROME_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath=candidates.find(path=>existsSync(path));
mkdirSync('artifacts',{recursive:true});
const profile=mkdtempSync(resolve('artifacts/chrome-audit-'));
const chrome=await launch({...(chromePath?{chromePath}:{}),userDataDir:profile,port:9225,chromeFlags:['--headless=new','--no-first-run','--disable-extensions'],logLevel:'silent'});
const summaries=[];
try{
  for(const [mode,config] of [['mobile',undefined],['desktop',desktopConfig]]){
    const result=await lighthouse(target,{port:chrome.port,output:['html','json'],logLevel:'error'},config);
    if(!result||result.lhr.runtimeError)throw new Error(result?.lhr.runtimeError?.message??'Lighthouse failed');
    writeFileSync(`artifacts/lighthouse-${mode}.html`,result.report[0]);writeFileSync(`artifacts/lighthouse-${mode}.json`,result.report[1]);
    const audits=result.lhr.audits;
    const summary={mode,url:target,fetchTime:result.lhr.fetchTime,categories:Object.fromEntries(Object.entries(result.lhr.categories).map(([id,category])=>[id,category.score===null?null:Math.round(category.score*100)])),
      metrics:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time','cumulative-layout-shift'].map(id=>[id,{value:audits[id]?.numericValue,display:audits[id]?.displayValue}])),
      failedAudits:Object.entries(audits).filter(([,audit])=>audit.score!==null&&audit.score<1&&['binary','numeric'].includes(audit.scoreDisplayMode)).map(([id,audit])=>({id,title:audit.title,score:audit.score})),
      agenticCategoryAvailable:Boolean(result.lhr.categories['agentic-browsing'])};
    summaries.push(summary);console.log(JSON.stringify(summary,null,2));
  }
  writeFileSync('artifacts/audit-summary.json',JSON.stringify({note:'Pruebas de laboratorio locales sobre compilación de producción. No son datos CrUX ni PageSpeed Insights de vyrsea.com.',results:summaries},null,2));
}finally{await chrome.kill();}
