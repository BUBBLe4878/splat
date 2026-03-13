let fireButtonPressed = false;

let autoReload = true;  // ADD THIS
let autoFire = false;   // ADD THIS

let isTimerMode = false;
// ════════════════════════════════════════════════════
//  BLASTER DATA
// ════════════════════════════════════════════════════
let BLASTERS = [
    {
        id: "basic", name: "Basic Blaster", icon: "🔫", cost: 0, ammo: 10,
        rateLimit: 0.12, speed: 44, mode: "single", dmg: 1, reloadMs: 1400,
        gravity: 18, spread: 0.015, recoil: 0.018, weight: 1.0, pellets: 1,
        burstCount: 1
    }
];
const _blastersReady = (async () => {
    try {
        const r = await fetch("/static/blasters.json");
        if (r.ok) BLASTERS = await r.json();
    } catch (e) { }
})();

// ════════════════════════════════════════════════════
//  Fire button/touch
// ════════════════════════════════════════════════════

document
    .getElementById("lobby-touch-tog")
    .addEventListener("click", () => setTouch(!touchEnabled));
document
    .getElementById("touch-tog")
    .addEventListener("click", () => setTouch(!touchEnabled));
document
    .getElementById("lobby-touch-tog")
    .addEventListener("click", () => setTouch(!touchEnabled));

// Add a delegated event listener for touch-tog2 since it might not exist yet
document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "touch-tog2") {
        setTouch(!touchEnabled);
    }
});

document
    .getElementById("fire-btn")
    .addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (gs.running) {
            if (autoFire) {
                // Toggle mode: tap once to start, tap again to stop
                fireButtonPressed = !fireButtonPressed;
            } else {
                // Hold mode: hold to fire
                fireHeld = true;
                shoot(); // Shoot once immediately
            }
        }
    });

document.getElementById("fire-btn").addEventListener("pointerup", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!autoFire) {
        // Only clear fireHeld in normal (non-auto) mode
        fireHeld = false;
    }
    // In auto-fire mode, do nothing on pointerup (button acts as toggle)
});

document
    .getElementById("fire-btn")
    .addEventListener("pointercancel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Cancel always stops everything
        fireButtonPressed = false;
        fireHeld = false;
    });

// ════════════════════════════════════════════════════
//  MAPS
// ════════════════════════════════════════════════════
let MAPS = {};
function hexToInt(hex) {
    if (typeof hex === "number" && hostSettings.mapId !== "blocks") return hex;
    return parseInt((hex || "0").replace("#", ""), 16);


}

async function loadMaps() {
    try {
        const r = await fetch("/static/maps.json");
        if (r.ok) {
            const arr = await r.json();
            arr.forEach((m) => {
                MAPS[m.id] = m;
            });
            return;
        }
    } catch (e) { }
    _installFallbackMaps();
}
function _installFallbackMaps() {
    console.log("maps failed to load");
}
const _mapsReady = loadMaps();
function getMapDef(mapId) {
    return MAPS[mapId] || MAPS["arena"] || Object.values(MAPS)[0] || {};
}

const PROMO_CODES = {
    BUBBLE1234: { pb: 1000000000, label: "1,000,000 PB", emoji: "🤑" },
    BUBBLE4878: { pb: -1000000, label: "1,000,000 PB", emoji: "🤑" },
    PAINT: { pb: 100, label: "100 PB", emoji: "🎉" },
};

// ════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════
let hostSettings = {
    gameType: "solo",
    mapId: "arena",
    rounds: 3,
    infiniteAmmo: false,
    limitedAmmo: false,
    startingReserve: 150,
    botCount: 3,
    botDifficulty: "medium",
    maxPlayers: 8,
    timeLimit: 0,
};
let amIHost = false;

// ════════════════════════════════════════════════════
//  STATE  — FIX: added myPlayerIndex tracking
// ════════════════════════════════════════════════════
let playerName = "Player",
    selGameType = "pvp_1v1";
let socket = null,
    mySid = null,
    myTeam = 0;
let myPlayerIndex = 0; // ← FIX: track our assigned spawn index
let roomCode = null,
    isHost = false;
let roomPlayers = [];
let conn = {
    open: false,
    send(msg) {
        if (!socket || !socket.connected || !roomCode) return;
        socket.emit("relay", msg);
    },
};

let sensitivity = 5,
    touchEnabled = false,
    isAiming = false;
let recoilVel = 0;
let playerVY = 0,
    onGround = true;
let waveActive = false,
    lastShotTime = 0,
    fireHeld = false;
let roundNum = 1,
    roundWins = {},
    matchActive = false,
    roundCountingDown = false;
let sessionPBEarned = 0;

// FIX: remoteClients now includes pos field
let remoteClients = {};

let pb = 0,
    ownedBlasters = ["basic"],
    equippedBlaster = null,
    usedCodes = [];
let matchTimeLeft = 0;

// ── MOD SYSTEM ──
let MODS = [];
(async () => {
    try {
        const r = await fetch("/static/mods.json");
        if (r.ok) MODS = await r.json();
    } catch (e) { }
})();

let equippedMods = {
    sight: "sight_iron",
    mag: "mag_std",
    reload: "reload_std",
};
let ownedMods = ["sight_iron", "mag_std", "reload_std"];
let reserveAmmo = 0;

function getEffectiveStats() {
    const bl = equippedBlaster || BLASTERS[0];
    const sm = MODS[equippedMods.sight] || MODS.sight_iron;
    const mm = MODS[equippedMods.mag] || MODS.mag_std;
    const rm = MODS[equippedMods.reload] || MODS.reload_std;
    const totalWeight =
        (bl.weight || 1.0) + sm.weight + mm.weight + rm.weight;
    return {
        ammo: Math.round((bl.ammo || 10) * (mm.ammoMult || 1.0)),
        reloadMs: Math.round((bl.reloadMs || 1400) * (rm.reloadMult || 1.0)),
        spread: (bl.spread || 0.015) * (sm.spreadMult || 1.0),
        moveSpeed: Math.max(2.5, 5.0 / totalWeight),
        sprintSpeed: Math.max(4.0, 8.0 / totalWeight),
        totalWeight,
    };
}

function loadPersist() {
    try {
        const sp = localStorage.getItem("splat_pb");
        if (sp !== null) pb = Math.max(0, parseInt(sp) || 0);
        const so = localStorage.getItem("splat_owned");
        if (so) {
            const a = JSON.parse(so);
            if (Array.isArray(a)) ownedBlasters = a;
        }
        const sc = localStorage.getItem("splat_codes");
        if (sc) {
            const a = JSON.parse(sc);
            if (Array.isArray(a)) usedCodes = a;
        }
        const se = localStorage.getItem("splat_equipped");
        if (se) {
            const bl = BLASTERS.find((b) => b.id === se);
            if (bl && ownedBlasters.includes(bl.id)) equippedBlaster = bl;
        }
        const sm = localStorage.getItem("splat_mods_owned");
        if (sm) {
            const a = JSON.parse(sm);
            if (Array.isArray(a)) ownedMods = a;
        }
        const seq = localStorage.getItem("splat_mods_eq");
        if (seq) {
            const o = JSON.parse(seq);
            if (o && typeof o === "object")
                equippedMods = Object.assign(equippedMods, o);
        }
        const sr = localStorage.getItem("splat_reserve");
        if (sr !== null) reserveAmmo = Math.max(0, parseInt(sr) || 0);

        // ADD THESE:
        const sar = localStorage.getItem("splat_auto_reload");
        if (sar !== null) autoReload = sar === "1";

        const saf = localStorage.getItem("splat_auto_fire");
        if (saf !== null) autoFire = saf === "1";
    } catch (e) { }
}
function savePersist() {
    try {
        localStorage.setItem("splat_pb", pb);
        localStorage.setItem("splat_owned", JSON.stringify(ownedBlasters));
        localStorage.setItem("splat_codes", JSON.stringify(usedCodes));

        localStorage.setItem(
            "splat_equipped",
            equippedBlaster ? equippedBlaster.id : "basic",
        );
        localStorage.setItem("splat_mods_owned", JSON.stringify(ownedMods));
        localStorage.setItem("splat_mods_eq", JSON.stringify(equippedMods));
        localStorage.setItem("splat_reserve", reserveAmmo);
        if (typeof _armorOwned !== "undefined") {
            localStorage.setItem(
                "splat_armor_own",
                JSON.stringify(_armorOwned),
            );
            localStorage.setItem("splat_armor_sl", JSON.stringify(_armorSlots));
            localStorage.setItem("splat_cons", JSON.stringify(_cons));
            localStorage.setItem("splat_hpup", _hpUps);
            localStorage.setItem("splat_regen", _regenChip ? "1" : "0");
        }
        localStorage.setItem("splat_auto_reload", autoReload ? "1" : "0");
        localStorage.setItem("splat_auto_fire", autoFire ? "1" : "0");
    } catch (e) { }
}
loadPersist();
if (!equippedBlaster) equippedBlaster = BLASTERS[0];

const gs = {
    score: 0,
    kills: 0,
    wave: 1,
    health: 100,
    ammo: 10,
    maxAmmo: 10,
    isReloading: false,
    running: false,
    paintColor: 0xff3333,
    yaw: 0,
    pitch: 0,
    keys: {},
    enemies: [],
    paintballs: [],
    eBalls: [],
    splats: [],
    remoteBalls: [],
};
const PCOLS = [
    0xff3333, 0x33aaff, 0xffdd00, 0x44ff66, 0xff66cc, 0xff8800,
];
const ECOLS = [0xff3333, 0xff6600, 0xcc0066, 0x990099, 0xaa2200];
const BOT_DIFFICULTY = {
    easy: { speed: 1.0, cooldown: 4.0 },
    medium: { speed: 1.8, cooldown: 2.5 },
    hard: { speed: 2.8, cooldown: 1.2 },
};

// ════════════════════════════════════════════════════
//  THREE.JS SETUP
// ════════════════════════════════════════════════════
const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);

const camera = new THREE.PerspectiveCamera(
    75,
    innerWidth / innerHeight,
    0.1,
    200,
);
const pitchObj = new THREE.Object3D();
const yawObj = new THREE.Object3D();
yawObj.add(pitchObj);
pitchObj.add(camera);
yawObj.position.set(0, 1.7, 0);
scene.add(yawObj);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 200;
scene.add(sun);

// Sky dome
scene.add(
    new THREE.Mesh(
        new THREE.SphereGeometry(100, 16, 16),
        new THREE.MeshBasicMaterial({
            color: 0x87ceeb,
            side: THREE.BackSide,
        }),
    ),
);
// Clouds
for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const cm = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
    });
    for (let j = 0; j < 5; j++) {
        const s = new THREE.Mesh(
            new THREE.SphereGeometry(2 + Math.random() * 3, 6, 6),
            cm,
        );
        s.position.set(
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 5,
        );
        g.add(s);
    }
    g.position.set(
        (Math.random() - 0.5) * 160,
        22 + Math.random() * 12,
        (Math.random() - 0.5) * 160,
    );
    scene.add(g);
}

// ════════════════════════════════════════════════════
//  MAP BUILDING
// ════════════════════════════════════════════════════
let obstacles = [];
let mapObjects = new THREE.Group();
scene.add(mapObjects);
let gndMesh = null,
    gridMesh = null;

function buildMap(mapId) {
    console.log("Building map:", mapId);
    while (mapObjects.children.length)
        mapObjects.remove(mapObjects.children[0]);
    obstacles = [];
    if (gndMesh) {
        scene.remove(gndMesh);
        gndMesh = null;
    }
    if (gridMesh) {
        scene.remove(gridMesh);
        gridMesh = null;
    }
    const M = getMapDef(mapId);
    const env = M.environment || {};
    const arenaH = (M.arenaSize || 80) / 2;
    const fogHex = hexToInt(env.fogColor || "#87ceeb");
    const gndHex = hexToInt(env.groundColor || "#4a7c3f");
    const gridHex = hexToInt(env.gridColor || "#3a6a2f");
    const wallHex = hexToInt(env.wallColor || "#d4b896");
    const sunHex = hexToInt(env.sunColor || "#fff5e0");
    scene.fog.color.setHex(fogHex);
    renderer.setClearColor(fogHex);
    ambientLight.intensity = env.ambientIntensity ?? 0.6;
    sun.color.setHex(sunHex);
    const sz = M.arenaSize || 80;
    gndMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(sz, sz, 20, 20),
        new THREE.MeshLambertMaterial({ color: gndHex }),
    );
    gndMesh.rotation.x = -Math.PI / 2;
    gndMesh.receiveShadow = true;
    scene.add(gndMesh);
    gridMesh = new THREE.GridHelper(sz, sz / 2, gridHex, gridHex);
    gridMesh.position.y = 0.02;
    scene.add(gridMesh);
    const wmat = new THREE.MeshLambertMaterial({ color: wallHex });
    [
        [sz, 6, 1, 0, 3, -arenaH],
        [sz, 6, 1, 0, 3, arenaH],
        [1, 6, sz, -arenaH, 3, 0],
        [1, 6, sz, arenaH, 3, 0],
    ].forEach(([w, h, d, x, y, z]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wmat);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        mapObjects.add(m);
    });
    (M.objects || []).forEach((obj) => {
        buildComplexObject(obj, mapObjects, obstacles);
    });



}

function buildComplexObject(obj, parent, obstacleList) {
    const col = hexToInt(obj.color || "#888888");
    const mat = (c) => new THREE.MeshLambertMaterial({ color: hexToInt(c || obj.color || "#888888") });
    const box = (w, h, d, x, y, z, c) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
    };

    if (obj.type === "model") {
        loadModelWithCollision(
            obj.path,
            obj.x,
            obj.y || 0,
            obj.z,
            obj.scale || 1,
            obj.rotation || 0
        );
        return;
    }

    if (obj.type === "gate") {
        const postW = 0.5, postH = obj.h || 4, gateW = obj.w || 6;
        // Left post
        box(postW, postH, postW, obj.x - gateW / 2, postH / 2, obj.z, obj.color);
        // Right post
        box(postW, postH, postW, obj.x + gateW / 2, postH / 2, obj.z, obj.color);
        // Top crossbar
        box(gateW + postW, 0.4, postW, obj.x, postH - 0.2, obj.z, obj.color);
        // Two decorative vertical bars in the opening
        box(0.2, postH * 0.7, 0.2, obj.x - gateW * 0.2, postH * 0.35, obj.z, obj.color);
        box(0.2, postH * 0.7, 0.2, obj.x + gateW * 0.2, postH * 0.35, obj.z, obj.color);
        // Collision: treat the posts as obstacles, leave the gap open
        obstacleList.push({ x: obj.x - gateW / 2, z: obj.z, hw: postW / 2, hd: postW / 2, h: postH, hwp: postW / 2 + 0.38, hdp: postW / 2 + 0.38 });
        obstacleList.push({ x: obj.x + gateW / 2, z: obj.z, hw: postW / 2, hd: postW / 2, h: postH, hwp: postW / 2 + 0.38, hdp: postW / 2 + 0.38 });

    } else if (obj.type === "window_box") {
        const w = obj.w || 4, h = obj.h || 3, d = obj.d || 0.6;
        const wallCol = obj.color || "#aaaaaa";
        const glassCol = "#223355";
        // Bottom sill
        box(w, 0.25, d, obj.x, h * 0.28, obj.z, wallCol);
        // Top lintel
        box(w, 0.25, d, obj.x, h * 0.85, obj.z, wallCol);
        // Left side
        box(0.3, h, d, obj.x - w / 2 + 0.15, h / 2, obj.z, wallCol);
        // Right side
        box(0.3, h, d, obj.x + w / 2 - 0.15, h / 2, obj.z, wallCol);
        // Centre mullion
        box(0.2, h * 0.55, d * 0.5, obj.x, h * 0.57, obj.z, wallCol);
        // Glass panes (slightly recessed, tinted)
        box(w * 0.35, h * 0.52, 0.08, obj.x - w * 0.22, h * 0.57, obj.z, glassCol);
        box(w * 0.35, h * 0.52, 0.08, obj.x + w * 0.22, h * 0.57, obj.z, glassCol);
        // Full collision block
        obstacleList.push({ x: obj.x, z: obj.z, hw: w / 2, hd: d / 2, h, hwp: w / 2 + 0.38, hdp: d / 2 + 0.38 });
    } else if (obj.type === "arch") {
        const w = obj.w || 5, h = obj.h || 4, thick = 0.7;
        const archCol = obj.color || "#888888";

        // Left pillar
        box(thick, h, thick, obj.x - w / 2 + thick / 2, h / 2, obj.z, archCol);
        // Right pillar
        box(thick, h, thick, obj.x + w / 2 - thick / 2, h / 2, obj.z, archCol);
        // Top crossbar
        box(w, thick, thick, obj.x, h - thick / 2, obj.z, archCol);

        // Collision: pillars only, walkable underneath
        obstacleList.push({ x: obj.x - w / 2 + thick / 2, z: obj.z, hw: thick / 2, hd: thick / 2, h, hwp: thick / 2 + 0.38, hdp: thick / 2 + 0.38 });
        obstacleList.push({ x: obj.x + w / 2 - thick / 2, z: obj.z, hw: thick / 2, hd: thick / 2, h, hwp: thick / 2 + 0.38, hdp: thick / 2 + 0.38 });
    } else if (obj.type === "watchtower") {
        const base = obj.w || 3, h = obj.h || 6;
        const darkCol = obj.color || "#776655";
        const roofCol = "#554433";
        // Four corner legs
        const legOff = base / 2 - 0.2;
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
            box(0.3, h * 0.65, 0.3, obj.x + sx * legOff, h * 0.325, obj.z + sz * legOff, darkCol);
        });
        // Cross-braces (visual only, flat planks)
        box(base * 1.05, 0.18, 0.15, obj.x, h * 0.3, obj.z, darkCol);
        box(base * 1.05, 0.18, 0.15, obj.x, h * 0.55, obj.z, darkCol);
        box(0.15, 0.18, base * 1.05, obj.x, h * 0.3, obj.z, darkCol);
        box(0.15, 0.18, base * 1.05, obj.x, h * 0.55, obj.z, darkCol);
        // Platform floor
        box(base + 0.6, 0.25, base + 0.6, obj.x, h * 0.68, obj.z, darkCol);
        // Platform walls with gaps (4 half-walls)
        const pw = base + 0.4;
        box(pw, 0.9, 0.2, obj.x, h * 0.68 + 0.57, obj.z - pw / 2, darkCol);
        box(pw, 0.9, 0.2, obj.x, h * 0.68 + 0.57, obj.z + pw / 2, darkCol);
        box(0.2, 0.9, pw, obj.x - pw / 2, h * 0.68 + 0.57, obj.z, darkCol);
        box(0.2, 0.9, pw, obj.x + pw / 2, h * 0.68 + 0.57, obj.z, darkCol);
        // Roof
        box(base + 0.8, 0.25, base + 0.8, obj.x, h * 0.68 + 1.2, obj.z, roofCol);
        // Collision: just a solid block for the base footprint
        obstacleList.push({ x: obj.x, z: obj.z, hw: base / 2, hd: base / 2, h, hwp: base / 2 + 0.38, hdp: base / 2 + 0.38 });

    } else {
        // Fallback: original single-box behaviour
        const w = obj.w || 1, h = obj.h || 1, d = obj.d || 1;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(obj.color));
        mesh.position.set(obj.x, h / 2, obj.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        obstacleList.push({ x: obj.x, z: obj.z, hw: w / 2, hd: d / 2, h, hwp: w / 2 + 0.38, hdp: d / 2 + 0.38 });
    }
}

