const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCXHRGIDnof2QMVAO8YGH4wdjnuCUYkut4",
    authDomain: "avcminercom.firebaseapp.com",
    projectId: "avcminercom",
    storageBucket: "avcminercom.firebasestorage.app",
    messagingSenderId: "888301668507",
    appId: "1:888301668507:web:d2380f74d4b58d9d269e3e"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let isAuthResolved = false;
let solarSwitchToastTimer = null;
let solarLowToastTimer = null;
let alertHideTimer = null;
let hudTop3RefreshDebounceTimer = null;

// Authenticate State Observer
auth.onAuthStateChanged(user => {
    currentUser = user;
    isAuthResolved = true;
    if(typeof checkReadyToStart === 'function') checkReadyToStart();
});

// Auth Functions
function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.innerText = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 8000);
}

/** Formdan e-posta (trim) + şifre; başta/sonda boşluk giriş hatalarını azaltır. */
function getAuthFormCredentials() {
    const emailEl = document.getElementById('auth-email');
    const passEl = document.getElementById('auth-password');
    const email = (emailEl && emailEl.value) ? emailEl.value.trim() : '';
    const pass = (passEl && passEl.value) ? passEl.value : '';
    return { email, pass };
}

/** Firebase Auth hata kodlarını kullanıcıya anlaşılır Türkçe metne çevirir. */
function firebaseAuthErrorToTr(err, context) {
    const code = err && err.code ? String(err.code) : '';
    const map = {
        'auth/invalid-email': 'Geçersiz e-posta adresi.',
        'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
        'auth/user-not-found': 'Bu e-posta ile kayıtlı hesap yok. Önce "Hesap Oluştur" ile kayıt olun.',
        'auth/wrong-password': 'Şifre yanlış.',
        'auth/invalid-credential': 'E-posta veya şifre hatalı; ya da bu e-posta ile hesap yok.',
        'auth/invalid-login-credentials': 'E-posta veya şifre hatalı; ya da bu e-posta ile hesap yok.',
        'auth/email-already-in-use': 'Bu e-posta zaten kayıtlı. "Giriş Yap" kullanın.',
        'auth/weak-password': 'Şifre çok zayıf (en az 6 karakter önerilir).',
        'auth/operation-not-allowed': 'Firebase’de E-posta/Şifre girişi kapalı. Konsolda Authentication → Sign-in method → E-posta/Şifre’yi açın.',
        'auth/too-many-requests': 'Çok fazla deneme. Bir süre sonra tekrar deneyin.',
        'auth/network-request-failed': 'Ağ hatası. Bağlantınızı kontrol edin.',
        'auth/popup-blocked': 'Tarayıcı pencereyi engelledi. Açılır pencereye izin verin.',
        'auth/popup-closed-by-user': 'Google penceresi kapatıldı.',
        'auth/cancelled-popup-request': 'Giriş iptal edildi.',
        'auth/admin-restricted-operation': 'Bu işlem kısıtlı (ör. kimlik doğrulama ayarları).'
    };
    if (map[code]) return map[code];
    const suffix = err && err.message ? ` (${err.message})` : '';
    const prefix = context === 'register' ? 'Kayıt başarısız'
        : context === 'google' ? 'Google girişi başarısız'
        : context === 'guest' ? 'Misafir girişi başarısız'
        : 'Giriş başarısız';
    return prefix + '.' + suffix;
}

function loginWithEmail() {
    const { email, pass } = getAuthFormCredentials();
    if (!email || !pass) return showAuthError("Lütfen e-posta ve şifrenizi girin.");
    
    auth.signInWithEmailAndPassword(email, pass).catch(e => {
        showAuthError(firebaseAuthErrorToTr(e, 'login'));
    });
}

function registerWithEmail() {
    const { email, pass } = getAuthFormCredentials();
    if (!email || !pass) return showAuthError("Lütfen e-posta ve şifrenizi girin.");
    if (pass.length < 6) return showAuthError("Şifre en az 6 karakter olmalı.");
    
    auth.createUserWithEmailAndPassword(email, pass).catch(e => {
        showAuthError(firebaseAuthErrorToTr(e, 'register'));
    });
}

function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(e => {
        showAuthError(firebaseAuthErrorToTr(e, 'google'));
    });
}

function loginAsGuest() {
    auth.signInAnonymously().catch(e => {
        showAuthError(firebaseAuthErrorToTr(e, 'guest'));
    });
}

function logout() {
    auth.signOut().then(() => {
        window.location.reload(); 
    });
}

const TILE_SIZE = 80;

/** En yüksek kazılabilir blok sertliği 200 (magma taşı, sandık); elmas 100. effPick >= hardness gerekir. */
const PICK_MAX_LVL = 200;

/** Jetpack: sabit tırmanış hızı (|vy|). Seviye Teknoloji Merkezi’nden artar. */
const FLIGHT_MOTOR_MAX_LVL = 10;
const FLIGHT_BASE_ASCENT = 3.15;
const FLIGHT_ASCENT_PER_LVL = 0.55;

function getFlightAscentSpeed() {
    const lvl = Math.min(Math.max(0, state.flightMotorLvl | 0), FLIGHT_MOTOR_MAX_LVL);
    return FLIGHT_BASE_ASCENT + lvl * FLIGHT_ASCENT_PER_LVL;
}
const MAP_W = 100;
const MAP_H = 1000; // Artan Derinlik
const SURFACE_Y = 5;
/** Bina görsellerini yeryüzü çizgisine göre aşağı kaydırır (px); E etkileşimi ile uyumlu. */
const BUILDING_Y_OFFSET = 36;

const ASSETS_MAP = {
    bedrock: 'assets/block_bedrock_1774610794526.png',
    grass: 'assets/block_grass_1774612313996.png',
    dirt: 'assets/block_dirt_1774610631109.png',
    stone: 'assets/block_stone_1774610647298.png',
    coal: 'assets/block_coal_1774610662007.png',
    iron: 'assets/block_iron_1774610678140.png',
    gold: 'assets/block_gold_1774610711996.png',
    ruby: 'assets/block_ruby_1774610738927.png',
    diamond: 'assets/block_diamond_1774610779615.png',
    player: 'assets/miner_player_single_1774611085961.png',
    house: 'assets/building_house_1774612162592.png',
    market: 'assets/building_market_1774612175943.png',
    warehouse: 'assets/building_warehouse_1774612298018.png',
    workshop: 'assets/building_workshop_1774612335193.png',
    tech: 'assets/teknolojimerkezi.png',
    quest: 'assets/akademi.png'
};

const images = {};
let loadedImages = 0;
const totalImages = Object.keys(ASSETS_MAP).length;

const BUILDINGS = [
    { id: 'house', name: 'Ev', x: 4 * TILE_SIZE, w: 220, h: 220, action: 'house' },
    { id: 'market', name: 'Market', x: 14 * TILE_SIZE, w: 220, h: 220, action: 'market' },
    { id: 'warehouse', name: 'Depo', x: 24 * TILE_SIZE, w: 220, h: 220, action: 'warehouse' },
    { id: 'workshop', name: 'Atölye', x: 34 * TILE_SIZE, w: 220, h: 220, action: 'workshop' },
    { id: 'tech', name: 'Teknoloji Merkezi', x: 44 * TILE_SIZE, w: 220, h: 220, action: 'tech' },
    { id: 'quest', name: 'Akademi', x: 54 * TILE_SIZE, w: 180, h: 220, action: 'quest' }
];

const LAYERS = [
    { depth: 0, name: 'Yeryüzü', bgTop: '#38bdf8', bgBot: '#e0f2fe' },
    { depth: 10, name: 'Toprak Katmanı', bgTop: '#3f2b1d', bgBot: '#1f130a' },
    { depth: 100, name: 'Taş Katmanı', bgTop: '#1e293b', bgBot: '#0f172a' },
    { depth: 400, name: 'Derin Mağaralar', bgTop: '#020617', bgBot: '#1e1b4b' },
    { depth: 800, name: 'Magma Katmanı', bgTop: '#450a0a', bgBot: '#b91c1c' }
];

const MINE_TYPES = [
    { id: 'dirt', particle: '#785b46', hardness: 1, val: 5, start: 6, end: 150, name: 'Toprak' },
    { id: 'stone', particle: '#94a3b8', hardness: 3, val: 15, start: 6, end: 1000, name: 'Taş' },
    { id: 'coal', particle: '#334155', hardness: 5, val: 25, start: 10, end: 400, name: 'Kömür' },
    { id: 'iron', particle: '#e2e8f0', hardness: 10, val: 120, start: 50, end: 600, name: 'Demir' },
    { id: 'gold', particle: '#fde047', hardness: 25, val: 400, start: 150, end: 800, name: 'Altın' },
    { id: 'ruby', particle: '#fb7185', hardness: 50, val: 1500, start: 300, end: 1000, name: 'Yakut' },
    { id: 'diamond', particle: '#67e8f9', hardness: 100, val: 5000, start: 500, end: 1000, name: 'Elmas' }
];

const GRASS = { id: 'grass', particle: '#4ade80', hardness: 1, val: 0, isPlatform: true, isUnmineable: true };
const BEDROCK = { id: 'bedrock', particle: '#3b0764', hardness: 999999, val: 0 };
const MAGMA_ROCK = { id: 'stone', particle: '#ef4444', isMagma: true, hardness: 200, val: 200 }; // Tinted stone

let state = {
    money: 10000,
    pickLvl: 1,
    pickUpgradeCost: 20,
    lightLvl: 1,
    lightUpgradeCost: 200,
    invMax: 10,
    invUpgradeCost: 50,
    inventory: 0,
    invValue: 0,
    energyMax: 100,
    energy: 100,

    player: { x: 12 * TILE_SIZE, y: 4 * TILE_SIZE, w: 60, h: 60, vx: 0, vy: 0, speed: 6.5, dir: 1, onGround: false },
    keys: {}, world: [], particles: [],
    camera: { x: 0, y: 0, shakeIntensity: 0 },
    activeModal: null, active: false, frame: 0,
    currentLayer: LAYERS[0],
    stats: { totalMined: 0, totalEarned: 0, maxDepth: 0, totalOreValue: 0 },
    quests: [], gasEffectTimer: 0,
    solarLvl: 0, solarUpgradeCost: 500, solarEnergy: 0, solarEnergyMax: 0,
    exoLvl: 0, exoUpgradeCost: 2000,
    flightMotorLvl: 0, flightMotorUpgradeCost: 750, activeSkillCooldown: 0,
    drone: { x: 12 * TILE_SIZE, y: 4 * TILE_SIZE, active: false, hasExtraInv: false },
    chips: { antitoxin: false, cooling: false },
    playerName: "AVCI-E", hasRadar: false, currentRole: null,
    /** HUD konsol: { text, variant, at } en yenisi üstte */
    messageLog: [],
    /** Robot üstü balon: { text, variant, until } */
    playerToast: null
};

function useEnergy(amount) {
    const drainMult = state.solarLvl > 0 ? (1 / (1 + state.solarLvl * 0.4)) : 1;
    let actualDrain = amount * drainMult;

    if (state.energy > 0) {
        state.energy -= actualDrain;
        if (state.energy < 0 && state.solarLvl > 0) {
            state.solarEnergy += state.energy;
            state.energy = 0;
            if (state.solarEnergy < 0) state.solarEnergy = 0;
        } else if (state.energy < 0) {
            state.energy = 0;
        }
    } else if (state.solarLvl > 0 && state.solarEnergy > 0) {
        state.solarEnergy -= actualDrain;
        if (state.solarEnergy < 0) state.solarEnergy = 0;
    }
}

function hasAnyEnergy(req = 0.5) {
    return state.energy >= req || (state.solarLvl > 0 && state.solarEnergy >= req);
}

class SoundEngine {
    constructor() { this.ctx = null; }
    init() { if (!this.ctx) { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } if (this.ctx.state === 'suspended') this.ctx.resume(); }
    play(type) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        if (type === 'coin') { osc.type = 'sine'; osc.frequency.setValueAtTime(1000, this.ctx.currentTime); osc.frequency.setValueAtTime(1500, this.ctx.currentTime + 0.05); gain.gain.setValueAtTime(0.1, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1); osc.start(); osc.stop(this.ctx.currentTime + 0.1); }
        else if (type === 'hit') { osc.type = 'triangle'; osc.frequency.setValueAtTime(150, this.ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.1); gain.gain.setValueAtTime(0.1, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1); osc.start(); osc.stop(this.ctx.currentTime + 0.1); }
        else if (type === 'gem') { osc.type = 'sine'; osc.frequency.setValueAtTime(800, this.ctx.currentTime); gain.gain.setValueAtTime(0.1, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2); osc.start(); osc.stop(this.ctx.currentTime + 0.2); }
        else if (type === 'gas') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, this.ctx.currentTime); gain.gain.setValueAtTime(0.05, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5); osc.start(); osc.stop(this.ctx.currentTime + 0.5); }
    }
}
const sfx = new SoundEngine();

function generateQuests() {
    state.quests = [
        { id: 1, desc: '30 Maden Kaz', target: 30, current: 0, reward: 500, type: 'mine' },
        { id: 2, desc: '100m Derinliğe İn', target: 10, current: 0, reward: 1000, type: 'depth' },
        { id: 3, desc: '1000 Para Kazan', target: 1000, current: 0, reward: 1500, type: 'earn' }
    ];
}
function updateQuests() {
    const list = document.getElementById('quest-list');
    if (!list) return;
    list.innerHTML = state.quests.map((q, i) => `
        <div class="quest-item ${q.current >= q.target ? 'completed' : ''} bg-black/40 p-3 sm:p-4 rounded-xl border border-white/10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0 flex-1">
                <div class="font-bold text-white text-sm sm:text-base mb-1">${q.desc}</div>
                <div class="text-xs text-slate-400">${q.current}/${q.target}</div>
            </div>
            <div class="flex flex-shrink-0 flex-wrap items-center gap-2 sm:gap-3 justify-between sm:justify-end w-full sm:w-auto">
                <div class="font-black text-purple-400 text-base sm:text-lg">${q.reward} 💰</div>
                ${q.current >= q.target ? `<button type="button" onclick="claimQuest(${i})" class="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 sm:px-3 sm:py-1.5 rounded-lg text-sm font-bold transition-scale active:scale-95">AL</button>` : ''}
            </div>
        </div>
    `).join('');
}
function claimQuest(idx) {
    const q = state.quests[idx];
    if (q.current >= q.target) {
        state.money += q.reward;
        state.stats.totalEarned += q.reward;
        checkQuests('earn', q.reward);
        sfx.play('coin');
        showAlert(`Görev Tamamlandı: ${q.reward} 💰`, 'success');
        state.quests.splice(idx, 1);
        updateQuests();
        updateUI();
        saveGame();
    }
}
function checkQuests(type, amount = 1) {
    let updated = false;
    for (let q of state.quests) {
        if (q.type === type && q.current < q.target) {
            if (type === 'depth') q.current = Math.max(q.current, amount);
            else q.current += amount;
            updated = true;
        }
    }
    if (updated) updateQuests();
}
function computeProgressionScore() {
    let s = state.pickLvl + state.lightLvl + state.solarLvl + state.exoLvl;
    s += Math.max(0, Math.floor((state.invMax - 10) / 10));
    if (state.drone && state.drone.active) s += 2;
    if (state.hasRadar) s += 1;
    if (state.chips && state.chips.antitoxin) s += 1;
    if (state.chips && state.chips.cooling) s += 1;
    return s;
}

/** Sabit tavanlar: oyuncu kümesinden bağımsız global puan (0–100). Kazı/Değer log1p ile yumuşatılır. */
const LB_GLOBAL_BLEND_CAPS = {
    totalMined: 2_000_000,
    totalOreValue: 80_000_000,
    maxDepth: 1000,
    progressionScore: 150
};

/** Yerel/bulut kayıt ve sıralama için üst sınırlar (konsol / localStorage manipülasyonunu sınırlar). Tam güvenlik için sunucu doğrulaması gerekir. */
const SAVE_STATE_CAPS = {
    moneyMax: 1e15,
    upgradeCostMax: 1e18,
    lightLvlMax: 400,
    solarLvlMax: 250,
    invMaxCap: 50_000,
    totalMinedMax: LB_GLOBAL_BLEND_CAPS.totalMined * 20,
    totalOreValueMax: LB_GLOBAL_BLEND_CAPS.totalOreValue * 20,
    totalEarnedMax: 1e15,
    maxDepthTiles: MAP_H
};

