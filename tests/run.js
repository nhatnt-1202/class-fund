/**
 * Bộ kiểm thử cho Quỹ Lớp (index.html).
 *   node run.js [đường-dẫn-file-danh-sách-lớp.xlsx]
 * Không có tham số thì tự tìm file mẫu trong ~/Downloads.
 *
 * 4 nhóm kiểm tra:
 *   1. Tính toán nghiệp vụ  — chạy bộ tự kiểm tra dựng sẵn trong app (11 phép)
 *   2. Parser file thật     — đọc file Excel danh sách lớp thật, đối chiếu từng con số
 *   3. Giao diện (jsdom)    — render 7 trang, mở 7 modal, thêm khoản chi, bắt lỗi runtime
 *   4. Xuất Excel           — dựng workbook, đọc lại, kiểm tra kiểu ô và số liệu
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { installStubs, extractAppCode } = require('./stubs');

const HTML = path.join(__dirname, '..', 'index.html');
const SAMPLE = process.argv[2] ||
  path.join(os.homedir(), 'Downloads', 'Danh sách đóng góp quỹ lớp DCXDXD69_03B (2).xlsx');

let pass = 0, fail = 0;
const ok  = (name, extra) => { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name + (extra ? '  \x1b[2m' + extra + '\x1b[0m' : '')); };
const bad = (name, why)   => { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      → ' + why); };
const check = (name, cond, why, extra) => cond ? ok(name, extra) : bad(name, why);
const head = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

/* ---------- 1. Tính toán nghiệp vụ ---------- */
head('1. Tính toán nghiệp vụ (bộ tự kiểm tra trong app)');
// installStubs() tắt setTimeout (để app không hẹn giờ mở modal chào mừng trong môi trường giả),
// nên phải giữ lại bản thật rồi trả về trước khi chạy các phần async bên dưới.
const realSetTimeout = setTimeout;
installStubs();
global.XLSX = require('xlsx');
const APP = extractAppCode(HTML);
const api = {};
(0, eval)(APP + '\nObject.assign(globalThis.__api = {}, { runSelfTest, detectHeaderRow, detectMeta, guessField,' +
  ' extractRows, validateRows, isEmptyCell, normCode, excelSerialToISO, parseDateFlexible, noAccent, parseMoney,' +
  ' fmtVND, fmtDate, buildWorkbook, scopeFilter, scopeLabel, loadDemo, lifetimeBalance, periodStats, debtMatrix });');
Object.assign(api, globalThis.__api);
global.setTimeout = realSetTimeout;