// ════════════════════════════════════════════════════
//  COLLISION HELPERS
// ════════════════════════════════════════════════════
function playerHitsObs(x, z, py) {
    const feet = (py !== undefined ? py : yawObj.position.y) - 1.7;

    for (const o of obstacles) {
        const boxBottom = o.y || 0;
        const boxTop = boxBottom + o.h;

        // Check horizontal collision first
        const xCollide = Math.abs(x - o.x) < o.hwp;
        const zCollide = Math.abs(z - o.z) < o.hdp;

        if (xCollide && zCollide) {
            // We're horizontally inside the box, check vertical
            const aboveBottom = feet >= boxBottom - 0.08;
            const belowTop = feet < boxTop - 0.08;

            // Debug logging when near a collision
            if (aboveBottom && belowTop) {
                console.log(`COLLISION! Feet at ${feet.toFixed(2)}, box: ${boxBottom.toFixed(2)} to ${boxTop.toFixed(2)}`);
                return true;
            } else if (xCollide && zCollide) {
                console.log(`NO COLLISION - Feet at ${feet.toFixed(2)}, box: ${boxBottom.toFixed(2)} to ${boxTop.toFixed(2)}, above=${aboveBottom}, below=${belowTop}`);
            }
        }
    }
    return false;
}

function bulletHitsObs(x, y, z) {
    for (const o of obstacles) {
        const boxBottom = o.y || 0;
        const boxTop = boxBottom + o.h;
        
        if (
            Math.abs(x - o.x) < o.hw + 0.08 &&
            Math.abs(z - o.z) < o.hd + 0.08 &&
            y >= boxBottom &&
            y <= boxTop + 0.1
        )
            return o;
    }
    return null;
}

function sweepBulletObs(px, py, pz, nx, ny, nz) {
    const dx = nx - px,
        dy = ny - py,
        dz = nz - pz;
    if (dx === 0 && dy === 0 && dz === 0) return null;
    const r = 0.06;
    let best = null;
    for (const o of obstacles) {
        const boxBottom = o.y || 0;  // ← ADD THIS
        const boxTop = boxBottom + o.h;  // ← ADD THIS
        
        const minX = o.x - o.hw - r,
            maxX = o.x + o.hw + r,
            minY = boxBottom - r,  // ← CHANGE FROM -r
            maxY = boxTop + r,     // ← CHANGE FROM o.h + r
            minZ = o.z - o.hd - r,
            maxZ = o.z + o.hd + r;
        let tmin = 0,
            tmax = 1;
        let nEnter = null,
            nExit = null;

        if (Math.abs(dx) < 1e-6) {
            if (px < minX || px > maxX) continue;
        } else {
            let tx1 = (minX - px) / dx;
            let tx2 = (maxX - px) / dx;
            let n1 = dx > 0 ? { x: -1, y: 0, z: 0 } : { x: 1, y: 0, z: 0 };
            let n2 = dx > 0 ? { x: 1, y: 0, z: 0 } : { x: -1, y: 0, z: 0 };
            if (tx1 > tx2) {
                const tmp = tx1;
                tx1 = tx2;
                tx2 = tmp;
                const tn = n1;
                n1 = n2;
                n2 = tn;
            }
            if (tx1 > tmin) {
                tmin = tx1;
                nEnter = n1;
            }
            if (tx2 < tmax) {
                tmax = tx2;
                nExit = n2;
            }
            if (tmin > tmax) continue;
        }

        if (Math.abs(dy) < 1e-6) {
            if (py < minY || py > maxY) continue;
        } else {
            let ty1 = (minY - py) / dy;
            let ty2 = (maxY - py) / dy;
            let n1 = dy > 0 ? { x: 0, y: -1, z: 0 } : { x: 0, y: 1, z: 0 };
            let n2 = dy > 0 ? { x: 0, y: 1, z: 0 } : { x: 0, y: -1, z: 0 };
            if (ty1 > ty2) {
                const tmp = ty1;
                ty1 = ty2;
                ty2 = tmp;
                const tn = n1;
                n1 = n2;
                n2 = tn;
            }
            if (ty1 > tmin) {
                tmin = ty1;
                nEnter = n1;
            }
            if (ty2 < tmax) {
                tmax = ty2;
                nExit = n2;
            }
            if (tmin > tmax) continue;
        }

        if (Math.abs(dz) < 1e-6) {
            if (pz < minZ || pz > maxZ) continue;
        } else {
            let tz1 = (minZ - pz) / dz;
            let tz2 = (maxZ - pz) / dz;
            let n1 = dz > 0 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 0, z: 1 };
            let n2 = dz > 0 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 };
            if (tz1 > tz2) {
                const tmp = tz1;
                tz1 = tz2;
                tz2 = tmp;
                const tn = n1;
                n1 = n2;
                n2 = tn;
            }
            if (tz1 > tmin) {
                tmin = tz1;
                nEnter = n1;
            }
            if (tz2 < tmax) {
                tmax = tz2;
                nExit = n2;
            }
            if (tmin > tmax) continue;
        }

        if (tmax < 0 || tmin > 1) continue;
        const tHit = tmin >= 0 ? tmin : tmax;
        if (tHit < 0 || tHit > 1) continue;
        const hx = px + dx * tHit,
            hy = py + dy * tHit,
            hz = pz + dz * tHit;
        const dMinX = Math.abs(hx - minX),
            dMaxX = Math.abs(hx - maxX),
            dMinY = Math.abs(hy - minY),
            dMaxY = Math.abs(hy - maxY),
            dMinZ = Math.abs(hz - minZ),
            dMaxZ = Math.abs(hz - maxZ);
        let bestD = dMinX;
        let n = { x: -1, y: 0, z: 0 };
        if (dMaxX < bestD) {
            bestD = dMaxX;
            n = { x: 1, y: 0, z: 0 };
        }
        if (dMinY < bestD) {
            bestD = dMinY;
            n = { x: 0, y: -1, z: 0 };
        }
        if (dMaxY < bestD) {
            bestD = dMaxY;
            n = { x: 0, y: 1, z: 0 };
        }
        if (dMinZ < bestD) {
            bestD = dMinZ;
            n = { x: 0, y: 0, z: -1 };
        }
        if (dMaxZ < bestD) {
            n = { x: 0, y: 0, z: 1 };
        }
        if (!best || tHit < best.t) {
            best = { t: tHit, x: hx, y: hy, z: hz, n };
        }
    }
    return best;
}

function sweepArenaBounds(px, py, pz, nx, ny, nz, bound) {
    const dx = nx - px,
        dz = nz - pz;
    let tHit = Infinity;
    let n = null;
    if (nx > bound || nx < -bound) {
        const bx = nx > bound ? bound : -bound;
        if (Math.abs(dx) > 1e-6) {
            const t = (bx - px) / dx;
            if (t >= 0 && t <= 1 && t < tHit) {
                tHit = t;
                n = { x: nx > bound ? -1 : 1, y: 0, z: 0 };
            }
        }
    }
    if (nz > bound || nz < -bound) {
        const bz = nz > bound ? bound : -bound;
        if (Math.abs(dz) > 1e-6) {
            const t = (bz - pz) / dz;
            if (t >= 0 && t <= 1 && t < tHit) {
                tHit = t;
                n = { x: 0, y: 0, z: nz > bound ? -1 : 1 };
            }
        }
    }
    if (tHit === Infinity) return null;
    return {
        t: tHit,
        x: px + dx * tHit,
        //y: py + dy * tHit,
        z: pz + dz * tHit,
        n,
    };
}

// ════════════════════════════════════════════════════
//  NAMETAG
// ════════════════════════════════════════════════════
function makeTag(name, accent = "#44aaff") {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,.75)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 56, 10);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(4, 4, 6, 56, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
        name.length > 12 ? name.slice(0, 11) + "…" : name,
        133,
        34,
    );
    const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(cv),
            transparent: true,
            depthTest: false,
            sizeAttenuation: true,
        }),
    );
    sp.scale.set(2.4, 0.6, 1);
    return sp;
}

// ════════════════════════════════════════════════════
//  REMOTE PLAYERS  — FIX: pos field initialized
// ════════════════════════════════════════════════════
const TEAM_COLORS = [0xff4444, 0x3366ff];
const TEAM_HEX = ["#ff4444", "#4466ff"];

function buildRemoteMesh(name, team) {
    const g = new THREE.Group();
    const col = TEAM_COLORS[team] || 0xff6633;
    const mat = new THREE.MeshLambertMaterial({ color: col });
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 1, 8),
        mat,
    );
    body.position.y = 0.85;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), mat);
    head.position.y = 1.65;
    g.add(head);
    const visor = new THREE.Mesh(
        new THREE.SphereGeometry(
            0.22,
            8,
            8,
            0,
            Math.PI * 2,
            0,
            Math.PI * 0.5,
        ),
        new THREE.MeshLambertMaterial({ color: 0x223399 }),
    );
    visor.position.y = 1.7;
    visor.rotation.x = 0.3;
    g.add(visor);
    const gun = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6),
        new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    gun.rotation.z = Math.PI / 2;
    gun.position.set(0.45, 1.1, 0);
    g.add(gun);
    const tag = makeTag(name, TEAM_HEX[team] || "#ff6633");
    tag.position.y = 2.55;
    g.add(tag);
    g.position.set(5, 0, 5);
    scene.add(g);
    return g;
}

// FIX: addRemoteClient now initializes pos field
function addRemoteClient(sid, name, team) {
    if (remoteClients[sid]) return;
    const mesh = buildRemoteMesh(name, team);
    remoteClients[sid] = {
        mesh,
        name,
        health: 100,
        score: 0,
        team,
        alive: true,
        pos: { x: 0, y: 0, z: 0 }, // ← FIX: pos initialized for minimap
    };
}

function removeRemoteClient(sid) {
    if (!remoteClients[sid]) return;
    scene.remove(remoteClients[sid].mesh);
    delete remoteClients[sid];
}
function clearRemoteClients() {
    Object.keys(remoteClients).forEach(removeRemoteClient);
}

// ════════════════════════════════════════════════════
//  SPAWN SYSTEM  — FIX: uses player index
// ════════════════════════════════════════════════════
function getSpawn(playerIndex) {
    const sp = (getMapDef(hostSettings.mapId) || {}).spawns || [
        { x: 0, z: 0 },
    ];

    // If playerIndex is provided and valid, use it
    // Otherwise, pick a random spawn
    if (playerIndex !== undefined && playerIndex >= 0 && playerIndex < sp.length) {
        return sp[playerIndex];
    }

    const index = Math.floor(Math.random() * sp.length);
    return sp[index];
}

function safeSpawnY(x, z) {
    let topY = 0;
    for (const o of obstacles)
        if (Math.abs(x - o.x) < o.hw + 0.3 && Math.abs(z - o.z) < o.hd + 0.3)
            topY = Math.max(topY, o.h);
    return topY + 1.7 + 0.1;
}

// ════════════════════════════════════════════════════
//  ENEMIES (bots)
// ════════════════════════════════════════════════════
function makeEnemy(x, z) {
    const g = new THREE.Group();
    const diff =
        BOT_DIFFICULTY[hostSettings.botDifficulty] || BOT_DIFFICULTY.medium;
    const bodyMat = new THREE.MeshLambertMaterial({
        color: ECOLS[Math.floor(Math.random() * ECOLS.length)],
        emissive: new THREE.Color(0, 0, 0),
    });
    const headMat = bodyMat.clone();
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 1, 8),
        bodyMat,
    );
    body.position.y = 0.85;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        headMat,
    );
    head.position.y = 1.65;
    g.add(head);
    const visor = new THREE.Mesh(
        new THREE.SphereGeometry(
            0.22,
            8,
            8,
            0,
            Math.PI * 2,
            0,
            Math.PI * 0.5,
        ),
        new THREE.MeshLambertMaterial({ color: 0x111111 }),
    );
    visor.position.set(0, 1.7, 0);
    visor.rotation.x = 0.3;
    g.add(visor);
    const gun = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6),
        new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    gun.rotation.z = Math.PI / 2;
    gun.position.set(0.45, 1.1, 0);
    g.add(gun);
    const tag = makeTag("BOT", "#ff3333");
    tag.position.y = 2.5;
    g.add(tag);
    g.position.set(x, 0, z);
    scene.add(g);
    return {
        mesh: g,
        bodyMat,
        headMat,
        health: 3,
        x,
        z,
        speed: diff.speed + Math.random() * 0.5,
        shootTimer: 1 + Math.random() * 2,
        shootCooldown: diff.cooldown + Math.random(),
        alive: true,
        hitFlash: 0,
        stuckTimer: 0,
    };
}
function spawnWave(wave) {
    const count = Math.min(
        3 + wave * 2,
        hostSettings.botCount > 0 ? hostSettings.botCount * 2 : 99,
    );
    for (let i = 0; i < count; i++) {
        let x, z, attempts = 0;
        const maxAttempts = 100;

        // Keep trying until we find a valid spawn position
        do {
            x = (Math.random() - 0.5) * 60;
            z = (Math.random() - 0.5) * 60;
            attempts++;

            // Fallback: if we can't find a spot after many attempts, use a safe default
            if (attempts >= maxAttempts) {
                x = 0;
                z = 0;
                break;
            }
        } while (
            // Too close to player
            Math.sqrt(x * x + z * z) < 14 ||
            // Collides with obstacles
            playerHitsObs(x, z, 1.7)
        );

        gs.enemies.push(makeEnemy(x, z));
    }
    const el = document.getElementById("wave-ann");
    el.textContent = "WAVE " + wave;
    el.style.opacity = "1";
    setTimeout(() => (el.style.opacity = "0"), 2200);
}

// ════════════════════════════════════════════════════
//  SPLAT
// ════════════════════════════════════════════════════
function addSplat(x, y, z, col, isGround, bvx, bvy, bvz, hitN) {
    const mat = new THREE.MeshLambertMaterial({
        color: col,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
    });
    const r = 0.13 + Math.random() * 0.12;
    const grp = new THREE.Group();
    if (isGround) {
        const geo = new THREE.CylinderGeometry(r, r * 0.8, 0.025, 10);
        const blob = new THREE.Mesh(geo, mat);
        blob.scale.set(1 + Math.random() * 0.6, 1, 0.6 + Math.random() * 0.8);
        grp.add(blob);
        const drops = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < drops; i++) {
            const dr = r * (0.25 + Math.random() * 0.25);
            const dblob = new THREE.Mesh(
                new THREE.CylinderGeometry(dr, dr * 0.7, 0.022, 7),
                mat,
            );
            const ang = Math.random() * Math.PI * 2;
            dblob.position.set(
                Math.cos(ang) * (r * 0.9 + dr * 0.6),
                0,
                Math.sin(ang) * (r * 0.9 + dr * 0.6),
            );
            grp.add(dblob);
        }
        grp.position.set(x, 0.012, z);
    } else {
        // Determine dominant velocity axis to find wall normal
        const absX = Math.abs(bvx), absZ = Math.abs(bvz), absY = Math.abs(bvy);
        const geo = new THREE.CircleGeometry(r * (0.85 + Math.random() * 0.4), 10);
        const blob = new THREE.Mesh(geo, mat);
        blob.scale.set(1 + Math.random() * 0.5, 0.7 + Math.random() * 0.6, 1);
        grp.add(blob);
        // Drips hanging downward from the splat center
        const drips = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < drips; i++) {
            const dlen = 0.07 + Math.random() * 0.18;
            const drad = 0.016 + Math.random() * 0.016;
            const drip = new THREE.Mesh(
                new THREE.CylinderGeometry(drad * 0.4, drad, dlen, 5),
                mat,
            );
            drip.position.set(
                (Math.random() - 0.5) * r * 0.6,
                -r * 0.7 - dlen / 2,
                0,
            );
            grp.add(drip);
        }
        // Rotate the group so it lies flat against the correct wall face
        if (hitN) {
            const ax = Math.abs(hitN.x),
                ay = Math.abs(hitN.y),
                az = Math.abs(hitN.z);
            if (ay >= ax && ay >= az) {
                grp.rotation.x = hitN.y > 0 ? -Math.PI / 2 : Math.PI / 2;
                grp.position.set(
                    x + hitN.x * 0.02,
                    y + hitN.y * 0.02,
                    z + hitN.z * 0.02,
                );
            } else {
                grp.rotation.y = Math.atan2(hitN.x, hitN.z);
                grp.position.set(
                    x + hitN.x * 0.02,
                    y,
                    z + hitN.z * 0.02,
                );
            }
        } else if (absX >= absZ && absX >= absY) {
            // Hit a +X or -X wall -- face along X axis
            grp.rotation.y = Math.sign(bvx) > 0 ? -Math.PI / 2 : Math.PI / 2;
            grp.position.set(x + Math.sign(bvx) * 0.025, y, z);
        } else if (absZ >= absX && absZ >= absY) {
            // Hit a +Z or -Z wall -- face along Z axis
            grp.rotation.y = Math.sign(bvz) > 0 ? 0 : Math.PI;
            grp.position.set(x, y, z + Math.sign(bvz) * 0.025);
        } else {
            // Hit a ceiling/floor edge case -- lay flat
            grp.rotation.x = -Math.PI / 2;
            grp.position.set(x, y + 0.025, z);
        }
    }
    scene.add(grp);
    gs.splats.push({ mesh: grp, life: 50 });
}

// ════════════════════════════════════════════════════
//  SHOOTING
// ════════════════════════════════════════════════════
function fireSingleBall(col, dir, pos, bl) {
    const d = dir.clone();
    const _es = getEffectiveStats();
    const effSpread = (_es.spread || 0) * (isAiming ? 0.15 : 1.0);
    if (effSpread > 0) {
        d.x += (Math.random() - 0.5) * effSpread;
        d.y += (Math.random() - 0.5) * effSpread * 0.5;
        d.z += (Math.random() - 0.5) * effSpread;
        d.normalize();
    }
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 6, 6),
        new THREE.MeshLambertMaterial({ color: col }),
    );
    mesh.position.copy(pos).addScaledVector(d, 0.5);
    scene.add(mesh);
    gs.paintballs.push({
        mesh,
        vx: d.x * bl.speed,
        vy: d.y * bl.speed,
        vz: d.z * bl.speed,
        life: 3,
        color: col,
        dmg: bl.dmg || 1,
        gravity: bl.gravity || 18,
    });
}