function clampFiniteNonNeg(n, maxVal) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 0) return 0;
    return Math.min(x, maxVal);
}

function clampIntInRange(n, min, max) {
    const x = Math.round(Number(n));
    if (!Number.isFinite(x)) return min;
    return Math.min(Math.max(x, min), max);
}

/**
 * İlerleme ve ekonomi alanlarını oyun kurallarına uygun aralığa indirir.
 * Çağrı: yükleme sonrası, kayıt öncesi, bulut kaydı parse edildikten sonra.
 */
function clampClientGameState() {
    const C = SAVE_STATE_CAPS;
    state.money = clampFiniteNonNeg(state.money, C.moneyMax);
    if (!state._initial10kGifted && state.money < 10000) {
        state.money = 10000;
        state._initial10kGifted = true;
    }
    state.pickLvl = clampIntInRange(state.pickLvl, 1, PICK_MAX_LVL);
    state.lightLvl = clampIntInRange(state.lightLvl, 1, C.lightLvlMax);
    state.invMax = clampIntInRange(state.invMax, 10, C.invMaxCap);
    state.inventory = clampFiniteNonNeg(state.inventory, state.invMax);
    state.invValue = clampFiniteNonNeg(state.invValue, state.inventory * 6000);
    state.energyMax = clampIntInRange(state.energyMax, 1, 500);
    state.energy = clampFiniteNonNeg(state.energy, state.energyMax);

    state.pickUpgradeCost = clampFiniteNonNeg(state.pickUpgradeCost, C.upgradeCostMax);
    state.lightUpgradeCost = clampFiniteNonNeg(state.lightUpgradeCost, C.upgradeCostMax);
    state.invUpgradeCost = clampFiniteNonNeg(state.invUpgradeCost, C.upgradeCostMax);
    state.solarUpgradeCost = clampFiniteNonNeg(state.solarUpgradeCost, C.upgradeCostMax);
    state.exoUpgradeCost = clampFiniteNonNeg(state.exoUpgradeCost, C.upgradeCostMax);
    state.flightMotorUpgradeCost = clampFiniteNonNeg(state.flightMotorUpgradeCost, C.upgradeCostMax);

    state.solarLvl = clampIntInRange(state.solarLvl, 0, C.solarLvlMax);
    state.solarEnergyMax = clampFiniteNonNeg(state.solarEnergyMax, state.solarLvl * 200 + 500);
    state.solarEnergy = clampFiniteNonNeg(state.solarEnergy, state.solarEnergyMax);

    state.exoLvl = clampIntInRange(state.exoLvl, 0, 5);
    state.flightMotorLvl = clampIntInRange(state.flightMotorLvl, 0, FLIGHT_MOTOR_MAX_LVL);
    state.activeSkillCooldown = clampFiniteNonNeg(state.activeSkillCooldown, 1e6);

    state.hasRadar = !!state.hasRadar;
    const role = state.currentRole;
    state.currentRole = (role === 'miner' || role === 'engineer' || role === 'explorer') ? role : null;

    if (!state.chips || typeof state.chips !== 'object') state.chips = { antitoxin: false, cooling: false };
    state.chips.antitoxin = !!state.chips.antitoxin;
    state.chips.cooling = !!state.chips.cooling;

    if (!state.drone || typeof state.drone !== 'object') {
        state.drone = { x: 12 * TILE_SIZE, y: 4 * TILE_SIZE, active: false, hasExtraInv: false };
    } else {
        const wPx = MAP_W * TILE_SIZE;
        const hPx = MAP_H * TILE_SIZE;
        state.drone.active = !!state.drone.active;
        state.drone.hasExtraInv = !!state.drone.hasExtraInv;
        state.drone.x = clampFiniteNonNeg(state.drone.x, wPx);
        state.drone.y = clampFiniteNonNeg(state.drone.y, hPx);
    }

    if (!state.stats || typeof state.stats !== 'object') {
        state.stats = { totalMined: 0, totalEarned: 0, maxDepth: 0, totalOreValue: 0 };
    }
    state.stats.totalMined = clampFiniteNonNeg(state.stats.totalMined, C.totalMinedMax);
    state.stats.totalOreValue = clampFiniteNonNeg(state.stats.totalOreValue, C.totalOreValueMax);
    state.stats.totalEarned = clampFiniteNonNeg(state.stats.totalEarned, C.totalEarnedMax);
    state.stats.maxDepth = clampIntInRange(state.stats.maxDepth, 0, C.maxDepthTiles);

    if (!Array.isArray(state.quests)) state.quests = [];
    else {
        state.quests = state.quests.filter(q => q && typeof q === 'object' && typeof q.target === 'number' && q.target > 0);
        for (const q of state.quests) {
            q.current = clampIntInRange(q.current, 0, Math.max(q.target, q.target * 2));
            if (typeof q.reward === 'number' && Number.isFinite(q.reward)) q.reward = clampFiniteNonNeg(q.reward, 1e9);
        }
    }
}

/** Firestore’dan gelen ham save nesnesini güvenli şekilde düzler (referansı değiştirmez; alanları yazar). */
function sanitizeCloudSavePayload(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const base = {
        money: 10000, pickLvl: 1, pickUpgradeCost: 20,
        lightLvl: 1, lightUpgradeCost: 200,
        invMax: 10, invUpgradeCost: 50,
        solarLvl: 0, solarUpgradeCost: 500, solarEnergy: 0, solarEnergyMax: 0,
        exoLvl: 0, exoUpgradeCost: 2000,
        flightMotorLvl: 0, flightMotorUpgradeCost: 750,
        drone: { x: 12 * TILE_SIZE, y: 4 * TILE_SIZE, active: false, hasExtraInv: false },
        chips: { antitoxin: false, cooling: false },
        hasRadar: false,
        currentRole: null,
        playerName: 'AVCI-E',
        quests: [],
        stats: { totalMined: 0, totalEarned: 0, maxDepth: 0, totalOreValue: 0 }
    };
    const out = { ...base, ...obj };
    if (obj.stats && typeof obj.stats === 'object') out.stats = { ...base.stats, ...obj.stats };
    if (obj.drone && typeof obj.drone === 'object') out.drone = { ...base.drone, ...obj.drone };
    if (obj.chips && typeof obj.chips === 'object') out.chips = { ...base.chips, ...obj.chips };
    return out;
}

/** Firestore okuma: global sekme yalnızca genel sıralama; üst N kayıt. İndeks/alan yoksa tam get() yedeği devreye girer. */
const LB_GLOBAL_ORDERBY_LIMIT = 100;

function lbBlendNormOne(value, cap, useLog) {
    const v = Math.max(0, Number(value) || 0);
    const c = Math.max(1e-9, Number(cap) || 1);
    const num = useLog ? Math.log1p(v) : v;
    const den = useLog ? Math.log1p(c) : c;
    return Math.min(1, num / den);
}

/** Firestore’a yazılan ve listede kullanılan global blend (dört metrik ortalaması × 100). */
function computeGlobalBlendScore(row) {
    const m = lbBlendNormOne(row.totalMined, LB_GLOBAL_BLEND_CAPS.totalMined, true);
    const o = lbBlendNormOne(row.totalOreValue, LB_GLOBAL_BLEND_CAPS.totalOreValue, true);
    const d = lbBlendNormOne(row.maxDepth, LB_GLOBAL_BLEND_CAPS.maxDepth, false);
    const p = lbBlendNormOne(row.progressionScore, LB_GLOBAL_BLEND_CAPS.progressionScore, false);
    const raw = ((m + o + d + p) / 4) * 100;
    return Math.round(raw * 100) / 100;
}

function syncLeaderboardEntry() {
    if (!currentUser || currentUser.isAnonymous) return;
    const prog = computeProgressionScore();
    const mined = state.stats.totalMined || 0;
    const ore = state.stats.totalOreValue || 0;
    const depth = state.stats.maxDepth || 0;
    const globalBlendScore = computeGlobalBlendScore({
        totalMined: mined,
        totalOreValue: ore,
        maxDepth: depth,
        progressionScore: prog
    });
    const lbName = String(state.playerName || 'AVCI-E').slice(0, PLAYER_NAME_MAX_LEN);
    db.collection('leaderboard').doc(currentUser.uid).set({
        playerName: lbName,
        totalMined: mined,
        totalOreValue: ore,
        maxDepth: depth,
        progressionScore: prog,
        globalBlendScore,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        photoURL: currentUser.photoURL || null
    }, { merge: true }).catch(e => console.error('Leaderboard sync failed:', e));
}

