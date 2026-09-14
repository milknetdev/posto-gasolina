'use strict';
// ============================================================
// MEU POSTO DE GASOLINA - Complete Gas Station Tycoon Game
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

// --- Global State ---
let W, H, scale, ox, oy, time = 0, last = 0, paused = false;
let action = 0, spawn = 0, saveClock = 0;
let pointer = null;
const keys = {};
const player = { x: 420, y: 530, bag: [], color: '#ffd700' };
const customers = [];
const particles = [];

// --- Products ---
// Fuel types (indices 0-5) and convenience items (6-11)
const products = [
  { icon: '⛽', name: 'GASOLINA COMUM', price: 5, key: null },
  { icon: '🔵', name: 'GASOLINA ADITIVADA', price: 8, key: 'aditivada' },
  { icon: '🟢', name: 'ETANOL', price: 4, key: 'etanol' },
  { icon: '⬛', name: 'DIESEL', price: 7, key: 'diesel' },
  { icon: '💨', name: 'GNV', price: 6, key: 'gnv' },
  { icon: '⚡', name: 'ENERGIA ELÉTRICA', price: 10, key: 'eletrica' },
  { icon: '🥤', name: 'BEBIDAS', price: 8, key: 'bebidas' },
  { icon: '🍫', name: 'SNACKS', price: 6, key: 'snacks' },
  { icon: '☕', name: 'CAFÉ', price: 5, key: 'cafe' },
  { icon: '🧴', name: 'ÓLEO LUBRIFICANTE', price: 15, key: 'oleo' },
  { icon: '🧃', name: 'ÁGUA MINERAL', price: 4, key: 'agua' },
  { icon: '🧊', name: 'SORVETE', price: 7, key: 'sorvete' },
];
// Raw materials (indices 12-14)
products.push(
  { icon: '🛢️', name: 'PETRÓLEO BRUTO', price: 0, key: 'petroleo' },
  { icon: '🌿', name: 'BIOMASSA', price: 0, key: 'biomassa' },
  { icon: '💧', name: 'ÁGUA', price: 0, key: 'agua_raw' },
);

// --- Game State ---
let state = {
  money: 0, capacity: 6, sold: 0, orders: 0,
  stock: new Array(products.length).fill(0),
  farm: new Array(products.length).fill(0),
  done: [], expansion: 0, milestones: [],
  reputation: 100,
  manualStocked: 0, manualFed: 0,
  shelfLevels: {},
  prodSettings: {},
  machines: {},
  operations: { registers: 1, scanner: 0, transport: 0, frentistas: 0 },
  specialists: {},
  specialistWorkers: {},
  layoutPositions: {},
  productionSites: {},
};

// Load saved state
try {
  const saved = JSON.parse(localStorage.getItem('meu-posto-v2'));
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(saved)) {
      if (saved[k] !== undefined && saved[k] !== null) state[k] = saved[k];
    }
  }
} catch {}

// Ensure arrays
state.stock = Array.isArray(state.stock) ? state.stock : [];
state.farm = Array.isArray(state.farm) ? state.farm : [];
for (let i = 0; i < products.length; i++) {
  state.stock[i] = Math.max(0, Number(state.stock[i]) || 0);
  state.farm[i] = Math.max(0, Number(state.farm[i]) || 0);
}
state.done = Array.isArray(state.done) ? state.done : [];
state.milestones = Array.isArray(state.milestones) ? state.milestones : [];
state.shelfLevels = state.shelfLevels || {};
state.prodSettings = state.prodSettings || {};
state.machines = state.machines || {};
state.operations = { registers: 1, scanner: 0, transport: 0, frentistas: 0, ...(state.operations || {}) };
state.specialists = state.specialists || {};
state.specialistWorkers = state.specialistWorkers || {};
state.layoutPositions = state.layoutPositions || {};
state.productionSites = state.productionSites || {};
state.manualStocked = state.manualStocked || 0;
state.manualFed = state.manualFed || 0;

function save() {
  if (state.resetPending) return;
  try {
    localStorage.setItem('meu-posto-v2', JSON.stringify({
      ...state,
      carried: [...player.bag],
      position: { x: player.x, y: player.y },
      layoutVersion: 1
    }));
  } catch {}
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').style.opacity = 1;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $('toast').style.opacity = 0, 2500);
}

function celebrate(message) {
  $('reward').textContent = message;
  $('reward').style.opacity = 1;
  clearTimeout(celebrate._t);
  celebrate._t = setTimeout(() => $('reward').style.opacity = 0, 4000);
  for (let i = 0; i < 12; i++) {
    pop(player.x + (Math.random() - .5) * 160, player.y - Math.random() * 80,
      ['✦', '★', '+'][i % 3], ['#ffd700', '#e74c3c', '#27ae60'][i % 3]);
  }
}