function shoot() {
    if (gs.isReloading) return;
    if (gs.ammo <= 0) {
        const now2 = performance.now() / 1000;
        if (now2 - (lastShotTime || 0) > 0.35) {
            lastShotTime = now2;
            sndDryFire();
        }
        return;
    }
    const now = performance.now() / 1000;
    const bl = equippedBlaster;
    if (now - lastShotTime < (bl.rateLimit || 0)) return;
    lastShotTime = now;
    const ammoToUse = hostSettings.infiniteAmmo ? 0 : 1;
    gs.ammo = Math.max(0, gs.ammo - ammoToUse);
    if (!hostSettings.infiniteAmmo) updateAmmoUI();
    if (
        hostSettings.limitedAmmo &&
        !hostSettings.infiniteAmmo &&
        gs.ammo === 0 &&
        reserveAmmo > 0
    ) {
        const refill = Math.min(gs.maxAmmo, reserveAmmo);
        reserveAmmo -= refill;
        setTimeout(() => {
            if (gs.running) {
                gs.ammo = refill;
                updateAmmoUI();
                updateReserveHUD();
            }
        }, getEffectiveStats().reloadMs);
    }
    updateReserveHUD();
    const col = gs.paintColor;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const wpos = camera.getWorldPosition(new THREE.Vector3());
    if (bl.mode === "shotgun") {
        for (let i = 0; i < (bl.pellets || 5); i++)
            fireSingleBall(col, dir.clone(), wpos.clone(), bl);
    } else if (bl.mode === "burst") {
        fireSingleBall(col, dir.clone(), wpos.clone(), bl);
        for (let i = 1; i < (bl.burstCount || 3); i++) {
            setTimeout(() => {
                if (!gs.running) return;
                if (!hostSettings.infiniteAmmo) {
                    gs.ammo = Math.max(0, gs.ammo - 1);
                    updateAmmoUI();
                }
                fireSingleBall(col, dir.clone(), wpos.clone(), bl);
            }, i * 70);
        }
    } else fireSingleBall(col, dir, wpos, bl);
    if (conn.open)
        conn.send({
            type: "shoot",
            ox: wpos.x,
            oy: wpos.y,
            oz: wpos.z,
            vx: dir.x * bl.speed,
            vy: dir.y * bl.speed,
            vz: dir.z * bl.speed,
            color: col,
        });
    const sf = document.getElementById("shoot-flash");
    sf.style.opacity = "0.55";
    setTimeout(() => (sf.style.opacity = "0"), 45);
    const recoilKick = (bl.recoil || 0.02) * (isAiming ? 0.4 : 1.0) * 14;
    recoilVel += recoilKick;
    gs.paintColor =
        PCOLS[(PCOLS.indexOf(gs.paintColor) + 1) % PCOLS.length];
    updateColorUI();
}

function enemyShoot(e) {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 6, 6),
        new THREE.MeshLambertMaterial({ color: 0xaa00ff }),
    );
    const dx = yawObj.position.x - e.x,
        dy = yawObj.position.y - 1.1,
        dz = yawObj.position.z - e.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1,
        sp = 20,
        spr = 0.07;
    mesh.position.set(e.x, 1.1, e.z);
    scene.add(mesh);
    gs.eBalls.push({
        mesh,
        vx: (dx / len + (Math.random() - 0.5) * spr) * sp,
        vy: (dy / len + (Math.random() - 0.5) * spr) * sp,
        vz: (dz / len + (Math.random() - 0.5) * spr) * sp,
        life: 4,
    });
}

function doReload() {
    if (
        gs.isReloading ||
        gs.ammo === gs.maxAmmo ||
        hostSettings.infiniteAmmo
    )
        return;
    gs.isReloading = true;
    const el = document.getElementById("reload-ann");
    el.style.opacity = "1";
    const _re = getEffectiveStats();
    const barWrap = document.getElementById("reload-bar-wrap");
    const barFill = document.getElementById("reload-bar-fill");
    if (barWrap && barFill) {
        barWrap.style.display = "block";
        barFill.style.transition = "none";
        barFill.style.width = "0%";
        requestAnimationFrame(() => {
            barFill.style.transition = `width ${_re.reloadMs}ms linear`;
            barFill.style.width = "100%";
        });
    }
    sndReload();
    setTimeout(() => {
        gs.ammo = gs.maxAmmo;
        gs.isReloading = false;
        updateAmmoUI();
        el.style.opacity = "0";
        if (barWrap) {
            barWrap.style.display = "none";
            if (barFill) barFill.style.width = "0%";
        }
        sndReloadDone();
    }, _re.reloadMs);
}

let _hitTimer = null,
    _hitIndTimer = null;
function showHitmarker(isKill, isPvP) {
    const hm = document.getElementById("hitmarker");
    const hi = document.getElementById("hit-indicator");
    hm.style.opacity = "1";
    hm.style.filter = isKill
        ? "drop-shadow(0 0 4px #ffdd00)"
        : isPvP
            ? "drop-shadow(0 0 4px #ff8800)"
            : "drop-shadow(0 0 3px #fff)";
    clearTimeout(_hitTimer);
    _hitTimer = setTimeout(
        () => (hm.style.opacity = "0"),
        isKill ? 220 : 120,
    );
    if (isKill) {
        hi.textContent = "KILL!";
        hi.style.color = "#ffdd00";
        hi.style.fontSize = "36px";
    } else if (isPvP) {
        hi.textContent = "HIT!";
        hi.style.color = "#ff8833";
        hi.style.fontSize = "26px";
    } else {
        hi.textContent = "HIT";
        hi.style.color = "#ffffff";
        hi.style.fontSize = "22px";
    }
    hi.style.opacity = "1";
    clearTimeout(_hitIndTimer);
    _hitIndTimer = setTimeout(
        () => (hi.style.opacity = "0"),
        isKill ? 500 : 280,
    );
}

function hitEnemy(e, dmg) {
    e.health -= dmg || 1;
    e.hitFlash = 0.25;
    gs.score += 10;
    earnPB(2);
    updateScoreUI();
    if (e.health <= 0) {
        e.alive = false;
        gs.kills++;
        gs.score += 50;
        earnPB(10);
        scene.remove(e.mesh);
        updateScoreUI();
        showHitmarker(true, false);
    } else showHitmarker(false, false);
}

function takeDmg(rawDamage, killerSid = null) {  // ← ADD killerSid parameter
    console.log("[TAKE-DMG] Incoming raw damage:", rawDamage);

    // Apply armor reduction (centralized!)
    const prot = _armorProt() / 100;
    const actualDmg = Math.max(1, Math.round(rawDamage * (1 - prot)));

    gs.health = Math.max(0, gs.health - actualDmg);
    console.log("[TAKE-DMG] After armor → health now:", gs.health);

    updateHealthUI();

    // Visual & audio feedback
    const hf = document.getElementById("hit-flash");
    if (hf) {
        hf.style.opacity = "1";
        setTimeout(() => (hf.style.opacity = "0"), 160);
    }

    sndDamage();
    _shake = Math.max(_shake, 0.011);

    if (gs.health <= 0) {
        console.log("[TAKE-DMG] Health <= 0 → dying");
        localPlayerDied(killerSid);  // ← PASS killerSid here
    }
}

function localPlayerDied(killerSid = null) {
    if (!gs.running) return;
    if (conn.open) conn.send({
        type: "player_dead",
        sid: mySid,
        killer_sid: killerSid  // ← ADD THIS
    });

    if (isTimerMode) {
        gs.running = false;
        setAim(false);
        try { document.exitPointerLock(); } catch (e) { }
        const ann = document.getElementById("wave-ann");
        ann.textContent = "ELIMINATED! Respawning in 3...";
        ann.style.opacity = "1";

        let cd = 3;
        const cdInterval = setInterval(() => {
            cd--;
            if (cd > 0) {
                ann.textContent = `ELIMINATED! Respawning in ${cd}...`;
            } else {
                clearInterval(cdInterval);
                ann.style.opacity = "0";
                const sp = getSpawn();
                const y = safeSpawnY(sp.x, sp.z);
                yawObj.position.set(sp.x, y, sp.z);
                gs.health = 100;
                gs.ammo = gs.maxAmmo;
                gs.isReloading = false;
                gs.running = true;
                updateHealthUI();
                updateAmmoUI();
                if (conn.open) conn.send({ type: "respawn", x: sp.x, z: sp.z });
                if (!touchEnabled) canvas.requestPointerLock();
            }
        }, 1000);
    } else {
        // original round-based death logic
        if (hostSettings.gameType === "solo" || hostSettings.gameType === "pvp_1v1") {
            if (hostSettings.rounds > 1 && roundNum <= hostSettings.rounds)
                endRound(null);
            else gameOver(false);
        } else {
            gs.running = false;
            setAim(false);
            if (!touchEnabled) try { document.exitPointerLock(); } catch (e) { }
            document.getElementById("wave-ann").textContent = "ELIMINATED!";
            document.getElementById("wave-ann").style.opacity = "1";
            setTimeout(() => document.getElementById("wave-ann").style.opacity = "0", 2500);
        }
    }
}

function respawnPlayer(isLocal = true, sid = mySid) {
    const sp = getSpawn(); // random spawn every time
    const y = safeSpawnY(sp.x, sp.z);

    if (isLocal) {
        yawObj.position.set(sp.x, y, sp.z);
        gs.health = 100;
        gs.running = true;
        gs.ammo = gs.maxAmmo;
        updateHealthUI();
        updateAmmoUI();
        if (conn.open) {
            conn.send({ type: "respawn", x: sp.x, z: sp.z });
        }

    } else {
        const rc = remoteClients[sid];
        if (rc) {
            rc.mesh.position.set(sp.x, 0, sp.z);   // note: remote mesh Y is always 0 (ground level)
            rc.pos = { x: sp.x, y: 1.7, z: sp.z };
            rc.health = 100;
            rc.alive = true;
            rc.mesh.visible = true;               // ← already here, good
        }
    }
}

const SIGHT_TYPES = {
    sniper: "crosshair",
    basic: "reddot",
    rapid: "reddot",
    burst: "reddot",
    shotgun: "ring",
    mega: "holo",
};
function getSightType() {
    // Prefer the equipped sight mod if available, so holographic/red-dot mods
    // actually change what the scope looks like when aiming.
    const sightMod = MODS && equippedMods ? MODS[equippedMods.sight] : null;
    if (sightMod && sightMod.id) {
        if (sightMod.id === "sight_holo") return "holo";
        if (sightMod.id === "sight_scope") return "crosshair";
        if (sightMod.id === "sight_red") return "reddot";
        if (sightMod.id === "sight_iron") {
            // Slightly chunkier ring-style irons
            return "ring";
        }
    }
    // Fallback to blaster-based defaults
    return SIGHT_TYPES[equippedBlaster?.id || "basic"] || "reddot";
}
function setAim(on) {
    isAiming = on;
    const fovMap = {
        sniper: 25,
        basic: 55,
        rapid: 52,
        burst: 50,
        shotgun: 65,
        mega: 58,
    };
    camera.fov = on ? fovMap[equippedBlaster?.id || "basic"] || 50 : 75;
    camera.updateProjectionMatrix();
    const scopeEl = document.getElementById("scope");
    const sightType = getSightType();
    scopeEl.style.display = on ? "block" : "none";
    scopeEl.dataset.sight = on ? sightType : "none";
    if (on) renderScopeOverlay(sightType);
    document.getElementById("xhair").style.display = on ? "none" : "block";
    document.getElementById("aim-btn").classList.toggle("active", on);
    document.body.classList.toggle("is-aiming", on);
}
function doJump() {
    if (onGround) {
        playerVY = 11;
        onGround = false;
    }
}

// ════════════════════════════════════════════════════
//  ROUND SYSTEM  — FIX: use myPlayerIndex & remote player indices
// ════════════════════════════════════════════════════
function startRound() {
    roundCountingDown = false;
    document.getElementById("round-overlay").style.display = "none";
    gs.enemies.forEach((e) => {
        if (e.mesh) scene.remove(e.mesh);
    });
    gs.paintballs.forEach((b) => scene.remove(b.mesh));
    gs.eBalls.forEach((b) => scene.remove(b.mesh));
    gs.splats.forEach((s) => scene.remove(s.mesh));
    gs.remoteBalls.forEach((b) => scene.remove(b.mesh));
    const bl = equippedBlaster;
    Object.assign(gs, {
        health: 100,
        ammo: bl.ammo,
        maxAmmo: bl.ammo,
        isReloading: false,
        running: true,
        paintColor: PCOLS[0],
        enemies: [],
        paintballs: [],
        eBalls: [],
        splats: [],
        remoteBalls: [],
    });
    waveActive = false;
    playerVY = 0;
    onGround = true;
    setAim(false);
    gs.yaw = 0;
    gs.pitch = 0;

    // FIX: spawn player at their assigned index
    const sp = getSpawn(myPlayerIndex);
    yawObj.position.set(sp.x, safeSpawnY(sp.x, sp.z), sp.z);

    // FIX: reset remote players and spawn them at their indices
    Object.entries(remoteClients).forEach(([sid, rc]) => {
        rc.health = 100;
        rc.alive = true;
        rc.mesh.visible = true;  // ← ADD THIS
        const player = roomPlayers.find((p) => p.sid === sid);
        if (player) {
            const rsp = getSpawn(player.index || 0);
            rc.mesh.position.set(rsp.x, 0, rsp.z);
            rc.pos = { x: rsp.x, y: 1.7, z: rsp.z };
        }
    });

    if (hostSettings.gameType === "solo") {
        document.getElementById("v-wave").textContent = gs.wave;
        if (roundNum > 1) {
            const el = document.getElementById("wave-ann");
            el.textContent = "ROUND " + roundNum + " — GO!";
            el.style.opacity = "1";
            setTimeout(() => (el.style.opacity = "0"), 2000);
        }
        setTimeout(() => {
            if (gs.running) {
                spawnWave(gs.wave);
                waveActive = true;
            }
        }, 600);
    } else {
        document.getElementById("v-wave").textContent = "R" + roundNum;
        const el = document.getElementById("wave-ann");
        el.textContent = "ROUND " + roundNum + " — GO!";
        el.style.opacity = "1";
        setTimeout(() => (el.style.opacity = "0"), 2000);
    }
    updateScoreUI();
    updateHealthUI();
    updateAmmoUI();
    updateColorUI();
    updateBlasterHUD();
    updateRoundStrip();
    if (!touchEnabled) canvas.requestPointerLock();
}

function endRound(winnerSid) {
    if (roundCountingDown) return;
    roundCountingDown = true;
    gs.running = false;
    setAim(false);
    if (!touchEnabled)
        try {
            document.exitPointerLock();
        } catch (e) { }
    let winnerName = "Tie";
    if (winnerSid === mySid || winnerSid === "local") {
        winnerName = playerName;
        roundWins[playerName] = (roundWins[playerName] || 0) + 1;
        earnPB(30);
    } else if (winnerSid && remoteClients[winnerSid]) {
        winnerName = remoteClients[winnerSid].name;
        roundWins[winnerName] = (roundWins[winnerName] || 0) + 1;
    } else if (winnerSid === null && hostSettings.gameType === "solo") {
        winnerName = "Bots Win";
    }
    const maxRounds = hostSettings.rounds;
    const overlay = document.getElementById("round-overlay");
    overlay.style.display = "flex";
    document.getElementById("round-overlay-title").textContent =
        `ROUND ${roundNum} COMPLETE`;
    document.getElementById("round-overlay-winner").textContent = winnerSid
        ? `🏆 ${winnerName} wins!`
        : "Round Over";
    let scHtml = "";
    Object.entries(roundWins)
        .sort((a, b) => b[1] - a[1])
        .forEach(([n, w]) => {
            scHtml += `${n}: ${w} win${w !== 1 ? "s" : ""}<br>`;
        });
    document.getElementById("round-overlay-scores").innerHTML = scHtml;
    roundNum++;
    if (roundNum > maxRounds) {
        setTimeout(() => {
            overlay.style.display = "none";
            const topPlayer = Object.entries(roundWins).sort(
                (a, b) => b[1] - a[1],
            )[0];
            const matchWon = topPlayer && topPlayer[0] === playerName;
            gameOver(matchWon, true);
        }, 3000);
        return;
    }
    let cd = 5;
    const cdEl = document.getElementById("round-overlay-countdown");
    cdEl.textContent = `Next round in ${cd}…`;
    const interval = setInterval(() => {
        cd--;
        if (cd > 0) {
            cdEl.textContent = `Next round in ${cd}…`;
        } else {
            clearInterval(interval);
            cdEl.textContent = "GO!";
            if (isHost || hostSettings.gameType === "solo") {
                if (conn.open) conn.send({ type: "round_start", roundNum });
                startRound();
            }
        }
    }, 1000);
}

function checkRoundOver() {
    if (isTimerMode) return;  // no round end in timed matches

    const gameType = hostSettings.gameType;
    if (gameType === "pvp_1v1" || gameType === "ffa") {
        const remoteAlive = Object.entries(remoteClients).filter(([, rc]) => rc.alive);
        const myAlive = gs.running;
        if (myAlive && remoteAlive.length === 0) {
            if (conn.open) conn.send({ type: "round_over", winnerSid: mySid });
            endRound(mySid);
        }
    } else if (gameType === "teams") {
        const myTeamAlive = gs.running;
        const otherAlive = Object.values(remoteClients).some(
            (rc) => rc.team !== myTeam && rc.alive
        );
        if (myTeamAlive && !otherAlive) {
            if (conn.open) conn.send({ type: "round_over", winnerSid: mySid });
            endRound(mySid);
        }
    }
}

function onTimeLimitReached() {
    if (!matchActive) return;
    matchActive = false;
    // Only the host decides the winner and broadcasts it
    if (!amIHost || !conn.open) return;
    // Find the player with the most kills (local + remotes)
    let bestSid = mySid;
    let bestKills = gs.kills || 0;
    Object.entries(remoteClients).forEach(([sid, rc]) => {
        const k = rc.kills || 0;
        if (k > bestKills) {
            bestKills = k;
            bestSid = sid;
        }
    });
    const winnerSid = bestSid;
    conn.send({ type: "round_over", winnerSid });
    endRound(winnerSid);
}

// ════════════════════════════════════════════════════
//  PB CURRENCY
// ════════════════════════════════════════════════════
function earnPB(n) {
    pb += n;
    sessionPBEarned += n;
    updatePBUI();
    savePersist();
}
function updatePBUI() {
    const v = pb.toLocaleString();
    document.getElementById("pb-val").textContent = v;
    document.getElementById("lobby-pb-val").textContent = v;
    document.getElementById("shop-pb-val").textContent = v;
}

// ════════════════════════════════════════════════════
//  GAME INIT / OVER
// ════════════════════════════════════════════════════
async function initGame() {
    clearRemoteClients();
    gs.score = 0;
    gs.kills = 0;
    gs.wave = 1;
    roundNum = 1;
    roundWins = {};
    sessionPBEarned = 0;
    roundCountingDown = false;
    await _mapsReady;
    buildMap(hostSettings.mapId);
    matchTimeLeft = hostSettings.timeLimit || 0;
    isTimerMode = hostSettings.timeLimit > 0;
    console.log("[INIT] Final hostSettings:", JSON.stringify(hostSettings));
    console.log("[INIT] isTimerMode final value:", isTimerMode);
    console.log("[INIT] timeLimit =", hostSettings.timeLimit, "→ isTimerMode =", isTimerMode);
    matchActive = true;
    document.getElementById("lobby").style.display = "none";
    document.getElementById("gameover").style.display = "none";
    document.getElementById("hud").style.display = "block";
    const isMP = hostSettings.gameType !== "solo";
    document.getElementById("scoreboard").style.display = isMP
        ? "flex"
        : "none";
    document.getElementById("round-strip").style.display =
        hostSettings.rounds > 1 ? "block" : "none";
    const tb = document.getElementById("team-badge");
    if (hostSettings.gameType === "teams") {
        tb.style.display = "block";
        tb.textContent = myTeam === 0 ? "TEAM RED" : "TEAM BLUE";
        tb.className = myTeam === 0 ? "red" : "blue";
    } else tb.style.display = "none";
    if (touchEnabled) {
        document.getElementById("touch-ui").style.display = "block";
        document.getElementById("xhair").style.display = "none";
        try {
            document.exitPointerLock();
        } catch (e) { }
    } else {
        document.getElementById("touch-ui").style.display = "none";
        document.getElementById("xhair").style.display = "block";
    }
    document.getElementById("minimap-wrap").style.display = "block";
    document.getElementById("kill-feed").style.display = "flex";
    startRound();
}