function saveGame() {
    clampClientGameState();
    const saveDataObj = {
        money: state.money, pickLvl: state.pickLvl, pickUpgradeCost: state.pickUpgradeCost,
        lightLvl: state.lightLvl, lightUpgradeCost: state.lightUpgradeCost,
        invMax: state.invMax, invUpgradeCost: state.invUpgradeCost,
        solarLvl: state.solarLvl, solarUpgradeCost: state.solarUpgradeCost,
        solarEnergy: state.solarEnergy, solarEnergyMax: state.solarEnergyMax,
        exoLvl: state.exoLvl, exoUpgradeCost: state.exoUpgradeCost,
        flightMotorLvl: state.flightMotorLvl, flightMotorUpgradeCost: state.flightMotorUpgradeCost,
        drone: state.drone, chips: state.chips,
        hasRadar: state.hasRadar,
        currentRole: state.currentRole,
        playerName: state.playerName,
        quests: state.quests, stats: state.stats
    };

    localStorage.setItem('minerSave', JSON.stringify(saveDataObj));

    if (currentUser) {
        // Buluta kaydet
        db.collection('users').doc(currentUser.uid).set({
            saveData: JSON.stringify(saveDataObj),
            lastSaved: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.error("Cloud save failed:", e));
        syncLeaderboardEntry();
        scheduleRefreshHudTop3Global();
    }
}

// Initiate Loading
const INTRO_MESSAGES = [
    "Çok uzun zaman önce, yerin derinliklerinde çalışan eski bir medeniyet vardı: Eko Ustaları.",
    "Bu medeniyet, yeraltındaki enerjiyi dengede tutan dev kristaller üretmişti. Bu kristaller sayesinde gaz patlamaları önleniyor, magma akışları dengeleniyor ve yeraltı canlıları korunuyordu.",
    "Ama bir gün bir şey oldu.",
    "Büyük merkez kristal olan Kalp Çekirdeği parçalandı.",
    "Kristalin parçaları yeraltının farklı katmanlarına dağıldı. Denge bozuldu. Gaz sızıntıları arttı, mağaralar karardı, magma katmanları öfkelendi ve eski madencilik üsleri terk edildi.",
    "Yüzeyde ise bu olay unutuldu. Herkes yeraltını sadece “tehlikeli bir maden bölgesi” sanmaya başladı.",
    "Ta ki bir gün…",
    "Hurda deposunda bekleyen eski bir kazı robotu, AVC-E, yeniden aktive edilene kadar."
];

let isIntroFinished = false;
let isAssetsLoaded = (totalImages === 0);
let skipIntro = false;

window.onload = () => {
    const bar = document.getElementById('loading-bar');
    const introTextEl = document.getElementById('intro-text');
    const skipBtn = document.getElementById('skip-intro-btn');
    
    if (totalImages > 0) {
        Object.entries(ASSETS_MAP).forEach(([key, src]) => {
            const img = new Image();
            img.src = src;
            img.onload = () => {
                loadedImages++;
                images[key] = img;
                if (bar) bar.style.width = `${(loadedImages / totalImages) * 100}%`;
                if (loadedImages === totalImages) {
                    isAssetsLoaded = true;
                    checkReadyToStart();
                }
            };
        });
    }

    let msgIndex = 0;
    let charIndex = 0;
    let typeInterval = null;
    let delayTimeout = null;

    if (skipBtn) {
        skipBtn.classList.remove('hidden');
        setTimeout(() => {
            skipBtn.classList.remove('opacity-0');
        }, 1500);
        skipBtn.onclick = () => {
            skipIntro = true;
            isIntroFinished = true;
            clearInterval(typeInterval);
            clearTimeout(delayTimeout);
            checkReadyToStart();
        };
    }

    function typeNextMessage() {
        if (skipIntro) return;
        if (msgIndex >= INTRO_MESSAGES.length) {
            isIntroFinished = true;
            checkReadyToStart();
            return;
        }

        const msg = INTRO_MESSAGES[msgIndex];
        if (introTextEl) introTextEl.textContent = "";
        charIndex = 0;

        typeInterval = setInterval(() => {
            if (skipIntro) {
                clearInterval(typeInterval);
                return;
            }
            if (charIndex < msg.length) {
                if (introTextEl) introTextEl.textContent = msg.substring(0, charIndex + 1);
                charIndex++;
            } else {
                clearInterval(typeInterval);
                let pauseTime = msg.length > 50 ? 2500 : 1500;
                if (msgIndex === INTRO_MESSAGES.length - 1) pauseTime = 3000;
                delayTimeout = setTimeout(() => {
                    msgIndex++;
                    typeNextMessage();
                }, pauseTime);
            }
        }, 35);
    }

    setTimeout(typeNextMessage, 500);

    initHudControls();
    initHudLogPanelControls();
};

function checkReadyToStart() {
    if (isAssetsLoaded && isIntroFinished && isAuthResolved) {
        const skipBtn = document.getElementById('skip-intro-btn');
        if (skipBtn) skipBtn.classList.add('hidden');
        
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.style.opacity = '0';
        
        setTimeout(() => {
            if (loadingScreen) loadingScreen.style.display = 'none';
            
            if (currentUser) {
                // Auth ekranı açıksa kapat
                const authEl = document.getElementById('auth-screen');
                if (authEl && !authEl.classList.contains('hidden')) {
                    authEl.classList.add('hidden', 'opacity-0');
                }

                // Bulut kaydını getir
                db.collection("users").doc(currentUser.uid).get().then(doc => {
                    const startScreen = document.getElementById('click-to-start');
                    if (startScreen) {
                        startScreen.classList.remove('hidden');
                        startScreen.classList.add('flex');
                    }
                    if (doc.exists) {
                        const loadBtn = document.getElementById('btn-load-game');
                        if (loadBtn) loadBtn.classList.remove('hidden');
                        const savedData = doc.data();
                        let parsedData = null;
                        try {
                            const raw = savedData.saveData;
                            const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
                            parsedData = sanitizeCloudSavePayload(obj);
                        } catch (e) {
                            console.error('Cloud saveData parse error:', e);
                        }
                        window.cloudSaveAvailable = true;
                        window.cloudSaveData = parsedData;

                        if (parsedData && parsedData.playerName) {
                            const inp = document.getElementById('player-name-input');
                            if (inp) inp.value = String(parsedData.playerName).slice(0, PLAYER_NAME_MAX_LEN);
                        }
                    } else if (currentUser.displayName) {
                        const inp = document.getElementById('player-name-input');
                        if (inp) inp.value = currentUser.displayName;
                    }
                }).catch(err => {
                    console.error("Cloud check error:", err);
                    const startScreen = document.getElementById('click-to-start');
                    if(startScreen) {
                        startScreen.classList.remove('hidden');
                        startScreen.classList.add('flex');
                    }
                });

            } else {
                // Giriş yapılmamış. Auth ekranını göster.
                const startScreen = document.getElementById('click-to-start');
                if(startScreen) startScreen.classList.add('hidden');

                const authEl = document.getElementById('auth-screen');
                if (authEl) {
                    authEl.classList.remove('hidden');
                    setTimeout(() => authEl.classList.remove('opacity-0'), 50);
                }
            }
        }, (loadingScreen && loadingScreen.style.display !== 'none') ? 500 : 0);
    }
}

/** Oyuncu adı uzunluk üst sınırı (boşluk / özel karakter yok). */
const PLAYER_NAME_MAX_LEN = 12;

/** Yalnızca harf (TR + İngilizce) ve rakam; boşluk ve özel karakter yok. */
const PLAYER_NAME_ALLOWED_RE = /^[0-9A-Za-zÇÖŞÜĞİçöşüğıİı]+$/;

/** Yasaklı adlar: büyük harfe çevrilmiş ve tire/alt çizgi/boşluk kaldırılmış eşleşme (marka: AVCE, AVCIE). */
function isReservedPlayerName(normalizedUpper) {
    const compact = (normalizedUpper || '').replace(/[-_\s]/g, '');
    return compact === 'AVCE' || compact === 'AVCIE';
}

function turkishLocaleUpper(str) {
    return (str || '').toLocaleUpperCase('tr-TR');
}

/** Geçerli adı büyük harfe çevirir (yalnızca doğrulanmış girdiler için). */
function normalizeValidatedPlayerName(t) {
    return turkishLocaleUpper((t || '').trim()).replace(/\//g, '').slice(0, PLAYER_NAME_MAX_LEN);
}

/**
 * Oyuncu adı kuralları. Dönüş: { ok: true, normalized } | { ok: false, reason }.
 * reason: 'empty' | 'long' | 'chars' | 'reserved'
 * @param {{ allowLegacySavedBrand?: boolean }} [options] — yalnızca kayıttan yüklerken eski AVCI-E/AVC-E kayıtları için.
 */
function validatePlayerNameInput(raw, options) {
    const t = (raw || '').trim();
    const legacy = options && options.allowLegacySavedBrand;
    if (!t) return { ok: false, reason: 'empty' };
    if (t.length > PLAYER_NAME_MAX_LEN) return { ok: false, reason: 'long' };
    if (/^avci-e$/i.test(t)) {
        if (legacy) return { ok: true, normalized: 'AVCI-E' };
        return { ok: false, reason: 'reserved' };
    }
    if (/^avc-e$/i.test(t)) {
        if (legacy) return { ok: true, normalized: 'AVC-E' };
        return { ok: false, reason: 'reserved' };
    }
    if (!PLAYER_NAME_ALLOWED_RE.test(t)) return { ok: false, reason: 'chars' };
    const normalized = normalizeValidatedPlayerName(t);
    if (!normalized) return { ok: false, reason: 'empty' };
    if (isReservedPlayerName(normalized)) return { ok: false, reason: 'reserved' };
    return { ok: true, normalized };
}

function playerNameValidationMessage(reason) {
    switch (reason) {
        case 'empty':
            return 'Lütfen bir oyuncu adı girin.';
        case 'long':
            return `Oyuncu adı en fazla ${PLAYER_NAME_MAX_LEN} karakter olabilir.`;
        case 'chars':
            return 'Oyuncu adında yalnızca harf ve rakam kullanılabilir; boşluk ve özel karakter kullanılamaz.';
        case 'reserved':
            return 'Bu oyuncu adı (marka) kullanılamaz. Lütfen başka bir ad seçin.';
        default:
            return 'Geçersiz oyuncu adı.';
    }
}

/** Geçerliyse normalize edilmiş ad, değilse boş (sunucu / eşleşme için). */
function normalizePlayerDisplayName(raw) {
    const v = validatePlayerNameInput(raw);
    return v.ok ? v.normalized : '';
}

/** Yükleme kaynağındaki oyuncu adı (bulut öncelikli). */
function getPendingLoadPlayerName() {
    if (window.cloudSaveAvailable && window.cloudSaveData && window.cloudSaveData.playerName)
        return window.cloudSaveData.playerName;
    try {
        const raw = localStorage.getItem('minerSave');
        if (!raw) return null;
        const o = JSON.parse(raw);
        return o && o.playerName ? o.playerName : null;
    } catch (e) {
        return null;
    }
}

/**
 * Yeni macerada görünen adın başka bir hesaba ait olmamasını sağlar.
 * Firestore: koleksiyon `playerNames` — doc id = normalizePlayerDisplayName çıktısı.
 * Kurallar: okuma herkese veya auth; yazma yalnızca doc yoksa create (uid=kendi) veya doc.uid=kendi.
 */
function claimPlayerDisplayNameInFirestore(normalizedName) {
    if (!currentUser || !normalizedName) return Promise.resolve();
    const key = normalizedName;
    if (key === '.' || key === '..') return Promise.reject(new Error('INVALID_NAME_KEY'));
    const ref = db.collection('playerNames').doc(key);
    return db.runTransaction(tx => tx.get(ref).then(doc => {
        if (doc.exists) {
            const owner = doc.data() && doc.data().uid;
            if (owner && owner !== currentUser.uid) {
                const err = new Error('NAME_TAKEN');
                err.code = 'NAME_TAKEN';
                throw err;
            }
            return;
        }
        tx.set(ref, {
            uid: currentUser.uid,
            playerName: normalizedName,
            claimedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }));
}

function beginGameSession(load) {
    sfx.init();
    if (solarSwitchToastTimer) {
        clearTimeout(solarSwitchToastTimer);
        solarSwitchToastTimer = null;
    }
    if (solarLowToastTimer) {
        clearTimeout(solarLowToastTimer);
        solarLowToastTimer = null;
    }
    const solarToast = document.getElementById('solar-switch-toast');
    if (solarToast) {
        solarToast.classList.add('hidden', 'opacity-0');
        solarToast.classList.remove('opacity-100');
    }
    const solarLowToast = document.getElementById('solar-low-toast');
    if (solarLowToast) {
        solarLowToast.classList.add('hidden', 'opacity-0');
        solarLowToast.classList.remove('opacity-100');
    }

    const startScreen = document.getElementById('click-to-start');
    startScreen.style.opacity = '0';
    setTimeout(() => startScreen.classList.add('hidden'), 300);
    document.getElementById('ui').classList.remove('hidden');

    state.active = true;
    state.keys = {};
    state.prevMainEnergyForSolarToast = undefined;
    state.prevSolarRatioForLowToast = undefined;
    canvas.focus();
    generateWorld();
    if (load) {
        let saved;
        if (window.cloudSaveAvailable && window.cloudSaveData) {
            saved = window.cloudSaveData;
        } else {
            try {
                const raw = localStorage.getItem('minerSave');
                saved = raw ? sanitizeCloudSavePayload(JSON.parse(raw)) : null;
            } catch (e) {
                console.error('local minerSave parse error:', e);
                saved = null;
            }
        }
        if (saved) {
            Object.assign(state, saved);
            clampClientGameState();
        }
    } else {
        const nameInp = document.getElementById('player-name-input');
        const vn = nameInp ? validatePlayerNameInput(nameInp.value) : { ok: false };
        if (vn.ok) state.playerName = vn.normalized;
        
        // --- Tam Sıfırlama (Yeni Macera) ---
        state.money = 10000;
        state.pickLvl = 1;
        state.pickUpgradeCost = 20;
        state.lightLvl = 1;
        state.lightUpgradeCost = 200;
        state.invMax = 10;
        state.inventory = 0;
        state.invValue = 0;
        state.energyMax = 100;
        state.energy = 100;
        state.quests = [];
        state.stats = { totalMined: 0, totalEarned: 0, maxDepth: 0, totalOreValue: 0 };
        state.solarLvl = 0;
        state.solarUpgradeCost = 500;
        state.solarEnergy = 0;
        state.solarEnergyMax = 0;
        state.exoLvl = 0;
        state.exoUpgradeCost = 2000;
        state.flightMotorLvl = 0;
        state.flightMotorUpgradeCost = 750;
        state.drone = { x: 12 * 80, y: 4 * 80, active: false, hasExtraInv: false };
        state.chips = { antitoxin: false, cooling: false };
        state.hasRadar = false;
        state.currentRole = null;
        
        generateQuests();
    }
    state.messageLog = [];
    state.playerToast = null;

    updateQuests();
    updateUI();
    syncHudCollapseUi();
    renderMessageLog();
    refreshHudTop3Global();

    const mc = document.getElementById('minimap');
    LAYERS.forEach(l => {
        const yPercent = (l.depth / (MAP_H - SURFACE_Y)) * 100;
        const div = document.createElement('div');
        div.className = 'layer-indicator h-1';
        div.style.top = `${yPercent}%`;
        div.style.background = l.bgTop;
        mc.appendChild(div);
    });

    requestAnimationFrame(gameLoop);
}

function startGame(load = false) {
    const inp = document.getElementById('player-name-input');
    let validatedLoadNormalized = null;
    let newGameNormalized = null;

    if (load) {
        const pending = getPendingLoadPlayerName();
        if (pending) {
            const vn = validatePlayerNameInput(pending, { allowLegacySavedBrand: true });
            if (!vn.ok) {
                setTimeout(() => {
                    showAlert(
                        playerNameValidationMessage(vn.reason) + ' Kayıtlı profil geçersiz. Yeni macera ile uygun bir ad seçin.',
                        'warning'
                    );
                }, 100);
                return;
            }
            validatedLoadNormalized = vn.normalized;
        }
    } else {
        const vn = inp ? validatePlayerNameInput(inp.value) : { ok: false, reason: 'empty' };
        if (!vn.ok) {
            setTimeout(() => {
                showAlert(playerNameValidationMessage(vn.reason), 'warning');
            }, 100);
            if (inp) inp.focus();
            return;
        }
        newGameNormalized = vn.normalized;
    }

    const proceed = () => beginGameSession(load);

    const onClaimFail = (err, focusInput) => {
        if (err && (err.message === 'NAME_TAKEN' || err.code === 'NAME_TAKEN')) {
            showAlert(
                load
                    ? 'Kayıtlı oyuncu adınız başka bir hesaba bağlı görünüyor. Destek için yöneticiyle iletişime geçin veya yeni macera ile yeni bir ad seçin.'
                    : 'Bu oyuncu adı başka bir hesap tarafından kullanılıyor. Lütfen farklı bir isim seçin.',
                'warning'
            );
        } else if (err && err.code === 'permission-denied') {
            showAlert('İsim kaydı sunucuda reddedildi. Firestore kurallarına playerNames koleksiyonunu ekleyin.', 'error');
        } else {
            console.error('claimPlayerDisplayNameInFirestore', err);
            showAlert('İsim kontrolü yapılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.', 'error');
        }
        if (focusInput && inp) inp.focus();
    };

    if (load && currentUser && validatedLoadNormalized) {
        claimPlayerDisplayNameInFirestore(validatedLoadNormalized).then(proceed).catch(err => onClaimFail(err, false));
        return;
    }

    if (!load && currentUser && newGameNormalized) {
        claimPlayerDisplayNameInFirestore(newGameNormalized).then(proceed).catch(err => onClaimFail(err, true));
        return;
    }

    proceed();
}

function generateWorld() {
    state.world = [];
    for (let x = 0; x < MAP_W; x++) {
        state.world[x] = [];
        for (let y = 0; y < MAP_H; y++) {
            if (y < SURFACE_Y) {
                state.world[x][y] = null;
            } else if (y === SURFACE_Y) {
                state.world[x][y] = { ...GRASS, hp: 10, max: 10 };
            } else if (y === MAP_H - 1 || x === 0 || x === MAP_W - 1) {
                state.world[x][y] = { ...BEDROCK, hp: 999990, max: 999990 };
            } else {
                // Determine block type based on depth
                const validMines = MINE_TYPES.filter(m => y >= m.start && y <= m.end);

                let type;
                if (y >= 800) {
                    type = (Math.random() < 0.7) ? MAGMA_ROCK : validMines[Math.floor(Math.random() * validMines.length)];
                } else {
                    if (Math.random() < 0.8) {
                        type = (Math.random() > 0.6) ? MINE_TYPES.find(m => m.id === 'stone') : MINE_TYPES.find(m => m.id === 'dirt');
                    } else {
                        type = validMines[Math.floor(Math.random() * validMines.length)];
                    }
                }

                // Hardness exponentially increases by depth
                const hpScale = 1 + Math.pow(y * 0.08, 1.2);
                let isGas = false, crumble = 0;
                if (y > 50 && Math.random() < 0.05 && (!type || type.id === 'stone' || type.id === 'dirt')) isGas = true;
                if (y > 30 && Math.random() < 0.08 && (!type || type.id === 'stone')) crumble = 90; // 90 frame

                if (y > 150 && Math.random() < 0.005) {
                    type = { id: 'chest', name: 'Antik Sandık', val: 0, hardness: 200, particle: '#eab308' };
                    isGas = false; crumble = 0;
                }

                state.world[x][y] = type ? {
                    ...type,
                    hp: type.hardness * 10 * hpScale,
                    max: type.hardness * 10 * hpScale,
                    hitFlash: 0,
                    isGas: isGas,
                    crumble: crumble
                } : null;
            }
        }
    }
    state.player.x = 12 * TILE_SIZE;
    state.player.y = SURFACE_Y * TILE_SIZE - state.player.h;
    updateUI();
}

function shouldIgnoreModalKeys(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

/** Açık bina penceresinde: Enter/Space ana işlem, K kapat, Teknoloji 1–6, Akademi sınıf 1–3 + Enter ödül */
function tryHandleModalShortcut(e) {
    if (!state.activeModal || shouldIgnoreModalKeys(e)) return false;

    const m = state.activeModal;
    const isEnter = e.code === 'Enter' || e.code === 'NumpadEnter';
    const isSpace = e.code === 'Space';

    if (e.code === 'KeyK') {
        e.preventDefault();
        closeModal();
        return true;
    }

    switch (m) {
        case 'house':
            if (isEnter || isSpace) {
                e.preventDefault();
                actionSleep();
                return true;
            }
            break;
        case 'market':
            if (isEnter || isSpace) {
                e.preventDefault();
                actionSell();
                return true;
            }
            break;
        case 'warehouse':
            if (isEnter || isSpace) {
                e.preventDefault();
                actionUpgradeInv();
                return true;
            }
            break;
        case 'workshop':
            if (isEnter || isSpace) {
                e.preventDefault();
                actionUpgradePick();
                return true;
            }
            break;
        case 'tech': {
            const techMap = {
                Digit1: () => actionUpgradeLight(),
                Numpad1: () => actionUpgradeLight(),
                Digit2: () => actionUpgradeSolar(),
                Numpad2: () => actionUpgradeSolar(),
                Digit3: () => actionUpgradeExo(),
                Numpad3: () => actionUpgradeExo(),
                Digit4: () => actionBuyDrone(),
                Numpad4: () => actionBuyDrone(),
                Digit5: () => { if (!state.hasRadar) actionBuyRadar(); },
                Numpad5: () => { if (!state.hasRadar) actionBuyRadar(); },
                Digit6: () => actionUpgradeFlightMotor(),
                Numpad6: () => actionUpgradeFlightMotor()
            };
            const fn = techMap[e.code];
            if (fn) {
                e.preventDefault();
                fn();
                return true;
            }
            break;
        }
        case 'quest': {
            const rsBox = document.getElementById('role-selection-box');
            const roleSelVisible = rsBox && !rsBox.classList.contains('hidden');
            if (roleSelVisible && !state.currentRole) {
                if (e.code === 'Digit1' || e.code === 'Numpad1') {
                    e.preventDefault();
                    selectRole('miner');
                    return true;
                }
                if (e.code === 'Digit2' || e.code === 'Numpad2') {
                    e.preventDefault();
                    selectRole('engineer');
                    return true;
                }
                if (e.code === 'Digit3' || e.code === 'Numpad3') {
                    e.preventDefault();
                    selectRole('explorer');
                    return true;
                }
            }
            if (isEnter || isSpace) {
                for (let i = 0; i < state.quests.length; i++) {
                    if (state.quests[i].current >= state.quests[i].target) {
                        e.preventDefault();
                        claimQuest(i);
                        return true;
                    }
                }
            }
            break;
        }
        default:
            break;
    }
    return false;
}

window.addEventListener('keydown', e => {
    if (!state.active) return;
    if (state.activeModal && tryHandleModalShortcut(e)) return;
    if (state.activeModal && e.code === 'Space') e.preventDefault();
    state.keys[e.code] = true;
    if (e.code === 'KeyE') handleInteraction();
    if (e.code === 'Escape' && state.activeModal) closeModal();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        if (!state.activeModal) e.preventDefault();
    }
});
window.addEventListener('keyup', e => state.keys[e.code] = false);

const ALERT_BASE_CLASS =
    'fixed left-1/2 top-1/2 z-[220] -translate-x-1/2 -translate-y-1/2 max-w-[min(92vw,26rem)] px-8 py-4 sm:px-10 sm:py-5 rounded-2xl font-outfit font-bold text-sm sm:text-base leading-snug text-center pointer-events-none backdrop-blur-xl border transition-opacity duration-300';
const ALERT_VARIANT_CLASS = {
    success:
        'bg-emerald-950/92 text-emerald-50 border-emerald-400/40 shadow-[0_0_56px_rgba(16,185,129,0.28),inset_0_1px_0_rgba(255,255,255,0.06)]',
    error:
        'bg-rose-950/92 text-rose-50 border-rose-500/45 shadow-[0_0_56px_rgba(244,63,94,0.32),inset_0_1px_0_rgba(255,255,255,0.06)]',
    warning:
        'bg-amber-950/92 text-amber-50 border-amber-400/45 shadow-[0_0_56px_rgba(245,158,11,0.28),inset_0_1px_0_rgba(255,255,255,0.06)]',
    info:
        'bg-slate-950/94 text-slate-100 border-sky-500/38 shadow-[0_0_56px_rgba(56,189,248,0.22),inset_0_1px_0_rgba(255,255,255,0.06)]'
};

const PLAYER_TOAST_MS = 4000;
/** Oyun oturumu boyunca tutulacak maksimum log satırı (geniş panelde hepsi scroll ile görünür). */
const MESSAGE_LOG_MAX = 100;

/** Canvas balon renkleri (variant ile uyumlu) */
const PLAYER_TOAST_STYLE = {
    success: { fill: 'rgba(236, 253, 245, 0.96)', stroke: 'rgba(16, 185, 129, 0.92)', text: '#065f46' },
    error: { fill: 'rgba(255, 241, 242, 0.96)', stroke: 'rgba(244, 63, 94, 0.9)', text: '#9f1239' },
    warning: { fill: 'rgba(254, 252, 232, 0.97)', stroke: 'rgba(245, 158, 11, 0.9)', text: '#713f12' },
    info: { fill: 'rgba(240, 249, 255, 0.96)', stroke: 'rgba(56, 189, 248, 0.88)', text: '#0c4a6e' }
};

const HUD_LOG_VARIANT_CLASS = {
    success: 'border-l-emerald-400/90 text-emerald-100/95 bg-emerald-950/25',
    error: 'border-l-rose-400/90 text-rose-100/95 bg-rose-950/20',
    warning: 'border-l-amber-400/90 text-amber-100/95 bg-amber-950/25',
    info: 'border-l-sky-400/80 text-slate-200 bg-slate-900/40'
};

function pushMessageLog(text, variant) {
    if (!Array.isArray(state.messageLog)) state.messageLog = [];
    state.messageLog.unshift({ text: String(text), variant, at: Date.now() });
    while (state.messageLog.length > MESSAGE_LOG_MAX) state.messageLog.pop();
    renderMessageLog();
}

function renderMessageLog() {
    const body = document.getElementById('hud-console-body');
    if (!body) return;
    body.textContent = '';
    const consoleEl = document.getElementById('hud-console');
    const expanded = consoleEl?.classList.contains('hud-log-panel--expanded');
    const log = Array.isArray(state.messageLog) ? state.messageLog : [];
    const visible = expanded ? log : log.slice(0, HUD_LOG_VISIBLE_COLLAPSED);
    const frag = document.createDocumentFragment();
    for (const row of visible) {
        const v = HUD_LOG_VARIANT_CLASS[row.variant] ? row.variant : 'info';
        const line = document.createElement('div');
        line.className = `border-l-2 pl-2 py-0.5 rounded-r break-words ${HUD_LOG_VARIANT_CLASS[v]}`;
        line.textContent = row.text;
        frag.appendChild(line);
    }
    body.appendChild(frag);
    body.scrollTop = 0;
}

const MINER_HUD_COLLAPSED_KEY = 'minerHudCollapsed';
/** localStorage === '1' → genişletilmiş mesaj paneli; aksi halde dar (son 3 mesaj). Durum paneli daralınca yok sayılır. */
const MINER_HUD_LOG_EXPANDED_KEY = 'minerHudLogExpanded';
const HUD_LOG_VISIBLE_COLLAPSED = 3;

function isStatusHudCollapsed() {
    return document.getElementById('hud-status-shell')?.classList.contains('hud-status-collapsed') ?? false;
}

function syncHudLogPanelUi() {
    const el = document.getElementById('hud-console');
    const btn = document.getElementById('hud-console-toggle-btn');
    if (!el) return;

    if (isStatusHudCollapsed()) {
        el.classList.remove('hud-log-panel--expanded');
        el.classList.add('hud-log-panel--collapsed');
        el.classList.add('hud-log-locked-to-status');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '▼';
            btn.setAttribute('aria-expanded', 'false');
            btn.title = 'Durum paneli daraltıkken mesajlar genişletilemez — önce durumu genişletin';
        }
        renderMessageLog();
        return;
    }

    el.classList.remove('hud-log-locked-to-status');
    if (btn) btn.disabled = false;

    const expanded = localStorage.getItem(MINER_HUD_LOG_EXPANDED_KEY) === '1';
    el.classList.toggle('hud-log-panel--expanded', expanded);
    el.classList.toggle('hud-log-panel--collapsed', !expanded);
    if (btn) {
        btn.textContent = expanded ? '▲' : '▼';
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        btn.title = expanded ? 'Mesaj panelini daralt (son 3 mesaj)' : 'Mesaj panelini genişlet';
    }
    renderMessageLog();
}

function initHudLogPanelControls() {
    const btn = document.getElementById('hud-console-toggle-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', e => {
        e.stopPropagation();
        if (isStatusHudCollapsed()) return;
        const cur = localStorage.getItem(MINER_HUD_LOG_EXPANDED_KEY) === '1';
        localStorage.setItem(MINER_HUD_LOG_EXPANDED_KEY, cur ? '0' : '1');
        syncHudLogPanelUi();
    });
    syncHudLogPanelUi();
}

function syncHudCollapseUi() {
    const shell = document.getElementById('hud-status-shell');
    const body = document.getElementById('hud-status-body');
    const compact = document.getElementById('hud-status-compact');
    if (!shell || !body || !compact) return;
    const collapsed = localStorage.getItem(MINER_HUD_COLLAPSED_KEY) === '1';
    if (collapsed) {
        shell.classList.add('hud-status-collapsed');
        body.classList.add('hidden');
        compact.classList.remove('hidden');
        shell.setAttribute('aria-expanded', 'false');
        shell.title = 'Paneli genişletmek için tıklayın';
    } else {
        shell.classList.remove('hud-status-collapsed');
        body.classList.remove('hidden');
        compact.classList.add('hidden');
        shell.setAttribute('aria-expanded', 'true');
        shell.title = 'Paneli daraltmak için tıklayın';
    }
    syncHudLogPanelUi();
}

function initHudControls() {
    const shell = document.getElementById('hud-status-shell');
    if (!shell || shell.dataset.hudToggleBound === '1') return;
    shell.dataset.hudToggleBound = '1';
    function toggleHudCollapsed() {
        const cur = localStorage.getItem(MINER_HUD_COLLAPSED_KEY) === '1';
        localStorage.setItem(MINER_HUD_COLLAPSED_KEY, cur ? '0' : '1');
        syncHudCollapseUi();
    }
    shell.addEventListener('click', e => {
        e.stopPropagation();
        toggleHudCollapsed();
    });
    shell.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleHudCollapsed();
        }
    });
    syncHudCollapseUi();
}

