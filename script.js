/* =====================================================
   ALMA.FACTORY - SCRIPT OPTIMISÉ
   - Logos locaux (ALMA-00 / ALMA-01) selon le thème
   - Thème persistant + meta theme-color dynamique
   - Correctifs mini-jeux (removeEventListener fiable)
   - Suppression d’un doublon de variable mini-jeu
   - A11y/UX : raccourcis, maintien barre espace (auto-click)
===================================================== */
const VERSION = '2.5.0';

const CONFIG = {
  // Seuils pour les codes promo
  promoObjectives: [20000, 50000],

  // Coûts de base des améliorations
  costUpgrades: { atelier: 50, machine: 200, pub: 300, digital: 500, lab: 800, staff: 1000 },

  // Bonus accordés par chaque boost
  boostValues: {
    atelierClick: 1,   // +1 / clic
    labClick: 2,       // +2 / clic
    machineAuto: 1,    // +1 / s
    staffAuto: 1,      // +1 / s
    pubMultiplier: 1.5,     // x1.5 prod manuelle
    digitalMultiplier: 1.3  // x1.3 prod globale
  },

  // Prestige
  prestigeRequirement: 50000,
  prestigeMultiplier: 1.5,

  // Événements éphémères
  ephemeralCheckInterval: 5, // s
  ephemeralChance: 0.02,     // 2%
  ephemeralEvents: [
    { name: "Boost de ouf !", description: "Double la production manuelle pendant 25s", type: "doubleManual", duration: 25 },
    { name: "Folie créatrice", description: "Double la production auto pendant 20s", type: "doubleAuto", duration: 20 },
    { name: "L'Usine en Fusion", description: "×2 sur tout (manuel + auto) pendant 15s", type: "doubleAll", duration: 15 }
  ],

  // Niveaux
  levelThresholds: [100, 1000, 2500, 5000, 10000, 20000],
  levelNames: ["Noob", "Casual", "Pro", "Expert", "Legend", "Le GOAT que tu penses être"],

  // Mini-Jeux
  miniGamesFrequency: 0.01,
  miniGameClickThreshold: 50
};

/* =========================
   ÉTAT DU JEU
========================= */
const state = {
  tshirtCount: 0,
  spentTshirts: 0,
  totalClicks: 0,

  atelierMultiplier: 1,
  machineMultiplier: 0,
  staffBonus: 0,

  pubActive: false,
  digitalActive: false,
  ephemeralActive: null,

  prices: { ...CONFIG.costUpgrades },

  firstObjectiveReached: false,
  secondObjectiveReached: false,

  prestigeUnlocked: false,
  prestigeBonus: 1,

  achievements: [],
  clickCountSinceLastMiniGame: 0,

  muted: false
};

let intervals = { auto: null, ev: null, visible: true };
let ephemeralTimer = null;

/* Mode */
const MODE_KEY = 'almaLightMode'; // 'light' | 'dark'
/* =========================
   DOM
========================= */
const $ = (sel) => document.querySelector(sel);
const live = $("#live");

const tshirtCountDisplay = $("#tshirtCount");
const clickMultiplierDisplay = $("#clickMultiplier");
const cpsDisplay = $("#cps");

const clickerButton = $("#clickerButton");

const priceAtelierDisplay = $("#priceAtelier");
const priceMachineDisplay = $("#priceMachine");
const pricePubDisplay = $("#pricePub");
const priceDigitalDisplay = $("#priceDigital");
const priceLabDisplay = $("#priceLab");
const priceStaffDisplay = $("#priceStaff");

const pubUpgradeBtn = $("#pubUpgrade");
const digitalUpgradeBtn = $("#digitalUpgrade");
const labUpgradeBtn = $("#labUpgrade");
const staffUpgradeBtn = $("#staffUpgrade");

const notification = $("#notification");
const achievementList = $("#achievementList");

const dailyRewardButton = $("#dailyRewardButton");
const prestigeButton = $("#prestigeButton");