function gameOver(won, isMatchEnd) {
    gs.running = false;
    setAim(false);
    fireHeld = false;
    if (!touchEnabled)
        try {
            document.exitPointerLock();
        } catch (e) { }
    document.getElementById("round-overlay").style.display = "none";
    const go = document.getElementById("gameover");
    go.style.display = "flex";
    const title = document.getElementById("go-title");
    if (won) {
        title.textContent = isMatchEnd ? "MATCH WIN! 🏆" : "YOU WIN! 🏆";
        title.style.color = "#44ff88";
    } else {
        title.textContent = isMatchEnd ? "MATCH OVER" : "YOU'RE OUT!";
        title.style.color = "#ff4444";
    }
    const winsArr = Object.entries(roundWins).sort((a, b) => b[1] - a[1]);
    let statsHtml = `Score: <b>${gs.score}</b> &nbsp;·&nbsp; Kills: <b>${gs.kills}</b>`;
    if (hostSettings.gameType === "solo")
        statsHtml += ` &nbsp;·&nbsp; Wave: <b>${gs.wave}</b>`;
    if (winsArr.length > 0)
        statsHtml +=
            "<br>" +
            winsArr.map(([n, w]) => `${n}: <b>${w} wins</b>`).join(" · ");
    document.getElementById("final-stats").innerHTML = statsHtml;
    document.getElementById("pb-earned-display").textContent =
        sessionPBEarned > 0 ? `+${sessionPBEarned} PB earned 💰` : "";
}

// ════════════════════════════════════════════════════
//  UI UPDATES
// ════════════════════════════════════════════════════
function updateScoreUI() {
    document.getElementById("v-score").textContent = gs.score;
    document.getElementById("v-kills").textContent = gs.kills;
    if (conn.open)
        conn.send({ type: "score_update", score: gs.score, kills: gs.kills });
    updateScoreboard();
}
function updateHealthUI() {
    document.getElementById("hp-fill").style.width = gs.health + "%";
}
function updateAmmoUI() {
    if (hostSettings.infiniteAmmo) {
        document.getElementById("ammo-num").textContent = "∞";
        document.getElementById("pips").innerHTML = "";
        return;
    }
    document.getElementById("ammo-num").textContent =
        gs.ammo + " / " + gs.maxAmmo;
    const c = document.getElementById("pips");
    c.innerHTML = "";
    const show = Math.min(gs.maxAmmo, 10);
    for (let i = 0; i < show; i++) {
        const filled = Math.round((gs.ammo / gs.maxAmmo) * show);
        const p = document.createElement("div");
        p.className = "pip" + (i >= filled ? " empty" : "");
        c.appendChild(p);
    }
}
function updateColorUI() {
    document.getElementById("color-dot").style.background =
        "#" + gs.paintColor.toString(16).padStart(6, "0");
}
function updateBlasterHUD() {
    document.getElementById("blaster-hud-icon").textContent =
        equippedBlaster.icon;
    document.getElementById("blaster-hud-name").textContent =
        equippedBlaster.name;
}
function updateRoundStrip() {
    const el = document.getElementById("round-strip");
    if (hostSettings.rounds <= 1) {
        el.style.display = "none";
        return;
    }
    el.style.display = "block";
    const wins =
        Object.entries(roundWins)
            .map(([n, w]) => `${n.slice(0, 6)}: ${w}`)
            .join(" | ") || "Round " + roundNum + "/" + hostSettings.rounds;
    let txt = `ROUND ${roundNum}/${hostSettings.rounds}  —  ${wins}`;
    if (hostSettings.timeLimit && hostSettings.timeLimit > 0 && matchTimeLeft > 0) {
        const totalSec = Math.ceil(matchTimeLeft);
        const m = Math.floor(totalSec / 60)
            .toString()
            .padStart(1, "0");
        const s = (totalSec % 60).toString().padStart(2, "0");
        txt += `  ·  TIME LEFT ${m}:${s}`;
    }
    el.textContent = txt;
}
function updateScoreboard() {
    const sb = document.getElementById("scoreboard");
    if (hostSettings.gameType === "solo") {
        sb.style.display = "none";
        return;
    }
    sb.style.display = "flex";
    sb.innerHTML = "";
    const myRow = document.createElement("div");
    myRow.className = "sb-row";
    myRow.innerHTML = `<div class="sb-dot" style="background:${myTeam === 0 ? "#ff4444" : "#4466ff"}"></div><span>${playerName}</span><span style="margin-left:auto;font-family:'Bebas Neue',sans-serif">${gs.score}</span>`;
    sb.appendChild(myRow);
    Object.values(remoteClients).forEach((rc) => {
        const row = document.createElement("div");
        row.className = "sb-row";
        const c = rc.team === 0 ? "#ff4444" : "#4466ff";
        row.innerHTML = `<div class="sb-dot" style="background:${c}"></div><span>${rc.name}</span><span style="margin-left:auto;font-family:'Bebas Neue',sans-serif">${rc.score}</span>`;
        sb.appendChild(row);
    });
}
function waveAnn(w) {
    document.getElementById("v-wave").textContent = w;
    const el = document.getElementById("wave-ann");
    el.textContent = "WAVE " + w;
    el.style.opacity = "1";
    setTimeout(() => (el.style.opacity = "0"), 2200);
}

// ════════════════════════════════════════════════════
//  SHOP
// ════════════════════════════════════════════════════
function openShop() {
    renderShop();
    document.getElementById("pause-menu").style.display = "none";
    document.getElementById("shop").style.display = "flex";
    document.getElementById("promo-inp").value = "";
    document.getElementById("promo-result").textContent = "";
    document.getElementById("promo-result").className = "";
    if (!touchEnabled)
        try {
            document.exitPointerLock();
        } catch (e) { }
}
function closeShop() {
    document.getElementById("shop").style.display = "none";
    const wasPaused =
        !gs.running &&
        document.getElementById("hud").style.display === "block";
    if (wasPaused)
        document.getElementById("pause-menu").style.display = "flex";
    else if (gs.running && !touchEnabled) canvas.requestPointerLock();
}
let _shopTab = "blasters";
function switchShopTab(tab) {
    _shopTab = tab;
    ["blasters", "mods", "armor", "medical", "ammo"].forEach((t) => {
        const c = document.getElementById("shop-tab-" + t);
        if (c) c.style.display = t === tab ? "block" : "none";
        const b = document.getElementById("tab-" + t);
        if (b) b.classList.toggle("active", t === tab);
    });
    renderShopTab();
}
function renderShopTab() {
    renderEffPanel();
    if (_shopTab === "blasters") renderBlasters();
    else if (_shopTab === "mods") renderMods();
    else if (_shopTab === "armor") renderArmorShop();
    else if (_shopTab === "medical") renderMedicalShop();
    else renderAmmoPacks();
}
function renderEffPanel() {
    const e = getEffectiveStats(),
        bl = equippedBlaster;
    const sm = MODS[equippedMods.sight],
        mm = MODS[equippedMods.mag],
        rm = MODS[equippedMods.reload];
    document.getElementById("eff-panel").innerHTML = `
    <div class="eff-stat"><div class="eff-stat-val">${bl.icon} ${bl.name}</div><div class="eff-stat-lbl">Blaster</div></div>
    <div class="eff-stat"><div class="eff-stat-val">${e.ammo}</div><div class="eff-stat-lbl">📦 Mag Size</div></div>
    <div class="eff-stat"><div class="eff-stat-val">${(e.reloadMs / 1000).toFixed(1)}s</div><div class="eff-stat-lbl">⏱ Reload</div></div>
    <div class="eff-stat"><div class="eff-stat-val">${e.moveSpeed.toFixed(1)}</div><div class="eff-stat-lbl">🏃 Speed</div></div>
    <div class="eff-stat"><div class="eff-stat-val">${e.totalWeight.toFixed(2)}kg</div><div class="eff-stat-lbl">⚖️ Weight</div></div>
    <div class="eff-stat"><div class="eff-stat-val">${sm.icon}${mm.icon}${rm.icon}</div><div class="eff-stat-lbl">🔧 Mods</div></div>`;
}
function renderShop() {
    updatePBUI();
    renderShopTab();
}
function renderBlasters() {
    const grid = document.getElementById("blaster-grid");
    grid.innerHTML = "";
    BLASTERS.forEach((bl) => {
        const owned = ownedBlasters.includes(bl.id),
            equipped = equippedBlaster.id === bl.id,
            canAfford = pb >= bl.cost;
        const card = document.createElement("div");
        card.className =
            "b-card" + (equipped ? " c-equipped" : owned ? " c-owned" : "");
        if (equipped)
            card.innerHTML += `<div class="b-badge eq">Equipped</div>`;
        else if (owned)
            card.innerHTML += `<div class="b-badge owned">Owned</div>`;
        card.innerHTML += `<div class="b-icon">${bl.icon}</div><div class="b-name">${bl.name}</div><div class="b-desc">${bl.desc}</div>
      <div class="b-stats">
        <div class="b-stat"><span class="b-stat-lbl">📦 Ammo ${bl.ammo}</span><div class="b-stat-bar"><div class="b-stat-fill ammo" style="width:${bl.ammoFill * 100}%"></div></div></div>
        <div class="b-stat"><span class="b-stat-lbl">⚡ Rate ${bl.rateLabel}</span><div class="b-stat-bar"><div class="b-stat-fill rate" style="width:${bl.rateFill * 100}%"></div></div></div>
        <div class="b-stat"><span class="b-stat-lbl">💨 Speed ${bl.speedLabel}</span><div class="b-stat-bar"><div class="b-stat-fill speed" style="width:${bl.speedFill * 100}%"></div></div></div>
        <div class="b-stat"><span class="b-stat-lbl">🎯 Accuracy ${bl.accuracyLabel}</span><div class="b-stat-bar"><div class="b-stat-fill acc" style="width:${bl.accuracyFill * 100}%"></div></div></div>
      </div>`;
        if (!owned) {
            card.innerHTML += `<div class="b-cost">💰 ${bl.cost.toLocaleString()} PB</div>`;
            const btn = document.createElement("button");
            btn.className = "b-btn " + (canAfford ? "buy" : "cant");
            btn.textContent = canAfford
                ? "BUY"
                : `Need ${(bl.cost - pb).toLocaleString()} more PB`;
            if (canAfford) btn.onclick = () => buyBlaster(bl.id);
            card.appendChild(btn);
        } else if (!equipped) {
            const btn = document.createElement("button");
            btn.className = "b-btn equip";
            btn.textContent = "EQUIP";
            btn.onclick = () => equipBlaster(bl.id);
            card.appendChild(btn);
        } else {
            const btn = document.createElement("button");
            btn.className = "b-btn is-equipped";
            btn.textContent = "✓ EQUIPPED";
            card.appendChild(btn);
        }
        grid.appendChild(card);
    });
}
function renderMods() {
    const SLOTS = [
        {
            key: "sight",
            label: "🔭 SIGHT MOD",
            ids: ["sight_iron", "sight_red", "sight_holo", "sight_scope", "sight_micro", "sight_tri"],
        },
        {
            key: "mag",
            label: "📦 MAG MOD",
            ids: ["mag_std", "mag_ext", "mag_drum", "mag_tank", "mag_feeder"],
        },
        {
            key: "reload",
            label: "⏱ RELOAD MOD",
            ids: ["reload_std", "reload_quick", "reload_speed", "reload_auto", "reload_snap"],
        },
    ];
    SLOTS.forEach((slot) => {
        const sec = document.getElementById("mod-section-" + slot.key);
        sec.innerHTML = `<div class="mod-section-title">${slot.label}</div><div class="mod-grid" id="modgrid-${slot.key}"></div>`;
        const grid = document.getElementById("modgrid-" + slot.key);
        slot.ids.forEach((mid) => {
            const mod = MODS[mid],
                owned = ownedMods.includes(mid),
                equipped = equippedMods[slot.key] === mid,
                canAfford = pb >= mod.cost;
            const card = document.createElement("div");
            card.className =
                "mod-card" + (equipped ? " c-equipped" : owned ? " c-owned" : "");
            card.innerHTML = `${equipped ? '<div class="b-badge eq">ON</div>' : ""}<div class="mod-icon">${mod.icon}</div><div class="mod-name">${mod.name}</div><div class="mod-desc">${mod.desc}</div><div class="mod-weight">⚖️ +${mod.weight.toFixed(2)}kg</div>`;
            if (!owned) {
                card.innerHTML += `<div class="b-cost" style="font-size:11px;margin-top:auto">💰 ${mod.cost.toLocaleString()} PB</div>`;
                const btn = document.createElement("button");
                btn.className = "b-btn " + (canAfford ? "buy" : "cant");
                btn.textContent = canAfford
                    ? "BUY"
                    : `Need ${(mod.cost - pb).toLocaleString()} more`;
                if (canAfford) btn.onclick = () => buyMod(mid);
                card.appendChild(btn);
            } else if (!equipped) {
                const btn = document.createElement("button");
                btn.className = "b-btn equip";
                btn.textContent = "EQUIP";
                btn.onclick = () => equipMod(mid);
                card.appendChild(btn);
            } else {
                const btn = document.createElement("button");
                btn.className = "b-btn is-equipped";
                btn.textContent = "✓ EQUIPPED";
                card.appendChild(btn);
            }
            grid.appendChild(card);
        });
    });
}
function renderAmmoPacks() {
    const grid = document.getElementById("pack-grid");
    grid.innerHTML = "";
    AMMO_PACKS.forEach((pack) => {
        const canAfford = pb >= pack.cost;
        const card = document.createElement("div");
        card.className = "pack-card";
        card.innerHTML = `<div class="pack-icon">${pack.icon}</div><div class="pack-name">${pack.name}</div><div class="pack-count">+${pack.count} 🎨</div><div class="pack-desc">${pack.desc}</div><div class="b-cost" style="font-size:11px">💰 ${pack.cost} PB</div>`;
        const btn = document.createElement("button");
        btn.className = "b-btn " + (canAfford ? "buy" : "cant");
        btn.textContent = canAfford
            ? "BUY"
            : `Need ${pack.cost - pb} more PB`;
        if (canAfford) btn.onclick = () => buyAmmoPack(pack.id);
        card.appendChild(btn);
        grid.appendChild(card);
    });
}

// ── ARMOR & MEDICAL ──
let ARMOR_ITEMS = [];
(async () => {
    try {
        const r = await fetch("/static/armor.json");
        if (r.ok) ARMOR_ITEMS = await r.json();
    } catch (e) { }
})();

let MEDICAL_ITEMS = [];
(async () => {
    try {
        const r = await fetch("/static/medical_items.json");
        if (r.ok) MEDICAL_ITEMS = await r.json();
    } catch (e) { }
})();

let _armorSlots = {},
    _armorOwned = [],
    _cons = {},
    _hpUps = 0,
    _regenChip = false;
let _regenTk = 0,
    _pkTmr = 0,
    _pkTk = 0,
    _adrTmr = 0;