/** @param {'success'|'error'|'warning'|'info'} [variant] */
function showAlert(msg, variant = 'info') {
    const v = Object.prototype.hasOwnProperty.call(ALERT_VARIANT_CLASS, variant) ? variant : 'info';
    const inGameHud = state.active && !state.activeModal;

    if (inGameHud) {
        pushMessageLog(msg, v);
        state.playerToast = { text: String(msg), variant: v, until: Date.now() + PLAYER_TOAST_MS };
        if (alertHideTimer) {
            clearTimeout(alertHideTimer);
            alertHideTimer = null;
        }
        const el = document.getElementById('alert');
        if (el) el.style.opacity = '0';
        return;
    }

    const el = document.getElementById('alert');
    const msgEl = document.getElementById('alert-msg');
    if (!el || !msgEl) return;
    el.className = `${ALERT_BASE_CLASS} ${ALERT_VARIANT_CLASS[v]}`;
    el.setAttribute('data-alert-variant', v);
    msgEl.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = '';
    if (alertHideTimer) clearTimeout(alertHideTimer);
    alertHideTimer = setTimeout(() => {
        el.style.opacity = '0';
        alertHideTimer = null;
    }, PLAYER_TOAST_MS);
}

function spawnFloatingText(text, x, y, color) {
    const el = document.createElement('div');
    el.className = 'floating-text text-xl';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    el.innerText = text;
    document.getElementById('floating-texts').appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

function cameraShake(intensity) {
    state.camera.shakeIntensity = intensity;
}

function updatePhysics() {
    if (state.activeModal) return;

    const p = state.player;
    const gravity = 0.5;
    const maxFall = 15;

    if (state.gasEffectTimer > 0) {
        state.gasEffectTimer--;
        useEnergy(0.10);
        if (state.gasEffectTimer % 10 === 0) {
            state.particles.push({ x: p.x + p.w / 2 + (Math.random() - 0.5) * 20, y: p.y + p.h / 2 + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 5, vy: -3, life: 1.0, color: '#4ade80', size: 8 });
        }
    }

    let mSpeed = p.speed;
    if (state.currentRole === 'explorer') mSpeed = 9.5;

    // Encumbrance (Ağırlık) Sistemi Hesabı
    let weightRatio = state.inventory / state.invMax; 
    let penaltyMultiplier = 1 - (state.exoLvl * 0.2); // Her Exo Lv %20 ceza indirimi sağlar
    if (penaltyMultiplier < 0) penaltyMultiplier = 0;
    
    let speedPenalty = weightRatio * 0.5 * penaltyMultiplier; // %100 dolulukta maks hızdan %50 eksiltir (Eğer Exo yoksa)
    mSpeed = mSpeed * (1 - speedPenalty);

    // Asistan Drone Takibi
    if (state.drone && state.drone.active) {
        let targetDx = p.dir === 1 ? -40 : 40;
        let dX = p.x + p.w / 2 + targetDx;
        let dY = p.y - 30 + Math.sin(state.frame * 0.1) * 15;
        state.drone.x += (dX - state.drone.x) * 0.05;
        state.drone.y += (dY - state.drone.y) * 0.05;
    }

    // Horizontal Movement
    let dx = 0;
    if (state.keys['ArrowLeft'] || state.keys['KeyA']) { dx = -mSpeed; p.dir = -1; p.vx = dx; }
    else if (state.keys['ArrowRight'] || state.keys['KeyD']) { dx = mSpeed; p.dir = 1; p.vx = dx; }
    else { p.vx = 0; }

    // Jetpack: sabit tırmanış hızı (motor seviyesiyle artar); ivmeli birikim yok.
    const wantsJet = state.keys['ArrowUp'] || state.keys['KeyW'];
    if (wantsJet && hasAnyEnergy(0.10)) {
        p.vy = -getFlightAscentSpeed();
        useEnergy(0.10);
        if (Math.random() > 0.5) {
            state.particles.push({
                x: p.x + p.w / 2 + (Math.random() - 0.5) * 10, y: p.y + p.h,
                vx: -(p.vx * 0.2) + (Math.random() - 0.5) * 2, vy: Math.random() * 3 + 3,
                life: 1.0, color: '#f97316', size: Math.random() * 6 + 4
            });
        }
    } else {
        p.vy += gravity;
        if (p.vy > maxFall) p.vy = maxFall;
    }

    // X Collision
    if (dx !== 0) {
        useEnergy(0.005);
        const nx = p.x + dx;

        // Yeryüzü (Surface) Horizontal Boundary Limitation
        let hitWall = false;
        if (p.y < SURFACE_Y * TILE_SIZE) {
            if (nx < 20 || nx > MAP_W * TILE_SIZE - p.w - 25) {
                hitWall = true;
            }
        }

        if (!hitWall && !checkCollision(nx, p.y, true)) {
            p.x = nx;
        } else {
            if (!hitWall) attemptMineAt(p.dir === 1 ? p.x + p.w + 2 : p.x - 2, p.y + p.h / 2);
        }
    }

    // Y Collision
    p.onGround = false;
    const ny = p.y + p.vy;

    // Ceiling sky limit
    if (ny < -100) { p.y = -100; p.vy = 0; }
    else if (!checkCollision(p.x, ny)) {
        p.y = ny;
    } else {
        if (p.vy > 0) {
            p.onGround = true;

            // Y-snapping to perfectly rest on top of the block and prevent sinking into it (which breaks X collision)
            const tileTop = Math.floor((ny + p.h - 8) / TILE_SIZE) * TILE_SIZE;
            p.y = tileTop + 8 - p.h - 0.1;

            const standTx = Math.floor((p.x + p.w / 2) / TILE_SIZE);
            const standTy = Math.floor((tileTop) / TILE_SIZE);
            const standBlock = state.world[standTx]?.[standTy];
            if (standBlock && standBlock.crumble > 0) {
                standBlock.crumble--;
                if (standBlock.crumble % 10 === 0) standBlock.hitFlash = 2;
                if (standBlock.crumble <= 0) {
                    state.world[standTx][standTy] = null;
                    sfx.play('hit');
                    for (let i = 0; i < 10; i++) {
                        state.particles.push({
                            x: standTx * TILE_SIZE + TILE_SIZE / 2, y: standTy * TILE_SIZE + TILE_SIZE / 2,
                            vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 1.0, color: standBlock.particle, size: Math.random() * 6 + 3
                        });
                    }
                }
            }

            if (state.keys['ArrowDown'] || state.keys['KeyS']) {
                attemptMineAt(p.x + p.w / 2, p.y + p.h + 2);
            }
            p.vy = 0;
        } else {
            p.vy = 0; // hit ceiling block
        }
    }

    // Magma Heat Energy Drain
    if (state.currentLayer && state.currentLayer.name === 'Magma Katmanı') {
        if (!state.chips.cooling) {
            useEnergy(0.015);
            if (state.frame % 120 === 0 && state.gasEffectTimer <= 0) {
                spawnFloatingText("🔥 SICAK!", p.x + p.w / 2, p.y - 10, '#ef4444');
            }
        }
    }

    if (!hasAnyEnergy(0.1) && p.onGround) passOut();
}

function checkCollision(nx, ny, isXMovement = false) {
    if (ny < 0) return false;
    const margin = 8;
    const bottomY = ny + state.player.h - margin;
    const topY = ny + margin;
    const leftX = nx + margin;
    const rightX = nx + state.player.w - margin;

    const pts = [
        { x: leftX, y: topY, isBottom: false },
        { x: rightX, y: topY, isBottom: false },
        { x: leftX, y: bottomY, isBottom: true },
        { x: rightX, y: bottomY, isBottom: true }
    ];

    for (let pt of pts) {
        const tx = Math.floor(pt.x / TILE_SIZE);
        const ty = Math.floor(pt.y / TILE_SIZE);
        const b = state.world[tx]?.[ty];
        if (b && !b.isPassable) {
            if (b.isPlatform) {
                if (isXMovement) continue;
                if (!pt.isBottom) continue;
                if (state.keys['ArrowDown'] || state.keys['KeyS']) continue;

                const tileTop = ty * TILE_SIZE;
                const oldBottom = state.player.y + state.player.h - margin;
                if (oldBottom > tileTop + 0.1) continue;
            }
            return true;
        }
    }
    return false;
}

function attemptMineAt(wx, wy) {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);

    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;
    const b = state.world[tx][ty];
    if (!b || b.id === 'bedrock' || b.isUnmineable) return;

    let baseUse = 0.08;
    let effPick = state.pickLvl;
    if (state.currentRole === 'miner') {
        baseUse = 0.04;
        effPick += 3;
    }

    if (!hasAnyEnergy(baseUse)) {
        if (state.frame % 30 === 0) showAlert("Enerjin çok düşük!", 'warning');
        return;
    }

    if (effPick < b.hardness) {
        if (state.frame % 30 === 0) showAlert("Kazman bu bloğa yetersiz! Atölyeye git.", 'warning');
        return;
    }

    b.hp -= effPick;
    b.hitFlash = 5;
    useEnergy(baseUse);
    cameraShake(2);
    sfx.play('hit');

    for (let i = 0; i < 4; i++) {
        state.particles.push({
            x: wx, y: wy,
            vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
            life: 1.0, color: b.particle, size: Math.random() * 8 + 4
        });
    }

    if (b.hp <= 0) {
        cameraShake(6);
        state.world[tx][ty] = null;
        checkQuests('mine', 1);
        state.stats.totalMined++;

        if (b.isGas) {
            if (state.chips && state.chips.antitoxin) {
                const ptX = (tx * TILE_SIZE + TILE_SIZE / 2) - state.camera.x;
                const ptY = (ty * TILE_SIZE + TILE_SIZE / 2) - state.camera.y;
                spawnFloatingText("TOKSİN ENGELLENDİ 🧪", ptX, ptY, '#4ade80');
            } else {
                state.gasEffectTimer = Math.max(state.gasEffectTimer, 300); // 5 sn
                sfx.play('gas');
                showAlert("Zehirli Gaz Sızıntısı!", 'error');
                for (let i = 0; i < 30; i++) {
                    state.particles.push({ x: wx, y: wy, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 1.5, color: '#4ade80', size: Math.random() * 15 + 10 });
                }
            }
        }

        if (b.id === 'chest') {
            cameraShake(15);
            sfx.play('gem');
            if (state.chips && !state.chips.antitoxin && Math.random() < 0.5) {
                state.chips.antitoxin = true;
                showAlert("🧪 ANTİ-TOKSİN ÇİPİ BULUNDU! Zehirli gazlardan etkilenmiyorsun.", 'success');
            } else if (state.chips && !state.chips.cooling) {
                state.chips.cooling = true;
                showAlert("❄️ SOĞUTUCU ÇİP BULUNDU! Magmanın ısı sarfiyatı artık seni sömürmeyecek.", 'success');
            } else {
                state.money += 4000;
                showAlert("Sandıktan 4000 💰 Nakit Çıktı!", 'success');
            }
            updateUI();
        }

        // Şans Sistemi (Kritik Elmas Buluşu)
        if (b.id === 'stone' || b.id === 'dirt') {
            if (Math.random() < 0.03) {
                const ptX = (tx * TILE_SIZE + TILE_SIZE / 2) - state.camera.x;
                const ptY = (ty * TILE_SIZE + TILE_SIZE / 2) - state.camera.y;
                spawnFloatingText(`ŞANSLI BULUŞ! +Elmas 💎`, ptX, ptY, '#0ea5e9');
                sfx.play('gem');
                if (state.inventory >= state.invMax) {
                    state.money += 500;
                } else {
                    state.inventory++;
                    state.invValue += 500;
                }
            }
        }

        if (b.val > 0) {
            if (state.inventory >= state.invMax) {
                showAlert("Envanterin Dolu! Yüzeye dönüp sat.", 'warning');
            } else {
                state.inventory++;
                state.invValue += b.val;
                sfx.play('gem');
                const ptX = (tx * TILE_SIZE + TILE_SIZE / 2) - state.camera.x;
                const ptY = (ty * TILE_SIZE + TILE_SIZE / 2) - state.camera.y;
                spawnFloatingText(`+${b.name} ${b.val} 💰`, ptX, ptY, b.particle);
            }
        }
    }
    updateUI();
}