const endGameSection = $("#endGameSection");
const endGameTitle = $("#endGameTitle");
const endGameMessage = $("#endGameMessage");
const continueButton = $("#continueButton");

const codesDisplay = $("#codesDisplay");
const codesList = $("#codesList");

const promoCodesDiv = $("#promoCodes");
const firstCode = promoCodesDiv?.dataset.firstCode || "ALMA10";
const secondCode = promoCodesDiv?.dataset.secondCode || "ALMAGOAT";

const shareButton = $("#shareButton");
const resetButton = $("#resetButton");
const lightModeToggle = $("#lightModeToggle");
const muteToggle = $("#muteToggle");

const progressFill = $("#progressFill");
const currentLevelLabel = $("#currentLevelLabel");
const totalClicksDisplay = $("#totalClicks");
const totalTshirtsCumulDisplay = $("#totalTshirtsCumul");

const logoEl = $("#logo");
const themeMeta = document.querySelector('meta[name="theme-color"]');

/* =========================
   FORMAT NOMBRES
========================= */
const fmt = Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 2 });
const formatNumber = (v) => (Math.abs(v) < 1000 ? String(v) : fmt.format(v));

/* =========================
   NOTIF / ANNOUNCE
========================= */
function announce(msg) {
  if (!live) return;
  live.textContent = msg;
  setTimeout(() => (live.textContent = ''), 1000);
}
function showNotification(message) {
  notification.textContent = message;
  notification.classList.add("show");
  setTimeout(() => notification.classList.remove("show"), 2800);
}

/* =========================
   SONS
========================= */
const sounds = {
  click: new Audio("sounds/click.mp3"),
  upgrade: new Audio("sounds/upgrade.mp3"),
  powerup: new Audio("sounds/powerup.mp3")
};
Object.values(sounds).forEach(a => { a.preload = 'auto'; a.volume = 0.7; });

function playSound(type) {
  if (state.muted) return;
  const a = sounds[type];
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

/* =========================
   SAVE / LOAD (débouoncé)
========================= */
const SAVE_KEY = "almaFactorySave_v" + VERSION.split('.')[0];
const saveDebounced = debounce(() => {
  const data = {
    ...state,
    // on ne sauve pas les timers/intervalles
    ephemeralActive: state.ephemeralActive ? { ...state.ephemeralActive } : null
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
}, 300);

function saveGame() { saveDebounced(); }

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(state, data);
  } catch { /* ignore */ }
}

/* =========================
   INIT ACHIEVEMENTS
========================= */
function initAchievements() {
  state.achievements = CONFIG.levelThresholds.map((threshold, idx) => ({
    id: idx + 1,
    name: CONFIG.levelNames[idx] || `Niveau ${idx + 1}`,
    condition: threshold,
    achieved: false
  }));
  achievementList.innerHTML = '';
  state.achievements.forEach((ach) => {
    const li = document.createElement("li");
    li.id = `achv-${ach.id}`;
    li.textContent = "???";
    li.classList.add("locked");
    achievementList.appendChild(li);
  });
}