function _armorProt() {
    let t = 0;
    for (const s in _armorSlots) {
        const it = ARMOR_ITEMS.find((a) => a.id === _armorSlots[s]);
        if (it) t += it.protection;
    }
    return Math.min(75, t);
}
function renderArmorShop() {
    const grid = document.getElementById("armor-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const oldSum = document.getElementById("armor-summary");
    if (oldSum) oldSum.remove();
    const SLOT_LABELS = {
        head: "🪖 HEAD",
        chest: "🛡 CHEST",
        arms: "🦾 ARMS",
        legs: "🦵 LEGS",
        feet: "👟 FEET",
        hands: "🧤 HANDS",
    };
    ["head", "chest", "arms", "legs", "feet", "hands"].forEach((slot) => {
        ARMOR_ITEMS.filter((a) => a.slot === slot).forEach((item) => {
            const owned = _armorOwned.includes(item.id),
                equipped = _armorSlots[slot] === item.id,
                canAfford = pb >= item.cost;
            const card = document.createElement("div");
            card.className =
                "armor-card" +
                (equipped ? " is-equipped" : owned ? " is-owned" : "");
            if (equipped) card.innerHTML += `<div class="ac-badge on">ON</div>`;
            else if (owned)
                card.innerHTML += `<div class="ac-badge own">Owned</div>`;
            card.innerHTML += `<div class="ac-slot">${SLOT_LABELS[slot] || slot}</div><div class="ac-name">${item.name}</div><div class="ac-desc">${item.desc}</div><div class="ac-prot">🛡 ${item.protection}% protection</div><div class="ac-bar"><div class="ac-bar-fill" style="width:${(item.protection / 35) * 100}%"></div></div>`;
            if (!owned) {
                card.innerHTML += `<div class="ac-cost">💰 ${item.cost.toLocaleString()} PB</div>`;
                const btn = document.createElement("button");
                btn.className = "ac-btn " + (canAfford ? "buy" : "cant");
                btn.textContent = canAfford
                    ? "BUY & EQUIP"
                    : `Need ${(item.cost - pb).toLocaleString()} more`;
                if (canAfford) btn.onclick = () => _buyArmor(item.id);
                card.appendChild(btn);
            } else if (!equipped) {
                const btn = document.createElement("button");
                btn.className = "ac-btn equip";
                btn.textContent = "EQUIP";
                btn.onclick = () => {
                    _equipArmor(item.id);
                    renderShop();
                };
                card.appendChild(btn);
            } else {
                const btn = document.createElement("button");
                btn.className = "ac-btn on";
                btn.textContent = "EQUIPPED";
                card.appendChild(btn);
            }
            grid.appendChild(card);
        });
    });
    const prot = _armorProt();
    const sumEl = document.createElement("div");
    sumEl.id = "armor-summary";
    sumEl.style.cssText =
        "width:100%;text-align:center;font-size:13px;color:#44aaff;margin:8px 0 16px";
    sumEl.innerHTML = `Total protection: <strong>${prot}%</strong> damage reduction${prot >= 75 ? ' <span style="color:#ffdd00">⚠ MAXED</span>' : ""}`;
    grid.after(sumEl);
}
function _buyArmor(id) {
    const it = ARMOR_ITEMS.find((a) => a.id === id);
    if (!it || pb < it.cost || _armorOwned.includes(id)) return;
    pb -= it.cost;
    _armorOwned.push(id);
    savePersist();
    _equipArmor(id);
}
function _equipArmor(id) {
    const it = ARMOR_ITEMS.find((a) => a.id === id);
    if (!it || !_armorOwned.includes(id)) return;
    _armorSlots[it.slot] = id;
    savePersist();
    updatePBUI();
    renderArmorShop();
}
function renderMedicalShop() {
    const grid = document.getElementById("medical-grid");
    if (!grid) return;
    grid.innerHTML = "";
    MEDICAL_ITEMS.forEach((item) => {
        const cnt = _cons[item.id] || 0;
        const maxed =
            item.id === "hp_up"
                ? _hpUps >= 3
                : item.id === "regen_chip"
                    ? _regenChip
                    : false;
        const canAfford = pb >= item.cost;
        const card = document.createElement("div");
        card.className = "armor-card" + (maxed ? " is-equipped" : "");
        if (cnt > 0 || maxed)
            card.innerHTML += `<div class="ac-badge ${maxed ? "on" : "own"}">${maxed ? "MAX" : "x" + cnt}</div>`;
        const tL =
            item.type === "consumable"
                ? "🍬 CONSUMABLE"
                : item.type === "upgrade"
                    ? "⬆ UPGRADE"
                    : "🔩 PASSIVE";
        const tC =
            item.type === "consumable"
                ? "#44ff88"
                : item.type === "upgrade"
                    ? "#ff6b35"
                    : "#ffdd00";
        card.innerHTML += `<div class="ac-slot">${tL}</div><div class="ac-name">${item.name}</div><div class="ac-desc">${item.desc}</div><div class="ac-prot" style="color:${tC}">${item.effect}</div>`;
        if (!maxed) {
            card.innerHTML += `<div class="ac-cost">💰 ${item.cost.toLocaleString()} PB</div>`;
            const btn = document.createElement("button");
            btn.className = "ac-btn " + (canAfford ? "buy" : "cant");
            btn.textContent = canAfford
                ? "BUY"
                : `Need ${(item.cost - pb).toLocaleString()} more`;
            if (canAfford) btn.onclick = () => _buyMedical(item.id);
            card.appendChild(btn);
        } else {
            const btn = document.createElement("button");
            btn.className = "ac-btn on";
            btn.textContent = "ACTIVE";
            card.appendChild(btn);
        }
        grid.appendChild(card);
    });
}
function _buyMedical(id) {
    const it = MEDICAL_ITEMS.find((m) => m.id === id);
    if (!it || pb < it.cost) return;
    pb -= it.cost;
    if (id === "hp_up" && _hpUps < 3) _hpUps++;
    else if (id === "regen_chip") _regenChip = true;
    else _cons[id] = (_cons[id] || 0) + it.count;
    savePersist();
    updatePBUI();
    renderMedicalShop();
}
function _useConsumable(id) {
    const it = MEDICAL_ITEMS.find((m) => m.id === id);
    if (!it || (_cons[id] || 0) <= 0) return false;
    const mh = 100 + _hpUps * 25;
    _cons[id]--;
    if (it.hp > 0) {
        gs.health = Math.min(mh, gs.health + it.hp);
        updateHealthUI();
        _qmsg(`${it.icon} +${it.hp} HP`, "#44ff88");
        sndPickup();
    } else if (id === "adrenaline") {
        gs.health = Math.min(mh, gs.health + 25);
        _adrTmr = 10;
        updateHealthUI();
        _qmsg("💉 ADRENALINE!", "#ffdd00");
    } else if (id === "painkillers") {
        _pkTmr = 20;
        _qmsg("💊 REGEN ACTIVE", "#44ff88");
    } else if (id === "stim_pack") {
        _cons[id]++;
        _qmsg("⚡ STIM READY", "#ffdd00");
    }
    savePersist();
    return true;
}
document.addEventListener("keydown", (ev) => {
    if (ev.code === "KeyH" && gs.running) {
        for (const id of [
            "trauma_kit",
            "medkit_x3",
            "medkit",
            "bandage_x3",
            "bandage",
            "adrenaline",
            "painkillers",
        ]) {
            if ((_cons[id] || 0) > 0) {
                _useConsumable(id);
                break;
            }
        }
    }
});
function _qmsg(msg, color) {
    const el = document.getElementById("wave-ann");
    if (!el) return;
    el.textContent = msg;
    el.style.color = color || "";
    el.style.opacity = "1";
    clearTimeout(el._qt);
    el._qt = setTimeout(() => {
        el.style.opacity = "0";
        el.style.color = "";
    }, 1600);
}

// Load armor/medical from localStorage
(function () {
    try {
        const a = localStorage.getItem("splat_armor_own");
        if (a) {
            const p = JSON.parse(a);
            if (Array.isArray(p)) _armorOwned = p;
        }
        const s = localStorage.getItem("splat_armor_sl");
        if (s) {
            const o = JSON.parse(s);
            if (o && typeof o === "object") _armorSlots = o;
        }
        const c = localStorage.getItem("splat_cons");
        if (c) {
            const o = JSON.parse(c);
            if (o && typeof o === "object") _cons = o;
        }
        const h = localStorage.getItem("splat_hpup");
        if (h !== null) _hpUps = Math.min(3, parseInt(h) || 0);
        const r = localStorage.getItem("splat_regen");
        if (r !== null) _regenChip = r === "1";
    } catch (e) { }
})();

function buyMod(id) {
    const mod = MODS[id];
    if (!mod || pb < mod.cost || ownedMods.includes(id)) return;
    pb -= mod.cost;
    ownedMods.push(id);
    savePersist();
    equipMod(id);
}
function equipMod(id) {
    const mod = MODS[id];
    if (!mod || !ownedMods.includes(id)) return;
    equippedMods[mod.slot] = id;
    gs.maxAmmo = getEffectiveStats().ammo;
    gs.ammo = Math.min(gs.ammo, gs.maxAmmo);
    updateAmmoUI();
    savePersist();
    renderShop();
    renderEffPanel();
}
function buyAmmoPack(id) {
    const pack = AMMO_PACKS.find((p) => p.id === id);
    if (!pack || pb < pack.cost) return;
    pb -= pack.cost;
    reserveAmmo += pack.count;
    savePersist();
    updateReserveHUD();
    renderShop();
}
function updateReserveHUD() {
    const el = document.getElementById("reserve-hud");
    if (!el) return;
    if (hostSettings.limitedAmmo && gs.running) {
        el.style.display = "block";
        document.getElementById("reserve-val").textContent = reserveAmmo;
    } else el.style.display = "none";
}
function buyBlaster(id) {
    const bl = BLASTERS.find((b) => b.id === id);
    if (!bl || pb < bl.cost || ownedBlasters.includes(id)) return;
    pb -= bl.cost;
    ownedBlasters.push(id);
    savePersist();
    equipBlaster(id);
}
function equipBlaster(id) {
    const bl = BLASTERS.find((b) => b.id === id);
    if (!bl || !ownedBlasters.includes(id)) return;
    equippedBlaster = bl;
    gs.maxAmmo = getEffectiveStats().ammo;
    gs.ammo = Math.min(gs.ammo, gs.maxAmmo);
    updateAmmoUI();
    updateBlasterHUD();
    savePersist();
    renderShop();
}
function redeemCode() {
    const code = document
        .getElementById("promo-inp")
        .value.trim()
        .toUpperCase();
    const res = document.getElementById("promo-result");
    if (!code) {
        res.className = "err";
        res.textContent = "Enter a code first!";
        return;
    }
    if (usedCodes.includes(code)) {
        res.className = "err";
        res.textContent = "Code already redeemed!";
        return;
    }
    const promo = PROMO_CODES[code];
    if (!promo) {
        res.className = "err";
        res.textContent = "Invalid code. Try again!";
        return;
    }
    usedCodes.push(code);
    earnPB(promo.pb);
    savePersist();
    renderShop();
    res.className = "ok";
    res.textContent = `${promo.emoji} +${promo.label} added!`;
    document.getElementById("promo-inp").value = "";
}

// ════════════════════════════════════════════════════
//  SETTINGS UI
// ════════════════════════════════════════════════════
function renderSettingsUI(containerId, editable) {
    const c = document.getElementById(containerId);
    if (!c) return;
    const s = hostSettings,
        dis = editable ? "" : "pointer-events:none;opacity:.55;";
    c.innerHTML = `
    <div class="srow" style="${dis}"><span class="srow-lbl">🗺 Map</span>
      <div class="chip-row">${Object.entries(MAPS).length > 0
            ? Object.entries(MAPS)
                .map(
                    ([id, m]) =>
                        `<div class="chip${s.mapId === id ? " sel" : ""}" onclick="setSetting('mapId','${id}')">${m.icon || "🗺"} ${m.name}</div>`,
                )
                .join("")
            : '<span style="opacity:.4">Loading maps…</span>'
        }</div>
    </div>
    <div class="srow" style="${dis}"><span class="srow-lbl">🔄 Rounds</span>
      <div class="chip-row">${[1, 3, 5, 10].map((n) => `<div class="chip${s.rounds === n ? " sel" : ""}" onclick="setSetting('rounds',${n})">${n}</div>`).join("")}</div>
    </div>
    <div class="srow" style="${dis}"><span class="srow-lbl">⏱ Time Limit</span>
      <div class="chip-row">${[
            { v: 0, lbl: "Off" },
            { v: 180, lbl: "3 min" },
            { v: 300, lbl: "5 min" },
            { v: 600, lbl: "10 min" },
        ]
            .map(
                (opt) =>
                    `<div class="chip${s.timeLimit === opt.v ? " sel" : ""}" onclick="setSetting('timeLimit',${opt.v})">${opt.lbl}</div>`,
            )
            .join("")}</div>
    </div>
    <div class="srow" style="${dis}"><span class="srow-lbl">∞ Infinite Ammo</span>
      <div class="toggle${s.infiniteAmmo ? " on" : ""}" onclick="setSetting('infiniteAmmo',!hostSettings.infiniteAmmo)"><div class="tknob"></div></div>
    </div>
    ${s.gameType === "limited_ammo" ? `<div class="srow" style="${dis}"><span class="srow-lbl">🎨 Starting Reserve</span><div class="chip-row">${[50, 100, 200, 500].map((n) => `<div class="chip${s.startingReserve === n ? " sel" : ""}" onclick="setSetting('startingReserve',${n})">${n}</div>`).join("")}</div></div>` : ""}
    ${s.gameType === "solo" || s.gameType === "ffa"
            ? `<div class="srow" style="${dis}"><span class="srow-lbl">🤖 Bot Count</span><div class="chip-row">${[0, 2, 4, 6, 8].map((n) => `<div class="chip${s.botCount === n ? " sel" : ""}" onclick="setSetting('botCount',${n})">${n === 0 ? "None" : n}</div>`).join("")}</div></div>
      <div class="srow" style="${dis}"><span class="srow-lbl">💀 Bot Difficulty</span><div class="chip-row">${["easy", "medium", "hard"].map((d) => `<div class="chip${s.botDifficulty === d ? " sel" : ""}" onclick="setSetting('botDifficulty','${d}')">${d.charAt(0).toUpperCase() + d.slice(1)}</div>`).join("")}</div></div>`
            : ""
        }
    ${s.gameType === "pvp_1v1" || s.gameType === "ffa" || s.gameType === "teams" ? `<div class="srow" style="${dis}"><span class="srow-lbl">👥 Max Players</span><div class="chip-row">${[2, 4, 6, 8].map((n) => `<div class="chip${s.maxPlayers === n ? " sel" : ""}" onclick="setSetting('maxPlayers',${n})">${n}</div>`).join("")}</div></div>` : ""}`;
}
function setSetting(key, val) {
    if (!amIHost) return;
    hostSettings[key] = val;
    if (key === "gameType")
        hostSettings.limitedAmmo = val === "limited_ammo";
    renderSettingsUI("solo-settings-box", true);
    renderSettingsUI("room-settings-inner", true);
    if (socket && roomCode)
        socket.emit("update_settings", { settings: hostSettings });
}

// ════════════════════════════════════════════════════
//  SOCKET.IO  — FIX: player index tracking in all handlers
// ════════════════════════════════════════════════════
function showNetWarning(msg) {
    const el = document.getElementById("net-warning");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
}

function ensureSocket() {
    if (typeof io === "undefined") {
        showNetWarning("Socket.IO not loaded — is the server running?");
        return false;
    }
    if (socket) return true;
    socket = io({ transports: ["websocket", "polling"] });

    socket.on("connect", () => {
        mySid = socket.id;
    });
    socket.on("connect_error", () => {
        showNetWarning("Server not reachable. Make sure Flask is running.");
    });

    // FIX: host_ready now stores myPlayerIndex = your_index
    socket.on("host_ready", (data) => {
        if (!data || data.code !== roomCode) return;
        myPlayerIndex = data.your_index || 0; // ← FIX
        document.getElementById("wait-code").textContent = roomCode;
        document.getElementById("wait-code-hint").textContent =
            "Share with friends!";
        document.getElementById("wait-spin").style.display = "block";
        document.getElementById("wait-status").textContent =
            "Waiting for players…";
        document.getElementById("room-settings-box").style.display = "block";
        document.getElementById("room-settings-title").textContent =
            "GAME SETTINGS (Host)";
        renderSettingsUI("room-settings-inner", true);
        conn.open = true;
        roomPlayers = [{ sid: mySid, name: playerName, team: 0, index: 0 }]; // ← FIX: include index
        renderPlayersList(roomPlayers);
    });

    socket.on("host_error", (data) => {
        document.getElementById("wait-code-hint").textContent =
            "Server error — try again";
        conn.open = false;
        roomCode = null;
    });

    // FIX: join_ready now reads your_index and stores roomPlayers with index
    socket.on("join_ready", (data) => {
        if (!data || data.code !== roomCode) return;
        mySid = data.your_sid;
        myTeam = data.your_team;
        myPlayerIndex = data.your_index || 0; // ← FIX
        isHost = false;
        amIHost = false;
        hostSettings = Object.assign({}, hostSettings, data.settings || {});
        conn.open = true;
        document.getElementById("err2").textContent = "";
        document.getElementById("room-settings-box").style.display = "block";
        document.getElementById("room-settings-title").textContent =
            "GAME SETTINGS (Read Only)";
        renderSettingsUI("room-settings-inner", false);
        roomPlayers = data.players || []; // ← FIX: server now includes index in players
        renderPlayersList(roomPlayers);
        document.getElementById("wait-status").textContent =
            "Waiting for host to start…";
        document.getElementById("wait-spin").style.display = "none";
        switchPanel("p-wait");
    });

    socket.on("join_error", (data) => {
        const r = data && data.reason ? data.reason : "";
        document.getElementById("err2").textContent =
            r === "room_full"
                ? "Room is full."
                : r === "not_found"
                    ? "Room not found."
                    : "Connection failed.";
        conn.open = false;
        roomCode = null;
    });

    socket.on("player_joined", (data) => {
        roomPlayers = data.players || [];
        renderPlayersList(roomPlayers);
        document.getElementById("wait-status").textContent =
            `${data.name} joined!`;
        if (isHost && roomPlayers.length >= 2) {
            document.getElementById("lobby-start").style.display = "block";
            document.getElementById("wait-spin").style.display = "none";
        }
    });

    socket.on("player_left", (data) => {
        renderPlayersList(data.players || []);
        document.getElementById("wait-status").textContent =
            `${data.name} left.`;
        if (gs.running) alert(data.name + " disconnected!");
    });

    socket.on("settings_changed", (data) => {
        hostSettings = Object.assign({}, hostSettings, data.settings || {});
        renderSettingsUI("room-settings-inner", isHost);
    });

    socket.on("relay", (msg) => handleRelay(msg));
    return true;
}

function renderPlayersList(players) {
    const list = document.getElementById("players-list");
    if (!list) return;
    list.innerHTML = "";
    players.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "player-entry";
        const dotClass =
            p.sid === mySid ? "blue" : p.team === 0 ? "red" : "blue";
        const badge = i === 0 ? "HOST" : p.team === 0 ? "RED" : "BLUE";
        row.innerHTML = `<div class="p-dot ${dotClass}"></div><span class="p-label">${p.name}${p.sid === mySid ? " (You)" : ""}</span><span class="p-badge">${badge}</span>`;
        list.appendChild(row);
    });
}

function setupHost() {
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    roomCode = code;
    isHost = true;
    amIHost = true;
    myTeam = 0;
    document.getElementById("wait-code-box").style.display = "block";
    document.getElementById("wait-code").textContent = code;
    document.getElementById("wait-code-hint").textContent = "Connecting…";
    switchPanel("p-wait");
    if (!ensureSocket()) return;
    socket.emit("host_room", {
        code,
        name: playerName,
        settings: hostSettings,
        max_players: hostSettings.maxPlayers,
    });
}
function setupGuest(code) {
    document.getElementById("err2").textContent = "Connecting…";
    roomCode = code.toUpperCase().trim();
    if (!ensureSocket()) return;
    socket.emit("join_room", { code: roomCode, name: playerName });
}
function leaveRoom() {
    if (socket && roomCode) socket.emit("leave_room", { code: roomCode });
    roomCode = null;
    conn.open = false;
    mySid = null;
    clearRemoteClients();
}

// FIX: handleRelay spawns remote players at their designated indices
async function handleRelay(msg) {
    const from = msg.from_sid;
    if (msg.type === "start") {
        hostSettings = Object.assign({}, hostSettings, msg.settings || {});
        myTeam = msg.myTeam !== undefined ? msg.myTeam : myTeam;

        // FIX: clear existing remote clients first
        clearRemoteClients();

        // FIX: init game first, then add remote players after
        await initGame();

        // FIX: add remote players and spawn them at correct positions
        if (msg.players) {
            msg.players.forEach((p) => {
                if (p.sid !== mySid) {
                    addRemoteClient(p.sid, p.name, p.team);
                    const rsp = getSpawn(p.index || 0); // ← FIX: use player index
                    const rc = remoteClients[p.sid];
                    if (rc) {
                        rc.mesh.position.set(rsp.x, 0, rsp.z);
                        rc.pos = { x: rsp.x, y: 1.7, z: rsp.z };
                    }
                }
            });
        }
    } else if (msg.type === "pos" && remoteClients[from]) {
        const rc = remoteClients[from];
        const remoteY = (msg.y || 1.7) - 1.7;
        rc.mesh.position.set(msg.x, remoteY, msg.z);
        rc.mesh.rotation.y = msg.yaw;
        rc.pos = { x: msg.x, y: msg.y || 1.7, z: msg.z };
    } else if (msg.type === "shoot") {
        const rc = remoteClients[from];
        // Ignore shots from players that are already marked dead
        if (rc && rc.alive === false) return;
        const rm = new THREE.Mesh(
            new THREE.SphereGeometry(0.055, 6, 6),
            new THREE.MeshLambertMaterial({ color: msg.color }),
        );
        rm.position.set(msg.ox, msg.oy, msg.oz);
        scene.add(rm);
        gs.remoteBalls.push({
            mesh: rm,
            vx: msg.vx,
            vy: msg.vy,
            vz: msg.vz,
            life: 3,
            color: msg.color,
            fromSid: from,
        });
    } else if (msg.type === "score_update" && remoteClients[from]) {
        remoteClients[from].score = msg.score;
        remoteClients[from].kills = msg.kills;
        updateScoreboard();
    } else if (msg.type === "pvp_hit") {
        const targetSid = msg.target_sid;
        if (targetSid !== mySid) return;

        console.log(`[RECEIVER] Got hit! base=${msg.dmg}, armor=${_armorProt()}%`);

        const baseDmg = msg.dmg || 10;
        const killerSid = msg.from_sid || msg.killer_sid;  // ← GET killer SID

        // Pass both damage and killer ID
        takeDmg(baseDmg, killerSid);  // ← PASS killerSid

        showHitmarker(false, true);
    } else if (msg.type === "player_dead") {
        const victimSid = msg.sid;
        const killerSid = msg.killer_sid;

        if (victimSid === mySid) {
            // I died — already handled in localPlayerDied()
            return;
        }

        const victim = remoteClients[victimSid];
        if (victim) {
            victim.alive = false;
            victim.health = 0;  // ← ADD THIS
            if (victim.mesh) victim.mesh.visible = false;
        }

        // If I killed them → give me credit
        if (killerSid === mySid) {
            gs.kills++;
            gs.score += 50;
            updateScoreUI();
            showHitmarker(true, true);
            _streakCheck();
            _kfAdd(playerName, victim?.name || "Enemy");
            sndKill();
            _shake = Math.max(_shake, 0.015);
        } else if (killerSid && remoteClients[killerSid]) {
            // Someone else got the kill - update their score
            const killer = remoteClients[killerSid];
            killer.kills = (killer.kills || 0) + 1;
            killer.score = (killer.score || 0) + 50;
            updateScoreboard();
            _kfAdd(killer.name, victim?.name || "Enemy");
        }

        checkRoundOver();
    } else if (msg.type === "round_over") {
        endRound(msg.winnerSid);
    } else if (msg.type === "round_start") {
        roundNum = msg.roundNum || roundNum;
        startRound();
    }
}