function passOut() {
    state.energy = state.energyMax * 0.5;
    if (state.solarLvl > 0) state.solarEnergy = state.solarEnergyMax * 0.5;
    state.inventory = 0;
    state.invValue = 0;

    state.player.x = 12 * TILE_SIZE;
    state.player.y = SURFACE_Y * TILE_SIZE - state.player.h;
    state.player.vy = 0;

    sfx.play('hit');
    showAlert("Enerjin bitti ve bayıldın! Topladığın cevherler döküldü.", 'error');
    updateUI();
    saveGame();
}

function getNearbyBuilding() {
    const px = state.player.x + state.player.w / 2;
    const py = state.player.y + state.player.h / 2;
    for (let b of BUILDINGS) {
        const bx = b.x + b.w / 2;
        const by = (SURFACE_Y * TILE_SIZE) - b.h / 2 + 20 + BUILDING_Y_OFFSET;
        if (Math.hypot(px - bx, py - by) < 180) return b;
    }
    return null;
}

function handleInteraction() {
    if (state.activeModal) {
        closeModal(); return;
    }
    const b = getNearbyBuilding();
    if (b) {
        state.activeModal = b.action;
        state.keys = {};
        document.getElementById('modals').classList.remove('hidden');
        document.getElementById(`modal-${b.action}`).classList.remove('hidden');
        setTimeout(() => { document.getElementById('modals').style.opacity = '1'; }, 10);

        if (b.action === 'market') document.getElementById('market-val').innerText = state.invValue.toLocaleString('tr-TR');
        if (b.action === 'quest') updateQuests();
    }
}

function closeModal() {
    document.getElementById('modals').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('modals').classList.add('hidden');
        if (state.activeModal) {
            const el = document.getElementById(`modal-${state.activeModal}`);
            if (el) el.classList.add('hidden');
        }
        state.activeModal = null;
    }, 300);
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LB_ORDER_FIELDS = {
    mined: 'totalMined',
    ore: 'totalOreValue',
    depth: 'maxDepth',
    prog: 'progressionScore'
};

function lbResolveGlobalBlend(row) {
    const g = row.globalBlendScore;
    if (typeof g === 'number' && !isNaN(g)) return g;
    return computeGlobalBlendScore(row);
}

let leaderboardCurrentTab = 'global';

const LB_TAB_CLASS_ACTIVE = 'lb-tab-btn pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-black uppercase tracking-wider transition-all duration-300 ring-2 ring-amber-400/70 border-amber-400/40 bg-gradient-to-b from-amber-500/25 to-amber-950/40 text-amber-50 shadow-[0_0_24px_rgba(251,191,36,0.15)]';
const LB_TAB_CLASS_IDLE = 'lb-tab-btn pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-black uppercase tracking-wider transition-all duration-300 border-white/10 text-slate-300 hover:bg-white/[0.06] hover:border-white/20';

function openAboutModal() {
    if (!state.active) return;
    state.activeModal = 'about';
    state.keys = {};
    document.getElementById('modals').classList.remove('hidden');
    document.getElementById('modal-about').classList.remove('hidden');
    setTimeout(() => { document.getElementById('modals').style.opacity = '1'; }, 10);
}

function openPremiumModal() {
    if (!state.active) return;
    state.activeModal = 'premium';
    state.keys = {};
    document.querySelectorAll('.modal-content').forEach(el => el.classList.add('hidden'));
    document.getElementById('modals').classList.remove('hidden');
    document.getElementById('modal-premium').classList.remove('hidden');
    setTimeout(() => { document.getElementById('modals').style.opacity = '1'; }, 10);
}

function actionBuyPremiumMoney() {
    if (confirm("Kredi kartınızdan 500 TL tutarında çekim yapılacaktır. Onaylıyor musunuz?")) {
        state.money += 1000000;
        showAlert("1.000.000 💰 hesabınıza eklendi!", 'success');
        updateUI(); saveGame(); closeModal();
    }
}

function actionBuyPremiumPick() {
    if (confirm("Kredi kartınızdan 500 TL tutarında çekim yapılacaktır. Onaylıyor musunuz?")) {
        state.pickLvl = PICK_MAX_LVL;
        showAlert("Kazma gücünüz maksimum seviyeye ulaştı!", 'success');
        updateUI(); saveGame(); closeModal();
    }
}

function actionBuyPremiumTech() {
    if (confirm("Kredi kartınızdan 500 TL tutarında çekim yapılacaktır. Onaylıyor musunuz?")) {
        state.hasRadar = true;
        state.drone.active = true;
        if(state.exoLvl < 5) state.exoLvl = 5;
        if(state.flightMotorLvl < FLIGHT_MOTOR_MAX_LVL) state.flightMotorLvl = FLIGHT_MOTOR_MAX_LVL;
        showAlert("Bütün ileri düzey teknoloji satın alındı!", 'success');
        updateUI(); saveGame(); closeModal();
    }
}

function openLeaderboard() {
    if (!state.active) return;
    state.activeModal = 'leaderboard';
    state.keys = {};
    document.getElementById('modals').classList.remove('hidden');
    document.getElementById('modal-leaderboard').classList.remove('hidden');
    setTimeout(() => { document.getElementById('modals').style.opacity = '1'; }, 10);
    switchLeaderboardTab(leaderboardCurrentTab || 'global');
    refreshHudTop3Global();
}

function switchLeaderboardTab(tab) {
    leaderboardCurrentTab = tab;
    const tabs = ['global', 'mined', 'ore', 'depth', 'prog'];
    tabs.forEach(t => {
        const btn = document.getElementById('lb-tab-' + t);
        const panel = document.getElementById('lb-panel-' + t);
        if (btn) btn.className = t === tab ? LB_TAB_CLASS_ACTIVE : LB_TAB_CLASS_IDLE;
        if (panel) panel.classList.toggle('hidden', t !== tab);
    });
    if (tab === 'global') loadLeaderboardGlobal();
    else loadLeaderboardMetricTab(tab);
}

function lbDisplayRank(val, field) {
    if (field === 'maxDepth') return String((val || 0) * 10) + ' m';
    return Number(val || 0).toLocaleString('tr-TR');
}

function lbLeaderboardRankCell(rank) {
    if (rank === 1) return '<span class="text-2xl leading-none" title="1.">🥇</span>';
    if (rank === 2) return '<span class="text-2xl leading-none" title="2.">🥈</span>';
    if (rank === 3) return '<span class="text-2xl leading-none" title="3.">🥉</span>';
    return '<span class="font-black tabular-nums text-amber-200/80">#' + rank + '</span>';
}

function lbLeaderboardTopRowClass(rank) {
    if (rank === 1) return 'lb-rank-gold';
    if (rank === 2) return 'lb-rank-silver';
    if (rank === 3) return 'lb-rank-bronze';
    return '';
}

function renderLeaderboardTbody(tbodyId, rows, field) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-slate-500 py-6">Henüz kayıt yok.</td></tr>';
        return;
    }
    let html = '';
    rows.forEach((r, i) => {
        const rank = i + 1;
        const name = escapeHtml(r.playerName || '—');
        const v = r[field];
        const accent = lbLeaderboardTopRowClass(rank);
        html += '<tr class="lb-tr border-b border-white/[0.06] ' + accent + '"><td class="py-3 pr-2 align-middle w-14">' + lbLeaderboardRankCell(rank) + '</td><td class="py-3 font-bold text-white/95">' + name + '</td><td class="py-3 text-right text-emerald-300/95 font-semibold tabular-nums">' + lbDisplayRank(v, field) + '</td></tr>';
    });
    tbody.innerHTML = html;
}