/* =========================
   UPDATE UI
========================= */
function updateDisplay() {
  tshirtCountDisplay.textContent = formatNumber(state.tshirtCount);
  clickMultiplierDisplay.textContent = state.atelierMultiplier;
  const autoRate = Math.floor((state.machineMultiplier + state.staffBonus) * state.prestigeBonus);
  cpsDisplay.textContent = formatNumber(autoRate);

  priceAtelierDisplay.textContent = formatNumber(state.prices.atelier);
  priceMachineDisplay.textContent = formatNumber(state.prices.machine);
  pricePubDisplay.textContent = formatNumber(state.prices.pub);
  priceDigitalDisplay.textContent = formatNumber(state.prices.digital);
  priceLabDisplay.textContent = formatNumber(state.prices.lab);
  priceStaffDisplay.textContent = formatNumber(state.prices.staff);

  totalClicksDisplay.textContent = formatNumber(state.totalClicks);
  totalTshirtsCumulDisplay.textContent = formatNumber(state.spentTshirts);

  toggleShow(pubUpgradeBtn, state.tshirtCount >= 500);
  toggleShow(digitalUpgradeBtn, state.tshirtCount >= 1000);
  toggleShow(labUpgradeBtn, state.tshirtCount >= 2000);
  toggleShow(staffUpgradeBtn, state.tshirtCount >= 3000);

  if (!state.prestigeUnlocked && state.spentTshirts >= CONFIG.prestigeRequirement) {
    state.prestigeUnlocked = true;
    prestigeButton.classList.remove("hidden");
    showNotification("Le Prestige est débloqué !");
  }

  const p = Math.min(100, (state.spentTshirts / CONFIG.promoObjectives[0]) * 100);
  progressFill.style.width = p + "%";

  const lvl = getCurrentLevel();
  currentLevelLabel.textContent = `Niveau ${lvl}`;

  updateAffordability();
  saveGame();
}

function toggleShow(el, show) {
  if (!el) return;
  el.classList.toggle('hidden', !show);
}

function updateAffordability() {
  document.querySelectorAll('.upgrade').forEach(btn => {
    const type = btn.dataset.upgrade;
    let price = state.prices[type];
    const active = (type === 'pub' && state.pubActive) || (type === 'digital' && state.digitalActive);
    const can = state.tshirtCount >= price && !active;
    btn.setAttribute('aria-disabled', String(!can));
    btn.classList.toggle('is-locked', !can);
    btn.classList.toggle('is-active', active);
  });
}

/* =========================
   NIVEAUX
========================= */
function checkAchievements() {
  state.achievements.forEach((ach) => {
    if (!ach.achieved && state.spentTshirts >= ach.condition) {
      ach.achieved = true;
      const li = document.getElementById(`achv-${ach.id}`);
      if (li) {
        li.classList.remove("locked");
        li.classList.add("completed");
        li.textContent = `${ach.name} - Accompli !`;
      }
      showNotification(`Niveau atteint : ${ach.name}`);
      playSound("upgrade");
    }
  });
}
function getCurrentLevel() {
  let level = 0;
  for (let i = 0; i < state.achievements.length; i++) {
    if (state.spentTshirts >= state.achievements[i].condition) level = i + 1; else break;
  }
  return level;
}

/* =========================
   CLICK MANUEL
========================= */
function onMainClick(e) {
  state.totalClicks++;
  state.clickCountSinceLastMiniGame++;

  const bonusPub = state.pubActive ? CONFIG.boostValues.pubMultiplier : 1;
  const bonusDigital = state.digitalActive ? CONFIG.boostValues.digitalMultiplier : 1;
  const eph = state.ephemeralActive ? getEphemeralMultiplier("manual") : 1;

  const totalBonus = bonusPub * bonusDigital * eph * state.prestigeBonus;
  const earned = Math.max(1, Math.floor(state.atelierMultiplier * totalBonus));

  state.tshirtCount += earned;
  state.spentTshirts += earned;

  vibrate(10);
  playSound("click");
  createClickAnimation(e, earned);

  updateDisplay();
  checkAchievements();
  updateShareLink();
  maybeLaunchMiniGame();
}

/* Animation +X */
function createClickAnimation(e, amount) {
  const span = document.createElement("span");
  span.className = "click-anim";
  span.textContent = `+${formatNumber(amount)}`;
  document.body.appendChild(span);
  const x = e?.pageX ?? (window.innerWidth/2);
  const y = e?.pageY ?? (window.innerHeight/2);
  span.style.left = x + "px";
  span.style.top = y + "px";
  setTimeout(() => span.remove(), 1000);
}