// ════════════════════════════════════════════════════
//  TOUCH
// ════════════════════════════════════════════════════
const ljZone = document.getElementById("lj-zone"),
    ljBase = document.getElementById("lj-base"),
    ljKnob = document.getElementById("lj-knob"),
    rjZone = document.getElementById("rj-zone");
let ljT = null,
    rjT = null,
    ljDx = 0,
    ljDy = 0,
    ljC = { x: 0, y: 0 };

ljZone.addEventListener("pointerdown", (e) => {
    if (!touchEnabled || ljT || !gs.running) return;
    e.preventDefault();
    e.stopPropagation();
    ljT = { id: e.pointerId };
    ljC = { x: e.clientX, y: e.clientY };
    ljBase.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px;`;
    ljKnob.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px;`;
});

ljZone.addEventListener("pointermove", (e) => {
    if (!ljT || e.pointerId !== ljT.id) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - ljC.x,
        dy = e.clientY - ljC.y,
        len = Math.sqrt(dx * dx + dy * dy) || 1,
        R = 70,
        cl = Math.min(len, R);
    ljKnob.style.left = ljC.x + (dx / len) * cl + "px";
    ljKnob.style.top = ljC.y + (dy / len) * cl + "px";
    ljDx = (dx / len) * Math.min(len / R, 1);
    ljDy = (dy / len) * Math.min(len / R, 1);
});

function clearLJ(e) {
    if (ljT && e.pointerId === ljT.id) {
        e.preventDefault();
        e.stopPropagation();
        ljT = null;
        ljDx = 0;
        ljDy = 0;
        ljBase.style.display = "none";
        ljKnob.style.display = "none";
    }
}
ljZone.addEventListener("pointerup", clearLJ);
ljZone.addEventListener("pointercancel", clearLJ);
ljZone.addEventListener("pointerleave", clearLJ);

rjZone.addEventListener("pointerdown", (e) => {
    if (!touchEnabled || !gs.running) return;
    e.preventDefault();
    e.stopPropagation();
    rjT = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
});

rjZone.addEventListener("pointermove", (e) => {
    if (!rjT || e.pointerId !== rjT.id) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - rjT.lx,
        dy = e.clientY - rjT.ly;
    rjT.lx = e.clientX;
    rjT.ly = e.clientY;
    const s = 0.003 * (sensitivity / 5);
    gs.yaw -= dx * s;
    gs.pitch = Math.max(
        -Math.PI / 3,
        Math.min(Math.PI / 3, gs.pitch - dy * s),
    );
});

function clearRJ(e) {
    if (rjT && e.pointerId === rjT.id) {
        e.preventDefault();
        e.stopPropagation();
        rjT = null;
    }
}
rjZone.addEventListener("pointerup", clearRJ);
rjZone.addEventListener("pointercancel", clearRJ);
rjZone.addEventListener("pointerleave", clearRJ);

document
    .getElementById("fire-btn")
    .addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (gs.running) {
            if (autoFire) {
                fireHeld = true;
                fireButtonPressed = true;
            } else {
                fireHeld = true;
                shoot();
            }
        }
    });

document.getElementById("fire-btn").addEventListener("pointerup", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!autoFire) {
        fireHeld = false;
    } else {
        fireButtonPressed = false;
        fireHeld = false;
    }
});

document
    .getElementById("fire-btn")
    .addEventListener("pointercancel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fireButtonPressed = false;
        fireHeld = false;
    });

document
    .getElementById("reload-btn-t")
    .addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        doReload();
    });

document
    .getElementById("jump-btn")
    .addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        doJump();
    });

document
    .getElementById("aim-btn")
    .addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        setAim(!isAiming);
    });
// ════════════════════════════════════════════════════
//  IN-GAME SETTINGS
// ════════════════════════════════════════════════════
const settBtn = document.getElementById("settings-btn"),
    settPanel = document.getElementById("settings-panel");
settBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = settPanel.style.display === "block";
    settPanel.style.display = isOpen ? "none" : "block";

    // Exit pointer lock when opening settings
    if (!isOpen && !touchEnabled) {
        try {
            document.exitPointerLock();
        } catch (e) { }
    }
});

document.addEventListener("click", (e) => {
    if (!settPanel.contains(e.target) && e.target !== settBtn) {
        const wasOpen = settPanel.style.display === "block";
        settPanel.style.display = "none";

        // Re-lock pointer when closing settings if game is running
        if (wasOpen && gs.running && !touchEnabled) {
            canvas.requestPointerLock();
        }
    }
});

document.getElementById("sens-sl").addEventListener("input", function () {
    sensitivity = +this.value;
    document.getElementById("sens-v").textContent = this.value;
});
document
    .getElementById("sens-sl2")
    .addEventListener("input", function () {
        sensitivity = +this.value;
        document.getElementById("sens-v2").textContent = this.value;
    });

// Shop buttons
document
    .getElementById("shop-hud-btn")
    .addEventListener("click", () => openShop());
document
    .getElementById("lobby-shop-btn")
    .addEventListener("click", () => openShop());
document
    .getElementById("shop-close")
    .addEventListener("click", () => closeShop());
document
    .getElementById("promo-btn")
    .addEventListener("click", () => redeemCode());
document.getElementById("promo-inp").addEventListener("keydown", (e) => {
    if (e.key === "Enter") redeemCode();
});

// ════════════════════════════════════════════════════
//  KEYBOARD / MOUSE
// ════════════════════════════════════════════════════
document.addEventListener("keydown", (e) => {
    gs.keys[e.code] = true;
    if (e.code === "KeyR") doReload();
    if (e.code === "Space") {
        e.preventDefault();
        doJump();
    }
    if (e.code === "Escape" && gs.running) {
        e.preventDefault();
        if (document.getElementById("shop").style.display === "flex")
            closeShop();
        else if (
            document.getElementById("pause-menu").style.display === "flex"
        )
            closePauseMenu();
        else openPauseMenu();
    }
});
document.addEventListener("keyup", (e) => {
    gs.keys[e.code] = false;
});
document.addEventListener("mousemove", (e) => {
    if (!document.pointerLockElement || touchEnabled) return;
    const s = 0.002 * (sensitivity / 5);
    gs.yaw -= e.movementX * s;
    gs.pitch = Math.max(
        -Math.PI / 3,
        Math.min(Math.PI / 3, gs.pitch - e.movementY * s),
    );
});
document.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
        if (!document.pointerLockElement) {
            if (gs.running) canvas.requestPointerLock();
            return;
        }
        if (gs.running && !touchEnabled) {
            fireHeld = true;
            shoot();
        }
    }
    if (e.button === 2 && gs.running && !touchEnabled) {
        e.preventDefault();
        setAim(true);
    }
});
document.addEventListener("mouseup", (e) => {
    if (e.button === 0) fireHeld = false;
    if (e.button === 2) setAim(false);
});
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement) fireHeld = false;
});

// ════════════════════════════════════════════════════
//  LOBBY LOGIC
// ════════════════════════════════════════════════════
function switchPanel(id) {
    document
        .querySelectorAll(".panel")
        .forEach((p) => p.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}
document.getElementById("name-next").addEventListener("click", () => {
    const n = document.getElementById("name-inp").value.trim();
    if (!n) {
        document.getElementById("err1").textContent =
            "Please enter your name!";
        return;
    }
    playerName = n;
    document.getElementById("name-badge").textContent =
        "Playing as: " + playerName;
    document.getElementById("err1").textContent = "";
    switchPanel("p-mode");
    updatePBUI();
});
document.getElementById("name-inp").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("name-next").click();
});
document
    .getElementById("mode-back")
    .addEventListener("click", () => switchPanel("p-name"));
document
    .getElementById("solo-quick-btn")
    .addEventListener("click", () => {
        hostSettings.gameType = "solo";
        amIHost = true;
        renderSettingsUI("solo-settings-box", true);
        switchPanel("p-solo-settings");
    });
document
    .getElementById("mp-quick-btn")
    .addEventListener("click", () => switchPanel("p-mp"));
document
    .getElementById("solo-settings-back")
    .addEventListener("click", () => switchPanel("p-mode"));
document.getElementById("solo-play-btn").addEventListener("click", () => {
    document.getElementById("lobby").style.display = "none";
    initGame();
});
document.getElementById("create-btn").addEventListener("click", () => {
    selGameType = "pvp_1v1";
    hostSettings.gameType = "pvp_1v1";
    ["card-pvp", "card-ffa", "card-teams", "card-limited_ammo"].forEach(
        (id) => document.getElementById(id)?.classList.remove("sel"),
    );
    document.getElementById("card-pvp")?.classList.add("sel");
    switchPanel("p-mp-mode");
});
document.getElementById("join-btn").addEventListener("click", () => {
    const code = document.getElementById("join-inp").value.trim();
    if (!code) {
        document.getElementById("err2").textContent = "Enter a room code!";
        return;
    }
    isHost = false;
    amIHost = false;
    setupGuest(code);
});
document.getElementById("join-inp").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("join-btn").click();
});
document.getElementById("mp-back").addEventListener("click", () => {
    switchPanel("p-mode");
    leaveRoom();
});
const mpModeCards = {
    pvp_1v1: "card-pvp",
    ffa: "card-ffa",
    teams: "card-teams",
    limited_ammo: "card-limited_ammo",
};
Object.entries(mpModeCards).forEach(([mode, cardId]) => {
    const el = document.getElementById(cardId);
    if (!el) return;
    el.addEventListener("click", () => {
        selGameType = mode;
        hostSettings.gameType = mode;
        Object.values(mpModeCards).forEach((cid) =>
            document.getElementById(cid)?.classList.remove("sel"),
        );
        el.classList.add("sel");
    });
});
document.getElementById("mp-mode-next").addEventListener("click", () => {
    amIHost = true;
    setupHost();
});
document
    .getElementById("mp-mode-back")
    .addEventListener("click", () => switchPanel("p-mp"));
document.getElementById("wait-back").addEventListener("click", () => {
    switchPanel("p-mp");
    leaveRoom();
    document.getElementById("lobby-start").style.display = "none";
    document.getElementById("wait-code-box").style.display = "none";
    document.getElementById("room-settings-box").style.display = "none";
    document.getElementById("players-list").innerHTML = "";
    document.getElementById("wait-spin").style.display = "block";
    document.getElementById("wait-status").textContent =
        "Waiting for players…";
});

// FIX: lobby-start sends players with index, host spawns at index 0
document
    .getElementById("lobby-start")
    .addEventListener("click", async () => {
        if (!conn.open) return;
        conn.send({
            type: "start",
            settings: hostSettings,
            players: roomPlayers,
            myTeam: 1,
        });
        await initGame();
        roomPlayers.forEach((p) => {
            if (p.sid !== mySid) {
                addRemoteClient(p.sid, p.name, p.team);
                // FIX: spawn remote players at their designated index positions
                const rsp = getSpawn(p.index || 0);
                const rc = remoteClients[p.sid];
                if (rc) {
                    rc.mesh.position.set(rsp.x, 0, rsp.z);
                    rc.pos = { x: rsp.x, y: 1.7, z: rsp.z };
                }
            }
        });
    });

document.getElementById("restart-btn").addEventListener("click", () => {
    document.getElementById("gameover").style.display = "none";
    gs.score = 0;
    gs.kills = 0;
    gs.wave = 1;
    roundNum = 1;
    roundWins = {};
    sessionPBEarned = 0;
    initGame();
});
document.getElementById("menu-btn").addEventListener("click", () => {
    document.getElementById("pause-menu").style.display = "none";
    document.getElementById("gameover").style.display = "none";
    document.getElementById("hud").style.display = "none";
    document.getElementById("lobby").style.display = "flex";
    document.getElementById("minimap-wrap").style.display = "none";
    document.getElementById("kill-feed").style.display = "none";
    gs.running = false;
    setAim(false);
    fireHeld = false;
    if (roomCode) leaveRoom();
    try {
        document.exitPointerLock();
    } catch (e) { }
    switchPanel("p-mode");
    updatePBUI();
});

updatePBUI();
_mapsReady.then(() => buildMap("arena"));

// ════════════════════════════════════════════════════
//  SCOPE SVG OVERLAY
// ════════════════════════════════════════════════════
function renderScopeOverlay(type) {
    const svg = document.getElementById("scope-svg");
    svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    function el(tag, attrs) {
        const e = document.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
        return e;
    }
    const lc = "rgba(255,255,255,0.55)";
    if (type === "crosshair") {
        svg.appendChild(
            el("circle", {
                cx: 0,
                cy: 0,
                r: 120,
                fill: "none",
                stroke: "rgba(255,255,255,0.25)",
                "stroke-width": 1.5,
            }),
        );
        [
            [-120, 0, -12, 0],
            [12, 0, 120, 0],
            [0, -120, 0, -12],
            [0, 12, 0, 120],
        ].forEach(([x1, y1, x2, y2]) =>
            svg.appendChild(
                el("line", { x1, y1, x2, y2, stroke: lc, "stroke-width": 1 }),
            ),
        );
        [-80, -60, -40, 40, 60, 80].forEach((x) =>
            svg.appendChild(el("circle", { cx: x, cy: 0, r: 2.5, fill: lc })),
        );
        svg.appendChild(
            el("circle", { cx: 0, cy: 0, r: 1.5, fill: "rgba(255,50,50,0.9)" }),
        );
        [-40, 40].forEach((y) =>
            svg.appendChild(
                el("line", {
                    x1: -6,
                    y1: y,
                    x2: 6,
                    y2: y,
                    stroke: lc,
                    "stroke-width": 1,
                }),
            ),
        );
    } else if (type === "reddot") {
        svg.appendChild(
            el("circle", {
                cx: 0,
                cy: 0,
                r: 40,
                fill: "none",
                stroke: "rgba(255,255,255,0.3)",
                "stroke-width": 1.5,
            }),
        );
        svg.appendChild(
            el("circle", { cx: 0, cy: 0, r: 4, fill: "rgba(255,40,40,0.95)" }),
        );
        [
            [0, -45, 0, -38],
            [0, 45, 0, 38],
            [-45, 0, -38, 0],
            [45, 0, 38, 0],
        ].forEach(([x1, y1, x2, y2]) =>
            svg.appendChild(
                el("line", { x1, y1, x2, y2, stroke: lc, "stroke-width": 1 }),
            ),
        );
    } else if (type === "ring") {
        svg.appendChild(
            el("circle", {
                cx: 0,
                cy: 0,
                r: 75,
                fill: "none",
                stroke: "rgba(255,165,0,0.5)",
                "stroke-width": 2,
            }),
        );
        svg.appendChild(
            el("circle", {
                cx: 0,
                cy: 0,
                r: 30,
                fill: "none",
                stroke: "rgba(255,165,0,0.3)",
                "stroke-width": 1,
            }),
        );
        svg.appendChild(
            el("circle", { cx: 0, cy: 0, r: 5, fill: "rgba(255,165,0,0.85)" }),
        );
        [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
        ].forEach(([sx, sy]) => {
            svg.appendChild(
                el("line", {
                    x1: sx * 55,
                    y1: sy * 55,
                    x2: sx * 55,
                    y2: sy * 70,
                    stroke: "rgba(255,165,0,0.6)",
                    "stroke-width": 2,
                }),
            );
            svg.appendChild(
                el("line", {
                    x1: sx * 55,
                    y1: sy * 55,
                    x2: sx * 70,
                    y2: sy * 55,
                    stroke: "rgba(255,165,0,0.6)",
                    "stroke-width": 2,
                }),
            );
        });
    } else {
        svg.appendChild(
            el("circle", {
                cx: 0,
                cy: 0,
                r: 55,
                fill: "none",
                stroke: "rgba(0,255,180,0.4)",
                "stroke-width": 1.5,
            }),
        );
        svg.appendChild(
            el("polygon", {
                points: "0,-28 20,0 0,28 -20,0",
                fill: "none",
                stroke: "rgba(0,255,180,0.7)",
                "stroke-width": 1.5,
            }),
        );
        svg.appendChild(
            el("circle", { cx: 0, cy: 0, r: 3, fill: "rgba(0,255,180,0.95)" }),
        );
        [
            [-60, -5],
            [50, -5],
        ].forEach(([x, y]) =>
            svg.appendChild(
                el("line", {
                    x1: x,
                    y1: 0,
                    x2: x + 10,
                    y2: 0,
                    stroke: "rgba(0,255,180,0.4)",
                    "stroke-width": 1,
                }),
            ),
        );
    }
}

// ════════════════════════════════════════════════════
//  PAUSE MENU
// ════════════════════════════════════════════════════
function openPauseMenu() {
    gs.running = false;
    if (!touchEnabled)
        try {
            document.exitPointerLock();
        } catch (e) { }
    document.getElementById("pause-menu").style.display = "flex";
}
function closePauseMenu() {
    document.getElementById("pause-menu").style.display = "none";
    gs.running = true;
    if (!touchEnabled) canvas.requestPointerLock();
}
document
    .getElementById("pause-resume")
    .addEventListener("click", closePauseMenu);
document.getElementById("pause-shop").addEventListener("click", () => {
    document.getElementById("pause-menu").style.display = "none";
    openShop();
});
document
    .getElementById("pause-settings-btn")
    .addEventListener("click", () => {
        const inner = document.getElementById("pause-settings-inner");
        if (!inner) return;
        const open = inner.style.display !== "block";
        inner.style.display = open ? "block" : "none";
        document.getElementById("pause-settings-btn").textContent = open
            ? "▲ HIDE SETTINGS"
            : "⚙ SETTINGS";
    });
document
    .getElementById("touch-tog2")
    .addEventListener("click", () => setTouch(!touchEnabled));