function loadLeaderboardMetricTab(tab) {
    const field = LB_ORDER_FIELDS[tab];
    if (!field) return;
    const tbodyId = 'lb-tbody-' + tab;
    const tbody = document.getElementById(tbodyId);
    if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center text-slate-500 py-6">Yükleniyor…</td></tr>';

    db.collection('leaderboard').orderBy(field, 'desc').limit(50).get()
        .then(snap => {
            const rows = [];
            snap.forEach(doc => rows.push(doc.data()));
            renderLeaderboardTbody(tbodyId, rows, field);
        })
        .catch(err => {
            console.error('Leaderboard query failed:', err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center text-red-400 py-6">Liste yüklenemedi. Firestore kuralları ve indeksleri kontrol edin.</td></tr>';
        });
}

function loadLeaderboardGlobal() {
    const mainTbody = document.getElementById('lb-global-main-tbody');
    if (mainTbody) mainTbody.innerHTML = '<tr><td colspan="3" class="text-center text-slate-500 py-8 font-semibold">Yükleniyor…</td></tr>';

    function finishFromSnap(snap) {
        const all = [];
        snap.forEach(doc => all.push(doc.data()));
        all.forEach(r => { r._lbBlend = lbResolveGlobalBlend(r); });
        all.sort((a, b) => (b._lbBlend || 0) - (a._lbBlend || 0));

        const formatGlobalPuan = r => Number(r._lbBlend || 0).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

        if (mainTbody) {
            if (all.length === 0) {
                mainTbody.innerHTML = '<tr><td colspan="3" class="text-center text-slate-500 py-8">Henüz kayıt yok.</td></tr>';
            } else {
                const top = all.slice(0, 100);
                let mainHtml = '';
                top.forEach((r, i) => {
                    const rank = i + 1;
                    const name = escapeHtml(r.playerName || '—');
                    const puan = formatGlobalPuan(r);
                    mainHtml += '<tr class="lb-tr border-b border-white/[0.06] ' + lbLeaderboardTopRowClass(rank) + '"><td class="py-3 pr-2 align-middle w-14">' + lbLeaderboardRankCell(rank) + '</td><td class="py-3 font-bold text-white/95">' + name + '</td><td class="py-3 text-right text-amber-200/95 font-black tabular-nums">' + puan + '</td></tr>';
                });
                mainTbody.innerHTML = mainHtml;
            }
        }
    }

    db.collection('leaderboard')
        .orderBy('globalBlendScore', 'desc')
        .limit(LB_GLOBAL_ORDERBY_LIMIT)
        .get()
        .then(snap => {
            if (snap.size === 0) {
                return db.collection('leaderboard').get().then(finishFromSnap);
            }
            finishFromSnap(snap);
        })
        .catch(err => {
            console.warn('Leaderboard orderBy(globalBlendScore) failed; falling back to full collection read.', err);
            return db.collection('leaderboard').get().then(finishFromSnap);
        })
        .catch(err => {
            console.error('Global leaderboard failed:', err);
            if (mainTbody) mainTbody.innerHTML = '<tr><td colspan="3" class="text-center text-red-400 py-8">Yüklenemedi. Firestore kuralları ve indeksleri kontrol edin.</td></tr>';
        });
}

const HUD_TOP3_DEBOUNCE_MS = 45000;

function scheduleRefreshHudTop3Global() {
    if (hudTop3RefreshDebounceTimer) clearTimeout(hudTop3RefreshDebounceTimer);
    hudTop3RefreshDebounceTimer = setTimeout(() => {
        hudTop3RefreshDebounceTimer = null;
        refreshHudTop3Global();
    }, HUD_TOP3_DEBOUNCE_MS);
}

/** HUD sağ üst: global blend’e göre ilk 3 oyuncu (şeffaf kürsü). */
function renderHudTop3Podium(sortedDesc) {
    const podium = document.getElementById('hud-top3-podium');
    if (!podium) return;
    const top = sortedDesc.slice(0, 3);
    const second = top[1] || null;
    const first = top[0] || null;
    const third = top[2] || null;

    const emptySlot = minH =>
        '<div class="flex-1 ' + minH + ' rounded-xl border border-dashed border-white/12 bg-white/[0.04] flex flex-col items-center justify-center opacity-50">' +
        '<span class="text-[0.7rem] text-slate-500/90">—</span></div>';

    const filledSlot = (row, minH, medal, borderGlow) => {
        const name = escapeHtml((row.playerName || '—').slice(0, 11));
        const fullName = escapeHtml(row.playerName || '');
        const score = Number(lbResolveGlobalBlend(row)).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const ch = String(row.playerName || '?').charAt(0).toUpperCase();
        const initial = escapeHtml(ch);
        const pu = row.photoURL && /^https:\/\//i.test(String(row.photoURL)) ? String(row.photoURL) : '';
        const avatar = pu
            ? '<img src="' + escapeHtml(pu) + '" alt="" class="w-8 h-8 rounded-full object-cover border border-white/30 shadow-md ring-1 ring-amber-400/20" loading="lazy" referrerpolicy="no-referrer" />'
            : '<div class="w-8 h-8 rounded-full border border-white/25 bg-gradient-to-br from-slate-600 to-slate-900 flex items-center justify-center text-[0.72rem] font-black text-white shadow-inner">' + initial + '</div>';
        return '<div class="flex-1 ' + minH + ' rounded-xl border ' + borderGlow + ' bg-gradient-to-b from-white/[0.09] to-transparent flex flex-col items-center justify-end pb-1.5 pt-1 px-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-[2px]">' +
            '<span class="text-base sm:text-lg leading-none mb-0.5 drop-shadow-[0_0_8px_rgba(0,0,0,0.45)]">' + medal + '</span>' +
            '<div class="mb-0.5 scale-95 sm:scale-100">' + avatar + '</div>' +
            '<div class="text-[0.55rem] sm:text-[0.6rem] font-bold text-white/95 truncate max-w-full text-center leading-tight px-0.5" title="' + fullName + '">' + name + '</div>' +
            '<div class="text-[0.5rem] sm:text-[0.55rem] font-black tabular-nums text-amber-200/95 mt-0.5 tracking-tight">' + score + '</div>' +
            '</div>';
    };

    let html = '';
    html += second ? filledSlot(second, 'min-h-[5.25rem]', '🥈', 'border-slate-300/30 shadow-[0_0_16px_rgba(148,163,184,0.12)]') : emptySlot('min-h-[5.25rem]');
    html += first ? filledSlot(first, 'min-h-[6.85rem]', '🥇', 'border-amber-300/50 shadow-[0_0_22px_rgba(251,191,36,0.22)]') : emptySlot('min-h-[6.85rem]');
    html += third ? filledSlot(third, 'min-h-[4.35rem]', '🥉', 'border-amber-800/40 shadow-[0_0_12px_rgba(180,83,9,0.15)]') : emptySlot('min-h-[4.35rem]');
    podium.innerHTML = html;
}

function refreshHudTop3Global() {
    const podium = document.getElementById('hud-top3-podium');
    if (!podium) return;

    function finishFromSnap(snap) {
        const all = [];
        snap.forEach(doc => all.push(doc.data()));
        all.forEach(r => { r._lbBlend = lbResolveGlobalBlend(r); });
        all.sort((a, b) => (b._lbBlend || 0) - (a._lbBlend || 0));
        if (all.length === 0) {
            podium.innerHTML = '<div class="w-full text-center text-[0.62rem] text-slate-400/95 py-3 font-semibold">Henüz kayıt yok</div>';
            return;
        }
        renderHudTop3Podium(all);
    }

    podium.innerHTML = '<div class="flex-1 flex items-center justify-center text-slate-400/90 text-[0.62rem] font-semibold py-3 w-full">Yükleniyor…</div>';

    db.collection('leaderboard')
        .orderBy('globalBlendScore', 'desc')
        .limit(3)
        .get()
        .then(snap => {
            if (snap.size === 0) {
                return db.collection('leaderboard').get().then(finishFromSnap);
            }
            finishFromSnap(snap);
        })
        .catch(err => {
            console.warn('HUD top3 orderBy failed; fallback full read.', err);
            return db.collection('leaderboard').get().then(finishFromSnap);
        })
        .catch(err => {
            console.error('HUD top3 failed:', err);
            podium.innerHTML = '<div class="flex-1 text-center text-[0.62rem] text-rose-300/90 py-2 px-1">Liste alınamadı</div>';
        });
}

function useActiveSkill() {
    if (!state.currentRole) {
        if(state.frame % 30 === 0) showAlert("Önce Akademi üyesi olmalısın!", 'warning');
        return;
    }
    if (state.activeSkillCooldown > 0) {
        if(state.frame % 30 === 0) showAlert(`Yetenek beklemede: ${Math.ceil(state.activeSkillCooldown / 60)}sn`, 'warning');
        return;
    }

    if (state.currentRole === 'miner') {
        const p = state.player;
        const ctxX = Math.floor((p.x + p.w / 2) / TILE_SIZE);
        const ctxY = Math.floor((p.y + p.h / 2) / TILE_SIZE);
        
        let minedSomething = false;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const tx = ctxX + dx, ty = ctxY + dy;
                if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
                    const b = state.world[tx][ty];
                    if (b && !b.isUnmineable && b.id !== 'bedrock') {
                        state.world[tx][ty] = null;
                        state.stats.totalMined++;
                        minedSomething = true;
                        
                        for(let i=0; i<4; i++) {
                            state.particles.push({
                                x: tx * TILE_SIZE + TILE_SIZE/2, y: ty * TILE_SIZE + TILE_SIZE/2,
                                vx: (Math.random()-0.5)*15, vy: (Math.random()-0.5)*15,
                                life: 1.5, color: b.particle, size: Math.random()*8+4
                            });
                        }
                        
                        if (b.val > 0 && state.inventory < state.invMax) {
                            state.inventory++;
                            state.invValue += b.val;
                            spawnFloatingText(`+${b.name} ${b.val}`, tx * TILE_SIZE, ty * TILE_SIZE, b.particle);
                        }
                    }
                }
            }
        }
        
        if (minedSomething) {
            cameraShake(10);
            sfx.play('hit'); 
            setTimeout(() => sfx.play('hit'), 50);
            state.activeSkillCooldown = 60 * 60; 
            showAlert("Dinamit patlatıldı!", 'success');
        } else {
            showAlert("Patlatacak bir şey yok!", 'info');
        }
    } 
    else if (state.currentRole === 'engineer') {
        state.scannerRings = [];
        const p = state.player;
        const px = p.x + p.w / 2, py = p.y + p.h / 2;
        let found = 0;
        
        for (let x = 0; x < MAP_W; x++) {
            for (let y = Math.max(0, Math.floor(py/TILE_SIZE)-25); y < Math.min(MAP_H, Math.floor(py/TILE_SIZE)+25); y++) {
                const b = state.world[x][y];
                if (b && b.val >= 120) { 
                    const bx = x * TILE_SIZE + TILE_SIZE/2;
                    const by = y * TILE_SIZE + TILE_SIZE/2;
                    if (Math.hypot(px - bx, py - by) < 1500) {
                        state.scannerRings.push({ x: bx, y: by, life: 180 });
                        found++;
                    }
                }
            }
        }
        if (found > 0) {
            sfx.play('coin');
            showAlert(`Radarda ${found} değerli kütle tespit edildi!`, 'success');
            state.activeSkillCooldown = 45 * 60; 
        } else {
            showAlert("Yakınlarda değerli maden yok.", 'info');
            state.activeSkillCooldown = 5 * 60; 
        }
    }
    else if (state.currentRole === 'explorer') {
        const p = state.player;
        if (p.y > SURFACE_Y * TILE_SIZE + 100) {
            state.teleportBeacon = { x: p.x, y: p.y };
            showAlert("Işınlanma noktası belirlendi. Yüzeyden dönebilirsiniz.", 'success');
            sfx.play('coin');
            state.activeSkillCooldown = 5 * 60; 
        } else {
            if (state.teleportBeacon) {
                p.x = state.teleportBeacon.x;
                p.y = state.teleportBeacon.y;
                p.vy = 0;
                state.teleportBeacon = null; 
                cameraShake(5);
                sfx.play('gem');
                showAlert("İşaretinize ışınlandınız!", 'success');
                state.activeSkillCooldown = 30 * 60; 
            } else {
                showAlert("Önce derinlerde bir [F] basarak ışınlanma noktası bırakmalısın.", 'warning');
            }
        }
    }
    updateUI();
}

function actionSleep() {
    state.energy = state.energyMax;
    if (state.solarLvl > 0) state.solarEnergy = state.solarEnergyMax;
    showAlert("İyice dinlendin! Enerjin dolu.", 'success');
    updateUI(); saveGame(); closeModal();
}

function actionSell() {
    if (state.inventory > 0) {
        state.money += state.invValue;
        state.stats.totalEarned += state.invValue;
        state.stats.totalOreValue = (state.stats.totalOreValue || 0) + state.invValue;
        checkQuests('earn', state.invValue);
        sfx.play('coin');
        showAlert(`${state.invValue.toLocaleString('tr-TR')} 💰 kazandın!`, 'success');
        state.inventory = 0; state.invValue = 0;
        updateUI(); saveGame(); closeModal();
    } else showAlert("Satacak cevherin yok.", 'info');
}

function getUpgradeCost(baseCost) {
    return state.currentRole === 'engineer' ? Math.floor(500 * 0.8) : 500;
}