/* =========================
   PRODUCTION AUTOMATIQUE
========================= */
function produceAuto() {
  const eph = state.ephemeralActive ? getEphemeralMultiplier("auto") : 1;
  const autoProduction = Math.floor(((state.machineMultiplier + state.staffBonus) * eph * state.prestigeBonus));
  if (autoProduction <= 0) return;
  state.tshirtCount += autoProduction;
  state.spentTshirts += autoProduction;
  updateDisplay();
  checkAchievements();
  updateShareLink();
}

/* =========================
   BOOSTS
========================= */
function buyUpgrade(type) {
  const price = state.prices[type];
  const active = (type === 'pub' && state.pubActive) || (type === 'digital' && state.digitalActive);
  if (active) { showNotification('Déjà active !'); return; }
  if (state.tshirtCount < price) { showNotification('T-Shirts insuffisants !'); return; }

  state.tshirtCount -= price;

  switch (type) {
    case "atelier":
      state.atelierMultiplier += CONFIG.boostValues.atelierClick;
      state.prices.atelier = Math.floor(state.prices.atelier * 1.7);
      showNotification("Extension d'Atelier achetée !");
      playSound("upgrade");
      break;
    case "machine":
      state.machineMultiplier += CONFIG.boostValues.machineAuto;
      state.prices.machine = Math.floor(state.prices.machine * 1.6);
      showNotification("Machine Automatique achetée !");
      playSound("upgrade");
      break;
    case "pub":
      state.pubActive = true;
      showNotification("Campagne Publicitaire ON (30s) !");
      playSound("powerup");
      setTimeout(() => {
        state.pubActive = false;
        showNotification("Campagne Publicitaire terminée.");
        updateDisplay();
      }, 30000);
      state.prices.pub = Math.floor(state.prices.pub * 1.8);
      break;
    case "digital":
      state.digitalActive = true;
      showNotification("Campagne Digitale ON (45s) !");
      playSound("powerup");
      setTimeout(() => {
        state.digitalActive = false;
        showNotification("Campagne Digitale terminée.");
        updateDisplay();
      }, 45000);
      state.prices.digital = Math.floor(state.prices.digital * 2);
      break;
    case "lab":
      state.atelierMultiplier += CONFIG.boostValues.labClick;
      state.prices.lab = Math.floor(state.prices.lab * 2.2);
      showNotification("Laboratoire R&D amélioré !");
      playSound("upgrade");
      break;
    case "staff":
      state.staffBonus += CONFIG.boostValues.staffAuto;
      state.prices.staff = Math.floor(state.prices.staff * 2.5);
      showNotification("Recrutement réussi !");
      playSound("upgrade");
      break;
  }

  updateDisplay();
}

/* =========================
   OBJECTIFS & CODES PROMO
========================= */
function checkObjectives() {
  const [obj1, obj2] = CONFIG.promoObjectives;

  if (!state.firstObjectiveReached && state.spentTshirts >= obj1) {
    state.firstObjectiveReached = true;
    endGameSection.classList.remove("hidden");
    endGameTitle.textContent = "Premier Code Promo !";
    endGameMessage.textContent = firstCode;
    continueButton.classList.remove("hidden");
    addCodeToDisplay(firstCode);
  }
  if (!state.secondObjectiveReached && state.spentTshirts >= obj2) {
    state.secondObjectiveReached = true;
    endGameSection.classList.remove("hidden");
    endGameTitle.textContent = "Deuxième Code Promo !";
    endGameMessage.textContent = secondCode;
    continueButton.classList.add("hidden");
    addCodeToDisplay(secondCode);
  }
}

function addCodeToDisplay(code) {
  codesDisplay.classList.remove("hidden");
  if (![...codesList.children].some(li => li.textContent === code)) {
    const li = document.createElement("li");
    li.textContent = code;
    codesList.appendChild(li);
  }
}

function continueGame() { endGameSection.classList.add("hidden"); }

