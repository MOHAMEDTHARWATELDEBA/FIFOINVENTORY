// ============================================================
//  FIFO INVENTORY SYSTEM — Google Apps Script Backend
//  نظام إدارة المخزن FIFO — الخادم الخلفي
// ============================================================

const MASTER_SHEET_ID = SpreadsheetApp.getActive().getId();

// ====== CORS HEADERS ======
function doPost(e) {
  const result = handleRequest(e);
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const result = handleRequest(e);
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(e) {
  try {
    const params = e.parameter || {};
    const body = e.postData ? JSON.parse(e.postData.contents) : {};
    const action = params.action || body.action;
    const token = params.token || body.token;

    // Public actions (no auth needed)
    if (action === 'login') return login(body);
    if (action === 'ping') return {ok: true, msg: 'FIFO System Online'};

    // All other actions need valid token
    const user = verifyToken(token);
    if (!user) return {ok: false, msg: 'غير مصرح — سجّل الدخول أولاً'};

    // Route actions
    switch(action) {
      // ── USERS (Admin only) ──
      case 'getUsers':      return requireAdmin(user, () => getUsers());
      case 'addUser':       return requireAdmin(user, () => addUser(body));
      case 'updateUser':    return requireAdmin(user, () => updateUser(body));
      case 'deleteUser':    return requireAdmin(user, () => deleteUser(body));

      // ── ITEMS ──
      case 'getItems':      return getItems(body.year);
      case 'addItem':       return requireRole(user, ['admin','storemanager'], () => addItem(body));
      case 'deleteItem':    return requireAdmin(user, () => deleteItem(body));

      // ── TRANSACTIONS ──
      case 'getInTrans':    return getInTrans(body.year);
      case 'addInTrans':    return requireRole(user, ['admin','storemanager'], () => addInTrans(body));
      case 'deleteInTrans': return requireRole(user, ['admin','storemanager'], () => deleteInTrans(body));

      case 'getOutTrans':   return getOutTrans(body.year);
      case 'addOutTrans':   return requireRole(user, ['admin','storemanager'], () => addOutTrans(body));
      case 'deleteOutTrans':return requireRole(user, ['admin','storemanager'], () => deleteOutTrans(body));

      // ── YEAR MANAGEMENT ──
      case 'getYears':      return getYears();
      case 'initYear':      return requireAdmin(user, () => initYear(body));
      case 'rolloverYear':  return requireAdmin(user, () => rolloverYear(body));

      // ── REPORTS ──
      case 'getOpeningBalance': return getOpeningBalance(body.year);

      default: return {ok: false, msg: 'إجراء غير معروف: ' + action};
    }
  } catch(err) {
    return {ok: false, msg: 'خطأ: ' + err.message};
  }
}

// ============================================================
//  AUTH HELPERS
// ============================================================
function requireAdmin(user, fn) {
  if (user.role !== 'admin') return {ok: false, msg: 'هذا الإجراء للمدير فقط'};
  return fn();
}

function requireRole(user, roles, fn) {
  if (!roles.includes(user.role)) return {ok: false, msg: 'ليس لديك صلاحية هذا الإجراء'};
  return fn();
}

// Simple token: base64(username:timestamp) stored in Tokens sheet
function generateToken(username) {
  const token = Utilities.base64Encode(username + ':' + Date.now() + ':' + Math.random());
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Tokens');
  if (!sh) sh = ss.insertSheet('Tokens');
  sh.appendRow([token, username, new Date().toISOString()]);
  return token;
}

function verifyToken(token) {
  if (!token) return null;
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Tokens');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      const username = data[i][1];
      return getUserByUsername(username);
    }
  }
  return null;
}

function invalidateToken(token) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Tokens');
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) { sh.deleteRow(i + 1); return; }
  }
}

// ============================================================
//  LOGIN
// ============================================================
function login(body) {
  const {username, password} = body;
  if (!username || !password) return {ok: false, msg: 'أدخل اسم المستخدم وكلمة المرور'};
  const user = getUserByUsername(username);
  if (!user) return {ok: false, msg: 'اسم المستخدم غير موجود'};
  if (!user.active) return {ok: false, msg: 'الحساب موقوف — تواصل مع المدير'};
  // Simple hash check (SHA256-like using Utilities)
  const hashedInput = hashPassword(password);
  if (hashedInput !== user.password) return {ok: false, msg: 'كلمة المرور غير صحيحة'};
  const token = generateToken(username);
  return {ok: true, token, user: {username: user.username, name: user.name, role: user.role}};
}

function hashPassword(password) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ============================================================
//  USERS
// ============================================================
function getUsersSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Users');
  if (!sh) {
    sh = ss.insertSheet('Users');
    sh.appendRow(['username','name','password','role','active','createdAt']);
    // Default admin
    sh.appendRow(['admin','المدير العام', hashPassword('admin123'), 'admin', true, new Date().toISOString()]);
  }
  return sh;
}

function getUserByUsername(username) {
  const sh = getUsersSheet();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      return {username: data[i][0], name: data[i][1], password: data[i][2], role: data[i][3], active: data[i][4]};
    }
  }
  return null;
}