function actionUpgradeInv() {
    const cost = getUpgradeCost(state.invUpgradeCost);
    if (state.money >= cost) {
        state.money -= cost;
        state.invMax += 10;
        state.invUpgradeCost = Math.floor(state.invUpgradeCost * 2.5);
        document.getElementById('cost-inv').innerText = getUpgradeCost(state.invUpgradeCost).toLocaleString('tr-TR');
        showAlert("Depo genişletildi!", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

function actionUpgradePick() {
    if (state.pickLvl >= PICK_MAX_LVL) {
        showAlert("Kazma zaten en üst seviyede!", 'info');
        return;
    }
    const cost = getUpgradeCost(state.pickUpgradeCost);
    if (state.money >= cost) {
        state.money -= cost;
        state.pickLvl++;
        state.pickUpgradeCost = Math.floor(state.pickUpgradeCost * 1.5);
        const elPickCost = document.getElementById('cost-pick');
        if (elPickCost) {
            elPickCost.innerText = state.pickLvl >= PICK_MAX_LVL
                ? 'MAX'
                : getUpgradeCost(state.pickUpgradeCost).toLocaleString('tr-TR');
        }
        showAlert("Kazma gücü arttı!", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

function actionUpgradeLight() {
    const cost = getUpgradeCost(state.lightUpgradeCost);
    if (state.money >= cost) {
        state.money -= cost;
        state.lightLvl++;
        state.lightUpgradeCost = Math.floor(state.lightUpgradeCost * 3.0);
        document.getElementById('cost-light').innerText = getUpgradeCost(state.lightUpgradeCost).toLocaleString('tr-TR');
        showAlert("Aydınlatma menzili arttı!", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

function actionUpgradeSolar() {
    const cost = getUpgradeCost(state.solarUpgradeCost);
    if (state.money >= cost) {
        state.money -= cost;
        state.solarLvl++;
        state.solarUpgradeCost = Math.floor(state.solarUpgradeCost * 3.5);
        state.solarEnergyMax = state.solarLvl * 100;
        state.solarEnergy = state.solarEnergyMax;

        const elLv = document.getElementById('lvl-solar');
        if (elLv) elLv.innerText = state.solarLvl;
        const elCost = document.getElementById('cost-solar');
        if (elCost) elCost.innerText = getUpgradeCost(state.solarUpgradeCost).toLocaleString('tr-TR');

        showAlert("Solar Enerji sistemi geliştirildi!", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

function actionUpgradeExo() {
    const cost = getUpgradeCost(state.exoUpgradeCost);
    if (state.money >= cost) {
        if (state.exoLvl >= 5) { showAlert("En üst seviyedesiniz!", 'info'); return; }
        state.money -= cost;
        state.exoLvl++;
        state.exoUpgradeCost = Math.floor(state.exoUpgradeCost * 3.5);

        const elLv = document.getElementById('lvl-exo');
        if (elLv) elLv.innerText = state.exoLvl;
        const elCost = document.getElementById('cost-exo');
        if (elCost) {
            if(state.exoLvl >= 5) elCost.innerText = "MAX";
            else elCost.innerText = getUpgradeCost(state.exoUpgradeCost).toLocaleString('tr-TR');
        }

        showAlert("Dış İskelet (Exosuit) geliştirildi!", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

function actionUpgradeFlightMotor() {
    const cost = getUpgradeCost(state.flightMotorUpgradeCost);
    if (state.flightMotorLvl >= FLIGHT_MOTOR_MAX_LVL) {
        showAlert("Uçuş motoru en üst seviyede!", 'info');
        return;
    }
    if (state.money >= cost) {
        state.money -= cost;
        state.flightMotorLvl++;
        state.flightMotorUpgradeCost = Math.floor(state.flightMotorUpgradeCost * 2.85);
        const elLv = document.getElementById('lvl-flight');
        if (elLv) elLv.innerText = state.flightMotorLvl;
        const elCost = document.getElementById('cost-flight');
        if (elCost) {
            elCost.innerText = state.flightMotorLvl >= FLIGHT_MOTOR_MAX_LVL
                ? 'MAX'
                : getUpgradeCost(state.flightMotorUpgradeCost).toLocaleString('tr-TR');
        }
        showAlert("Uçuş motoru geliştirildi! Jetpack tırmanış hızın arttı.", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

function actionBuyDrone() {
    const cost = getUpgradeCost(5000);
    if (state.money >= cost) {
        if (state.drone.active) { showAlert("Zaten bir Asistan Drone'unuz var!", 'warning'); return; }
        state.money -= cost;
        state.drone.active = true;
        state.drone.x = state.player.x;
        state.drone.y = state.player.y;

        const elCost = document.getElementById('cost-drone');
        if (elCost) elCost.innerText = "ALINDI";

        showAlert("Asistan Drone başarıyla satın alındı!", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

function actionBuyRadar() {
    const cost = getUpgradeCost(1500);
    if (state.money >= cost) {
        state.money -= cost;
        state.hasRadar = true;
        showAlert("Derinlik radarı aktif edildi!", 'success');
        updateUI(); saveGame();
    } else showAlert("Paran yetersiz!", 'error');
}

/** Enerji oranına göre çubuk ve etiket rengi: dolu = camgöbeği/mavi, azaldıkça sarı-turuncu, kritik = kırmızı */
function setEnergyHudColors(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    const h = Math.round(r * 195);
    const bar = document.getElementById('energy-bar');
    const track = document.getElementById('energy-bar-track');
    const label = document.getElementById('energy-text');
    if (bar) {
        const hDark = Math.max(0, h - 38);
        const hLight = Math.min(205, h + 18);
        bar.style.background = `linear-gradient(90deg, hsl(${hDark}, 90%, 36%) 0%, hsl(${h}, 92%, 48%) 48%, hsl(${hLight}, 95%, 58%) 100%)`;
        bar.style.boxShadow = `0 0 14px hsla(${h}, 92%, 52%, ${0.22 + r * 0.2})`;
    }
    if (track) track.style.setProperty('--energy-hue', String(h));
    if (label) {
        label.style.color = `hsl(${h}, 88%, ${68 + r * 12}%)`;
    }
    const energyBlock = document.getElementById('energy-hud-block');
    if (energyBlock) energyBlock.classList.toggle('hud-energy-critical', state.energy < 30);
}

function showSolarSwitchToast() {
    const el = document.getElementById('solar-switch-toast');
    if (!el) return;
    if (solarSwitchToastTimer) {
        clearTimeout(solarSwitchToastTimer);
        solarSwitchToastTimer = null;
    }
    el.classList.remove('hidden');
    requestAnimationFrame(() => {
        el.classList.remove('opacity-0');
        el.classList.add('opacity-100');
    });
    solarSwitchToastTimer = setTimeout(() => {
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
        setTimeout(() => {
            el.classList.add('hidden');
        }, 500);
        solarSwitchToastTimer = null;
    }, 5000);
}

function showSolarLowToast() {
    const el = document.getElementById('solar-low-toast');
    if (!el) return;
    if (solarLowToastTimer) {
        clearTimeout(solarLowToastTimer);
        solarLowToastTimer = null;
    }
    el.classList.remove('hidden');
    requestAnimationFrame(() => {
        el.classList.remove('opacity-0');
        el.classList.add('opacity-100');
    });
    solarLowToastTimer = setTimeout(() => {
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
        setTimeout(() => {
            el.classList.add('hidden');
        }, 500);
        solarLowToastTimer = null;
    }, 5000);
}

function updateUI() {
    const moneyStr = Math.floor(state.money).toLocaleString('tr-TR');
    document.getElementById('money').innerText = moneyStr;
    let effPick = state.pickLvl + (state.currentRole === 'miner' ? 3 : 0);
    document.getElementById('pick-lvl').innerText = effPick;

    const hn = document.getElementById('hud-name');
    if (hn) hn.innerText = state.playerName;

    let d = Math.floor(state.player.y / TILE_SIZE) - SURFACE_Y + 1;
    if (d < 0) d = 0;

    const hcm = document.getElementById('hud-compact-money');
    if (hcm) hcm.textContent = moneyStr;
    const hcd = document.getElementById('hud-compact-depth');
    if (hcd) hcd.textContent = String(d * 10);

    checkQuests('depth', d);
    if (d > state.stats.maxDepth) state.stats.maxDepth = d;

    // Determine Current Layer Name
    let currLayer = LAYERS[0];
    for (let l of LAYERS) {
        if (d >= l.depth) currLayer = l;
    }
    state.currentLayer = currLayer;

    document.getElementById('depth-m').innerText = d * 10;
    document.getElementById('layer-name').innerText = currLayer.name;

    const energyRatio = state.energyMax > 0 ? state.energy / state.energyMax : 0;
    const energyPct = state.energyMax > 0 ? Math.round((state.energy / state.energyMax) * 100) : 0;
    document.getElementById('energy-text').innerText = `%${energyPct}`;
    const energyBarEl = document.getElementById('energy-bar');
    if (energyBarEl) energyBarEl.style.width = `${energyRatio * 100}%`;
    setEnergyHudColors(energyRatio);

    const sc = document.getElementById('solar-container');
    if (sc) {
        if (state.solarLvl > 0) {
            sc.classList.remove('hidden');
            document.getElementById('solar-text').innerText = `${Math.floor(state.solarEnergy)}/${state.solarEnergyMax}`;
            const sMax = state.solarEnergyMax;
            const sRatio = sMax > 0 ? state.solarEnergy / sMax : 0;
            document.getElementById('solar-bar').style.width = `${sRatio * 100}%`;
            const prevS = state.prevSolarRatioForLowToast;
            if (sMax > 0 && prevS !== undefined && prevS > 0.2 && sRatio <= 0.2) {
                showSolarLowToast();
            }
            state.prevSolarRatioForLowToast = sRatio;
        } else {
            sc.classList.add('hidden');
            state.prevSolarRatioForLowToast = undefined;
        }
    }

    document.getElementById('inv-text').innerText = `${state.inventory}/${state.invMax}`;
    document.getElementById('inv-bar').style.width = `${(state.inventory / state.invMax) * 100}%`;

    const mp = document.getElementById('minimap-player');
    if (mp) {
        const yPercent = Math.max(0, Math.min(100, (state.player.y / (MAP_H * TILE_SIZE)) * 100));
        mp.style.top = `${yPercent}%`;
    }
    
    const rw = document.getElementById('radar-widget');
    if(rw) {
        if(state.hasRadar) rw.classList.remove('hidden');
        else rw.classList.add('hidden');
    }

    const radBuy = document.getElementById('radar-buy-box');
    const radOwn = document.getElementById('radar-owned-box');
    if(radBuy && radOwn) {
        if(state.hasRadar) {
            radBuy.classList.add('hidden');
            radOwn.classList.remove('hidden');
        } else {
            radBuy.classList.remove('hidden');
            radOwn.classList.add('hidden');
        }
    }

    if (document.getElementById('cost-pick')) {
        document.getElementById('cost-pick').innerText = state.pickLvl >= PICK_MAX_LVL
            ? 'MAX'
            : getUpgradeCost(state.pickUpgradeCost).toLocaleString('tr-TR');
    }
    if(document.getElementById('cost-inv')) document.getElementById('cost-inv').innerText = getUpgradeCost(state.invUpgradeCost).toLocaleString('tr-TR');
    if(document.getElementById('cost-light')) document.getElementById('cost-light').innerText = getUpgradeCost(state.lightUpgradeCost).toLocaleString('tr-TR');
    if(document.getElementById('cost-solar')) document.getElementById('cost-solar').innerText = getUpgradeCost(state.solarUpgradeCost).toLocaleString('tr-TR');
    if(document.getElementById('cost-exo')) document.getElementById('cost-exo').innerText = state.exoLvl >= 5 ? "MAX" : getUpgradeCost(state.exoUpgradeCost).toLocaleString('tr-TR');
    if(document.getElementById('lvl-exo')) document.getElementById('lvl-exo').innerText = state.exoLvl;

    if (document.getElementById('lvl-flight')) document.getElementById('lvl-flight').innerText = state.flightMotorLvl;
    const hudFl = document.getElementById('hud-flight-motor-lvl');
    if (hudFl) hudFl.textContent = `${state.flightMotorLvl}/${FLIGHT_MOTOR_MAX_LVL}`;
    if (document.getElementById('cost-flight')) {
        document.getElementById('cost-flight').innerText = state.flightMotorLvl >= FLIGHT_MOTOR_MAX_LVL
            ? 'MAX'
            : getUpgradeCost(state.flightMotorUpgradeCost).toLocaleString('tr-TR');
    }
    
    const drC = document.getElementById('cost-drone');
    if(drC) drC.innerText = state.drone.active ? "ALINDI" : getUpgradeCost(5000).toLocaleString('tr-TR');

    if (state.chips) {
        const c1 = document.getElementById('chip-antitoxin');
        const c2 = document.getElementById('chip-cooling');
        if (state.chips.antitoxin && c1) {
            c1.classList.remove('grayscale', 'opacity-50');
            c1.classList.add('border-green-400', 'shadow-[0_0_10px_rgba(74,222,128,0.5)]');
        }
        if (state.chips.cooling && c2) {
            c2.classList.remove('grayscale', 'opacity-50');
            c2.classList.add('border-sky-400', 'shadow-[0_0_10px_rgba(56,189,248,0.5)]');
        }
    }

    if (state.solarLvl > 0 && state.energy <= 0) {
        const prev = state.prevMainEnergyForSolarToast;
        if (prev !== undefined && prev > 0) showSolarSwitchToast();
    }
    state.prevMainEnergyForSolarToast = state.energy;
}

function selectRole(roleId) {
    if (state.currentRole) return;
    state.currentRole = roleId;

    if (roleId === 'engineer') {
        if(state.solarLvl === 0) {
            state.solarLvl = 1;
            state.solarEnergyMax = 100;
            state.solarEnergy = 100;
        }
    }

    sfx.play('coin'); 
    showAlert("Akademi'ye başarıyla kayıt oldunuz!", 'success');
    
    // Anında UI Gncellemesi
    const b = getNearbyBuilding();
    if(b && b.action === 'quest') {
        const boxSel = document.getElementById('role-selection-box');
        const boxAct = document.getElementById('role-active-box');
        const labelAct = document.getElementById('active-role-name');
        
        if(boxSel) boxSel.classList.add('hidden');
        if(boxAct) boxAct.classList.remove('hidden');
        const rName = state.currentRole === 'miner' ? '⛏️ Madenci' : (state.currentRole === 'engineer' ? '⚙️ Mühendis' : '🗺️ Kaşif');
        if(labelAct) labelAct.innerText = rName;
    }
    updateUI();
    saveGame();
}

/** Enerji %30 ve altındayken isim rozetinin üstünde küçük konuşma balonu. */
function drawEnergyLowBubble(ctx, p) {
    const maxE = state.energyMax;
    if (maxE <= 0) return;
    const ratio = state.energy / maxE;
    // Solar enerjisi aktifken ana enerji bittiğinde "ana enerji bitti" mesajını bastır.
    if (state.solarLvl > 0 && state.energy <= 0) return;
    if (ratio > 0.3) return;

    const bob = p.onGround ? Math.sin(state.frame * 0.15) * 1.2 : 0;
    const headTop = p.y + p.h / 2 - 37 + bob;
    const badgeBottom = headTop - 4;
    const badgeH = 16;
    const badgeTop = badgeBottom - badgeH;

    const text = 'Ana Enerjimiz Bitiyor';
    ctx.save();
    ctx.font = '600 9px Outfit, system-ui, sans-serif';
    const tw = ctx.measureText(text).width;
    const padX = 8;
    const bodyH = 20;
    const tailH = 6;
    const tailHalfW = 5;
    const r = 7;
    const tipGap = 3;
    const tailTipY = badgeTop - tipGap;
    const rectBottom = tailTipY - tailH;
    const rectTop = rectBottom - bodyH;
    const w = Math.ceil(tw + padX * 2);
    const cx = p.x + p.w / 2;
    const x = cx - w / 2;
    const y = rectTop;

    ctx.fillStyle = 'rgba(254, 252, 232, 0.97)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    ctx.beginPath();
    ctx.roundRect(x, y, w, bodyH, r);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.beginPath();
    ctx.moveTo(cx - tailHalfW, rectBottom);
    ctx.lineTo(cx, tailTipY);
    ctx.lineTo(cx + tailHalfW, rectBottom);
    ctx.closePath();
    ctx.fillStyle = 'rgba(254, 252, 232, 0.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
    ctx.stroke();

    ctx.fillStyle = '#713f12';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + bodyH / 2);
    ctx.restore();
}

function wrapToastLines(ctx, text, maxInnerW) {
    const ell = '…';
    function truncateWord(w) {
        if (ctx.measureText(w).width <= maxInnerW) return w;
        let i = w.length;
        while (i > 0 && ctx.measureText(w.slice(0, i) + ell).width > maxInnerW) i--;
        return i > 0 ? w.slice(0, i) + ell : ell;
    }
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(test).width <= maxInnerW) cur = test;
        else {
            if (cur) lines.push(cur);
            cur = ctx.measureText(w).width > maxInnerW ? truncateWord(w) : w;
        }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
}

/** showAlert ile gelen mesaj — isim rozetinin üstünde ~4 sn (dünya koordinatları). */
function drawPlayerToast(ctx, p) {
    const t = state.playerToast;
    if (!t || !t.text) return;
    if (Date.now() > t.until) {
        state.playerToast = null;
        return;
    }
    const vKey = PLAYER_TOAST_STYLE[t.variant] ? t.variant : 'info';
    const st = PLAYER_TOAST_STYLE[vKey];

    const bob = p.onGround ? Math.sin(state.frame * 0.15) * 1.2 : 0;
    const headTop = p.y + p.h / 2 - 37 + bob;
    const nameBadgeBottom = headTop - 4;
    const nameBadgeTop = nameBadgeBottom - 16;

    const maxInnerW = 200;
    ctx.save();
    ctx.font = '600 11px Outfit, system-ui, sans-serif';
    const lines = wrapToastLines(ctx, t.text, maxInnerW);
    const lineH = 14;
    const padX = 10;
    const padY = 7;
    let maxLineW = 0;
    for (const ln of lines) maxLineW = Math.max(maxLineW, ctx.measureText(ln).width);
    const w = Math.ceil(Math.min(maxLineW + padX * 2, maxInnerW + padX * 2));
    const bodyH = padY * 2 + lines.length * lineH;

    const tailH = 6;
    const tailHalfW = 5;
    const tipGap = 5;
    const tailTipY = nameBadgeTop - tipGap;
    const rectBottom = tailTipY - tailH;
    const rectTop = rectBottom - bodyH;
    const cx = p.x + p.w / 2;
    const x = cx - w / 2;
    const r = 8;

    ctx.fillStyle = st.fill;
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = 1.35;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;

    ctx.beginPath();
    ctx.roundRect(x, rectTop, w, bodyH, r);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.beginPath();
    ctx.moveTo(cx - tailHalfW, rectBottom);
    ctx.lineTo(cx, tailTipY);
    ctx.lineTo(cx + tailHalfW, rectBottom);
    ctx.closePath();
    ctx.fillStyle = st.fill;
    ctx.fill();
    ctx.strokeStyle = st.stroke;
    ctx.stroke();

    ctx.fillStyle = st.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let ly = rectTop + padY + lineH / 2;
    for (const ln of lines) {
        ctx.fillText(ln, cx, ly);
        ly += lineH;
    }
    ctx.restore();
}

/** Rozet metni: marka yazımı tr-TR büyük harfte bozulmasın diye sabit gösterim. */
function playerNameBadgeDisplayText(rawName) {
    const s = rawName && String(rawName).trim();
    if (!s) return 'AVCI-E';
    if (/^avci-e$/i.test(s)) return 'AVCI-E';
    if (/^avc-e$/i.test(s)) return 'AVC-E';
    return turkishLocaleUpper(s);
}

/** Oyuncu robotunun üzerinde küçük rozet tarzında isim (dünya koordinatları). */
function drawPlayerNameBadge(ctx, p, rawName) {
    const text = playerNameBadgeDisplayText(rawName);
    const maxLen = 14;
    const display = text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
    const bob = p.onGround ? Math.sin(state.frame * 0.15) * 1.2 : 0;
    const headTop = p.y + p.h / 2 - 37 + bob;
    const badgeBottom = headTop - 4;

    ctx.save();
    ctx.font = '700 10px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(display).width;
    const padX = 5;
    const padY = 2;
    const w = Math.max(tw + padX * 2, 28);
    const h = 16;
    const cx = p.x + p.w / 2;
    const x = cx - w / 2;
    const y = badgeBottom - h;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f1f5f9';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.fillText(display, cx, y + h - 4);
    ctx.shadowBlur = 0;
    ctx.restore();
}

/** Hasarlı blokların alt kenarında premium can çubuğu (cam çerçeve + gradient + parlaklık). */
function drawBlockHpBar(ctx, px, py, hpRatio) {
    const pad = 8;
    const barW = TILE_SIZE - pad * 2;
    const barH = 7;
    const x = px + pad;
    const y = py + TILE_SIZE - 15;
    const r = 3.5;
    const t = Math.max(0, Math.min(1, hpRatio));
    const fillW = Math.max(barW * t, t > 0 ? 1 : 0);

    ctx.save();

    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, r);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, r);
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, r);
    ctx.clip();

    if (fillW > 0) {
        const g = ctx.createLinearGradient(x, y, x + fillW, y + barH);
        if (t > 0.45) {
            g.addColorStop(0, '#047857');
            g.addColorStop(0.45, '#10b981');
            g.addColorStop(1, '#6ee7b7');
        } else {
            g.addColorStop(0, '#b45309');
            g.addColorStop(0.5, '#f59e0b');
            g.addColorStop(1, '#fde68a');
        }
        ctx.fillStyle = g;
        ctx.fillRect(x, y, fillW, barH);

        const shine = ctx.createLinearGradient(x, y, x, y + barH);
        shine.addColorStop(0, 'rgba(255,255,255,0.38)');
        shine.addColorStop(0.5, 'rgba(255,255,255,0.06)');
        shine.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, fillW, barH);

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(x + 1, y + 1, Math.max(fillW - 2, 0), 1.5);
    }

    ctx.restore();
}


function gameLoop() {
    if (!state.active) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    state.frame++;

    updatePhysics();

    let targetX = state.player.x + state.player.w / 2 - canvas.width / 2;
    let targetY = state.player.y + state.player.h / 2 - canvas.height / 2;

    targetX = Math.max(0, Math.min(targetX, MAP_W * TILE_SIZE - canvas.width));
    targetY = Math.max(-200, Math.min(targetY, MAP_H * TILE_SIZE - canvas.height));

    state.camera.x += (targetX - state.camera.x) * 0.15;
    state.camera.y += (targetY - state.camera.y) * 0.15;

    let camShakeX = 0, camShakeY = 0;
    if (state.camera.shakeIntensity > 0) {
        camShakeX = (Math.random() - 0.5) * state.camera.shakeIntensity;
        camShakeY = (Math.random() - 0.5) * state.camera.shakeIntensity;
        state.camera.shakeIntensity *= 0.8;
    }

    ctx.save();

    // Dynamic Layer Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, state.currentLayer.bgTop);
    bgGrad.addColorStop(1, state.currentLayer.bgBot);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply Camera
    ctx.translate(-state.camera.x - camShakeX, -state.camera.y - camShakeY);

    const startCol = Math.max(0, Math.floor(state.camera.x / TILE_SIZE));
    const endCol = Math.min(MAP_W, Math.ceil((state.camera.x + canvas.width) / TILE_SIZE));
    const startRow = Math.max(0, Math.floor((state.camera.y - 300) / TILE_SIZE)); // pad top for rendering buildings
    const endRow = Math.min(MAP_H, Math.ceil((state.camera.y + canvas.height) / TILE_SIZE));

    // Blocks
    for (let x = startCol; x < endCol; x++) {
        for (let y = Math.max(0, startRow); y < endRow; y++) {
            const b = state.world[x][y];
            if (b) {
                const px = x * TILE_SIZE, py = y * TILE_SIZE;
                const img = images[b.id] || images.stone;

                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(px, py + 8, TILE_SIZE, TILE_SIZE);

                if (b.hitFlash > 0) {
                    ctx.filter = `brightness(150%)`;
                    b.hitFlash--;
                }
                else if (b.isMagma) {
                    // special visual for magma blocks (tinted red)
                    ctx.filter = `sepia(1) hue-rotate(-50deg) saturate(3) brightness(70%)`;
                }

                if (b.id === 'chest') {
                    ctx.fillStyle = '#b45309'; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                    ctx.fillStyle = '#facc15'; ctx.fillRect(px, py + TILE_SIZE / 2 - 4, TILE_SIZE, 8); 
                    ctx.fillStyle = '#1e293b'; ctx.fillRect(px + TILE_SIZE / 2 - 4, py + TILE_SIZE / 2 - 8, 8, 16);
                } else {
                    ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
                    ctx.filter = 'none';
                }

                if (b.hp < b.max && b.id !== 'bedrock') {
                    drawBlockHpBar(ctx, px, py, b.hp / b.max);
                }
            } else if (y >= SURFACE_Y) {
                const px = x * TILE_SIZE, py = y * TILE_SIZE;
                // Deeper darkness based on layer
                ctx.fillStyle = `rgba(0,0,0,${0.3 + (state.currentLayer.depth / 1000) * 0.5})`;
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    // Buildings
    if (startRow <= SURFACE_Y) {
        for (let b of BUILDINGS) {
            if (b.x + b.w > state.camera.x && b.x < state.camera.x + canvas.width) {
                const img = images[b.id];
                if (img) {
                    const by = (SURFACE_Y * TILE_SIZE) - b.h + 20 + BUILDING_Y_OFFSET;
                    ctx.drawImage(img, b.x, by, b.w, b.h);
                }
            }
        }
    }

    const p = state.player;
    ctx.globalCompositeOperation = 'screen';

    // Ambient Magma Glow if deep
    if (state.currentLayer.name === 'Magma Katmanı') {
        const ambient = ctx.createLinearGradient(0, state.camera.y, 0, state.camera.y + canvas.height);
        ambient.addColorStop(0, 'transparent');
        ambient.addColorStop(1, 'rgba(239, 68, 68, 0.15)');
        ctx.fillStyle = ambient;
        ctx.fillRect(state.camera.x, state.camera.y, canvas.width, canvas.height);
    }

    let lightRadius = 400 + (state.lightLvl * 100);
    if (state.currentRole === 'explorer') lightRadius += 200;
    
    const light = ctx.createRadialGradient(p.x + p.w / 2, p.y + p.h / 2, 0, p.x + p.w / 2, p.y + p.h / 2, lightRadius);
    light.addColorStop(0, 'rgba(255,255,255,0.15)');
    light.addColorStop(1, 'transparent');
    ctx.fillStyle = light;
    ctx.fillRect(p.x - lightRadius, p.y - lightRadius, lightRadius * 2, lightRadius * 2);
    
    // Drone Light
    if (state.drone && state.drone.active) {
        const dLight = ctx.createRadialGradient(state.drone.x, state.drone.y, 0, state.drone.x, state.drone.y, 250);
        dLight.addColorStop(0, 'rgba(14, 165, 233, 0.25)'); // sky blue
        dLight.addColorStop(1, 'transparent');
        ctx.fillStyle = dLight;
        ctx.fillRect(state.drone.x - 250, state.drone.y - 250, 500, 500);
    }
    
    ctx.globalCompositeOperation = 'source-over';

    // Draw Drone Entity
    if (state.drone && state.drone.active) {
        ctx.save();
        ctx.translate(state.drone.x, state.drone.y);
        const dx = p.x - state.drone.x;
        ctx.rotate(dx * 0.002 + Math.sin(state.frame * 0.1) * 0.1); 
        
        // Drone Gölge
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 15;

        // İtici motor kasaları (Yanlarda ufak gri roketler)
        ctx.fillStyle = '#334155';
        ctx.beginPath(); ctx.roundRect(-16, -2, 8, 14, 2); ctx.fill(); // Sol
        ctx.beginPath(); ctx.roundRect(8, -2, 8, 14, 2); ctx.fill();   // Sağ

        // Ana Gövde (Paslı Sarı/Kutu form)
        const dGrad = ctx.createLinearGradient(-12, -10, 12, 10);
        dGrad.addColorStop(0, '#fef08a'); 
        dGrad.addColorStop(0.5, '#facc15'); 
        dGrad.addColorStop(1, '#b45309'); 
        ctx.fillStyle = dGrad;
        ctx.beginPath(); ctx.roundRect(-12, -10, 24, 20, 3); ctx.fill();

        // Gövde Yıpranma Çizgisi
        ctx.strokeStyle = '#92400e';
        ctx.lineWidth = 1;
        ctx.strokeRect(-10, -8, 20, 16);
        
        // Uyarı Şeritleri (Sarı-Siyah)
        ctx.fillStyle = '#1e293b'; 
        ctx.beginPath(); ctx.roundRect(-10, -8, 20, 4, 1); ctx.fill();
        ctx.fillStyle = '#facc15';
        for (let ix = -8; ix < 10; ix += 6) {
            ctx.fillRect(ix, -8, 4, 4);
        }

        // Ana Mercek (Kamera Şekli)
        ctx.fillStyle = '#475569';
        ctx.beginPath(); ctx.arc(0, 2, 6, 0, Math.PI*2); ctx.fill(); // Dış çerçeve
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.arc(0, 2, 4, 0, Math.PI*2); ctx.fill(); // İç lens
        
        // Lens Yansıması
        ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.beginPath(); ctx.arc(-1, 1, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0; 
        
        // Yan Mini Sensör Işığı
        ctx.fillStyle = state.frame % 40 < 20 ? '#ef4444' : '#7f1d1d';
        ctx.beginPath(); ctx.arc(-6, 7, 1.5, 0, Math.PI*2); ctx.fill();

        // Anten - Eski Tip Radyo Anteni
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(6, -10); ctx.lineTo(10, -22); ctx.stroke();
        // Anten Ucu Kırmızı Işık
        ctx.fillStyle = state.frame % 60 < 30 ? '#ef4444' : '#7f1d1d';
        ctx.beginPath(); ctx.arc(10, -22, 2, 0, Math.PI*2); ctx.fill();

        // İtici Gaz Partikülleri (Ateş/Turuncu Egzoz)
        if (state.frame % 3 === 0) {
            // Sol Taraf İtici Jet
            state.particles.push({
                x: state.drone.x - 12 + (Math.random() - 0.5) * 4,
                y: state.drone.y + 12,
                vx: 0, vy: 1 + Math.random() * 2,
                life: 0.8, color: '#f97316', size: Math.random() * 3 + 2
            });
            // Sağ Taraf İtici Jet
            state.particles.push({
                x: state.drone.x + 12 + (Math.random() - 0.5) * 4,
                y: state.drone.y + 12,
                vx: 0, vy: 1 + Math.random() * 2,
                life: 0.8, color: '#f59e0b', size: Math.random() * 3 + 2
            });
        }
        
        ctx.restore();
    }

    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.scale(p.dir, 1);
    ctx.scale(1.3, 1.3); // Boyutu bir tık ufaltıyoruz, matkap sığsın diye
    
    // Süspansiyon süzülmesi
    const animY = p.onGround ? Math.sin(state.frame * 0.15) * 1 : 0;
    ctx.translate(0, animY);

    // Jetpack Sırt Çantası veya Exosuit Kabloları
    if (state.exoLvl > 0) {
        ctx.strokeStyle = '#f59e0b'; 
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-16, -10); ctx.lineTo(-16, 14); ctx.stroke();
    }

    // --- Arka Palet (Sol Tank Paleti) ---
    const treadSwing = (Math.abs(p.vx) > 0 && p.onGround) ? (state.frame * p.vx * 0.5) : 0;
    ctx.fillStyle = '#1e293b'; // Koyu gri
    ctx.beginPath(); ctx.roundRect(-10, 10, 20, 12, 4); ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.roundRect(-8, 12, 16, 8, 2); ctx.fill();
    
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    for (let i = 0; i < 20; i += 4) {
        let lx = -10 + ((i - treadSwing) % 20 + 20) % 20;
        ctx.beginPath(); ctx.moveTo(lx, 10); ctx.lineTo(lx, 22); ctx.stroke();
    }

    // --- Gövde (Paslı Sarı Kasa) ---
    const torsoGrad = ctx.createLinearGradient(-15, -8, 15, 20);
    torsoGrad.addColorStop(0, '#facc15'); 
    torsoGrad.addColorStop(1, '#b45309'); 
    ctx.fillStyle = torsoGrad;
    ctx.beginPath(); ctx.roundRect(-16, -8, 32, 22, 3); ctx.fill();

    // Pas lekeleri (Sarı boyanın üzerindeki aşınmalar)
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(-12, -6, 8, 5);
    ctx.fillRect(6, 6, 6, 7);
    ctx.fillRect(-8, 8, 4, 5);
    
    ctx.fillStyle = '#450a0a';
    ctx.fillRect(-10, -4, 4, 3);
    ctx.fillRect(4, 8, 5, 3);
    ctx.fillRect(-6, 9, 3, 4);
    ctx.beginPath(); ctx.arc(12, -2, 2.5, 0, Math.PI*2); ctx.fill();

    // Gövde Yıpranma ve Paneller
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 1;
    ctx.strokeRect(-14, -6, 28, 18);
    
    // Eski Tip Pil Ekranı
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(0, -4, 12, 6);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(1, -3, 10 * (state.energy/state.energyMax), 4);
    
    // Kaportadaki AVC-E Yazısı
    ctx.fillStyle = '#451a03';
    ctx.font = '900 7px Outfit';
    ctx.fillText('AVC-E', -12, 8);

    // --- Boyun ve Baş (Büyük Mercekli Kamera) ---
    // Boyun Pistonu
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-4, -16, 8, 8);
    
    // Baş Kasası (Kutu yapı)
    const headGrad = ctx.createLinearGradient(-12, -28, 12, -14);
    headGrad.addColorStop(0, '#fef08a');
    headGrad.addColorStop(1, '#eab308');
    ctx.fillStyle = headGrad;
    ctx.beginPath(); ctx.roundRect(-12, -28, 24, 16, 4); ctx.fill();

    // Kafadaki pas lekeleri
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(-10, -26, 6, 3);
    ctx.fillRect(4, -18, 4, 3);
    ctx.fillStyle = '#450a0a';
    ctx.fillRect(-8, -25, 3, 2);
    ctx.fillRect(5, -17, 2, 2);
    ctx.fillRect(-4, -16, 5, 2);
    
    // Kamera Ana Lensi
    ctx.fillStyle = '#475569';
    ctx.beginPath(); ctx.arc(0, -20, 8, 0, Math.PI*2); ctx.fill(); 
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.arc(0, -20, 5, 0, Math.PI*2); ctx.fill(); 
    
    // Lens Yansıması (Cam efekti)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.beginPath(); ctx.arc(-2, -22, 2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath(); ctx.arc(1, -19, 1.5, 0, Math.PI*2); ctx.fill();

    // Yan Sensör (Sol kamera detayı)
    ctx.fillStyle = '#334155';
    ctx.fillRect(-10, -24, 4, 8);
    // Kayıt Işığı
    ctx.fillStyle = state.frame % 60 < 30 ? '#ef4444' : '#7f1d1d'; 
    ctx.beginPath(); ctx.arc(-8, -20, 1, 0, Math.PI*2); ctx.fill();

    // --- Ön Palet (Sağ Tank Paleti - Gövdenin Önünde) ---
    ctx.fillStyle = '#334155'; 
    ctx.beginPath(); ctx.roundRect(-6, 12, 24, 14, 4); ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.roundRect(-4, 14, 20, 10, 2); ctx.fill();
    
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i += 4) {
        let lx = -6 + ((i - treadSwing) % 24 + 24) % 24;
        ctx.beginPath(); ctx.moveTo(lx, 12); ctx.lineTo(lx, 26); ctx.stroke();
    }

    // --- Robotik Kollu Devasa Matkap (Orantılı) ---
    // Aşağı tuşu: zeminde veya alt blok kırılıp düşerken onGround kısa süre false olabiliyor — vy>=0 ile sürekli aşağı poz (jetpack yukarı vy<0 hariç).
    const downHeld = state.keys['ArrowDown'] || state.keys['KeyS'];
    const miningDown = downHeld && p.vy >= 0;
    let armSwing;
    if (miningDown) {
        armSwing = Math.PI / 2 + Math.sin(state.frame * 0.6) * 0.12;
    } else if (!p.onGround && p.vy < 0) {
        armSwing = Math.PI / 4;
    } else if (Math.abs(p.vx) > 0) {
        armSwing = Math.sin(state.frame * 0.6) * 0.15;
    } else {
        armSwing = 0;
    }
    ctx.save();
    ctx.translate(6, 4); // Omuz merkezi
    ctx.rotate(armSwing);
    
    // Kol Pistonu (Sarı/Turuncu Endüstriyel)
    ctx.fillStyle = '#d97706';
    ctx.beginPath(); ctx.roundRect(-4, -4, 20, 8, 2); ctx.fill();
    ctx.strokeStyle = '#78350f'; ctx.strokeRect(-2, -2, 16, 4);
    
    // Matkap Başlangıç Kasası (Gri)
    ctx.fillStyle = '#475569';
    ctx.beginPath(); ctx.roundRect(14, -8, 8, 16, 2); ctx.fill(); // Gri bağlantı kutusu
    
    // Dev Altın Konik Matkap 
    const drillGrad = ctx.createLinearGradient(14, -14, 14, 14);
    drillGrad.addColorStop(0, '#facc15');
    drillGrad.addColorStop(0.5, '#fef08a');
    drillGrad.addColorStop(1, '#b45309');
    
    ctx.fillStyle = drillGrad;
    ctx.beginPath();
    ctx.moveTo(22, -14); // Koninin geniş tabanı
    ctx.lineTo(48, 0);   // Koninin ölümcül sivri ucu
    ctx.lineTo(22, 14);
    ctx.closePath();
    ctx.fill();

    // Matkap Yivleri (Kesici Döngüler - Harekete Duyarlı Animasyon)
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.7)'; // Pas rengi yiv
    ctx.lineWidth = 2;
    let drillSpin = ((Math.abs(p.vx) > 0 || state.frame % 10 < 5) ? state.frame * 2 : 0) % 6;
    for(let i = 0; i < 5; i++) {
        let drX = 24 + i*5 + (drillSpin/6)*5;
        if(drX > 22 && drX < 46) {
            let taper = (48 - drX) / 26; // Uç noktaya doğru matkap genişliği daralır
            let drH = taper * 14; 
            ctx.beginPath();
            ctx.moveTo(drX - 2, -drH);
            ctx.lineTo(drX + 1, drH);
            ctx.stroke();
        }
    }
    
    ctx.restore();
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const pt = state.particles[i];
        pt.x += pt.vx; pt.y += pt.vy;
        pt.vx *= 0.95; pt.vy += 0.2;
        pt.life -= 0.04;
        if (pt.life <= 0) {
            state.particles.splice(i, 1);
        } else {
            ctx.globalAlpha = pt.life;
            ctx.fillStyle = pt.color;
            ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    drawEnergyLowBubble(ctx, p);
    drawPlayerNameBadge(ctx, p, state.playerName);
    drawPlayerToast(ctx, p);

    ctx.restore();

    const tt = document.getElementById('interaction-tooltip');
    const nb = getNearbyBuilding();
    if (nb && !state.activeModal) {
        tt.style.opacity = '1';
        document.getElementById('tooltip-text').innerText = `${nb.name} (E)`;
    } else {
        tt.style.opacity = '0';
    }

    if (state.frame % 5 === 0) updateUI();

    requestAnimationFrame(gameLoop);
}