/* =========================
   PRESTIGE
========================= */
function activatePrestige() {
  if (!confirm("Activer le Prestige ? Cela réinitialisera votre progression pour un bonus permanent.")) return;

  state.prestigeBonus *= CONFIG.prestigeMultiplier;

  Object.assign(state, {
    tshirtCount: 0, spentTshirts: 0, totalClicks: 0,
    atelierMultiplier: 1, machineMultiplier: 0, staffBonus: 0,
    prices: { ...CONFIG.costUpgrades },
    pubActive: false, digitalActive: false, ephemeralActive: null,
    firstObjectiveReached: false, secondObjectiveReached: false,
    prestigeUnlocked: false
  });

  pubUpgradeBtn.classList.add("hidden");
  digitalUpgradeBtn.classList.add("hidden");
  labUpgradeBtn.classList.add("hidden");
  staffUpgradeBtn.classList.add("hidden");
  prestigeButton.classList.add("hidden");

  initAchievements();

  updateDisplay();
  showNotification(`Prestige activé ! Production x${state.prestigeBonus.toFixed(2)}`);
}

/* =========================
   EVENEMENTS ÉPHÉMÈRES
========================= */
function checkEphemeralEvent() {
  if (state.ephemeralActive) return;
  if (Math.random() < CONFIG.ephemeralChance) {
    const ev = CONFIG.ephemeralEvents[Math.floor(Math.random() * CONFIG.ephemeralEvents.length)];
    state.ephemeralActive = ev;
    showNotification(`Événement : ${ev.name} ! (${ev.description})`);
    playSound("powerup");

    clearTimeout(ephemeralTimer);
    ephemeralTimer = setTimeout(() => {
      state.ephemeralActive = null;
      showNotification(`Fin de l'événement : ${ev.name}`);
    }, ev.duration * 1000);
  }
}
function getEphemeralMultiplier(mode) {
  const ev = state.ephemeralActive;
  if (!ev) return 1;
  switch (ev.type) {
    case "doubleManual": return mode === "manual" ? 2 : 1;
    case "doubleAuto":   return mode === "auto"   ? 2 : 1;
    case "doubleAll":    return 2;
    default: return 1;
  }
}

/* =========================
   MINI-JEUX
========================= */
function maybeLaunchMiniGame() {
  if (Math.random() < CONFIG.miniGamesFrequency || state.clickCountSinceLastMiniGame >= CONFIG.miniGameClickThreshold) {
    state.clickCountSinceLastMiniGame = 0;
    (Math.random() < .5 ? miniGameTapFrenzy : miniGameReflex)();
  }
}

function miniGameTapFrenzy() {
  const duration = 5; let count = 0;
  showNotification("Mini-jeu : Tapotement rapide (5s) !");
  playSound("powerup");

  const onClick = () => count++;
  document.addEventListener("click", onClick);
  setTimeout(() => {
    document.removeEventListener("click", onClick);
    const bonus = count * 2;
    state.tshirtCount += bonus; state.spentTshirts += bonus;
    showNotification(`Mini-jeu terminé : +${formatNumber(bonus)} T-shirts !`);
    updateDisplay();
  }, duration * 1000);
}

function miniGameReflex() {
  const delay = Math.random() * 3000 + 1000;
  showNotification("Mini-jeu : Défi de réflexe. Clique le plus vite possible !");
  playSound("powerup");

  let started = false;
  let startTime = 0;

  const onClick = () => {
    if (!started) return;
    const reactionTime = Date.now() - startTime;
    document.removeEventListener("click", onClick);
    let bonus = Math.max(1000 - reactionTime, 0);
    bonus = Math.floor(bonus / 10);
    state.tshirtCount += bonus; state.spentTshirts += bonus;
    showNotification(`Réflexe : +${formatNumber(bonus)} T-shirts ! (Temps : ${reactionTime} ms)`);
    updateDisplay();
  };

  setTimeout(() => {
    showNotification("CLIQUE MAINTENANT !");
    started = true;
    startTime = Date.now();
    document.addEventListener("click", onClick);
  }, delay);
}