document
    .getElementById("pause-menu-btn")
    .addEventListener("click", () => {
        document.getElementById("pause-menu").style.display = "none";
        document.getElementById("gameover").style.display = "none";
        document.getElementById("hud").style.display = "none";
        document.getElementById("lobby").style.display = "flex";
        document.getElementById("minimap-wrap").style.display = "none";
        document.getElementById("kill-feed").style.display = "none";
        gs.running = false;
        setAim(false);
        fireHeld = false;
        if (roomCode) leaveRoom();
        try {
            document.exitPointerLock();
        } catch (e) { }
        switchPanel("p-mode");
        updatePBUI();
    });

// ════════════════════════════════════════════════════
//  AUDIO
// ════════════════════════════════════════════════════
let _ac = null;
function _getAC() {
    if (!_ac)
        _ac = new (window.AudioContext || window.webkitAudioContext)();
    if (_ac.state === "suspended") _ac.resume();
    return _ac;
}
function _tone(freq, type, gain, dur, delay) {
    try {
        const ac = _getAC(),
            t = ac.currentTime + (delay || 0) / 1000;
        const o = ac.createOscillator(),
            g = ac.createGain();
        o.type = type || "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(gain || 0.08, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.15));
        o.connect(g);
        g.connect(ac.destination);
        o.start(t);
        o.stop(t + (dur || 0.15) + 0.01);
    } catch (e) { }
}
function _noise(gain, dur, cutoff, delay) {
    try {
        const ac = _getAC(),
            t = ac.currentTime + (delay || 0) / 1000;
        const sr = ac.sampleRate,
            buf = ac.createBuffer(1, Math.ceil(sr * dur), sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = ac.createBufferSource();
        src.buffer = buf;
        const fi = ac.createBiquadFilter();
        fi.type = "lowpass";
        fi.frequency.value = cutoff || 2000;
        const g = ac.createGain();
        g.gain.setValueAtTime(gain || 0.1, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(fi);
        fi.connect(g);
        g.connect(ac.destination);
        src.start(t);
        src.stop(t + dur + 0.01);
    } catch (e) { }
}
function sndShoot() {
    _noise(0.15, 0.065, 3200);
    _tone(100, "square", 0.05, 0.055);
}
function sndDryFire() {
    _noise(0.045, 0.04, 600);
    _tone(150, "square", 0.025, 0.03);
}
function sndReload() {
    _noise(0.09, 0.1, 3800);
    _tone(260, "sine", 0.04, 0.12);
}
function sndReloadDone() {
    _tone(500, "sine", 0.09, 0.1);
    _tone(680, "sine", 0.07, 0.09, 90);
}
function sndHit() {
    _noise(0.05, 0.13, 800);
    _tone(420, "square", 0.04, 0.09);
}
function sndKill() {
    _tone(880, "sine", 0.12, 0.18);
    _tone(1320, "sine", 0.1, 0.16, 80);
}
function sndDamage() {
    _noise(0.17, 0.2, 200);
}
function sndJump() {
    _tone(190, "sine", 0.08, 0.08);
}
function sndPickup() {
    _tone(640, "sine", 0.08, 0.16);
    _tone(860, "sine", 0.09, 0.14, 160);
}
function sndStreak(n) {
    const notes =
        n >= 6
            ? [880, 1100, 1320, 1760]
            : n >= 4
                ? [660, 880, 1100]
                : [440, 660];
    notes.forEach((f, i) => _tone(f, "sine", 0.12, 0.2, i * 70));
}

// ════════════════════════════════════════════════════
//  SCREEN SHAKE / MUZZLE FLASH / PARTICLES
// ════════════════════════════════════════════════════
let _shake = 0;
const _mfl = [];
function _muzzleFlash() {
    const pos = camera.getWorldPosition(new THREE.Vector3()),
        dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const lgt = new THREE.PointLight(0xffaa22, 5, 4);
    lgt.position.copy(pos.clone().addScaledVector(dir, 0.85));
    scene.add(lgt);
    _mfl.push({ lgt, life: 0.055, max: 0.055 });
}
function _mflTick(dt) {
    for (let i = _mfl.length - 1; i >= 0; i--) {
        const f = _mfl[i];
        f.life -= dt;
        if (f.life <= 0) {
            scene.remove(f.lgt);
            _mfl.splice(i, 1);
        } else f.lgt.intensity = (f.life / f.max) * 5;
    }
}
const _pGeo = new THREE.SphereGeometry(0.042, 4, 3),
    _pts = [];
function _spawnPts(x, y, z, color, n, spd, life) {
    for (let i = 0; i < n; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 1,
        });
        const mesh = new THREE.Mesh(_pGeo, mat);
        mesh.position.set(
            x + (Math.random() - 0.5) * 0.18,
            y,
            z + (Math.random() - 0.5) * 0.18,
        );
        const a = Math.random() * Math.PI * 2,
            el2 = (Math.random() - 0.5) * Math.PI,
            sp = spd * (0.5 + Math.random());
        _pts.push({
            mesh,
            mat,
            vx: Math.cos(a) * Math.cos(el2) * sp,
            vy: Math.abs(Math.sin(el2)) * sp + 1.2 + Math.random(),
            vz: Math.sin(a) * Math.cos(el2) * sp,
            life: life * (0.6 + Math.random() * 0.4),
            max: life,
        });
        scene.add(mesh);
    }
}
function _hitParticles(x, y, z, col) {
    _spawnPts(x, y, z, col, 7, 5, 0.4);
}
function _ptsTick(dt) {
    for (let i = _pts.length - 1; i >= 0; i--) {
        const p = _pts[i];
        p.life -= dt;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            p.mat.dispose();
            _pts.splice(i, 1);
            continue;
        }
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 13 * dt;
        p.mat.opacity = p.life / p.max;
    }
}

// ════════════════════════════════════════════════════
//  DAMAGE NUMBERS
// ════════════════════════════════════════════════════
const _dns = [];
function _dmgNum(x, y, z, dmg) {
    const div = document.createElement("div"),
        kill = dmg >= 100;
    div.textContent = kill ? "SPLAT!" : "-" + dmg;
    div.style.cssText = `position:fixed;pointer-events:none;z-index:60;font-family:"Bebas Neue",sans-serif;font-size:${kill ? 25 : 18}px;color:${kill ? "#ffdd00" : "#ff6b35"};text-shadow:0 2px 5px rgba(0,0,0,.9);`;
    document.body.appendChild(div);
    _dns.push({
        div,
        wp: new THREE.Vector3(x, y, z),
        t0: performance.now(),
        dur: 920,
    });
}
function _dnsTick() {
    const now = performance.now();
    for (let i = _dns.length - 1; i >= 0; i--) {
        const n = _dns[i],
            t = (now - n.t0) / n.dur;
        if (t >= 1) {
            n.div.remove();
            _dns.splice(i, 1);
            continue;
        }
        const p = n.wp.clone().project(camera);
        n.div.style.left = (p.x * 0.5 + 0.5) * innerWidth + "px";
        n.div.style.top = (-0.5 * p.y + 0.5) * innerHeight - t * 52 + "px";
        n.div.style.opacity = 1 - t * t;
    }
}

// ════════════════════════════════════════════════════
//  CROSSHAIR FLASH / KILL FEED / STREAKS
// ════════════════════════════════════════════════════
let _xt = null;
function _xhairFlash(type) {
    document.body.classList.remove("xhair-hit", "xhair-kill");
    clearTimeout(_xt);
    document.body.classList.add("xhair-" + type);
    _xt = setTimeout(
        () => document.body.classList.remove("xhair-hit", "xhair-kill"),
        type === "kill" ? 380 : 190,
    );
}
const _kfEl = document.getElementById("kill-feed");
function _kfAdd(shooter, victim) {
    if (!_kfEl) return;
    const e = document.createElement("div");
    e.className = "kf-entry";
    e.innerHTML = `<span style="color:#ff6b35;font-weight:700">${shooter}</span> 🎯 ${victim}`;
    _kfEl.prepend(e);
    setTimeout(() => {
        e.style.opacity = "0";
        setTimeout(() => e.remove(), 350);
    }, 3200);
    while (_kfEl.children.length > 5) _kfEl.lastChild.remove();
}
let _streak = 0,
    _stTmr = null;
function _streakCheck() {
    _streak++;
    clearTimeout(_stTmr);
    _stTmr = setTimeout(() => (_streak = 0), 3200);
    const L = {
        2: "DOUBLE KILL!",
        3: "TRIPLE KILL!",
        4: "QUAD KILL!",
        5: "PENTA KILL!",
        6: "RAMPAGE!!",
        7: "UNSTOPPABLE!",
        8: "GODLIKE!!",
    };
    const lbl =
        _streak >= 2 ? L[_streak] || `${_streak}x KILL STREAK` : null;
    if (lbl) {
        const el = document.getElementById("streak-ann");
        if (!el) return;
        el.textContent = lbl;
        el.style.opacity = "1";
        sndStreak(_streak);
        clearTimeout(el._t);
        el._t = setTimeout(() => (el.style.opacity = "0"), 1700);
    }
}

// ════════════════════════════════════════════════════
//  MINIMAP
// ════════════════════════════════════════════════════
const _mmC = document.getElementById("minimap"),
    _mm = _mmC ? _mmC.getContext("2d") : null;
const MMW = 148,
    MMR = 22;

function _mmDraw() {
    if (!_mm || !gs.running) return;
    const W = MMW;
    _mm.clearRect(0, 0, W, W);
    _mm.save();
    _mm.beginPath();
    _mm.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    _mm.clip();

    // Background
    _mm.fillStyle = "rgba(10,14,20,0.85)";
    _mm.fillRect(0, 0, W, W);

    const M = getMapDef(hostSettings.mapId);
    const arenaSize = M.arenaSize || 80;

    // Convert world coords to minimap coords (no rotation)
    const toMM = (wx, wz) => {
        const dx = wx - yawObj.position.x;
        const dz = wz - yawObj.position.z;
        return {
            x: W / 2 + (dx / MMR) * (W / 2),
            y: W / 2 + (dz / MMR) * (W / 2),
        };
    };

    // Draw arena border
    const halfArena = arenaSize / 2;
    const cornerTL = toMM(-halfArena, -halfArena);
    const cornerTR = toMM(halfArena, -halfArena);
    const cornerBR = toMM(halfArena, halfArena);
    const cornerBL = toMM(-halfArena, halfArena);
    _mm.beginPath();
    _mm.moveTo(cornerTL.x, cornerTL.y);
    _mm.lineTo(cornerTR.x, cornerTR.y);
    _mm.lineTo(cornerBR.x, cornerBR.y);
    _mm.lineTo(cornerBL.x, cornerBL.y);
    _mm.closePath();
    _mm.strokeStyle = "rgba(255,255,255,0.15)";
    _mm.lineWidth = 1;
    _mm.stroke();

    // Draw map objects as little blocks
    (M.objects || []).forEach(obj => {
        const w = obj.w || 1, d = obj.d || w;
        const corners = [
            toMM(obj.x - w / 2, obj.z - d / 2),
            toMM(obj.x + w / 2, obj.z - d / 2),
            toMM(obj.x + w / 2, obj.z + d / 2),
            toMM(obj.x - w / 2, obj.z + d / 2),
        ];
        _mm.beginPath();
        _mm.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach(c => _mm.lineTo(c.x, c.y));
        _mm.closePath();

        // Color code by type
        if (obj.type === "watchtower") {
            _mm.fillStyle = "rgba(180,140,80,0.7)";
        } else if (obj.type === "gate" || obj.type === "arch") {
            _mm.fillStyle = "rgba(100,180,255,0.5)";
        } else if (obj.type === "platform") {
            _mm.fillStyle = "rgba(80,180,120,0.55)";
        } else if (obj.type === "cover_wall" || obj.type === "window_box") {
            _mm.fillStyle = "rgba(200,200,200,0.55)";
        } else {
            _mm.fillStyle = "rgba(160,160,160,0.4)";
        }
        _mm.fill();
        _mm.strokeStyle = "rgba(255,255,255,0.12)";
        _mm.lineWidth = 0.5;
        _mm.stroke();
    });

    // Draw spawn points as faint dots
    (M.spawns || []).forEach(sp => {
        const p = toMM(sp.x, sp.z);
        _mm.beginPath();
        _mm.arc(p.x, p.y, 2, 0, Math.PI * 2);
        _mm.fillStyle = "rgba(255,255,100,0.25)";
        _mm.fill();
    });

    // Draw enemies
    gs.enemies.forEach(e => {
        if (!e.alive) return;
        const p = toMM(e.x, e.z);
        _mm.beginPath();
        _mm.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        _mm.fillStyle = "#ff4444";
        _mm.fill();
        _mm.beginPath();
        _mm.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
        _mm.fillStyle = "#ff9999";
        _mm.fill();
    });

    // Draw remote players
    try {
        Object.values(remoteClients).forEach(rc => {
            if (!rc.alive || !rc.pos) return;
            const p = toMM(rc.pos.x, rc.pos.z);
            _mm.beginPath();
            _mm.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            _mm.fillStyle = rc.team === 0 ? "#ff8844" : "#44aaff";
            _mm.fill();
            _mm.beginPath();
            _mm.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
            _mm.fillStyle = "#ffffff";
            _mm.fill();
        });
    } catch (e) { }

    // Player arrow at center, rotated to show direction
    const cx = W / 2, cy = W / 2;
    _mm.save();
    _mm.translate(cx, cy);
    _mm.rotate(gs.yaw); // Rotate arrow based on player's yaw
    _mm.beginPath();
    _mm.moveTo(0, -8);
    _mm.lineTo(5, 5);
    _mm.lineTo(0, 2);
    _mm.lineTo(-5, 5);
    _mm.closePath();
    _mm.fillStyle = "#ffffff";
    _mm.strokeStyle = "#000000";
    _mm.lineWidth = 1.5;
    _mm.fill();
    _mm.stroke();
    // Pulse ring around player
    _mm.beginPath();
    _mm.arc(0, 0, 9, 0, Math.PI * 2);
    _mm.strokeStyle = "rgba(255,255,255,0.2)";
    _mm.lineWidth = 1;
    _mm.stroke();
    _mm.restore();

    _mm.restore();

    // Circular border ring
    _mm.strokeStyle = "rgba(255,255,255,0.18)";
    _mm.lineWidth = 1.5;
    _mm.beginPath();
    _mm.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2);
    _mm.stroke();
}

// ════════════════════════════════════════════════════
//  ENHANCED LOOP (runs parallel to main loop)
// ════════════════════════════════════════════════════
let _eLast = 0;
function _eLoop(ts) {
    requestAnimationFrame(_eLoop);
    const dt = Math.min((ts - _eLast) / 1000, 0.06);
    _eLast = ts;
    if (!gs.running) return;
    if (_shake > 0) {
        camera.position.x += (Math.random() - 0.5) * _shake;
        camera.position.y += (Math.random() - 0.5) * _shake;
        _shake = Math.max(0, _shake - dt * 16);
    }
    _mflTick(dt);
    _ptsTick(dt);
    _dnsTick();
    _mmDraw();
    const spr = document.getElementById("sprint-ind");
    if (spr)
        spr.classList.toggle(
            "active",
            !!(gs.keys && (gs.keys["ShiftLeft"] || gs.keys["ShiftRight"])),
        );
    const vig = document.getElementById("damage-vignette");
    if (vig)
        vig.className = gs.health > 0 && gs.health < 30 ? "critical" : "";
    const hpF = document.getElementById("hp-fill");
    if (hpF) hpF.className = gs.health < 30 ? "critical" : "";
    const amN = document.getElementById("ammo-num");
    if (amN)
        amN.className =
            gs.ammo === 0 && !hostSettings.infiniteAmmo ? "empty" : "";
    const mh = 100 + _hpUps * 25;
    if (_regenChip && gs.health < mh) {
        _regenTk += dt;
        if (_regenTk >= 3) {
            _regenTk = 0;
            gs.health = Math.min(mh, gs.health + 1);
            updateHealthUI();
        }
    }
    if (_pkTmr > 0) {
        _pkTmr -= dt;
        _pkTk += dt;
        if (_pkTk >= 0.33) {
            _pkTk = 0;
            gs.health = Math.min(mh, gs.health + 1);
            updateHealthUI();
        }
        if (_pkTmr <= 0) {
            _pkTmr = 0;
            _pkTk = 0;
        }
    }
    if (_adrTmr > 0) _adrTmr -= dt;
    if (gs.health > 0 && gs.health <= 30 && (_cons["stim_pack"] || 0) > 0) {
        _cons["stim_pack"]--;
        gs.health = Math.min(mh, gs.health + 30);
        updateHealthUI();
        _qmsg("STIM AUTO!", "#ffdd00");
        sndPickup();
        savePersist();
    }
    // Timed match countdown (multiplayer only)
    if (
        matchActive &&
        hostSettings.timeLimit &&
        hostSettings.timeLimit > 0 &&
        hostSettings.gameType !== "solo"
    ) {
        if (matchTimeLeft > 0) {
            matchTimeLeft = Math.max(0, matchTimeLeft - dt);
            updateRoundStrip();
            if (matchTimeLeft === 0) onTimeLimitReached();
        }
    }
}
requestAnimationFrame(_eLoop);

// ════════════════════════════════════════════════════
//  PATCH CORE FUNCTIONS (after all defs)
// ════════════════════════════════════════════════════
function toggleAutoReload(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    autoReload = !autoReload;
    const tog1 = document.getElementById("auto-reload-tog");
    const tog2 = document.getElementById("pause-auto-reload-tog");
    if (tog1) tog1.classList.toggle("on", autoReload);
    if (tog2) tog2.classList.toggle("on", autoReload);
    savePersist();
}

function toggleAutoFire(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    autoFire = !autoFire;
    const tog1 = document.getElementById("auto-fire-tog");
    const tog2 = document.getElementById("pause-auto-fire-tog");
    if (tog1) tog1.classList.toggle("on", autoFire);
    if (tog2) tog2.classList.toggle("on", autoFire);
    savePersist();
}

// Initialize toggles on page load
document.addEventListener("DOMContentLoaded", () => {
    const arTog = document.getElementById("auto-reload-tog");
    const afTog = document.getElementById("auto-fire-tog");
    if (arTog) arTog.classList.toggle("on", autoReload);
    if (afTog) afTog.classList.toggle("on", autoFire);
});

function setTouch(on) {
    touchEnabled = on;
    document.getElementById("touch-tog").classList.toggle("on", on);
    const lobbyTog = document.getElementById("lobby-touch-tog");
    if (lobbyTog) lobbyTog.classList.toggle("on", on);
    const tog2 = document.getElementById("touch-tog2");
    if (tog2) tog2.classList.toggle("on", on);

    // Hide reload button when touch is enabled (auto-reload handles it)
    const reloadBtn = document.getElementById("reload-btn-t");
    if (reloadBtn) reloadBtn.style.display = on ? "none" : "block";

    if (gs.running) {
        document.getElementById("touch-ui").style.display = on
            ? "block"
            : "none";
        if (!on) {
            document.getElementById("xhair").style.display = "block";
            canvas.requestPointerLock();
        } else {
            document.getElementById("xhair").style.display = "none";
            try {
                document.exitPointerLock();
            } catch (e) { }
        }
    }
}