function getUsers() {
  const sh = getUsersSheet();
  const data = sh.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) users.push({username: data[i][0], name: data[i][1], role: data[i][3], active: data[i][4], createdAt: data[i][5]});
  }
  return {ok: true, users};
}

function addUser(body) {
  const {username, name, password, role} = body;
  if (!username || !name || !password || !role) return {ok: false, msg: 'أكمل جميع البيانات'};
  if (getUserByUsername(username)) return {ok: false, msg: 'اسم المستخدم موجود مسبقاً'};
  const validRoles = ['admin','storemanager','viewer','accountant'];
  if (!validRoles.includes(role)) return {ok: false, msg: 'دور غير صالح'};
  const sh = getUsersSheet();
  sh.appendRow([username, name, hashPassword(password), role, true, new Date().toISOString()]);
  return {ok: true, msg: 'تم إضافة المستخدم بنجاح'};
}

function updateUser(body) {
  const {username, name, password, role, active} = body;
  const sh = getUsersSheet();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      if (name !== undefined) sh.getRange(i+1, 2).setValue(name);
      if (password) sh.getRange(i+1, 3).setValue(hashPassword(password));
      if (role) sh.getRange(i+1, 4).setValue(role);
      if (active !== undefined) sh.getRange(i+1, 5).setValue(active);
      return {ok: true, msg: 'تم تحديث المستخدم'};
    }
  }
  return {ok: false, msg: 'المستخدم غير موجود'};
}

function deleteUser(body) {
  if (body.username === 'admin') return {ok: false, msg: 'لا يمكن حذف المدير الرئيسي'};
  const sh = getUsersSheet();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.username) { sh.deleteRow(i+1); return {ok: true, msg: 'تم حذف المستخدم'}; }
  }
  return {ok: false, msg: 'المستخدم غير موجود'};
}

// ============================================================
//  YEAR MANAGEMENT
// ============================================================
function getYearSheet(year, suffix) {
  const ss = SpreadsheetApp.getActive();
  const name = year + '_' + suffix;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (suffix === 'Items') sh.appendRow(['code','name','createdAt']);
    if (suffix === 'InTrans') sh.appendRow(['id','date','code','name','price','qty','total']);
    if (suffix === 'OutTrans') sh.appendRow(['id','date','code','name','qty','total']);
    if (suffix === 'Opening') sh.appendRow(['code','name','qty','val']);
  }
  return sh;
}

function getYears() {
  const ss = SpreadsheetApp.getActive();
  const sheets = ss.getSheets().map(s => s.getName());
  const years = [...new Set(sheets
    .filter(n => /^\d{4}_Items$/.test(n))
    .map(n => parseInt(n.split('_')[0])))].sort((a,b) => b-a);
  return {ok: true, years};
}

function initYear(body) {
  const year = parseInt(body.year);
  if (!year || year < 2000 || year > 2100) return {ok: false, msg: 'سنة غير صالحة'};
  getYearSheet(year, 'Items');
  getYearSheet(year, 'InTrans');
  getYearSheet(year, 'OutTrans');
  getYearSheet(year, 'Opening');
  return {ok: true, msg: 'تم إنشاء قاعدة بيانات سنة ' + year};
}

// Transfer Dec balance → Jan opening of next year
function rolloverYear(body) {
  const fromYear = parseInt(body.fromYear);
  const toYear = fromYear + 1;

  // Ensure next year sheets exist
  getYearSheet(toYear, 'Items');
  getYearSheet(toYear, 'InTrans');
  getYearSheet(toYear, 'OutTrans');
  const openingSh = getYearSheet(toYear, 'Opening');

  // Get all items from previous year
  const items = getItemsData(fromYear);
  // Compute FIFO balance for each item in fromYear
  const openingRows = [];
  for (const item of items) {
    const bal = computeBalance(item.code, fromYear);
    openingRows.push([item.code, item.name, bal.qty, bal.val]);
    // Also copy item to new year if not already there
    addItemIfMissing(toYear, item.code, item.name);
  }

  // Clear & write opening balance
  const lastRow = openingSh.getLastRow();
  if (lastRow > 1) openingSh.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (openingRows.length > 0) openingSh.getRange(2, 1, openingRows.length, 4).setValues(openingRows);

  return {ok: true, msg: `تم نقل رصيد ${fromYear} كرصيد أول مدة ${toYear}`, count: openingRows.length};
}

function addItemIfMissing(year, code, name) {
  const sh = getYearSheet(year, 'Items');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code) return;
  }
  sh.appendRow([code, name, new Date().toISOString()]);
}

// ============================================================
//  ITEMS
// ============================================================
function getItemsData(year) {
  const sh = getYearSheet(year, 'Items');
  const data = sh.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) items.push({code: data[i][0], name: data[i][1], createdAt: data[i][2]});
  }
  return items;
}

function getItems(year) {
  if (!year) return {ok: false, msg: 'حدد السنة'};
  return {ok: true, items: getItemsData(year)};
}