function pop(x, y, text, color = '#ffd700') {
  particles.push({ x, y, text, color, life: 1.3 });
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function move(p, x, y, dt, speed = 160) {
  let d = Math.hypot(x - p.x, y - p.y);
  if (d > 2) {
    let step = Math.min(d, speed * dt);
    p.x += (x - p.x) / d * step;
    p.y += (y - p.y) / d * step;
  }
  return d < 10;
}

// --- Zones and Stands ---
const zones = [];  // extraction/production zones
const stands = []; // fuel pumps / shelves

// Base zones: oil well and refinery
zones[0] = { x: 130, y: 450, w: 120, h: 90, type: 0, name: 'POÇO DE GASOLINA', color: '#1e3a5f' };

// Base pump
stands.push({ x: 430, y: 180, w: 110, h: 55, type: 0 }); // Gasolina Comum

// Register/till position
const till = { x: 680, y: 380 };

// --- Recipes ---
// input: {itemIndex: quantity} -> yields product
const recipes = {
  1: { input: { 12: 1 }, seconds: 6, yield: 2, name: 'Refino de gasolina aditivada' },
  2: { input: { 13: 2 }, seconds: 6, yield: 2, name: 'Destilação de etanol' },
  3: { input: { 12: 2 }, seconds: 8, yield: 2, name: 'Refino de diesel' },
  4: { input: { 12: 1, 14: 1 }, seconds: 7, yield: 2, name: 'Produção de GNV' },
  5: { input: { 14: 2 }, seconds: 8, yield: 2, name: 'Geração de energia elétrica' },
  6: { input: { 14: 1 }, seconds: 5, yield: 2, name: 'Refrigerantes' },
  7: { input: { 12: 1 }, seconds: 6, yield: 2, name: 'Snacks processados' },
  8: { input: { 14: 1, 13: 1 }, seconds: 5, yield: 2, name: 'Café especial' },
  9: { input: { 12: 2 }, seconds: 10, yield: 2, name: 'Lubrificação' },
  10: { input: { 14: 1 }, seconds: 4, yield: 3, name: 'Água mineral' },
  11: { input: { 14: 2 }, seconds: 8, yield: 2, name: 'Sorvetes' },
};

// Initialize machines
for (const i of Object.keys(recipes).map(Number)) {
  state.machines[i] = state.machines[i] || { inputs: {}, remaining: 0 };
  const m = state.machines[i];
  m.inputs = m.inputs || {};
  m.remaining = Math.max(0, Number(m.remaining) || 0);
  for (const k of Object.keys(recipes[i].input)) {
    m.inputs[k] = Math.max(0, Math.floor(Number(m.inputs[k]) || 0));
  }
}

function rawMaterial(i) { return [12, 13, 14].includes(i); }
function available(i) {
  if (i === 0) return true;
  if (i === 12) return true; // Petróleo bruto sempre disponível
  if (i === 13) return !!(state.etanol || state.cafe);
  if (i === 14) return !!(state.gnv || state.eletrica || state.bebidas || state.cafe || state.agua || state.sorvete);
  if (i >= products.length) return false;
  return !!state[products[i]?.key];
}
function isFuel(i) { return i <= 5; }
function isConvenience(i) { return i >= 6 && i <= 11; }

// --- Shelf/Pump Limits ---
function shelfCapacity(tier) { return [16, 28, 44, 64, 88, 120][tier] || (120 + (tier - 5) * 40); }
function shelfLevel(i) { return state.shelfLevels?.[i] || 0; }
function shelfLimit(i) { return shelfCapacity(shelfLevel(i)); }
function shelfUpgradeCost(i) {
  const lvl = shelfLevel(i);
  return lvl >= 5 ? null : Math.round(55 * Math.pow(1.9, lvl));
}

// --- Farm/Extraction Limits ---
function defaultCapacity(i) {
  if (i === 12) return 10;
  if (i === 13) return 8;
  if (i === 14) return 10;
  return 10;
}
function farmLimit(i) {
  const p = state.prodSettings?.[i];
  return Math.ceil((p?.baseCapacity || defaultCapacity(i)) * (1 + .5 * (p?.capacity || 0)));
}
function cropRate(i) {
  const p = state.prodSettings?.[i];
  return (p?.baseRate || .6) * (1 + .35 * (p?.speed || 0));
}
function productionMultiplier(i) { return 1 + .35 * (state.prodSettings?.[i]?.speed || 0); }
function inputLimit(i) { return (state.prodSettings?.[i]?.baseInputs || 2) + 2 * (state.prodSettings?.[i]?.inputs || 0); }

// Init prodSettings for available items
for (let i = 0; i < products.length; i++) {
  if (!state.prodSettings[i]) {
    state.prodSettings[i] = {
      speed: 0, capacity: 0, inputs: 0,
      baseCapacity: defaultCapacity(i),
      baseRate: .6,
      baseInputs: 2
    };
  }
}

// --- Map Layout ---
function arrangeMap() {
  // POÇO zone for Gasolina Comum (fixed position)
  zones[0] = { x: 130, y: 450, w: 120, h: 90, type: 0, name: 'POÇO DE GASOLINA', color: '#1e3a5f' };

  // Raw material extraction zones
  let extIdx = 0;
  for (let i = 12; i <= 14; i++) {
    if (!available(i)) continue;
    zones[i] = zones[i] || {};
    zones[i].x = 130 - Math.floor(extIdx / 2) * 200;
    zones[i].y = 600 + (extIdx % 2) * 160;
    zones[i].w = 120;
    zones[i].h = 90;
    zones[i].type = i;
    zones[i].name = products[i].name;
    zones[i].color = '#2a4a2a';
    extIdx++;
  }

  // Recipe product machine zones (refinery/shop area)
  let machineIdx = 0;
  for (let i = 1; i <= 11; i++) {
    if (!available(i) || !recipes[i]) continue;
    zones[i] = zones[i] || {};
    if (isFuel(i)) {
      // Fuel machines in refinery area
      zones[i].x = 100 + (machineIdx % 3) * 110;
      zones[i].y = 600 + Math.floor(machineIdx / 3) * 110;
      zones[i].color = '#4a3728';
    } else {
      // Convenience store machines in shop area
      zones[i].x = 350 + ((machineIdx - fuelCount()) % 3) * 100;
      zones[i].y = 560 + Math.floor((machineIdx - fuelCount()) / 3) * 100;
      zones[i].color = '#3a2a4a';
    }
    zones[i].w = 90;
    zones[i].h = 70;
    zones[i].type = i;
    zones[i].name = products[i].name + ' (Máquina)';
    machineIdx++;
  }

  // Pump stands for all available products
  let pumpIdx = 0;
  for (let i = 0; i < products.length; i++) {
    if (!available(i) || rawMaterial(i)) continue;
    stands[i] = stands[i] || {};
    stands[i].x = 430 + Math.floor(pumpIdx / 3) * 180;
    stands[i].y = 150 + (pumpIdx % 3) * 120;
    stands[i].w = 110;
    stands[i].h = 55;
    stands[i].type = i;
    pumpIdx++;
  }
}

function fuelCount() {
  return Object.keys(recipes).map(Number).filter(i => isFuel(i) && available(i)).length;
}

function applyEffects() {
  arrangeMap();
  state.expansion = state.eletrica ? 5 : state.gnv ? 4 : state.diesel ? 3 : state.etanol ? 2 : state.aditivada ? 1 : 0;
  state.capacity = Math.max(state.capacity, state.tanque_pro ? 24 : state.tanque_medio ? 14 : state.tanque ? 10 : 6);
}
applyEffects();

// Load position
if (state.position && Number.isFinite(state.position.x)) {
  player.x = state.position.x;
  player.y = state.position.y;
}
if (Array.isArray(state.carried)) {
  player.bag = state.carried.filter(i => Number.isInteger(i) && i >= 0 && i < products.length).slice(0, state.capacity);
}

// --- Progression Steps ---
const steps = [
  // Chapter 0: Primeiros Passos
  { id: 'diesel', title: 'Instalar bomba de diesel', cost: 60, chapter: 0,
    desc: 'Libera diesel. Extraia petróleo bruto para produzir.', minSales: 8 },
  { id: 'tanque', title: 'Tanque de combustível', cost: 50, chapter: 0,
    desc: 'Carregue 10 litros por viagem.' },
  { id: 'cashier', title: 'Contratar frentista Lucas', cost: 80, chapter: 0,
    desc: 'Lucas recebe pagamentos. Você foca na produção.', minSales: 15, manualStock: 10 },
  { id: 'etanol', title: 'Instalar bomba de etanol', cost: 90, chapter: 0,
    desc: 'Bomba no posto e extração de biomassa.', minSales: 20 },
  // Chapter 1: Expansão Básica
  { id: 'expansion1', title: 'Expandir o poço', cost: 100, chapter: 1,
    desc: 'Poço maior: mais capacidade de extração.' },
  { id: 'frentista1', title: 'Contratar frentista Bento', cost: 120, chapter: 1,
    desc: 'Bento extrai e transporta combustível automaticamente.', minSales: 40 },
  { id: 'tanque_medio', title: 'Tanque profissional', cost: 90, chapter: 1,
    desc: 'Carregue 14 litros por viagem.' },
  { id: 'gnv', title: 'Instalar ponto de GNV', cost: 150, chapter: 1,
    desc: 'GNV: gás natural veicular. $6 por m³.', minSales: 50 },
  { id: 'shelves1', title: 'Ampliar bombas (nível 2)', cost: 130, chapter: 1,
    desc: 'Todas as bombas passam de 16 para 28 unidades.', optional: true },
  // Chapter 2: Combustíveis Premium
  { id: 'aditivada', title: 'Instalar gasolina aditivada', cost: 180, chapter: 2,
    desc: 'Gasolina aditivada por $8/litro.', minSales: 70 },
  { id: 'expansion2', title: 'Expandir: ala premium', cost: 220, chapter: 2,
    desc: 'Novas bombas e ampliação da extração.' },
  { id: 'frentista2', title: 'Contratar frentista Nico', cost: 200, chapter: 2,
    desc: 'Nico também extrai e transporta.', minSales: 90 },
  { id: 'eletrica', title: 'Instalar carregador elétrico', cost: 280, chapter: 2,
    desc: 'Energia elétrica: $10/recarga. O futuro!', minSales: 110 },
  // Chapter 3: Loja de Conveniência
  { id: 'bebidas', title: 'Abrir loja: bebidas', cost: 250, chapter: 3,
    desc: 'Bebidas na loja de conveniência. $8 cada.' },
  { id: 'snacks', title: 'Vender snacks', cost: 200, chapter: 3,
    desc: 'Snacks e guloseimas. $6 cada.' },
  { id: 'cafe', title: 'Instalar cafeteria', cost: 230, chapter: 3,
    desc: 'Café fresco para os motoristas. $5 cada.' },
  { id: 'tanque_pro', title: 'Tanque de atacadista', cost: 180, chapter: 3,
    desc: 'Carregue até 24 litros por viagem.' },
  { id: 'shelves2', title: 'Bombas de grande porte', cost: 350, chapter: 3,
    desc: 'Todas as bombas comportam 64 unidades.', optional: true },
  // Chapter 4: Serviços Automotivos
  { id: 'oleo', title: 'Oficina de lubrificação', cost: 400, chapter: 4,
    desc: 'Óleo lubrificante por $15. Serviço premium.' },
  { id: 'agua', title: 'Ponto de água mineral', cost: 180, chapter: 4,
    desc: 'Água mineral barata e popular. $4 cada.' },
  { id: 'sorvete', title: 'Sorveteria', cost: 300, chapter: 4,
    desc: 'Sorvetes artesanais. $7 cada.' },
  { id: 'expansion3', title: 'Expandir: posto completo', cost: 500, chapter: 4,
    desc: 'Área máxima de extração e bombas.' },
  { id: 'frentista3', title: 'Contratar frentista Bia', cost: 400, chapter: 4,
    desc: 'Terceira frentista para escala 24h.', minSales: 200 },
  // Chapter 5: Grande Posto
  { id: 'shelves3', title: 'Bombas industriais', cost: 600, chapter: 5,
    desc: 'Capacidade de 88 unidades por bomba.', optional: true },
  { id: 'logistics', title: 'Logística avançada', cost: 700, chapter: 5,
    desc: 'Frentistas andam mais rápido. Transporte otimizado.' },
  { id: 'scanner', title: 'Pagamento rápido', cost: 500, chapter: 5,
    desc: 'Scanner e NFC: pagamentos 3x mais rápidos.' },
  { id: 'grand', title: 'Inaugurar o Grande Posto', cost: 1000, chapter: 5,
    desc: 'Conclua o jogo! Bônus de $500. Continue expandindo!' },
  // Chapter 6: Império
  { id: 'extra_registers', title: 'Abrir segundo caixa', cost: 800, chapter: 6,
    desc: 'Duas filas de atendimento. Menos espera.' },
  { id: 'treinamento', title: 'Treinar toda a equipe', cost: 1200, chapter: 6,
    desc: 'Todos os frentistas 50% mais rápidos.' },
  { id: 'hypermarket', title: 'Rede de postos', cost: 2000, chapter: 6,
    desc: 'Sistema de metas operacionais com bônus.' },
];

const chapters = [
  { name: 'Primeiros Passos' },
  { name: 'Expansão Básica' },
  { name: 'Combustíveis Premium' },
  { name: 'Loja de Conveniência' },
  { name: 'Serviços Automotivos' },
  { name: 'Grande Posto' },
  { name: 'Império dos Postos' },
];

// Ensure all steps have chapter
for (const s of steps) if (s.chapter === undefined) s.chapter = 0;

function nextStep() { return steps.find(s => !s.optional && !state.done.includes(s.id)); }
function level() { const n = nextStep(); return n ? 1 + (n.chapter || 0) : chapters.length; }

// --- Resize ---
function resize() {
  W = innerWidth; H = innerHeight;
  canvas.width = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  scale = Math.max(.2, Math.min((W - 32) / 940, (H - 250) / 610));
  ox = (W - 940 * scale) / 2;
  oy = 80 + Math.max(0, (H - 250 - 610 * scale) / 2);
}
addEventListener('resize', resize);
resize();

// --- Camera ---
function worldLeft() { return Math.min(0, ...zones.filter(z => available(z.type)).map(z => z.x - 150)); }
function worldRight() {
  return Math.max(900,
    ...stands.filter(s => available(s.type)).map(s => s.x + 150),
    till.x + 200 + ((state.operations.registers || 1) - 1) * 200);
}
function worldBottom() {
  return Math.max(600,
    ...zones.filter(z => available(z.type)).map(z => z.y + 180),
    ...stands.filter(s => available(s.type)).map(s => s.y + 180),
    till.y + 200);
}
function cameraX() { return Math.max(worldLeft(), Math.min(worldRight() - 940, player.x - 470)); }
function cameraY() { return Math.max(0, Math.min(worldBottom() - 610, player.y - 320)); }

// --- Drawing Helpers ---
function rect(x, y, w, h, color, r = 8) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
function ellipse(x, y, rx, ry, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 7);
  ctx.fill();
}
function text(t, x, y, size = 14, color = '#c8d6e5') {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px system-ui`;
  ctx.textAlign = 'center';
  ctx.fillText(t, x, y);
}
function fitText(value, x, y, width, size = 13, color = '#c8d6e5') {
  ctx.font = `700 ${size}px system-ui`;
  const words = value.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (line && ctx.measureText(candidate).width > width) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((t, n) => text(t, x, y + n * (size + 2), size, color));
}

// --- Draw Car ---
function drawCar(p, isPlayer = false) {
  const bob = Math.sin(time * 6 + p.x) * 1;
  const w = 52, h = 22;
  const cx = p.x, cy = p.y + bob;

  // Shadow
  ellipse(cx, cy + 16, 28, 8, '#0d1f2d40');

  // Car body
  rect(cx - w / 2, cy - h, w, h, p.color || '#e74c3c', 6);
  // Roof/cabin
  rect(cx - w / 4, cy - h - 12, w / 2, 14, shadeColor(p.color || '#e74c3c', -30), 4);
  // Windshield
  rect(cx - w / 4 + 3, cy - h - 10, w / 2 - 6, 10, '#7ec8e3', 3);

  // Wheels
  ellipse(cx - 16, cy + 4, 7, 7, '#1a2d45');
  ellipse(cx + 16, cy + 4, 7, 7, '#1a2d45');
  ellipse(cx - 16, cy + 4, 4, 4, '#4a6785');
  ellipse(cx + 16, cy + 4, 4, 4, '#4a6785');

  // Headlights
  rect(cx + w / 2 - 4, cy - h + 3, 4, 6, '#ffd700', 2);
  rect(cx - w / 2, cy - h + 3, 4, 6, '#ffd700', 2);

  if (isPlayer) {
    text('VOCÊ', cx, cy - 30, 11, '#ffd700');
    // Show carried items
    for (let i = 0; i < player.bag.length; i++) {
      text(products[player.bag[i]].icon, cx + 28 + (i % 3) * 10, cy - 5 - Math.floor(i / 3) * 10, 14);
    }
  }
}

function shadeColor(color, amount) {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xFF) + amount));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// --- Draw Person (for staff/frentistas) ---
function drawPerson(p) {
  const bob = Math.sin(time * 9 + p.x) * 2;
  ellipse(p.x, p.y + 10, 16, 7, '#0d1f2d30');
  rect(p.x - 10, p.y - 18 + bob, 20, 26, p.color || '#69a7ea', 8);
  rect(p.x - 8, p.y + 2, 6, 10, '#2d4a6f', 3);
  rect(p.x + 2, p.y + 2, 6, 10, '#2d4a6f', 3);
  ellipse(p.x, p.y - 26 + bob, 10, 11, '#ffd5b0');
  ellipse(p.x, p.y - 34 + bob, 10, 5, '#664c40');
}

// --- Draw Fuel Pump ---
function drawPump(s) {
  const i = s.type;
  if (!available(i) || rawMaterial(i)) return;
  const on = available(i);

  // Pump body
  rect(s.x - 55, s.y - 28, 110, 66, '#1a2d45', 6);
  rect(s.x - 50, s.y - 38, 100, 48, on ? '#2d4a6f' : '#4a6785', 4);
  // Display
  rect(s.x - 30, s.y - 34, 60, 20, '#0a1929', 4);
  text(products[i].icon + ' ' + products[i].name, s.x, s.y - 60, 12);
  text('$' + products[i].price, s.x, s.y - 47, 10, '#7f8c8d');

  // Stock display
  const stock = state.stock[i];
  const limit = shelfLimit(i);
  if (on) {
    // Fuel level bar
    rect(s.x - 25, s.y - 32, 50 * (stock / Math.max(1, limit)), 16, isFuel(i) ? '#27ae60' : '#ffd700', 3);
    text(stock + '/' + limit, s.x, s.y + 5, 12);
  }

  // Pump nozzle hose
  ctx.strokeStyle = on ? '#4a6785' : '#2d4a6f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.x + 45, s.y - 25);
  ctx.quadraticCurveTo(s.x + 65, s.y - 10, s.x + 55, s.y + 10);
  ctx.stroke();

  // Nozzle
  if (on) {
    rect(s.x + 50, s.y + 6, 10, 8, '#ffd700', 3);
  }
}

// --- Draw Extraction Zone ---
function drawZone(z) {
  if (!available(z.type)) {
    rect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h, '#2d4a6f', 10);
    text('🔒', z.x, z.y, 24);
    return;
  }

  // Zone background
  rect(z.x - z.w / 2, z.y - z.h / 2 + 4, z.w, z.h, '#0f2338', 10);
  rect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h, z.color, 10);

  const stock = Math.floor(state.farm[z.type]);

  if (recipes[z.type] && !rawMaterial(z.type)) {
    // Recipe product zone - show machine status
    const m = state.machines[z.type];
    const r = recipes[z.type];

    text(products[z.type].icon, z.x, z.y - 18, 20);

    if (m.remaining > 0) {
      // Producing - progress bar
      const pct = 1 - m.remaining / r.seconds;
      rect(z.x - 30, z.y + 2, 60, 8, '#1a2d45', 3);
      rect(z.x - 30, z.y + 2, 60 * pct, 8, '#f39c12', 3);
      text('⟳ ' + Math.ceil(m.remaining / productionMultiplier(z.type)) + 's', z.x, z.y + 22, 10, '#f39c12');
    } else {
      // Show input status
      const inputStr = Object.entries(r.input).map(([k, n]) =>
        products[k].icon + (m.inputs[k] || 0) + '/' + n
      ).join(' ');
      text(inputStr, z.x, z.y + 10, 9);

      const ready = Object.entries(r.input).every(([k, n]) => m.inputs[k] >= n);
      if (ready) text('✓ Pronto!', z.x, z.y + 22, 10, '#27ae60');
      else text(machineLabel(z.type), z.x, z.y + 22, 9, '#e74c3c');
    }

    // Output stock
    text(stock + ' pronto', z.x, z.y + z.h / 2 + 16, 10, '#7f8c8d');
    fitText(z.name, z.x, z.y + z.h / 2 + 32, z.w + 40, 10);
  } else {
    // Raw material or direct product zone
    for (let i = 0; i < Math.min(12, stock); i++) {
      const ix = z.x - 35 + (i % 4) * 22;
      const iy = z.y - 20 + Math.floor(i / 4) * 22;
      text(products[z.type].icon, ix, iy + 5, 18);
    }
    fitText(z.name, z.x, z.y + z.h / 2 + 18, 200, 11);
    text(stock + '/' + farmLimit(z.type) + ' disponível', z.x, z.y + z.h / 2 + 36, 10, '#7f8c8d');
  }
}

// --- Draw Shop/Convenience Store ---
function drawShop() {
  const shopX = 380, shopY = 440, shopW = 200, shopH = 100;

  // Building
  rect(shopX - shopW / 2, shopY - shopH / 2 + 10, shopW, shopH, '#1a2d45', 12);
  rect(shopX - shopW / 2, shopY - shopH / 2, shopW, shopH - 10, '#2d4a6f', 12);

  // Roof
  rect(shopX - shopW / 2 - 5, shopY - shopH / 2 - 12, shopW + 10, 16, '#27ae60', 6);

  // Sign
  rect(shopX - 50, shopY - shopH / 2 - 8, 100, 12, '#ffd700', 4);
  text('CONVENIÊNCIA', shopX, shopY - shopH / 2, 9, '#1a3a5c');

  // Door
  rect(shopX - 12, shopY + 10, 24, 30, '#0d1f2d', 4);
  rect(shopX - 10, shopY + 12, 20, 26, '#1e3a5f', 3);

  // Windows
  rect(shopX - 70, shopY - 20, 30, 20, '#7ec8e340', 4);
  rect(shopX + 40, shopY - 20, 30, 20, '#7ec8e340', 4);
}

// --- Draw Refinery ---
function drawRefinery() {
  const rx = 50, ry = 580;

  // Refinery building
  rect(rx - 60, ry - 40, 120, 80, '#4a3728', 8);
  rect(rx - 50, ry - 35, 100, 70, '#5c4a3a', 6);

  // Chimney with smoke if any machine is active
  const anyActive = Object.keys(recipes).map(Number).some(i => available(i) && state.machines[i]?.remaining > 0);
  rect(rx + 20, ry - 70, 16, 35, '#3a2a1a', 4);
  if (anyActive) {
    for (let s = 0; s < 3; s++) {
      const sy = ry - 74 - s * 12 - Math.sin(time * 3 + s) * 4;
      ellipse(rx + 28 + Math.sin(time * 2 + s * 2) * 5, sy, 6 + s * 3, 4 + s * 2, '#88888830');
    }
  }

  // Tanks
  ellipse(rx - 30, ry, 18, 12, '#4a6785');
  ellipse(rx + 10, ry, 18, 12, '#4a6785');

  text('REFINARIA', rx, ry + 55, 11, '#7ec8e3');

  // Show active machine summary
  const active = Object.keys(recipes).map(Number).filter(i => available(i));
  if (active.length > 0) {
    const summary = active.map(i => products[i].icon).join('');
    text(summary, rx, ry + 70, 10, '#7f8c8d');
  }
}

// --- Draw Road ---
function drawRoad() {
  // Road surface
  rect(worldLeft() - 50, 60, worldRight() - worldLeft() + 100, 55, '#3a3a3a', 0);
  // Lane markings
  for (let x = worldLeft() - 30; x < worldRight() + 30; x += 40) {
    rect(x, 86, 20, 4, '#ffd700', 2);
  }
  // Road edges
  rect(worldLeft() - 50, 58, worldRight() - worldLeft() + 100, 3, '#ffffff30', 0);
  rect(worldLeft() - 50, 113, worldRight() - worldLeft() + 100, 3, '#ffffff30', 0);
}

// --- Draw Registers ---
function drawRegisters() {
  for (let i = 0; i < state.operations.registers; i++) {
    const r = registerAt(i);
    // Counter
    rect(r.x - 60, r.y - 25, 120, 55, '#1a2d45', 8);
    rect(r.x - 65, r.y - 32, 130, 38, '#ffd700', 6);
    // Screen
    rect(r.x + 8, r.y - 29, 38, 24, '#2d4a6f', 4);
    // Label
    text('CAIXA ' + (i + 1), r.x, r.y + 50, 12);
    // Cashier
    if (i === 0 && state.cashier) {
      drawPerson({ x: r.x + 45, y: r.y + 15, color: '#7392d3' });
      text('LUCAS', r.x + 45, r.y - 25, 10, '#7392d3');
    }
    // Queue count
    const waiting = customers.filter(c => c.phase === 'pay' && c.register === i).length;
    text(waiting + ' na fila', r.x, r.y - 48, 10);
  }
}

function registerAt(i) {
  return state.layoutPositions?.['register:' + i] ||
    { x: 680 + i * 200, y: Math.max(380, 230 + Math.min(stands.filter(s => available(s.type)).length, 4) * 120 + 80) };
}

function entranceAt() {
  return state.layoutPositions?.entrance || { x: 700, y: 90 };
}

// --- Main Draw ---
function draw() {
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#1a2d45';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.translate(-cameraX(), -cameraY());

  // Ground
  const wl = worldLeft() - 60, wr = worldRight() + 60;
  rect(wl, 115, wr - wl, worldBottom() - 80, '#2a4a3a', 0);

  // Concrete area for station
  rect(350, 120, wr - 360, worldBottom() - 140, '#3a3a3a', 16);

  // Extraction area
  rect(wl, 350, 250, worldBottom() - 370, '#2a3a2a', 16);

  // Draw road
  drawRoad();

  // Sector labels
  text('ÁREA DE EXTRAÇÃO', wl + 125, 370, 12, '#7ec8e3');
  text('POSTO DE GASOLINA', (380 + wr) / 2, 140, 13, '#ffd700');

  // Draw zones
  for (const z of zones) {
    if (z.type < products.length && available(z.type)) drawZone(z);
  }

  // Draw refinery
  drawRefinery();

  // Draw shop
  drawShop();

  // Draw pumps
  for (const s of stands) drawPump(s);

  // Draw registers
  drawRegisters();

  // Draw entrance
  const ent = entranceAt();
  rect(ent.x - 45, ent.y - 10, 90, 16, '#ffd700', 3);
  text('ENTRADA', ent.x, ent.y + 20, 12);

  // Draw staff/frentistas
  for (const w of staff) {
    if (!state[w.key]) continue;
    drawPerson(w);
    text(w.name, w.x, w.y - 42, 10, w.color);
    if (w.bag.length) text(products[w.bag[0]].icon + ' ×' + w.bag.length, w.x + 22, w.y - 15, 13);
  }

  // Draw customers (sorted by Y)
  const allCars = [...customers, { ...player, isPlayer: true }].sort((a, b) => a.y - b.y);
  for (const p of allCars) {
    if (p.isPlayer) drawCar(player, true);
    else drawCar(p);
  }

  // Draw particles
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life);
    text(p.text, p.x, p.y, 18, p.color);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

// --- Customer System ---
const carColors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e84393', '#00cec9', '#6c5ce7'];

function saleTypes() {
  return products.map((_, i) => i).filter(i => !rawMaterial(i) && available(i));
}

function chooseProduct() {
  const unlocked = saleTypes();
  const stocked = unlocked.filter(i => state.stock[i] > 0);
  const list = stocked.length && Math.random() < .75 ? stocked : unlocked;
  return list[Math.floor(Math.random() * list.length)];
}

function makeShoppingList() {
  const all = saleTypes();
  const count = Math.min(all.length, 1 + Math.floor(Math.random() * 3));
  const list = [];
  const used = new Set();
  for (let n = 0; n < count; n++) {
    let type;
    do { type = all[Math.floor(Math.random() * all.length)]; } while (used.has(type));
    used.add(type);
    list.push({ type, quantity: 1 + Math.floor(Math.random() * 2), picked: 0 });
  }
  return list;
}

function makeCustomer() {
  const ent = entranceAt();
  return {
    x: ent.x + 100, y: 90,
    targetY: ent.y - 50,
    list: makeShoppingList(),
    index: 0,
    cart: [],
    phase: 'enter', // enter -> shop -> pay -> exit
    color: carColors[Math.floor(Math.random() * carColors.length)],
    wait: 0, pickClock: 0, paid: false, register: 0,
    queueTicket: 0
  };
}

function cartTotal(c) { return c.cart.reduce((sum, i) => sum + products[i].price, 0); }

let queueSequence = 0;

function chooseRegister() {
  let best = 0, bestLoad = Infinity;
  for (let i = 0; i < state.operations.registers; i++) {
    const load = customers.filter(c => c.phase === 'pay' && c.register === i).length;
    if (load < bestLoad) { bestLoad = load; best = i; }
  }
  return best;
}

function nextAisle(c) {
  c.index++;
  c.wait = 0;
  if (c.index >= c.list.length) {
    c.phase = c.cart.length ? 'pay' : 'exit';
    if (c.phase === 'pay') {
      c.queueTicket = ++queueSequence;
      c.register = chooseRegister();
    }
  }
}

function checkout(c) {
  if (c.paid || c.phase !== 'pay' || !c.cart.length) return false;
  const total = cartTotal(c);
  state.money += total;
  state.sold += c.cart.length;
  state.orders = (state.orders || 0) + 1;
  state.lastReceipt = { items: c.cart.length, total };
  c.paid = true;
  c.phase = 'exit';
  const reg = registerAt(c.register || 0);
  pop(reg.x, reg.y - 40, '+$ ' + total + ' · ' + c.cart.length + ' itens');
  return true;
}

function shopTick(dt) {
  spawn -= dt;
  if (spawn <= 0 && customers.length < Math.min(20, 6 + state.expansion * 2)) {
    spawn = Math.max(1.5, 4 - state.expansion * 0.3);
    customers.push(makeCustomer());
  }

  let queue = 0;
  for (const c of customers) {
    if (c.phase === 'enter') {
      // Drive from road to shop area
      const target = { x: entranceAt().x + Math.random() * 40 - 20, y: 130 };
      if (move(c, target.x, target.y, dt, 200)) {
        c.phase = 'shop';
      }
    } else if (c.phase === 'shop') {
      const item = c.list[c.index];
      if (!item) { nextAisle(c); continue; }
      const s = stands[item.type];
      if (!s) { nextAisle(c); continue; }
      const approach = { x: s.x, y: s.y + 80 };
      if (move(c, approach.x, approach.y, dt, 130)) {
        c.pickClock -= dt;
        if (state.stock[item.type] > 0 && c.pickClock <= 0) {
          state.stock[item.type]--;
          c.cart.push(item.type);
          item.picked++;
          c.wait = 0;
          c.pickClock = 0.4;
          if (item.picked >= item.quantity) nextAisle(c);
        } else if (state.stock[item.type] === 0) {
          c.wait += dt;
          if (c.wait > 10) nextAisle(c);
        }
      }
    } else if (c.phase === 'pay') {
      const reg = registerAt(c.register || 0);
      const qx = reg.x - 40;
      const qy = reg.y - 80 - queue * 45;
      if (move(c, qx, qy, dt, 120)) {
        // At front of queue and cashier available?
        if (queue === 0 && (state.cashier || dist(player, reg) < 120)) {
          checkout(c);
        }
      }
      queue++;
    } else if (c.phase === 'exit') {
      const ent = entranceAt();
      move(c, ent.x, ent.y + 30, dt, 180);
    }
  }

  // Remove customers that exited
  for (let i = customers.length - 1; i >= 0; i--) {
    if (customers[i].phase === 'exit') {
      const ent = entranceAt();
      if (dist(customers[i], { x: ent.x, y: ent.y + 30 }) < 15) customers.splice(i, 1);
    }
  }
}

// --- Staff / Frentistas ---
const staff = [
  { x: 380, y: 400, color: '#69a7ea', name: 'LUCAS', key: 'cashier', bag: [], task: null },
  { x: 250, y: 400, color: '#bd80d9', name: 'BENTO', key: 'frentista1', bag: [], task: null },
  { x: 300, y: 450, color: '#6ebcad', name: 'NICO', key: 'frentista2', bag: [], task: null },
  { x: 350, y: 500, color: '#e9a460', name: 'BIA', key: 'frentista3', bag: [], task: null },
];

function work(dt) {
  const speed = state.treinamento ? 230 : (state.logistics ? 200 : 165);
  const cap = state.treinamento ? 10 : 5;

  for (const w of staff) {
    if (!state[w.key]) continue;
    if (w.key === 'cashier') continue; // Lucas stays at register

    // If no task, find one
    if (!w.task) {
      w.task = findStaffTask(w);
    }
    if (!w.task) continue;

    executeStaffTask(w, dt, speed, cap);
  }
}

// --- Resource Growth ---
function growCrops(dt) {
  for (let i = 0; i < products.length; i++) {
    if (!available(i)) continue;
    if (!rawMaterial(i) && i !== 0) continue; // Only raw materials and direct products auto-grow
    state.farm[i] = Math.min(farmLimit(i), state.farm[i] + dt * cropRate(i));
  }
}

// --- Machine Tick (Production) ---
function machineTick(dt) {
  for (const i of Object.keys(recipes).map(Number)) {
    if (!available(i)) continue;
    const m = state.machines[i], r = recipes[i];
    if (m.remaining > 0) {
      m.remaining = Math.max(0, m.remaining - dt * productionMultiplier(i));
      if (m.remaining === 0) {
        state.farm[i] += r.yield;
        pop(zones[i]?.x || 400, (zones[i]?.y || 400) - 30, '+' + r.yield + ' ' + products[i].icon);
      }
    } else {
      // Check if can start
      if (state.farm[i] + r.yield <= farmLimit(i) &&
          Object.entries(r.input).every(([k, n]) => m.inputs[k] >= n)) {
        for (const [k, n] of Object.entries(r.input)) m.inputs[k] -= n;
        m.remaining = r.seconds;
      }
    }
  }
}

function machineLabel(i) {
  const m = state.machines[i], r = recipes[i];
  if (m.remaining > 0) return 'Produzindo... ' + Math.ceil(m.remaining / productionMultiplier(i)) + 's';
  if (state.farm[i] + r.yield > farmLimit(i)) return 'Estoque cheio';
  const missing = Object.keys(r.input).filter(k => m.inputs[k] < r.input[k]);
  return missing.length ? 'Falta ' + missing.map(k => products[k]?.icon || '?').join(' + ') : 'Pronto para produzir';
}

// --- Input feeding ---
let manualClock = 0;
function manualInputs(dt) {
  manualClock -= dt;
  if (manualClock > 0) return;
  manualClock = 0.3;

  for (const i of Object.keys(recipes).map(Number)) {
    if (!available(i)) continue;
    const z = zones.find(z => z.type === i);
    if (!z || dist(player, z) > 90) continue;

    // Auto-feed from player bag
    const idx = player.bag.findIndex(item => recipes[i].input[item] && state.machines[i].inputs[item] < inputLimit(i));
    if (idx >= 0) {
      const item = player.bag[idx];
      state.machines[i].inputs[item]++;
      player.bag.splice(idx, 1);
      state.manualFed++;
      pop(z.x, z.y - 25, '+' + products[item].icon);
    }
  }
}

// --- Staff task finding ---
function findStaffTask(w) {
  // Priority 1: Stock pumps that are low from finished products in farm
  const needStock = saleTypes().filter(i => state.stock[i] < shelfLimit(i) && Math.floor(state.farm[i]) >= 1);
  if (needStock.length) {
    needStock.sort((a, b) => (state.stock[a] / shelfLimit(a)) - (state.stock[b] / shelfLimit(b)));
    return { type: 'stock_pump', product: needStock[0], phase: 'collect' };
  }

  // Priority 2: Feed machines that need raw materials
  for (const ri of Object.keys(recipes).map(Number)) {
    if (!available(ri)) continue;
    const m = state.machines[ri], r = recipes[ri];
    // Check if machine needs any input
    for (const [k, n] of Object.entries(r.input)) {
      const rawIdx = Number(k);
      if (m.inputs[k] < inputLimit(ri) && state.farm[rawIdx] >= 1) {
        return { type: 'feed_machine', machine: ri, raw: rawIdx, phase: 'fetch_raw' };
      }
    }
  }

  return null;
}

function executeStaffTask(w, dt, speed, cap) {
  const t = w.task;

  if (t.type === 'stock_pump') {
    if (t.phase === 'collect') {
      const z = zones.find(z => z.type === t.product);
      if (!z) { w.task = null; return; }
      if (move(w, z.x, z.y + 50, dt, speed)) {
        const maxCollect = Math.min(cap, Math.floor(state.farm[t.product]), shelfLimit(t.product) - state.stock[t.product]);
        if (maxCollect > 0) {
          state.farm[t.product] -= maxCollect;
          w.bag = Array(maxCollect).fill(t.product);
          t.phase = 'deliver';
        } else {
          w.task = null;
        }
      }
    } else if (t.phase === 'deliver') {
      const s = stands[t.product];
      if (!s) { w.bag = []; w.task = null; return; }
      if (move(w, s.x, s.y + 70, dt, speed)) {
        const count = Math.min(w.bag.length, shelfLimit(t.product) - state.stock[t.product]);
        if (count > 0) {
          state.stock[t.product] += count;
          w.bag.splice(0, count);
          pop(s.x, s.y - 30, '+' + count);
        }
        if (w.bag.length === 0) w.task = null;
        else { state.farm[t.product] += w.bag.length; w.bag = []; w.task = null; }
      }
    }
  } else if (t.type === 'feed_machine') {
    if (t.phase === 'fetch_raw') {
      const z = zones.find(z => z.type === t.raw);
      if (!z) { w.task = null; return; }
      if (move(w, z.x, z.y + 50, dt, speed)) {
        const maxCollect = Math.min(cap, Math.floor(state.farm[t.raw]));
        if (maxCollect > 0) {
          state.farm[t.raw] -= maxCollect;
          w.bag = Array(maxCollect).fill(t.raw);
          t.phase = 'feed';
        } else {
          w.task = null;
        }
      }
    } else if (t.phase === 'feed') {
      const z = zones.find(z => z.type === t.machine);
      if (!z) { w.bag.forEach(item => { state.farm[item] = (state.farm[item] || 0) + 1; }); w.bag = []; w.task = null; return; }
      if (move(w, z.x, z.y + 50, dt, speed)) {
        const m = state.machines[t.machine];
        const r = recipes[t.machine];
        let fed = 0;
        // Feed items from bag into machine
        while (w.bag.length > 0) {
          const item = w.bag[0];
          if (r.input[item] !== undefined && m.inputs[item] < inputLimit(t.machine)) {
            m.inputs[item]++;
            w.bag.shift();
            fed++;
          } else {
            break;
          }
        }
        if (fed > 0) pop(z.x, z.y - 25, '+' + fed + ' ' + products[t.raw].icon);
        // Return remaining to farm
        if (w.bag.length > 0) {
          w.bag.forEach(item => { state.farm[item] = (state.farm[item] || 0) + 1; });
          w.bag = [];
        }
        w.task = null;
      }
    }
  }
}

// --- Player Action Tick ---
function playerTick(dt) {
  action -= dt;
  if (action > 0) return;
  action = 0.25;

  // Pick up from extraction zones
  for (const z of zones) {
    if (!available(z.type)) continue;
    if (dist(player, z) < 80 && state.farm[z.type] >= 1 && player.bag.length < state.capacity) {
      state.farm[z.type]--;
      player.bag.push(z.type);
      pop(player.x, player.y - 40, products[z.type].icon);
      break;
    }
  }

  // Drop at pumps
  for (const s of stands) {
    if (!available(s.type) || rawMaterial(s.type)) continue;
    const idx = player.bag.indexOf(s.type);
    const dropPoint = { x: s.x, y: s.y + 70 };
    if (dist(player, dropPoint) < 60 && idx >= 0 && state.stock[s.type] < shelfLimit(s.type)) {
      player.bag.splice(idx, 1);
      state.stock[s.type]++;
      state.manualStocked++;
      pop(s.x, s.y - 30, '+1');
    }
  }

  // Drop raw materials at recipe zones (for manual input)
  for (const i of Object.keys(recipes).map(Number)) {
    if (!available(i)) continue;
    const z = zones.find(z => z.type === i);
    if (!z || dist(player, z) > 90) continue;
    const m = state.machines[i];
    const r = recipes[i];
    for (const [k, n] of Object.entries(r.input)) {
      const item = Number(k);
      const idx = player.bag.indexOf(item);
      if (idx >= 0 && m.inputs[item] < inputLimit(i)) {
        m.inputs[item]++;
        player.bag.splice(idx, 1);
        state.manualFed++;
        pop(z.x, z.y - 25, '+' + products[item].icon);
      }
    }
  }
}

// --- Milestones ---
function checkMilestones() {
  for (const m of [10, 30, 60, 100, 200, 500]) {
    if (state.sold >= m && !state.milestones.includes(m)) {
      state.milestones.push(m);
      const reward = Math.min(200, 15 + Math.floor(m / 3));
      state.money += reward;
      celebrate(m + ' vendas! Bônus de $' + reward);
      save();
    }
  }
}

// --- Main Game Tick ---
function tick(dt) {
  time += dt;

  // Player movement
  let dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  let dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  if (pointer) {
    dx = (pointer.cx - pointer.x) / 45;
    dy = (pointer.cy - pointer.y) / 45;
    if (Math.hypot(dx, dy) < .15) dx = dy = 0;
  }
  const len = Math.hypot(dx, dy);
  if (len) {
    const speed = state.tanque_pro ? 240 : state.tanque_medio ? 210 : 190;
    player.x += dx / Math.max(1, len) * speed * dt;
    player.y += dy / Math.max(1, len) * speed * dt;
  }
  player.x = Math.max(worldLeft() + 60, Math.min(worldRight() - 60, player.x));
  player.y = Math.max(130, Math.min(worldBottom() - 60, player.y));

  growCrops(dt);
  playerTick(dt);
  machineTick(dt);
  manualInputs(dt);
  work(dt);
  shopTick(dt);
  checkMilestones();

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].life -= dt;
    particles[i].y -= 25 * dt;
    if (particles[i].life <= 0) particles.splice(i, 1);
  }

  // Auto-save
  saveClock += dt;
  if (saveClock > 5) { save(); saveClock = 0; }

  updateUI();
}

// --- Frame Loop ---
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (!paused) tick(dt);
  draw();
  requestAnimationFrame(frame);
}

// --- UI Update ---
function updateUI() {
  $('money').textContent = '$ ' + state.money;
  $('bag').textContent = '🛢️ ' + player.bag.length + '/' + state.capacity;
  $('level').textContent = '★ Nível ' + level();

  const n = nextStep();
  $('nextUpgrade').disabled = !n;
  $('nextUpgrade').textContent = n ? 'E · ' + n.title + ' · $ ' + n.cost : '★ Posto completo!';
  $('nextUpgrade').style.background = n && state.money >= n.cost ? '#a4efac' : '#ffdb65';

  let instruction;
  if (state.sold === 0 && !state.done.length) {
    // Tutorial phase - guide through the basics
    if (player.bag.length === 0 && state.farm[0] < 1) {
      instruction = 'Aguarde o poço extrair gasolina... ⛽';
    } else if (player.bag.length === 0) {
      instruction = 'Vá ao POÇO (tecla G) para pegar gasolina 🛢️';
    } else if (state.stock[0] < shelfLimit(0)) {
      instruction = 'Leve a gasolina até a BOMBA (tecla B) e solte lá ⛽';
    } else {
      instruction = 'Fique perto do CAIXA (tecla M) para vender 💵';
    }
  } else {
    instruction = n ? n.title : 'Posto completo · ' + state.sold + ' vendas';
  }
  $('mission').innerHTML = n ?
    instruction + ' <span style="color:#7f8c8d">· $' + Math.min(state.money, n.cost) + ' / $' + n.cost + '</span>' +
    '<progress max="' + n.cost + '" value="' + Math.min(state.money, n.cost) + '"></progress>' :
    instruction;

  if ($('receipt')) {
    $('receipt').textContent = state.lastReceipt ?
      'Última venda: ' + state.lastReceipt.items + ' itens · $' + state.lastReceipt.total +
      ' | ' + (state.orders || 0) + ' clientes atendidos' : '';
  }
}

// --- Purchase System ---
function stepReady(step) {
  return state.sold >= (step.minSales || 0) && state.manualStocked >= (step.manualStock || 0) && state.manualFed >= (step.manualFeed || 0);
}

function stepRequirement(step) {
  const req = [];
  if (step.minSales) req.push(Math.min(state.sold, step.minSales) + '/' + step.minSales + ' vendas');
  if (step.manualStock) req.push(Math.min(state.manualStocked, step.manualStock) + '/' + step.manualStock + ' reposições');
  if (step.manualFeed) req.push(Math.min(state.manualFed, step.manualFeed) + '/' + step.manualFeed + ' alimentações');
  return req.length ? req.join(' · ') : 'Liberado';
}

function purchaseStep(id) {
  const next = nextStep();
  if (!next || next.id !== id) { toast('Conclua a melhoria anterior primeiro.'); return false; }
  if (state.money < next.cost) { toast('Faltam $' + (next.cost - state.money) + ' para ' + next.title); return false; }
  if (!stepReady(next)) { toast(stepRequirement(next)); return false; }

  const before = level();
  state.money -= next.cost;
  state[id] = true;
  state.done.push(id);

  // Apply effects
  if (id === 'tanque') state.capacity = 10;
  if (id === 'tanque_medio') state.capacity = 14;
  if (id === 'tanque_pro') state.capacity = 24;
  if (id === 'grand') state.money += 500;
  if (id === 'extra_registers') state.operations.registers = 2;
  if (id === 'scanner') state.operations.scanner = 3;
  if (id === 'logistics') state.operations.transport = 2;
  if (id === 'shelves1') {
    for (let i = 0; i < products.length; i++) if (available(i)) state.shelfLevels[i] = Math.max(state.shelfLevels[i] || 0, 1);
  }
  if (id === 'shelves2') {
    for (let i = 0; i < products.length; i++) if (available(i)) state.shelfLevels[i] = Math.max(state.shelfLevels[i] || 0, 3);
  }
  if (id === 'shelves3') {
    for (let i = 0; i < products.length; i++) if (available(i)) state.shelfLevels[i] = Math.max(state.shelfLevels[i] || 0, 4);
  }
  if (id === 'expansion1' || id === 'expansion2' || id === 'expansion3') {
    for (let i = 0; i < products.length; i++) {
      if (available(i) && state.prodSettings[i]) {
        state.prodSettings[i].baseCapacity = Math.max(state.prodSettings[i].baseCapacity, defaultCapacity(i) + 5);
        state.prodSettings[i].baseRate = Math.max(state.prodSettings[i].baseRate, .8);
      }
    }
  }

  // Initialize farm for new products
  const prodIdx = products.findIndex(p => p.key === id);
  if (prodIdx >= 0) state.farm[prodIdx] = Math.min(3, farmLimit(prodIdx));

  applyEffects();
  celebrate((level() > before ? 'NÍVEL ' + level() + '! ' : '') + next.title + ' ✓');
  save();
  updateUI();
  renderRoadmap();
  return true;
}

$('nextUpgrade').onclick = () => { if (!paused && nextStep()) purchaseStep(nextStep().id); };

// --- Roadmap ---
function renderRoadmap() {
  const current = nextStep();
  $('steps').innerHTML = chapters.map((ch, c) =>
    '<h3 style="font-size:14px;margin:12px 0 4px;color:#ffd700">' + (c + 1) + '. ' + ch.name + '</h3>' +
    steps.filter(s => s.chapter === c && !s.optional).map(s =>
      '<div class="step ' + (state.done.includes(s.id) ? 'done' : current === s ? 'current' : '') + '">' +
      '<b>' + (state.done.includes(s.id) ? '✓' : current === s ? '→' : '🔒') + ' ' + s.title + '</b>' +
      '<small>' + s.desc + '</small>' +
      '<small>' + (state.done.includes(s.id) ? 'Concluído' : '$' + s.cost + ' · ' + stepRequirement(s)) + '</small>' +
      '</div>'
    ).join('')
  ).join('');
}

function toggleRoadmap() {
  const opening = $('roadmap').hidden;
  $('roadmap').hidden = !opening;
  Object.keys(keys).forEach(k => keys[k] = false);
  paused = opening;
  if (opening) renderRoadmap();
}

$('roadmapButton').onclick = toggleRoadmap;
$('closeRoadmap').onclick = () => { $('roadmap').hidden = true; paused = false; };

// --- Pump Upgrades (Benches) ---
let selectedBench = 0;

function renderBenches() {
  const ids = saleTypes();
  if (!ids.includes(selectedBench)) selectedBench = ids[0];
  $('benchList').innerHTML = ids.map(i => {
    const cost = shelfUpgradeCost(i);
    const cap = shelfLimit(i);
    const next = cost !== null ? shelfCapacity(shelfLevel(i) + 1) : cap;
    return '<div class="bench ' + (i === selectedBench ? 'selected' : '') + '" data-bench="' + i + '">' +
      '<b>' + products[i].icon + ' ' + products[i].name + ' · Nível ' + (shelfLevel(i) + 1) + '</b>' +
      '<p>Estoque: ' + state.stock[i] + '/' + cap + (cost !== null ? ' → ' + next : ' · Máximo') + '</p>' +
      '<button data-upgrade="' + i + '" ' + (cost === null || state.money < cost ? 'disabled' : '') + '>' +
      (cost === null ? 'Máximo' : 'Ampliar · $' + cost) + '</button>' +
      (cost !== null && state.money < cost ? '<p style="color:#e74c3c">Faltam $' + (state.money < cost ? cost - state.money : 0) + '</p>' : '') +
      '</div>';
  }).join('');
}

function upgradeBench(i) {
  const cost = shelfUpgradeCost(i);
  if (cost === null) { toast('Já no máximo.'); return false; }
  if (state.money < cost) { toast('Faltam $' + (cost - state.money)); return false; }
  state.money -= cost;
  state.shelfLevels[i] = (state.shelfLevels[i] || 0) + 1;
  save();
  updateUI();
  renderBenches();
  toast(products[i].name + ': capacidade ' + shelfLimit(i) + '!');
  return true;
}

function toggleBenches() {
  if (!$('benches').hidden) { $('benches').hidden = true; paused = false; return; }
  closeAllPanels();
  paused = true;
  $('benches').hidden = false;
  renderBenches();
}

$('benchesButton').onclick = toggleBenches;
$('closeBenches').onclick = () => { $('benches').hidden = true; paused = false; };
$('benchList').onclick = e => {
  const btn = e.target.closest('[data-upgrade]');
  if (btn) { upgradeBench(Number(btn.dataset.upgrade)); return; }
  const row = e.target.closest('[data-bench]');
  if (row) { selectedBench = Number(row.dataset.bench); renderBenches(); }
};

// --- Production Panel ---
let selectedProduction = 0;

function renderProduction() {
  const ids = products.map((_, i) => i).filter(i => available(i));
  if (!ids.includes(selectedProduction)) selectedProduction = ids[0];
  const i = selectedProduction;
  const p = state.prodSettings[i] || {};
  const r = recipes[i];
  const isRaw = rawMaterial(i);

  let html = '<div class="bench selected">' +
    '<b>' + products[i].icon + ' ' + products[i].name + '</b>';

  if (r) {
    const seconds = (r.seconds / productionMultiplier(i)).toFixed(1);
    html += '<p>' + r.yield + ' unidades em ' + seconds + 's</p>';
    html += '<p>Receita: ' + Object.entries(r.input).map(([k, n]) => n + ' ' + products[k].icon).join(' + ') + '</p>';
    html += '<p>' + machineLabel(i) + '</p>';
    html += '<p>Estoque: ' + Math.floor(state.farm[i]) + '/' + farmLimit(i) + '</p>';
  } else if (isRaw) {
    html += '<p>Extração automática · ' + cropRate(i).toFixed(2) + '/s</p>';
    html += '<p>Estoque: ' + Math.floor(state.farm[i]) + '/' + farmLimit(i) + '</p>';
  } else {
    html += '<p>Produto direto · $' + products[i].price + '</p>';
  }

  // Upgrade buttons
  const prodCost = (kind) => {
    const tier = p[kind] || 0;
    return tier >= 10 ? null : Math.round((kind === 'speed' ? 80 : 55) * (tier + 1) * (1 + tier * 0.35));
  };

  html += '<div class="prodButtons">';
  for (const kind of ['speed', 'capacity']) {
    const cost = prodCost(kind);
    if (cost !== null) {
      html += '<button data-prod="' + kind + '" ' + (state.money < cost ? 'disabled' : '') + '>' +
        (kind === 'speed' ? '⚡ Velocidade' : '📦 Capacidade') + '<br>$' + cost + '</button>';
    }
  }
  html += '</div></div>';

  // Machine inputs display
  if (r) {
    const m = state.machines[i];
    html += '<div class="bench"><b>Depósito de ingredientes</b>';
    for (const [k, n] of Object.entries(r.input)) {
      html += '<p>' + products[k].icon + ' ' + products[k].name + ': ' +
        (m.inputs[k] || 0) + '/' + inputLimit(i) + ' (precisa ' + n + ')</p>';
    }
    html += '<p style="color:#7f8c8d">Itens são depositados automaticamente por frentistas ou manualmente (aproxime-se com matéria-prima no tanque)</p>';
    html += '</div>';
  }

  // Navigation
  html = '<div class="prodButtons" style="margin-bottom:8px">' +
    '<button data-product-nav="-1">← Anterior</button>' +
    '<button data-product-nav="1">Próximo →</button></div>' + html;

  // Specialists
  let specHtml = '';
  for (const spec of specialistDefs) {
    const hired = state.specialists[spec.id];
    const canHire = available(spec.unlock) && !hired;
    specHtml += '<div class="bench"><b>' + spec.name + ' · ' + spec.title + '</b>' +
      '<p>' + spec.desc + '</p>' +
      '<button data-specialist="' + spec.id + '" ' + (hired || !canHire || state.money < spec.cost ? 'disabled' : '') + '>' +
      (hired ? 'Contratado' : !canHire ? 'Bloqueado' : 'Contratar · $' + spec.cost) + '</button></div>';
  }

  $('productionList').innerHTML = html;
  $('specialistList').innerHTML = specHtml;
}

const specialistDefs = [
  { id: 'op_diesel', name: 'DAVI', title: 'Operador de Diesel', cost: 300, unlock: 3, desc: 'Produz diesel e abastece bombas.' },
  { id: 'op_conv', name: 'ROSA', title: 'Operadora de Conveniência', cost: 400, unlock: 6, desc: 'Produz itens da loja e repõe prateleiras.' },
  { id: 'op_premium', name: 'ANA', title: 'Operadora Premium', cost: 600, unlock: 9, desc: 'Produz lubrificantes e sorvetes.' },
];

function toggleProduction() {
  if (!$('productionPanel').hidden) { $('productionPanel').hidden = true; paused = false; return; }
  closeAllPanels();
  paused = true;
  $('productionPanel').hidden = false;
  renderProduction();
}

$('productionButton').onclick = toggleProduction;
$('closeProduction').onclick = () => { $('productionPanel').hidden = true; paused = false; };
$('productionList').onclick = e => {
  const nav = e.target.closest('[data-product-nav]');
  if (nav) {
    const ids = products.map((_, i) => i).filter(i => available(i));
    selectedProduction = ids[(ids.indexOf(selectedProduction) + Number(nav.dataset.productNav) + ids.length) % ids.length];
    renderProduction();
    return;
  }
  const btn = e.target.closest('[data-prod]');
  if (btn) {
    const kind = btn.dataset.prod;
    const i = selectedProduction;
    const p = state.prodSettings[i] || {};
    const tier = p[kind] || 0;
    const cost = Math.round((kind === 'speed' ? 80 : 55) * (tier + 1) * (1 + tier * 0.35));
    if (tier >= 10 || state.money < cost) return;
    state.money -= cost;
    p[kind] = (p[kind] || 0) + 1;
    state.prodSettings[i] = p;
    save();
    updateUI();
    renderProduction();
    toast(products[i].name + ': ' + (kind === 'speed' ? 'velocidade' : 'capacidade') + ' melhorada!');
  }
};
$('specialistList').onclick = e => {
  const btn = e.target.closest('[data-specialist]');
  if (!btn) return;
  const spec = specialistDefs.find(d => d.id === btn.dataset.specialist);
  if (!spec || state.specialists[spec.id] || state.money < spec.cost) return;
  state.money -= spec.cost;
  state.specialists[spec.id] = true;
  save();
  updateUI();
  renderProduction();
  toast(spec.name + ' contratado!');
};

// --- Operations Panel ---
function operationCost(kind) {
  const ops = state.operations;
  const n = ops[kind] || 0;
  const maxes = { registers: 4, scanner: 5, transport: 5, frentistas: 3 };
  if (n >= (maxes[kind] || 5)) return null;
  return Math.round({ registers: 800, scanner: 400, transport: 500, frentistas: 600 }[kind] * Math.pow(1.6, n));
}

function renderOperations() {
  const names = [
    ['registers', 'Caixa de atendimento', 'Mais uma fila de pagamento'],
    ['scanner', 'Leitor NFC/Scanner', 'Pagamentos mais rápidos'],
    ['transport', 'Caminhão-tanque', 'Transporte de combustível'],
    ['frentistas', 'Frentista extra', 'Mais um funcionário']
  ];
  $('operationsList').innerHTML = names.map(([kind, title, desc], n) => {
    const cost = operationCost(kind);
    return '<div class="bench"><b>' + (n + 1) + ' · ' + title + '</b>' +
      '<p>' + desc + ' · Nível: ' + (state.operations[kind] || 0) + '</p>' +
      '<button data-operation="' + kind + '" ' + (cost === null || state.money < cost ? 'disabled' : '') + '>' +
      (cost === null ? 'Máximo' : 'Comprar · $' + cost) + '</button></div>';
  }).join('');
}

function toggleOperations() {
  if (!$('operationsPanel').hidden) { $('operationsPanel').hidden = true; paused = false; return; }
  closeAllPanels();
  paused = true;
  $('operationsPanel').hidden = false;
  renderOperations();
}

$('operationsButton').onclick = toggleOperations;
$('closeOperations').onclick = () => { $('operationsPanel').hidden = true; paused = false; };
$('operationsList').onclick = e => {
  const btn = e.target.closest('[data-operation]');
  if (!btn) return;
  const kind = btn.dataset.operation;
  const cost = operationCost(kind);
  if (cost === null || state.money < cost) return;
  state.money -= cost;
  state.operations[kind] = (state.operations[kind] || 0) + 1;
  if (kind === 'registers') state.operations.registers = Math.max(state.operations.registers, state.operations[kind]);
  save();
  updateUI();
  renderOperations();
  toast('Melhoria de operação comprada!');
};

// --- Layout Editor ---
let layoutEdit = null;

function layoutItems() {
  return [
    ...saleTypes().map(i => ({ id: 'shelf:' + i, name: products[i].icon + ' ' + products[i].name, x: stands[i].x, y: stands[i].y, w: 140, h: 140 })),
    ...Array.from({ length: state.operations.registers }, (_, i) => ({ id: 'register:' + i, name: 'Caixa ' + (i + 1), ...registerAt(i), w: 180, h: 200 })),
    { id: 'entrance', name: 'Entrada', ...entranceAt(), w: 100, h: 50 }
  ];
}

function openLayout() {
  if (layoutEdit) { closeLayout(); return; }
  closeAllPanels();
  paused = true;
  layoutEdit = { id: null, draft: null, camera: { ...player } };
  $('layoutPanel').hidden = false;
  $('layoutSelect').innerHTML = layoutItems().map(i => '<option value="' + i.id + '">' + i.name + '</option>').join('');
  selectLayout(layoutItems()[0].id);
}

function closeLayout() {
  layoutEdit = null;
  $('layoutPanel').hidden = true;
  paused = false;
}

function selectLayout(id) {
  const item = layoutItems().find(i => i.id === id);
  if (!item) return;
  layoutEdit.id = id;
  layoutEdit.draft = { x: item.x, y: item.y };
  layoutEdit.camera = { x: item.x, y: item.y };
  $('layoutSelect').value = id;
}

$('layoutButton').onclick = openLayout;
$('closeLayout').onclick = closeLayout;
$('layoutSelect').onchange = e => selectLayout(e.target.value);

// --- Close All Panels ---
function closeAllPanels() {
  for (const id of ['roadmap', 'benches', 'productionPanel', 'operationsPanel', 'layoutPanel']) {
    $(id).hidden = true;
  }
  $('pauseScreen').style.display = 'none';
}

// --- Pause ---
function pause(v) {
  paused = v;
  $('pauseScreen').style.display = v ? 'grid' : 'none';
  Object.keys(keys).forEach(k => keys[k] = false);
  pointer = null;
}

$('pause').onclick = () => pause(true);
$('resume').onclick = () => pause(false);

// --- Input ---
addEventListener('keydown', e => {
  if (layoutEdit) {
    e.preventDefault();
    if (e.key === 'Escape') { selectLayout(layoutEdit.id); return; }
    if (e.key === 'Enter') {
      state.layoutPositions[layoutEdit.id] = { ...layoutEdit.draft };
      save();
      toast('Posição salva!');
      return;
    }
    if (e.key === 'Tab') {
      const ids = layoutItems().map(i => i.id);
      selectLayout(ids[(ids.indexOf(layoutEdit.id) + 1) % ids.length]);
      return;
    }
    const dirs = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
    const d = dirs[e.key];
    if (d && layoutEdit.draft) { layoutEdit.draft.x += d[0]; layoutEdit.draft.y += d[1]; }
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;

  if (e.repeat) return;
  const k = e.key.toLowerCase();

  if (e.key === 'Escape' || e.code === 'Space') { e.preventDefault(); pause(!paused); return; }
  if (k === 'u') { toggleRoadmap(); return; }
  if (k === 'b' || k === 't') { toggleBenches(); return; }
  if (k === 'p') { toggleProduction(); return; }
  if (k === 'o') { toggleOperations(); return; }
  if (k === 'l') { openLayout(); return; }
  if (k === 'e' && !paused && nextStep()) { purchaseStep(nextStep().id); return; }
  if (!paused && k === 'g') { player.x = 130; player.y = 450; toast('Poço de petróleo'); return; }
  if (!paused && k === 'r') { player.x = 50; player.y = 580; toast('Refinaria'); return; }
  if (!paused && k === 'm') { const reg = registerAt(0); player.x = reg.x; player.y = reg.y - 50; toast('Caixa'); return; }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { Object.keys(keys).forEach(k => keys[k] = false); pause(true); });

// Touch/click
canvas.onpointerdown = e => {
  if (paused || layoutEdit) return;
  canvas.setPointerCapture(e.pointerId);
  pointer = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY };
};
canvas.onpointermove = e => { if (pointer) { pointer.cx = e.clientX; pointer.cy = e.clientY; } };
canvas.onpointerup = canvas.onpointercancel = () => { pointer = null; };

// --- Save/Load/Reset ---
$('newGame').onclick = () => {
  if (!confirm('Começar nova partida? A atual será guardada como backup.')) return;
  save();
  const backup = { v2: localStorage.getItem('meu-posto-v2') };
  localStorage.setItem('meu-posto-backup', JSON.stringify(backup));
  state.resetPending = true;
  localStorage.removeItem('meu-posto-v2');
  location.reload();
};
$('restoreGame').onclick = () => {
  const raw = localStorage.getItem('meu-posto-backup');
  if (!raw) { toast('Nenhum backup encontrado.'); return; }
  if (!confirm('Restaurar partida guardada? A atual será substituída.')) return;
  const b = JSON.parse(raw);
  state.resetPending = true;
  if (b.v2) localStorage.setItem('meu-posto-v2', b.v2);
  location.reload();
};

addEventListener('pagehide', save);

// --- Kick off ---
updateUI();
requestAnimationFrame(frame);