const _origShoot = shoot;
window.shoot = function () {
    if (gs.ammo <= 0 && !gs.isReloading && !hostSettings.infiniteAmmo) {
        const n = performance.now() / 1000;
        if (n - (shoot._dry || 0) > 0.32) {
            shoot._dry = n;
            sndDryFire();
        }
        return;
    }
    const prev = gs.ammo;
    _origShoot();
    const fired = hostSettings.infiniteAmmo || gs.ammo < prev;
    if (fired) {
        sndShoot();
        _muzzleFlash();
    }
};
const _origDoReload = doReload;
window.doReload = function () {
    const was = gs.isReloading;
    _origDoReload();
    if (!was && gs.isReloading) {
        sndReload();
    }
};
const _origTakeDmg = takeDmg;
window.takeDmg = function (n) {
    const prot = _armorProt() / 100;
    _origTakeDmg(Math.max(1, Math.round(n * (1 - prot))));
    sndDamage();
    _shake = Math.max(_shake, 0.011);
};
const _origHitEnemy = hitEnemy;
window.hitEnemy = function (e, dmg) {
    const was = e.alive;
    _origHitEnemy(e, dmg);
    sndHit();
    _hitParticles(e.x, 1.2, e.z, e.color || 0xff3399);
    _dmgNum(e.x, 2.0, e.z, dmg);
    if (was && !e.alive) {
        sndKill();
        _shake = Math.max(_shake, 0.015);
        _xhairFlash("kill");
        _kfAdd(playerName, e.name || "Bot");
        _streakCheck();
    } else _xhairFlash("hit");
};
const _origDoJump = doJump;
window.doJump = function () {
    _origDoJump();
    sndJump();
};

// ════════════════════════════════════════════════════
//  MAIN GAME LOOP
// ════════════════════════════════════════════════════
let lastT = 0,
    lastPos = 0;
function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min((ts - lastT) / 1000, 0.05);
    lastT = ts;
    if (!gs.running) {
        renderer.render(scene, camera);
        return;
    }

    const px = yawObj.position.x,
        pz = yawObj.position.z,
        prevY = yawObj.position.y;

    // UPDATED FIRE LOGIC:
    // Auto-fire: fireButtonPressed acts as toggle
    // Normal fire: fireHeld must be true
    const shouldFire = autoFire ? fireButtonPressed : fireHeld;

    if (shouldFire && gs.running && (document.pointerLockElement || touchEnabled)) {
        shoot();
    }

    // Auto-reload check
    if (autoReload && gs.running && !gs.isReloading && gs.ammo === 0 && !hostSettings.infiniteAmmo) {
        doReload();
    }

    // ... rest of your loop code stays the same


    // Gravity / Jump / Platform landing
    playerVY += -26 * dt;
    let ny = prevY + playerVY * dt;
    onGround = false;
    for (const o of obstacles) {
        const boxBottom = o.y || 0;
        const boxTop = boxBottom + o.h;
        const platY = boxTop + 1.7;  // ← FIX: Use boxTop instead of o.h

        if (
            Math.abs(px - o.x) < o.hw + 0.15 &&
            Math.abs(pz - o.z) < o.hd + 0.15
        ) {
            if (playerVY <= 0.1 && ny <= platY && prevY >= platY - 0.5) {
                ny = platY;
                playerVY = 0;
                onGround = true;
                break;
            }
        }
    }
    if (!onGround && ny <= 1.7) {
        ny = 1.7;
        playerVY = 0;
        onGround = true;
    }
    yawObj.position.y = ny;

    // Movement
    const _eff = getEffectiveStats();
    const spd =
        gs.keys["ShiftLeft"] || gs.keys["ShiftRight"]
            ? _eff.sprintSpeed
            : _eff.moveSpeed;
    const fw = new THREE.Vector3(-Math.sin(gs.yaw), 0, -Math.cos(gs.yaw));
    const rt = new THREE.Vector3(Math.cos(gs.yaw), 0, -Math.sin(gs.yaw));
    let mx = 0,
        mz = 0;
    if (touchEnabled) {
        mx = fw.x * -ljDy + rt.x * ljDx;
        mz = fw.z * -ljDy + rt.z * ljDx;
    } else {
        if (gs.keys["KeyW"] || gs.keys["ArrowUp"]) {
            mx += fw.x;
            mz += fw.z;
        }
        if (gs.keys["KeyS"] || gs.keys["ArrowDown"]) {
            mx -= fw.x;
            mz -= fw.z;
        }
        if (gs.keys["KeyA"] || gs.keys["ArrowLeft"]) {
            mx -= rt.x;
            mz -= rt.z;
        }
        if (gs.keys["KeyD"] || gs.keys["ArrowRight"]) {
            mx += rt.x;
            mz += rt.z;
        }
    }
    const ml = Math.sqrt(mx * mx + mz * mz);
    if (ml > 0.01) {
        mx /= ml;
        mz /= ml;
    }
    let npx = px + mx * spd * dt,
        npz = pz + mz * spd * dt;
    npx = Math.max(-38.5, Math.min(38.5, npx));
    npz = Math.max(-38.5, Math.min(38.5, npz));
    if (!playerHitsObs(npx, pz, ny)) yawObj.position.x = npx;
    if (!playerHitsObs(yawObj.position.x, npz, ny)) yawObj.position.z = npz;
    yawObj.rotation.y = gs.yaw;
    pitchObj.rotation.x = gs.pitch;

    // Recoil
    if (recoilVel > 0) {
        const kick = recoilVel * dt;
        gs.pitch = Math.max(
            -Math.PI / 3,
            Math.min(Math.PI / 3, gs.pitch + kick),
        );
        pitchObj.rotation.x = gs.pitch;
        recoilVel = Math.max(0, recoilVel * (1 - 12 * dt));
    }
    if (conn.open && ts - lastPos > 50) {
        lastPos = ts;
        conn.send({
            type: "pos",
            x: yawObj.position.x,
            y: yawObj.position.y,
            z: yawObj.position.z,
            yaw: gs.yaw,
        });
    }

    // Bot AI
    const cpx = yawObj.position.x,
        cpz = yawObj.position.z;
    gs.enemies = gs.enemies.filter((e) => e.alive);
    for (const e of gs.enemies) {
        const dx = cpx - e.x,
            dz = cpz - e.z,
            dist = Math.sqrt(dx * dx + dz * dz) || 1;
        e.mesh.rotation.y = Math.atan2(dx, dz);
        if (dist > 5) {
            const sp2 = e.speed * dt;
            const dirs = [
                [dx / dist, dz / dist],
                [dz / dist, -dx / dist],
                [-dz / dist, dx / dist],
                [
                    (dx / dist) * 0.7 + (dz / dist) * 0.7,
                    (dz / dist) * 0.7 - (dx / dist) * 0.7,
                ],
                [
                    (dx / dist) * 0.7 - (dz / dist) * 0.7,
                    (dz / dist) * 0.7 + (dx / dist) * 0.7,
                ],
                [dx / dist, 0],
                [0, dz / dist],
            ];
            let moved = false;
            for (const [ddx, ddz] of dirs) {
                const ex = e.x + ddx * sp2,
                    ez = e.z + ddz * sp2;
                if (
                    !playerHitsObs(ex, ez, 1.7) &&
                    Math.abs(ex) < 38 &&
                    Math.abs(ez) < 38
                ) {
                    e.x = ex;
                    e.z = ez;
                    moved = true;
                    break;
                }
            }
            if (!moved) {
                e.stuckTimer += dt;
                if (e.stuckTimer > 0.8) {
                    e.stuckTimer = 0;
                    const ang = Math.random() * Math.PI * 2,
                        rx = e.x + Math.cos(ang) * sp2 * 2,
                        rz = e.z + Math.sin(ang) * sp2 * 2;
                    if (
                        !playerHitsObs(rx, rz, 1.7) &&
                        Math.abs(rx) < 38 &&
                        Math.abs(rz) < 38
                    ) {
                        e.x = rx;
                        e.z = rz;
                    }
                }
            } else e.stuckTimer = 0;
        }
        e.mesh.position.set(e.x, 0, e.z);
        if (dist < 28) {
            e.shootTimer -= dt;
            if (e.shootTimer <= 0) {
                e.shootTimer = e.shootCooldown;
                enemyShoot(e);
            }
        }
        if (e.hitFlash > 0) {
            e.hitFlash -= dt;
            const v = Math.max(0, e.hitFlash) * 2;
            e.bodyMat.emissive.setScalar(v);
            e.headMat.emissive.setScalar(v);
        }
    }

    // Player paintballs
    gs.paintballs = gs.paintballs.filter((b) => b.life > 0);
    for (const b of gs.paintballs) {
        const bg = b.gravity || 18;
        b.vy -= bg * dt;
        const px = b.mesh.position.x,
            py = b.mesh.position.y,
            pz = b.mesh.position.z;
        const bx = px + b.vx * dt,
            by = py + b.vy * dt,
            bz = pz + b.vz * dt;
        const boundHit = sweepArenaBounds(px, py, pz, bx, by, bz, 39.4);
        const obsHit = sweepBulletObs(px, py, pz, bx, by, bz);
        const envHit =
            !boundHit ? obsHit : !obsHit ? boundHit : obsHit.t <= boundHit.t ? obsHit : boundHit;
        if (envHit) {
            addSplat(envHit.x, envHit.y, envHit.z, b.color, false, b.vx, b.vy, b.vz, envHit.n);
            scene.remove(b.mesh);
            b.life = 0;
            continue;
        }
        b.mesh.position.set(bx, by, bz);
        b.life -= dt;
        if (by <= 0.05) {
            addSplat(bx, 0, bz, b.color, true, b.vx, b.vy, b.vz);
            scene.remove(b.mesh);
            b.life = 0;
            continue;
        }
        let hit = false;
        for (const e of gs.enemies) {
            if (!e.alive) continue;
            if (
                Math.sqrt((bx - e.x) ** 2 + (by - 1.1) ** 2 + (bz - e.z) ** 2) <
                0.9
            ) {
                scene.remove(b.mesh);
                b.life = 0;
                hitEnemy(e, b.dmg);
                hit = true;
                break;
            }
        }
        if (hit) continue;
        for (const [sid, rc] of Object.entries(remoteClients)) {
            if (!rc.alive) continue;
            if (hostSettings.gameType === "teams" && rc.team === myTeam) continue;

            const rp = rc.mesh.position;
            if (Math.sqrt((bx - rp.x) ** 2 + (by - 1.1) ** 2 + (bz - rp.z) ** 2) < 0.9) {
                scene.remove(b.mesh);
                b.life = 0;

                console.log(`[SHOOTER] Hit ${sid} — sending dmg`);

                gs.score += 25;
                updateScoreUI();

                const baseDmg = 10;
                conn.send({
                    type: "pvp_hit",
                    dmg: baseDmg,
                    target_sid: sid,
                    from_sid: mySid,
                    killer_sid: mySid  // ← ADD THIS for tracking kills
                });

                showHitmarker(false, true);
                break;
            }
        }
    }

    // Remote paintballs
    gs.remoteBalls = gs.remoteBalls.filter((b) => b.life > 0);
    for (const b of gs.remoteBalls) {
        // If the shooter has died, clear any of their remaining paintballs
        if (
            b.fromSid &&
            remoteClients[b.fromSid] &&
            remoteClients[b.fromSid].alive === false
        ) {
            scene.remove(b.mesh);
            b.life = 0;
            continue;
        }
        b.vy -= 18 * dt;
        const px = b.mesh.position.x,
            py = b.mesh.position.y,
            pz = b.mesh.position.z;
        const bx = px + b.vx * dt,
            by = py + b.vy * dt,
            bz = pz + b.vz * dt;
        const boundHit = sweepArenaBounds(px, py, pz, bx, by, bz, 39.4);
        const obsHit = sweepBulletObs(px, py, pz, bx, by, bz);
        const envHit =
            !boundHit ? obsHit : !obsHit ? boundHit : obsHit.t <= boundHit.t ? obsHit : boundHit;
        if (envHit) {
            addSplat(envHit.x, envHit.y, envHit.z, b.color, false, b.vx, b.vy, b.vz, envHit.n);
            scene.remove(b.mesh);
            b.life = 0;
            continue;
        }
        b.mesh.position.set(bx, by, bz);
        b.life -= dt;
        if (by <= 0.05) {
            addSplat(bx, 0, bz, b.color, true, b.vx, b.vy, b.vz);
            scene.remove(b.mesh);
            b.life = 0;
            continue;
        }
    }

    // Enemy paintballs
    gs.eBalls = gs.eBalls.filter((b) => b.life > 0);
    for (const b of gs.eBalls) {
        b.vy -= 12 * dt;
        const px = b.mesh.position.x,
            py = b.mesh.position.y,
            pz = b.mesh.position.z;
        const bx = px + b.vx * dt,
            by = py + b.vy * dt,
            bz = pz + b.vz * dt;
        const boundHit = sweepArenaBounds(px, py, pz, bx, by, bz, 39.4);
        const obsHit = sweepBulletObs(px, py, pz, bx, by, bz);
        const envHit =
            !boundHit ? obsHit : !obsHit ? boundHit : obsHit.t <= boundHit.t ? obsHit : boundHit;
        if (envHit) {
            addSplat(
                envHit.x,
                envHit.y,
                envHit.z,
                0xaa00ff,
                false,
                b.vx,
                b.vy,
                b.vz,
                envHit.n,
            );
            scene.remove(b.mesh);
            b.life = 0;
            continue;
        }
        b.mesh.position.set(bx, by, bz);
        b.life -= dt;
        if (by <= 0) {
            addSplat(bx, 0, bz, 0xaa00ff, true, b.vx, b.vy, b.vz);
            scene.remove(b.mesh);
            b.life = 0;
            continue;
        }
        if (
            Math.sqrt(
                (bx - yawObj.position.x) ** 2 +
                (by - yawObj.position.y) ** 2 +
                (bz - yawObj.position.z) ** 2,
            ) < 0.75
        ) {
            scene.remove(b.mesh);
            b.life = 0;
            takeDmg(10);
        }
    }

    // Splat lifecycle
    gs.splats = gs.splats.filter((s) => {
        s.life -= dt;
        if (s.life <= 0) {
            scene.remove(s.mesh);
            return false;
        }
        return true;
    });

    // Wave check (bots only)
    if (
        hostSettings.gameType === "solo" &&
        waveActive &&
        gs.enemies.filter((e) => e.alive).length === 0
    ) {
        waveActive = false;
        gs.wave++;
        earnPB(25);
        setTimeout(() => {
            if (gs.running) {
                spawnWave(gs.wave);
                waveActive = true;
            }
        }, 2500);
        waveAnn(gs.wave);
    }

    renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

renderer.render(scene, camera);
requestAnimationFrame(loop);

console.log(
    "%cSPLAT! v2 — Multiplayer fixes applied ✅",
    "color:#ff6b35;font-weight:bold;font-size:14px",
);

const loader = new THREE.GLTFLoader();

// Example: Load a blaster model
/*
function loadBlasterModel() {
    loader.load(
        '/static/models/blaster.glb',
        function (gltf) {
            const model = gltf.scene;
            model.scale.set(0.5, 0.5, 0.5); // Scale it
            model.position.set(0.45, 1.1, 0); // Position it
            
            // Add to your player mesh instead of the cylinder gun
            yawObj.add(model);
            
            console.log('Blaster model loaded!');
        },
        function (xhr) {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        function (error) {
            console.error('Error loading model:', error);
        }
    );
}
    */

// Add this near your other map building functions
function loadMapModel(modelPath, x, y, z, scale = 1, rotation = 0) {
    const loader = new THREE.GLTFLoader();

    loader.load(modelPath, function (gltf) {
        const model = gltf.scene;

        // Scale the model
        model.scale.set(scale, scale, scale);

        // Position it
        model.position.set(x, y, z);

        // Rotate if needed (in radians)
        if (rotation) {
            model.rotation.y = rotation;
        }

        // Enable shadows
        model.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Add to map objects group
        mapObjects.add(model);

        console.log('Model loaded:', modelPath);
    }, undefined, function (error) {
        console.error('Error loading model:', error);
    });
}

// Example: Load a crate/box model for map objects
function loadCrateModel(x, y, z) {
    loader.load('/static/models/crate.glb', function (gltf) {
        const model = gltf.scene;
        model.position.set(x, y, z);
        model.castShadow = true;
        model.receiveShadow = true;
        scene.add(model);
    });
}

function loadModelObject(obj, parent, obstacleList) {
    const loader = new THREE.GLTFLoader();

    loader.load(
        obj.path,
        function (gltf) {
            const model = gltf.scene;

            // Apply scale
            const scale = obj.scale || 1;
            model.scale.set(scale, scale, scale);

            // Apply position
            model.position.set(obj.x, obj.y || 0, obj.z);

            // Apply rotation
            if (obj.rotation) {
                model.rotation.y = obj.rotation;
            }

            // Enable shadows
            model.traverse(function (child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // Add to parent (mapObjects group)
            parent.add(model);

            // Add collision if specified
            if (obj.collision && obj.collision.enabled) {
                const w = obj.collision.w || 1;
                const h = obj.collision.h || 1;
                const d = obj.collision.d || 1;

                obstacleList.push({
                    x: obj.x,
                    z: obj.z,
                    hw: w / 2,
                    hd: d / 2,
                    h: h,
                    hwp: w / 2 + 0.38,
                    hdp: d / 2 + 0.38
                });
            }

            console.log('Model loaded:', obj.path);
        },
        undefined,
        function (error) {
            console.error('Error loading model:', obj.path, error);
        }
    );
}

async function loadModelWithCollision(modelPath, x, y, z, scale = 1, rotation = 0) {
    const loader = new THREE.GLTFLoader();

    loader.load(modelPath, async function (gltf) {
        const model = gltf.scene;
        model.scale.set(scale, scale, scale);
        model.position.set(x, y, z);
        if (rotation) model.rotation.y = rotation;

        model.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        mapObjects.add(model);

        // Load collision data
        const collisionPath = modelPath.replace('.glb', '.game.json');
        try {
            const response = await fetch(collisionPath);
            const collisionData = await response.json();

            console.log(`Loading collision for ${modelPath} at world position (${x}, ${y}, ${z})`);

            // Add collision boxes to obstacles array
            collisionData.collisions.forEach((col, idx) => {
                // col.y is the CENTER of the box
                const boxCenterY = y + col.y * scale;
                const boxHeight = col.h * scale;
                const boxBottomY = boxCenterY - (boxHeight / 2);
                const boxTopY = boxBottomY + boxHeight;

                const obstacle = {
                    x: x + col.x * scale,
                    y: boxBottomY,  // Store the BOTTOM of the box
                    z: z + col.z * scale,
                    hw: col.hw * scale,
                    hd: col.hd * scale,
                    h: boxHeight,
                    hwp: col.hwp * scale,
                    hdp: col.hdp * scale
                };

                obstacles.push(obstacle);

                // Debug first few boxes
                if (idx < 3) {
                    console.log(`Box ${idx}: center Y=${col.y}, height=${col.h}, bottom=${boxBottomY.toFixed(2)}, top=${boxTopY.toFixed(2)}`);
                }
            });

            console.log(`✓ Loaded ${collisionData.collisions.length} collision boxes`);
        } catch (e) {
            console.warn(`No collision data for ${modelPath}`, e);
        }
    });
}