function addItem(body) {
  const {year, code, name} = body;
  if (!year || !code || !name) return {ok: false, msg: 'أكمل البيانات'};
  const sh = getYearSheet(year, 'Items');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code) return {ok: false, msg: 'الكود موجود مسبقاً'};
  }
  sh.appendRow([code, name, new Date().toISOString()]);
  return {ok: true, msg: 'تم إضافة الصنف'};
}

function deleteItem(body) {
  const {year, code} = body;
  const sh = getYearSheet(year, 'Items');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code) { sh.deleteRow(i+1); return {ok: true}; }
  }
  return {ok: false, msg: 'الصنف غير موجود'};
}

// ============================================================
//  TRANSACTIONS
// ============================================================
function getInTrans(year) {
  if (!year) return {ok: false, msg: 'حدد السنة'};
  const sh = getYearSheet(year, 'InTrans');
  const data = sh.getDataRange().getValues();
  const trans = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) trans.push({id: data[i][0], date: data[i][1], code: data[i][2], name: data[i][3], price: data[i][4], qty: data[i][5], total: data[i][6]});
  }
  return {ok: true, trans};
}

function addInTrans(body) {
  const {year, date, code, name, price, qty} = body;
  if (!year||!date||!code||!price||!qty) return {ok: false, msg: 'أكمل البيانات'};
  const total = parseFloat(price) * parseInt(qty);
  const id = Date.now();
  getYearSheet(year, 'InTrans').appendRow([id, date, code, name, parseFloat(price), parseInt(qty), total]);
  return {ok: true, msg: 'تم تسجيل الوارد', id};
}

function deleteInTrans(body) {
  const {year, id} = body;
  const sh = getYearSheet(year, 'InTrans');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) { sh.deleteRow(i+1); return {ok: true}; }
  }
  return {ok: false, msg: 'الحركة غير موجودة'};
}

function getOutTrans(year) {
  if (!year) return {ok: false, msg: 'حدد السنة'};
  const sh = getYearSheet(year, 'OutTrans');
  const data = sh.getDataRange().getValues();
  const trans = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) trans.push({id: data[i][0], date: data[i][1], code: data[i][2], name: data[i][3], qty: data[i][4], total: data[i][5]});
  }
  return {ok: true, trans};
}

function addOutTrans(body) {
  const {year, date, code, name, qty, total} = body;
  if (!year||!date||!code||!qty) return {ok: false, msg: 'أكمل البيانات'};
  const id = Date.now();
  getYearSheet(year, 'OutTrans').appendRow([id, date, code, name, parseInt(qty), parseFloat(total)]);
  return {ok: true, msg: 'تم تسجيل المنصرف', id};
}

function deleteOutTrans(body) {
  const {year, id} = body;
  const sh = getYearSheet(year, 'OutTrans');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) { sh.deleteRow(i+1); return {ok: true}; }
  }
  return {ok: false, msg: 'الحركة غير موجودة'};
}

// ============================================================
//  BALANCE (FIFO)
// ============================================================
function computeBalance(code, year) {
  const inSh = getYearSheet(year, 'InTrans');
  const outSh = getYearSheet(year, 'OutTrans');
  const openSh = getYearSheet(year, 'Opening');

  // Opening balance
  const openData = openSh.getDataRange().getValues();
  let openQty = 0, openVal = 0;
  for (let i = 1; i < openData.length; i++) {
    if (openData[i][0] === code) { openQty = parseFloat(openData[i][2])||0; openVal = parseFloat(openData[i][3])||0; break; }
  }

  // Build FIFO layers from opening + ins
  let layers = [];
  if (openQty > 0) {
    const avgPrice = openQty > 0 ? openVal / openQty : 0;
    layers.push({qty: openQty, price: avgPrice});
  }

  const inData = inSh.getDataRange().getValues();
  const ins = [];
  for (let i = 1; i < inData.length; i++) {
    if (inData[i][2] === code) ins.push({date: inData[i][1], price: parseFloat(inData[i][4]), qty: parseInt(inData[i][5])});
  }
  ins.sort((a,b) => String(a.date).localeCompare(String(b.date)));
  ins.forEach(t => layers.push({qty: t.qty, price: t.price}));

  const outData = outSh.getDataRange().getValues();
  const outs = [];
  for (let i = 1; i < outData.length; i++) {
    if (outData[i][2] === code) outs.push({date: outData[i][1], qty: parseInt(outData[i][4])});
  }
  outs.sort((a,b) => String(a.date).localeCompare(String(b.date)));

  for (const out of outs) {
    let rem = out.qty;
    for (let l of layers) { if (rem<=0) break; const take=Math.min(l.qty,rem); l.qty-=take; rem-=take; }
    layers = layers.filter(l => l.qty > 0);
  }

  const qty = layers.reduce((s,l)=>s+l.qty,0);
  const val = layers.reduce((s,l)=>s+l.qty*l.price,0);
  return {qty, val};
}

function getOpeningBalance(year) {
  if (!year) return {ok: false, msg: 'حدد السنة'};
  const sh = getYearSheet(year, 'Opening');
  const data = sh.getDataRange().getValues();
  const opening = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) opening.push({code: data[i][0], name: data[i][1], qty: data[i][2], val: data[i][3]});
  }
  return {ok: true, opening};
}