const raw = api.runSelfTest();
raw.split('<div class="testline ').slice(1).forEach(chunk => {
  const name = chunk.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
    .replace(/^[pf]">/, '').trim().replace(/^[✓✕] (ĐẠT|LỖI) /, '');
  chunk.startsWith('p"') ? ok(name) : bad(name.split('—')[0], name.split('—').slice(1).join('—').trim() || 'thất bại');
});

/* ---------- 2. Parser file thật ---------- */
head('2. Parser trên file Excel thật');
if (!fs.existsSync(SAMPLE)){
  console.log('  \x1b[33m⚠ bỏ qua\x1b[0m — không tìm thấy file: ' + SAMPLE);
} else {
  const XLSX = global.XLSX;
  const wb = XLSX.read(fs.readFileSync(SAMPLE), { type:'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:true, defval:null, blankrows:true });
  const hr = api.detectHeaderRow(aoa);
  check('Dò được dòng tiêu đề bảng', hr === 9, `ra dòng ${hr+1}, mong đợi dòng 10`, 'dòng 10');

  const meta = api.detectMeta(aoa, hr);
  check('Đọc được thông tin lớp từ phần tiêu đề hành chính',
    meta.className === 'DCXDXD69_03B' && /XÂY DỰNG/.test(meta.faculty || '') &&
    meta.term === 'Học kỳ I' && meta.schoolYear === '2026-2027',
    JSON.stringify(meta), `${meta.className} · ${meta.faculty} · ${meta.term} · ${meta.schoolYear}`);

  const hdr = aoa[hr] || [], mapping = {};
  const width = Math.max(hdr.length, ...aoa.slice(hr+1, hr+12).map(r => (r||[]).length));
  for (let c = 0; c < width; c++) mapping[c] = api.guessField(hdr[c]);
  for (let c = 0; c < width; c++){
    if (mapping[c] === 'lastName' && api.isEmptyCell(hdr[c+1])){
      const sample = aoa.slice(hr+1, hr+8).some(r => r && !api.isEmptyCell(r[c+1]) && typeof r[c+1] === 'string');
      if (sample && (mapping[c+1] === 'skip' || mapping[c+1] === undefined)) mapping[c+1] = 'firstName';
    }
  }
  const used = new Set();
  Object.keys(mapping).forEach(c => { const v = mapping[c];
    if (v !== 'skip'){ if (used.has(v)) mapping[c] = 'skip'; else used.add(v); } });
  check('Tự khớp cột: ô "Họ và tên SV" bị merge ⇒ tách thành 2 trường',
    mapping[2] === 'lastName' && mapping[3] === 'firstName',
    `C=${mapping[2]}, D=${mapping[3]}`, 'C→họ đệm, D→tên');

  const ex = api.extractRows(aoa, hr, mapping);
  api.validateRows(ex.rows);
  check('Đọc đúng 49 sinh viên', ex.rows.length === 49, `đọc được ${ex.rows.length}`, 'dòng 11–59');
  check('Không lấy dòng "Tổng quỹ" thành sinh viên',
    !ex.rows.some(r => /^(tong|cong)/.test(api.noAccent(r.fullName))), 'dòng tổng bị lẫn vào');
  check('Bắt được dòng tổng để đối chiếu (cách bảng 4 dòng trống)',
    ex.footerTotal === 1000000, `footerTotal = ${ex.footerTotal}`, api.fmtVND(1000000));
  check('Mã SV không còn dạng ký hiệu khoa học',
    ex.rows.every(r => /^\d+$/.test(r.code)) && ex.rows[0].code === '2400000001',
    'còn mã sai: ' + ex.rows.filter(r => !/^\d+$/.test(r.code)).map(r => r.code).join(','), '2400000001');
  check('Ghép họ + tên đúng', ex.rows[0].fullName === 'Trần Văn Mẫu', ex.rows[0].fullName, 'Trần Văn Mẫu');
  check('Quy đổi serial ngày sinh đúng như Excel hiển thị',
    ex.rows[0].dob === '2006-07-20' && ex.rows[1].dob === '2006-06-05',
    `${ex.rows[0].dob} / ${ex.rows[1].dob}`, '20/07/2006 · 05/06/2006');
  check('Mọi dòng đều hợp lệ (0 lỗi)', ex.rows.filter(r => r.errors.length).length === 0,
    ex.rows.filter(r => r.errors.length).map(r => r._row + ':' + r.errors).join(' | '));
  check('Cột "Trạng thái" có khoảng trắng cuối vẫn nhận đúng',
    ex.rows.filter(r => r.paidFlag).length === 23, ex.rows.filter(r => r.paidFlag).length + ' dòng đã đóng', '23 đã đóng');
  check('Mã SV duy nhất', new Set(ex.rows.map(r => r.code)).size === 49, 'có mã trùng');
}

/* ---------- 3. Giao diện ---------- */
head('3. Giao diện (jsdom)');
let jsdom = null;
try { jsdom = require('jsdom'); } catch(e){ console.log('  \x1b[33m⚠ bỏ qua\x1b[0m — chưa cài jsdom (npm i)'); }
const wait = ms => new Promise(r => setTimeout(r, ms));
/** Mỗi lần gọi trả về một phiên bản app hoàn toàn mới (localStorage rỗng). */
function makeDom(){
  const { JSDOM, VirtualConsole } = jsdom;
  const errors = [];
  const vc = new VirtualConsole().on('jsdomError', e => errors.push(String(e.detail || e).split('\n')[0]));
  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'),
    { runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/', virtualConsole: vc });
  // jsdom không tải script từ CDN ⇒ nạp thẳng thư viện tương đương để kiểm tra được phần vẽ QR
  dom.window.XLSX = require('xlsx');
  try { dom.window.qrcode = require('qrcode-generator'); } catch(e){}
  return { w: dom.window, d: dom.window.document, errors };
}
(async () => {
  if (jsdom){
    const { w, d, errors } = makeDom();
    await wait(600);

    check('Trang khởi động, sidebar và nội dung render được',
      d.querySelectorAll('.nav-item').length === 7 && d.getElementById('main').innerHTML.length > 500,
      'nav=' + d.querySelectorAll('.nav-item').length);
    check('Lần đầu mở hiện màn hình chào mừng', !!d.querySelector('#modalRoot .modal'), 'không thấy modal');
    d.querySelectorAll('#modalRoot [data-close]').forEach(b => b.click());
    d.getElementById('modalRoot').innerHTML = '';

    w.loadDemo(); await wait(60);
    for (const v of ['dashboard','students','incomes','expenses','periods','io','settings']){
      w.go(v); await wait(30);
      const main = d.getElementById('main');
      check('Trang "' + v + '" render không lỗi', main.innerHTML.length > 800,
        'chỉ ' + main.innerHTML.length + ' ký tự');
    }
    const modals = { 'Thêm thu':()=>w.openIncomeModal(), 'Thêm chi':()=>w.openExpenseModal(),
      'Thêm SV':()=>w.openStudentModal(), 'Tạo đợt thu':()=>w.openPeriodModal(),
      'Thu theo lô':()=>w.openBatchModal(), 'Xuất Excel':()=>w.openExportModal('range'),
      'Nhập Excel':()=>w.openImportModal() };
    for (const [name, fn] of Object.entries(modals)){
      try {
        fn(); await wait(50);
        const m = d.querySelector('#modalRoot .modal');
        check('Mở được modal "' + name + '"', !!m, 'không mở được',
          m ? m.querySelectorAll('input,select,button').length + ' control' : '');
      } catch(e){ bad('Mở được modal "' + name + '"', e.message); }
      d.getElementById('modalRoot').innerHTML = '';
    }
    // thêm một khoản chi vượt tồn quỹ ⇒ phải hỏi xác nhận trước khi ghi
    w.go('expenses'); await wait(40);
    w.openExpenseModal(); await wait(50);
    const md = d.querySelector('#modalRoot .modal');
    md.querySelector('#exAmount').value = '35000';
    md.querySelector('#exAmount').dispatchEvent(new w.Event('input'));
    md.querySelector('#exItem').value = 'Bút lông viết bảng';
    md.querySelector('#exBuyer').value = 'Trần Văn Mẫu';
    md.querySelector('#exSave').click(); await wait(60);
    const confirmBtn = d.querySelector('#modalRoot [data-ok]');
    check('Chi vượt tồn quỹ thì hỏi xác nhận, không ghi ngầm', !!confirmBtn, 'ghi luôn mà không cảnh báo');
    if (confirmBtn) confirmBtn.click();
    await wait(80);
    const st = JSON.parse(w.localStorage.getItem('classFund.v1') || '{}');
    const added = (st.expenses || []).find(e => e.item === 'Bút lông viết bảng');
    check('Lưu được khoản chi và ghi vào localStorage', !!added && added.amount === 35000,
      'không thấy bản ghi', added ? 'đánh dấu vượt quỹ: ' + !!added.overdraft : '');
    ['QUY_LOP','QUY_DOAN'].forEach(f => {
      const i = (st.incomes||[]).filter(x=>x.fund===f).reduce((a,x)=>a+x.amount,0);
      const e = (st.expenses||[]).filter(x=>x.fund===f).reduce((a,x)=>a+x.amount,0);
      check('Tồn quỹ = Thu − Chi (' + f + ')', w.lifetimeBalance(f) === i - e,
        `${w.lifetimeBalance(f)} ≠ ${i - e}`, api.fmtVND(i - e));
    });
    w.go('settings'); await wait(30);
    d.getElementById('btnSelfTest').click(); await wait(50);
    const outTxt = d.getElementById('testOut').textContent;
    check('Nút "Chạy tự kiểm tra" hoạt động trong app', /(\d+)\/\1 phép kiểm tra đạt/.test(outTxt),
      outTxt.trim().slice(0, 80) || '(không có kết quả)');

    /* ---------- luồng import qua giao diện ---------- */
    check('Không có lỗi runtime nào trong phiên giao diện', errors.length === 0, errors.join(' | '));

    if (fs.existsSync(SAMPLE)){
      head('3b. Luồng import qua giao diện, dùng file thật (phiên sạch)');
      const s2 = makeDom();
      const w = s2.w, d = s2.d;
      await wait(600);
      d.querySelectorAll('#modalRoot [data-close]').forEach(b => b.click());
      d.getElementById('modalRoot').innerHTML = '';
      const file = new w.File([new Uint8Array(fs.readFileSync(SAMPLE))], path.basename(SAMPLE));
      w.openImportModal(file); await wait(700);
      let m = d.querySelector('#modalRoot .modal');
      check('Đọc file và nhảy sang bước khớp cột',
        !!m.querySelector('#impNext') && /49 sinh viên/.test(m.textContent), 'không sang được bước 2');
      check('Tự điền thông tin lớp vào form', (m.querySelector('#mmClass')||{}).value === 'DCXDXD69_03B',
        (m.querySelector('#mmClass')||{}).value);
      check('Không còn tuỳ chọn tạo khoản thu từ file', !m.querySelector('#mkInc'),
        'vẫn còn checkbox lấy tiền từ file import');
      m.querySelector('#impNext').click(); await wait(250);
      m = d.querySelector('#modalRoot .modal');
      const preview = m.textContent.replace(/\s+/g, ' ');
      check('Xem trước hiện thống kê và nói rõ không cộng tiền từ file',
        /49 thêm mới/.test(preview) && /không.*d[uù]ng để cộng vào quỹ/i.test(preview),
        preview.slice(0, 160));
      m.querySelector('#impNext').click(); await wait(300);
      const rep = d.querySelector('#modalRoot .modal').textContent.replace(/\s+/g, ' ');
      check('Báo cáo kết quả và hướng dẫn bước tiếp theo là dùng QR',
        /Thêm mới\s*49 sinh viên/.test(rep) && /QR cả lớp/.test(rep), rep.slice(0, 160));
      d.querySelectorAll('#modalRoot [data-close]').forEach(b => b.click());
      await wait(60);
      const after = JSON.parse(w.localStorage.getItem('classFund.v1'));
      check('Import chỉ tạo danh sách: 49 SV, 0 đợt thu, 0 khoản thu',
        after.students.length === 49 && after.periods.length === 0 && after.incomes.length === 0,
        `${after.students.length} SV / ${after.periods.length} đợt / ${after.incomes.length} thu`);
      w.go('students'); await wait(80);
      check('Bảng danh sách lớp hiện đủ 49 hàng',
        d.getElementById('main').querySelectorAll('tbody tr').length === 49,
        d.getElementById('main').querySelectorAll('tbody tr').length + ' hàng');

      /* ---------- thu tiền bằng QR ---------- */
      head('3c. Thu tiền bằng QR chuyển khoản');
      // cấu hình tài khoản qua đúng giao diện Cài đặt
      w.go('settings'); await wait(60);
      d.getElementById('bkBank').value = '970436';
      d.getElementById('bkBank').dispatchEvent(new w.Event('change'));
      d.getElementById('bkAccount').value = '1021234567';
      d.getElementById('bkName').value = 'NGUYEN VAN THU QUY';
      d.getElementById('bkTpl').value = '{ma} {dot}';
      d.getElementById('bkSave').click(); await wait(80);
      const cfg = JSON.parse(w.localStorage.getItem('classFund.v1')).meta.bank;
      check('Lưu được tài khoản nhận chuyển khoản',
        cfg.bin === '970436' && cfg.accountNo === '1021234567' && cfg.bankName === 'Vietcombank',
        JSON.stringify(cfg));

      // tạo một đợt thu để có số tiền phải nộp
      w.openPeriodModal(); await wait(60);
      let pm = d.querySelector('#modalRoot .modal');
      pm.querySelector('#pName').value = 'Quỹ lớp học kỳ I';
      pm.querySelector('#pAmt').value = '50000';
      pm.querySelector('#pAmt').dispatchEvent(new w.Event('input'));
      pm.querySelector('#pSave').click(); await wait(80);
      const st1 = JSON.parse(w.localStorage.getItem('classFund.v1'));
      check('Tạo được đợt thu 50.000 ₫/SV', st1.periods.length === 1 && st1.periods[0].amountPerStudent === 50000,
        JSON.stringify(st1.periods));

      // mở QR của một sinh viên
      const stu = st1.students[0], per = st1.periods[0];
      w.openQRModal({ studentId: stu.id, periodId: per.id }); await wait(120);
      const qm = d.querySelector('#modalRoot .modal-back') || d.querySelector('#modalRoot .modal');
      const back = d.querySelector('#modalRoot .modal-back');
      const payload = back ? back.dataset.payload : '';
      check('Mở QR sinh viên và dựng được payload VietQR', !!payload && payload.startsWith('000201'),
        payload ? payload.slice(0, 40) : '(rỗng)');
      check('QR mang đúng số tiền còn phải nộp của sinh viên',
        payload.includes('540550000'), 'không thấy trường 54 = 50000', '54 05 50000');
      check('QR mang đúng số tài khoản của thủ quỹ',
        payload.includes('970436') && payload.includes('1021234567'), 'thiếu BIN/số TK');
      const noteShown = (d.getElementById('qrNote') || {}).textContent || '';
      check('Nội dung chuyển khoản gắn mã SV để đối chiếu',
        noteShown.includes(stu.code), 'nội dung = ' + noteShown, noteShown);
      const svg = d.querySelector('#qrImg svg');
      check('Vẽ được ảnh QR (SVG) ngay trên máy', !!svg, 'không render được SVG');
      check('Số tiền QR đổi theo ô nhập', (() => {
        const inp = d.getElementById('qrAmount');
        inp.value = '20000'; inp.dispatchEvent(new w.Event('input'));
        return (d.querySelector('#modalRoot .modal-back').dataset.payload || '').includes('540520000');
      })(), 'payload không cập nhật khi đổi số tiền');

      // xác nhận đã nhận tiền
      d.getElementById('qrAmount').value = '50000';
      d.getElementById('qrAmount').dispatchEvent(new w.Event('input'));
      d.getElementById('qrDone').click(); await wait(100);
      const st2 = JSON.parse(w.localStorage.getItem('classFund.v1'));
      const rec = st2.incomes[0];
      check('Ghi nhận thu sau chuyển khoản: đúng người, đúng quỹ, hình thức chuyển khoản',
        st2.incomes.length === 1 && rec.studentId === stu.id && rec.amount === 50000 &&
        rec.method === 'TRANSFER' && rec.fund === per.fund && /QR/.test(rec.note || ''),
        JSON.stringify(rec));
      check('Tồn quỹ cập nhật đúng sau khi ghi nhận', w.lifetimeBalance(per.fund) === 50000,
        String(w.lifetimeBalance(per.fund)), api.fmtVND(50000));

      // QR cả lớp cho đợt thu
      w.openQRSheetModal(per.id); await wait(300);
      const cells = d.querySelectorAll('#modalRoot .qrcell').length;
      const svgs  = d.querySelectorAll('#modalRoot .qrcell svg').length;
      check('QR cả lớp: 48 sinh viên còn nợ, mỗi người một mã riêng',
        cells === 48 && svgs === 48, `${cells} ô / ${svgs} mã vẽ được`);
      d.getElementById('modalRoot').innerHTML = '';

      check('Không có lỗi runtime nào trong phiên import + QR', s2.errors.length === 0, s2.errors.join(' | '));
    }
  }

  /* ---------- 4. Xuất Excel ---------- */
  head('4. Xuất Excel');
  const XLSX = global.XLSX;
  installStubs(); global.XLSX = XLSX; global.setTimeout = realSetTimeout;
  const a2 = {};
  (0, eval)(APP + '\nglobalThis.__api2 = { loadDemo, buildWorkbook, scopeFilter,' +
    ' setBankForTest(){ S.meta.bank = { bin:"970436", bankName:"Vietcombank", accountNo:"1021234567",' +
    ' accountName:"THU QUY", template:"{ma} {dot}" }; } };');
  Object.assign(a2, globalThis.__api2);
  a2.loadDemo();
  const out = path.join(os.tmpdir(), 'class-fund-test.xlsx');
  const wb = a2.buildWorkbook({ mode:'all', fund:'' });
  XLSX.writeFile(wb, out);
  const back = XLSX.read(fs.readFileSync(out), { type:'buffer', cellNF:true });
  const want = ['Tong quan','Thu','Chi','Cong no','Ma tran dot thu','Danh sach lop','Nhat ky theo ngay'];
  // chưa cấu hình tài khoản ⇒ chưa có sheet QR
  check('Workbook có đúng 7 sheet, đúng tên và đúng thứ tự',
    JSON.stringify(back.SheetNames) === JSON.stringify(want), back.SheetNames.join(', '), want.length + ' sheet');
  const F2 = back.Sheets['Thu'].F2, A2 = back.Sheets['Thu'].A2;
  check('Cột tiền là số thật + format #,##0 (Excel SUM được)',
    F2 && F2.t === 'n' && F2.z === '#,##0', JSON.stringify(F2));
  check('Cột ngày là ngày thật, không dính phân số giờ',
    A2 && A2.t === 'n' && Number.isInteger(A2.v) && A2.z === 'dd/mm/yyyy', JSON.stringify(A2), A2 && A2.w);
  check('Sheet có autofilter và độ rộng cột',
    !!back.Sheets['Thu']['!autofilter'], 'thiếu autofilter');
  const tq = XLSX.utils.sheet_to_json(back.Sheets['Tong quan'], { header:1 });
  const bal = tq.find(r => r[0] === 'Tồn quỹ');
  check('Sheet Tổng quan tách cột theo từng quỹ và có dòng tồn quỹ',
    bal && bal.length >= 4, JSON.stringify(bal), JSON.stringify(bal));
  // cấu hình tài khoản ⇒ có thêm sheet đối chiếu chuyển khoản
  a2.setBankForTest();
  const wb2 = a2.buildWorkbook({ mode:'all', fund:'' });
  check('Có tài khoản QR thì workbook có thêm sheet "QR chuyen khoan"',
    wb2.SheetNames.includes('QR chuyen khoan'), wb2.SheetNames.join(', '));
  const qrRows = XLSX.utils.sheet_to_json(wb2.Sheets['QR chuyen khoan'] || {}, { header:1 });
  check('Sheet QR có nội dung chuyển khoản và payload cho từng SV còn nợ',
    qrRows.length > 1 && String(qrRows[1][8] || '').startsWith('000201') && qrRows[1][4] > 0,
    JSON.stringify(qrRows[1] || []).slice(0, 120));

  const day = a2.buildWorkbook({ mode:'day', from:'2026-09-05', fund:'' });
  const dayThu = XLSX.utils.sheet_to_json(day.Sheets['Thu'], { header:1 });
  check('Xuất theo một ngày không có khoản thu ⇒ vẫn có header + dòng "không có dữ liệu"',
    dayThu.length === 2 && /Không có dữ liệu/.test(dayThu[1][0]), JSON.stringify(dayThu.slice(0,2)));

  console.log('\n' + '─'.repeat(60));
  console.log(fail === 0
    ? `\x1b[32m\x1b[1mTẤT CẢ ${pass} PHÉP KIỂM TRA ĐẠT\x1b[0m`
    : `\x1b[31m\x1b[1m${fail} LỖI\x1b[0m / ${pass + fail} phép kiểm tra`);
  process.exit(fail ? 1 : 0);
})();
