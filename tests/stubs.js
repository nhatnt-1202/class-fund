/**
 * DOM giả tối thiểu để chạy phần logic của index.html trong node (không cần jsdom).
 * Dùng cho bộ kiểm tra thuần tính toán: tiền, ngày, parser Excel, công nợ.
 */
function fakeEl(){
  return { style:{ setProperty(){} }, dataset:{},
    classList:{ add(){}, remove(){}, toggle(){}, contains:()=>false },
    children:[], value:'', textContent:'', innerHTML:'', hidden:false, files:[], checked:false,
    setAttribute(){}, removeAttribute(){}, getAttribute:()=>null, appendChild(){}, remove(){},
    addEventListener(){}, removeEventListener(){}, focus(){}, click(){},
    closest:()=>fakeEl(), querySelector:()=>fakeEl(), querySelectorAll:()=>[],
    selectedOptions:[], scrollIntoView(){}, dispatchEvent(){} };
}
function installStubs(){
  global.window = global;
  global.document = { getElementById:()=>fakeEl(), querySelector:()=>fakeEl(), querySelectorAll:()=>[],
    createElement:()=>fakeEl(), addEventListener(){}, body:fakeEl(), head:fakeEl(),
    documentElement:fakeEl(), activeElement:{ tagName:'BODY' }, title:'' };
  global.localStorage = { _m:{}, getItem(k){ return this._m[k] ?? null; },
    setItem(k,v){ this._m[k] = v; }, removeItem(k){ delete this._m[k]; } };
  global.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2,10) };
  global.performance = { now: () => Date.now() };
  global.matchMedia = () => ({ matches:false });
  global.requestAnimationFrame = fn => fn(0);
  global.setTimeout = () => 0;
  global.Blob = class {};
  global.URL = { createObjectURL: () => '', revokeObjectURL(){} };
  global.FileReader = class {};
  global.Event = class {};
}
/** Cắt phần JavaScript của app ra khỏi index.html để nạp vào node. */
function extractAppCode(htmlPath){
  const html = require('fs').readFileSync(htmlPath, 'utf8');
  const open = html.indexOf("<script>\n'use strict';");
  const close = html.lastIndexOf('</script>');
  if (open < 0 || close < 0) throw new Error('Không tìm thấy khối <script> của app trong ' + htmlPath);
  return html.slice(open + '<script>'.length, close).replace("'use strict';", '');
}
module.exports = { fakeEl, installStubs, extractAppCode };