/* =========================
   RÉCOMPENSE JOURNALIÈRE
========================= */
function checkDailyRewardAvailability() {
  const last = localStorage.getItem("dailyRewardClaimDate");
  const today = new Date().toDateString();
  dailyRewardButton.classList.toggle("hidden", last === today);
}
function claimDailyReward() {
  const rewardAmount = 500;
  state.tshirtCount += rewardAmount;
  state.spentTshirts += rewardAmount;
  showNotification(`+${formatNumber(rewardAmount)} T-Shirts (récompense journalière)`);
  localStorage.setItem("dailyRewardClaimDate", new Date().toDateString());
  dailyRewardButton.classList.add("hidden");
  updateDisplay();
}

/* =========================
   PARTAGE
========================= */
function updateShareLink() {
  const text = `Je produis ${formatNumber(state.tshirtCount)} T-Shirts sur ALMA.FACTORY ! Rejoins-moi !`;
  shareButton.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
function shareNative() {
  const text = `Je produis ${formatNumber(state.tshirtCount)} T-Shirts sur ALMA.FACTORY !`;
  if (navigator.share) {
    navigator.share({ text, url: location.href }).catch(()=>{});
  } else {
    window.open(shareButton.href, '_blank', 'noopener');
  }
}

/* =========================
   LIGHT MODE + LOGO + MUTE
========================= */
function applyMode(isLight) {
  document.body.classList.toggle("light-mode", isLight);
  lightModeToggle.textContent = isLight ? "Mode Sombre" : "Mode Clair";
  lightModeToggle.setAttribute('aria-pressed', String(isLight));
  setLogoForMode(isLight);
  updateThemeColorMeta();
  try { localStorage.setItem(MODE_KEY, isLight ? 'light' : 'dark'); } catch {}
}

function setLogoForMode(isLight) {
  if (!logoEl) return;
  const darkSrc = logoEl.getAttribute('data-dark') || 'ALMA-00.png';
  const lightSrc = logoEl.getAttribute('data-light') || 'ALMA-01.png';
  if (isLight) {
    logoEl.src = lightSrc;
    logoEl.alt = "Logo ALMA (clair)";
  } else {
    logoEl.src = darkSrc;
    logoEl.alt = "Logo ALMA (sombre)";
  }
}

function toggleLightMode() {
  const isLight = !document.body.classList.contains('light-mode');
  applyMode(isLight);
}

function toggleMute() {
  state.muted = !state.muted;
  muteToggle.textContent = state.muted ? "🔇 Muet" : "🔊 Son";
  muteToggle.setAttribute('aria-pressed', String(state.muted));
  saveGame();
}

function updateThemeColorMeta() {
  if (!themeMeta) return;
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#121212';
  themeMeta.setAttribute('content', bg);
}

/* =========================
   RESET
========================= */
function resetGame() {
  if (!confirm("Réinitialiser TOUT ? Action irréversible.")) return;

  ["almaFactorySave_v2", "almaFactorySave_v1", "almaTShirtFactorySave", "dailyRewardClaimDate"].forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(SAVE_KEY);

  clearTimeout(ephemeralTimer);

  Object.assign(state, {
    tshirtCount: 0, spentTshirts: 0, totalClicks: 0,
    atelierMultiplier: 1, machineMultiplier: 0, staffBonus: 0,
    prices: { ...CONFIG.costUpgrades },
    pubActive: false, digitalActive: false, ephemeralActive: null,
    firstObjectiveReached: false, secondObjectiveReached: false,
    prestigeUnlocked: false, prestigeBonus: 1,
    clickCountSinceLastMiniGame: 0,
    muted: false
  });

  initAchievements();

  pubUpgradeBtn.classList.add("hidden");
  digitalUpgradeBtn.classList.add("hidden");
  labUpgradeBtn.classList.add("hidden");
  staffUpgradeBtn.classList.add("hidden");
  prestigeButton.classList.add("hidden");

  // Revenir au mode sombre par défaut (sans toucher au stockage de préférence)
  applyMode(false);

  updateDisplay();
  showNotification("Le jeu a été réinitialisé avec succès !");
}

/* =========================
   VISIBILITY (pause perf)
========================= */
function handleVisibility() {
  intervals.visible = !document.hidden;
  if (document.hidden) {
    clearInterval(intervals.auto);
    clearInterval(intervals.ev);
    intervals.auto = intervals.ev = null;
  } else {
    startIntervals();
  }
}

/* =========================
   HELPERS
========================= */
function debounce(fn, delay) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
function vibrate(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch {} }

/* =========================
   BIND EVENTS
========================= */
let spaceHoldInterval = null;
function bindEvents() {
  clickerButton.addEventListener("click", onMainClick);

  // clavier : Espace = auto-click tant que maintenu
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (e.key === ' ' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
      e.preventDefault();
      onMainClick({ pageX: window.innerWidth/2, pageY: window.innerHeight/2 });
      spaceHoldInterval = setInterval(() => onMainClick({ pageX: window.innerWidth/2, pageY: window.innerHeight/2 }), 110);
    }
    // Raccourcis achats 1..6
    const map = { '1':'atelier', '2':'machine', '3':'pub', '4':'digital', '5':'lab', '6':'staff' };
    if (map[e.key]) {
      e.preventDefault();
      buyUpgrade(map[e.key]);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      clearInterval(spaceHoldInterval);
      spaceHoldInterval = null;
    }
  });

  // Délégation des upgrades
  document.addEventListener('click', (e) => {
    const up = e.target.closest('.upgrade');
    if (!up) return;
    const type = up.dataset.upgrade;
    if (up.getAttribute('aria-disabled') === 'true') return;
    buyUpgrade(type);
  });

  // Top actions
  lightModeToggle.addEventListener("click", toggleLightMode);
  muteToggle.addEventListener("click", toggleMute);

  // Bottom
  resetButton.addEventListener("click", resetGame);
  shareButton.addEventListener("click", (e) => { e.preventDefault(); shareNative(); });

  // Daily / Prestige / Continue
  dailyRewardButton.addEventListener("click", claimDailyReward);
  prestigeButton.addEventListener("click", activatePrestige);
  continueButton.addEventListener("click", continueGame);

  // Visibility pause
  document.addEventListener('visibilitychange', handleVisibility, { passive: true });

  // Sauvegarde à la fermeture
  window.addEventListener('beforeunload', saveGame);
}

/* =========================
   INTERVALS
========================= */
function startIntervals() {
  clearInterval(intervals.auto);
  clearInterval(intervals.ev);
  intervals.auto = setInterval(() => { produceAuto(); checkObjectives(); }, 1000);
  intervals.ev = setInterval(checkEphemeralEvent, CONFIG.ephemeralCheckInterval * 1000);
}

/* =========================
   MODE INITIAL
========================= */
function setupInitialMode() {
  let mode = null;
  try { mode = localStorage.getItem(MODE_KEY); } catch {}
  if (!mode) {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    mode = prefersLight ? 'light' : 'dark';
  }
  applyMode(mode === 'light');
}

/* =========================
   INIT
========================= */
function init() {
  initAchievements();
  loadGame();

  // UI init
  setupInitialMode();
  updateDisplay();
  checkDailyRewardAvailability();
  updateShareLink();

  // Intervalles
  startIntervals();

  // Events
  bindEvents();

  // Muet : synchroniser l'UI si sauvegardé
  muteToggle.textContent = state.muted ? "🔇 Muet" : "🔊 Son";
  muteToggle.setAttribute('aria-pressed', String(state.muted));

  console.log("ALMA.FACTORY prêt ✔ v" + VERSION);
}

window.addEventListener('load', init);
