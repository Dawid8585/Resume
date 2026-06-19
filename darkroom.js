// ============================================================================
// DARKROOM.WAD — Doom-style Raycasted 3D Photo Gallery for DpOS
// A retro first-person walkable gallery hidden inside a Windows 95 portfolio OS.
// Pure Canvas 2D raycasting, no external dependencies. 60fps target.
// ============================================================================

'use strict';

const DARKROOM = {
  // === RENDER CONFIG ===
  RENDER_W: 320,        // Internal render resolution (upscaled with nearest-neighbor)
  RENDER_H: 200,
  FOV: Math.PI / 3,     // 60-degree FOV
  MAP_SIZE: 32,         // Tile map dimensions

  // === TILE TYPES ===
  TILE_EMPTY: 0,
  TILE_WALL: 1,
  TILE_DOOR_CLOSED: 2,
  TILE_DOOR_OPEN: 3,
  TILE_CONTACT_WALL: 4,
  TILE_NEGATIVE_WALL: 5,
  TILE_CRT_WALL: 6,
  TILE_EXIT_DOOR: 7,
  TILE_PUSH_WALL: 8,    // Secret push-wall

  // === STATE ===
  active: false,
  booted: false,
  canvas: null,
  ctx: null,
  renderCanvas: null,
  renderCtx: null,
  map: null,
  lastTime: 0,
  animFrame: null,

  // Player state
  player: {
    x: 4.5, y: 4.5,     // Spawn in gallery center
    angle: 0,            // Facing north
    pitch: 0,            // Vertical look
    bobPhase: 0,
    bobAmount: 0,
    moveSpeed: 3.0,      // Units per second
    turnSpeed: 2.0,      // Radians per second
    radius: 0.25         // Collision radius
  },

  // Input
  keys: {},
  mobileMove: null,
  mobileLook: null,
  pointerLocked: false,

  // Doors: map key "x,y" -> { progress: 0-1, opening: bool, timer: 0 }
  doors: {},

  // Secrets
  secrets: {
    canisters: 0,
    floppyDisk: false,
    devRoom: false
  },

  // Sprites
  sprites: [],

  // Textures (generated procedurally)
  textures: {},

  // Photo textures (lazy loaded)
  photoTexCache: {},
  photoTexLoading: {},

  // Room lighting
  roomLighting: {
    gallery: { ambient: [0.9, 0.85, 0.7], fog: 0.08 },
    corridor: { ambient: [0.6, 0.6, 0.7], fog: 0.12 },
    crt: { ambient: [0.3, 0.4, 0.8], fog: 0.1 },
    negative: { ambient: [0.8, 0.15, 0.1], fog: 0.06 },
    exit: { ambient: [0.4, 0.8, 0.4], fog: 0.1 }
  },

  // HUD data
  hud: {
    roll: 1,
    frame: 1,
    filmStock: 'KODAK GOLD 200',
    light: 'SAFE',
    canisterCount: 0,
    canisterTotal: 3,
    interactMsg: ''
  },

  // Meta-flicker system
  flicker: {
    nextTime: 0,
    active: false,
    type: -1,
    endTime: 0
  },

  // Viewfinder state
  viewfinder: {
    active: false,
    photoIndex: 0,
    rollStart: 0,
    rollPos: 0
  },

  // Boot sequence state
  boot: {
    lines: [],
    currentLine: 0,
    charIndex: 0,
    timer: 0,
    complete: false
  },

  // Push-wall interaction
  pushWall: {
    holdStart: 0,
    targetX: -1,
    targetY: -1,
    active: false,
    progress: 0
  }
};

// ============================================================================
// MAP GENERATION
// ============================================================================

DARKROOM.buildMap = function() {
  // Create 32x32 tile map, all walls by default
  const M = DARKROOM.MAP_SIZE;
  const map = [];
  for (let i = 0; i < M * M; i++) map[i] = DARKROOM.TILE_WALL;

  function setTile(x, y, t) { if (x >= 0 && x < M && y >= 0 && y < M) map[y * M + x] = t; }
  function getTile(x, y) { return (x >= 0 && x < M && y >= 0 && y < M) ? map[y * M + x] : 1; }

  // Room 1 - THE GALLERY (spawn room): 8x8, top-left at (1,1)
  // Interior: x=2..8, y=2..8 (7 wide, 7 tall interior)
  for (let y = 2; y <= 8; y++)
    for (let x = 2; x <= 8; x++)
      setTile(x, y, DARKROOM.TILE_EMPTY);

  // North wall of gallery has photos - leave as wall (rendered with photo textures)
  // South wall door to Contact Sheet Hall
  setTile(5, 9, DARKROOM.TILE_DOOR_CLOSED); // Door south from gallery

  // Room 2 - CONTACT SHEET HALL: long corridor, 2 wide x 16 long
  // Runs south from gallery: x=4..6, y=9..24
  for (let y = 10; y <= 24; y++)
    for (let x = 4; x <= 6; x++)
      setTile(x, y, DARKROOM.TILE_EMPTY);

  // Contact sheet walls (sides of corridor are type 4)
  for (let y = 10; y <= 24; y++) {
    setTile(3, y, DARKROOM.TILE_CONTACT_WALL);
    setTile(7, y, DARKROOM.TILE_CONTACT_WALL);
  }

  // Door at end of corridor to CRT room
  setTile(5, 25, DARKROOM.TILE_DOOR_CLOSED);

  // Room 3 - CRT / DpOS ROOM: 7x6 at (2,26) to (8,31)
  for (let y = 26; y <= 30; y++)
    for (let x = 3; x <= 8; x++)
      setTile(x, y, DARKROOM.TILE_EMPTY);

  // CRT wall on north side of room
  setTile(5, 25, DARKROOM.TILE_DOOR_CLOSED); // already set above, door between corridor & CRT
  setTile(6, 26, DARKROOM.TILE_CRT_WALL);

  // Door from CRT room to Negative Room (east side)
  setTile(9, 28, DARKROOM.TILE_DOOR_CLOSED);

  // Room 4 - THE NEGATIVE ROOM: 7x6 at (10,26) to (16,31)
  for (let y = 26; y <= 30; y++)
    for (let x = 10; x <= 15; x++)
      setTile(x, y, DARKROOM.TILE_EMPTY);

  // Negative walls (surround negative room)
  for (let x = 10; x <= 15; x++) {
    setTile(x, 25, DARKROOM.TILE_NEGATIVE_WALL);
    setTile(x, 31, DARKROOM.TILE_NEGATIVE_WALL);
  }
  for (let y = 26; y <= 30; y++) {
    setTile(16, y, DARKROOM.TILE_NEGATIVE_WALL);
  }

  // Door from Negative Room to Exit Corridor (south)
  setTile(12, 31, DARKROOM.TILE_DOOR_CLOSED);

  // Room 5 - EXIT CORRIDOR: short hallway south from negative room
  // x=11..13, y=31..34 - but map is 32, so use available space
  // Adjust: make exit corridor at y=26..30 but east of negative room
  // Actually let's rework: put exit corridor going north from negative room
  // Better approach: exit door on east wall of negative room
  setTile(16, 28, DARKROOM.TILE_EXIT_DOOR);

  // Small exit hallway x=16..18, y=27..29
  for (let y = 27; y <= 29; y++)
    for (let x = 17; x <= 18; x++)
      setTile(x, y, DARKROOM.TILE_EMPTY);

  // Secret push-wall in gallery (reveals dev room)
  // East wall of gallery, middle
  setTile(9, 5, DARKROOM.TILE_PUSH_WALL);

  // Dev room behind push-wall: x=10..12, y=4..6
  for (let y = 4; y <= 6; y++)
    for (let x = 10; x <= 12; x++)
      setTile(x, y, DARKROOM.TILE_EMPTY);
  // Block the entrance until push-wall opens
  setTile(9, 5, DARKROOM.TILE_PUSH_WALL);

  DARKROOM.map = map;

  // Setup sprites
  DARKROOM.sprites = [
    // Camera on podium in gallery
    { x: 5.5, y: 3.5, type: 'camera', active: true },
    // Film canisters (3 collectibles)
    { x: 5.5, y: 15, type: 'canister', active: true, id: 0 },
    { x: 4.5, y: 28, type: 'canister', active: true, id: 1 },
    { x: 13, y: 28, type: 'canister', active: true, id: 2 },
    // Floppy disk (hidden in dev room)
    { x: 11, y: 5, type: 'floppy', active: true },
    // CRT monitor in CRT room
    { x: 6.5, y: 26.5, type: 'crt', active: true }
  ];

  // Load saved secrets
  DARKROOM.loadSecrets();
};

// ============================================================================
// TEXTURE GENERATION (procedural)
// ============================================================================

DARKROOM.generateTextures = function() {
  const T = DARKROOM.textures;
  const SIZE = 64;

  function createTex(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // --- BRICK WALL ---
  const brick = createTex(SIZE, SIZE);
  const bCtx = brick.getContext('2d');
  bCtx.fillStyle = '#3a2820';
  bCtx.fillRect(0, 0, SIZE, SIZE);
  // Brick pattern
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 16;
    for (let col = 0; col < 4; col++) {
      const bx = col * 16 + offset;
      const by = row * 8;
      // Brick face with variation
      const r = 90 + Math.floor(Math.random() * 40);
      const g = 45 + Math.floor(Math.random() * 20);
      const b = 30 + Math.floor(Math.random() * 15);
      bCtx.fillStyle = `rgb(${r},${g},${b})`;
      bCtx.fillRect(bx + 1, by + 1, 14, 6);
      // Highlight top edge
      bCtx.fillStyle = `rgba(255,200,150,0.15)`;
      bCtx.fillRect(bx + 1, by + 1, 14, 1);
    }
    // Mortar line
    bCtx.fillStyle = '#1a1410';
    bCtx.fillRect(0, row * 8, SIZE, 1);
  }
  T.brick = brick;

  // --- DOOR (uses darkroom_door.png if loaded, else procedural) ---
  const door = createTex(SIZE, SIZE);
  const dCtx = door.getContext('2d');
  // Dark wood panels as base (will be overwritten when asset loads)
  dCtx.fillStyle = '#2a1808';
  dCtx.fillRect(0, 0, SIZE, SIZE);
  dCtx.fillStyle = '#4a2818';
  dCtx.fillRect(4, 4, 24, 26);
  dCtx.fillRect(4, 34, 24, 26);
  dCtx.fillRect(34, 4, 24, 26);
  dCtx.fillRect(34, 34, 24, 26);
  dCtx.fillStyle = '#c8a030';
  dCtx.fillRect(28, 30, 8, 4);
  dCtx.fillStyle = '#e8c848';
  dCtx.fillRect(29, 31, 6, 2);
  T.door = door;

  // Overwrite door texture with asset once loaded
  var doorImg = new Image();
  doorImg.src = 'darkroom_door.png';
  doorImg.onload = function() {
    dCtx.drawImage(doorImg, 0, 0, SIZE, SIZE);
  };

  // --- CONTACT SHEET WALL ---
  const contact = createTex(SIZE, SIZE);
  const cCtx = contact.getContext('2d');
  cCtx.fillStyle = '#d8d4cc';
  cCtx.fillRect(0, 0, SIZE, SIZE);
  // Sprocket holes top and bottom
  for (let i = 0; i < 8; i++) {
    cCtx.fillStyle = '#222';
    cCtx.fillRect(i * 8 + 2, 1, 4, 3);
    cCtx.fillRect(i * 8 + 2, 60, 4, 3);
  }
  // Tiny photo thumbnails grid
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const shade = 40 + Math.floor(Math.random() * 60);
      cCtx.fillStyle = `rgb(${shade},${shade + 10},${shade + 5})`;
      cCtx.fillRect(col * 12 + 3, row * 12 + 8, 10, 10);
      cCtx.strokeStyle = '#666';
      cCtx.strokeRect(col * 12 + 3, row * 12 + 8, 10, 10);
    }
  }
  T.contact = contact;

  // --- NEGATIVE WALL ---
  const neg = createTex(SIZE, SIZE);
  const nCtx = neg.getContext('2d');
  nCtx.fillStyle = '#1a0505';
  nCtx.fillRect(0, 0, SIZE, SIZE);
  // Red-tinted abstract photo mural placeholder
  for (let y = 0; y < SIZE; y += 4) {
    for (let x = 0; x < SIZE; x += 4) {
      const v = Math.random();
      nCtx.fillStyle = `rgba(${80 + v * 100 | 0},${v * 20 | 0},${v * 15 | 0},0.6)`;
      nCtx.fillRect(x, y, 4, 4);
    }
  }
  T.negative = neg;

  // --- CRT WALL ---
  const crt = createTex(SIZE, SIZE);
  const crCtx = crt.getContext('2d');
  crCtx.fillStyle = '#0a0a14';
  crCtx.fillRect(0, 0, SIZE, SIZE);
  // CRT screen area
  crCtx.fillStyle = '#004040';
  crCtx.fillRect(8, 8, 48, 36);
  // Scanlines
  for (let y = 8; y < 44; y += 2) {
    crCtx.fillStyle = 'rgba(0,255,255,0.08)';
    crCtx.fillRect(8, y, 48, 1);
  }
  // Teal desktop color
  crCtx.fillStyle = '#008080';
  crCtx.fillRect(12, 12, 40, 28);
  // Taskbar
  crCtx.fillStyle = '#c0c0c0';
  crCtx.fillRect(12, 38, 40, 4);
  // Start button
  crCtx.fillStyle = '#808080';
  crCtx.fillRect(12, 38, 10, 4);
  // CRT bezel
  crCtx.strokeStyle = '#333';
  crCtx.lineWidth = 2;
  crCtx.strokeRect(6, 6, 52, 40);
  // Monitor stand
  crCtx.fillStyle = '#222';
  crCtx.fillRect(24, 48, 16, 4);
  crCtx.fillRect(20, 52, 24, 4);
  T.crt = crt;

  // --- EXIT DOOR ---
  const exitDoor = createTex(SIZE, SIZE);
  const eCtx = exitDoor.getContext('2d');
  eCtx.fillStyle = '#1a2a1a';
  eCtx.fillRect(0, 0, SIZE, SIZE);
  // Glowing green edges
  eCtx.strokeStyle = '#00ff44';
  eCtx.lineWidth = 2;
  eCtx.strokeRect(4, 4, 56, 56);
  // "OPEN ROLL" text
  eCtx.fillStyle = '#00ff44';
  eCtx.font = '8px monospace';
  eCtx.textAlign = 'center';
  eCtx.fillText('OPEN', 32, 28);
  eCtx.fillText('ROLL', 32, 40);
  eCtx.textAlign = 'left';
  T.exitDoor = exitDoor;

  // --- CHECKERBOARD FLOOR ---
  const floor = createTex(SIZE, SIZE);
  const fCtx = floor.getContext('2d');
  for (let y = 0; y < SIZE; y += 16) {
    for (let x = 0; x < SIZE; x += 16) {
      const check = ((x / 16 + y / 16) & 1) === 0;
      fCtx.fillStyle = check ? '#2a2420' : '#1a1510';
      fCtx.fillRect(x, y, 16, 16);
    }
  }
  T.floor = floor;

  // --- CEILING ---
  const ceil = createTex(SIZE, SIZE);
  const clCtx = ceil.getContext('2d');
  clCtx.fillStyle = '#0d0d12';
  clCtx.fillRect(0, 0, SIZE, SIZE);
  // Beam pattern
  clCtx.fillStyle = '#1a1410';
  clCtx.fillRect(0, 0, SIZE, 3);
  clCtx.fillRect(0, 61, SIZE, 3);
  clCtx.fillRect(0, 0, 3, SIZE);
  clCtx.fillRect(61, 0, 3, SIZE);
  // Fluorescent strip
  clCtx.fillStyle = '#2a2a30';
  clCtx.fillRect(20, 30, 24, 4);
  clCtx.fillStyle = 'rgba(200,200,255,0.2)';
  clCtx.fillRect(22, 31, 20, 2);
  T.ceiling = ceil;

  // --- PUSH WALL (same as brick but with a subtle mark) ---
  const push = createTex(SIZE, SIZE);
  const pCtx = push.getContext('2d');
  pCtx.drawImage(brick, 0, 0);
  // Subtle scratch mark (hint)
  pCtx.strokeStyle = 'rgba(100,100,100,0.3)';
  pCtx.lineWidth = 1;
  pCtx.beginPath();
  pCtx.moveTo(28, 28); pCtx.lineTo(36, 36);
  pCtx.stroke();
  T.pushWall = push;
};

// ============================================================================
// ASSET PRELOADING (use actual PNG sprite assets)
// ============================================================================

DARKROOM.assets = {};

DARKROOM.preloadAssets = function() {
  const A = DARKROOM.assets;
  const assetList = [
    'darkroom_camera.png',
    'darkroom_canister.png',
    'darkroom_floppy.png',
    'darkroom_crt.png',
    'darkroom_hud.png',
    'darkroom_door.png',
    'darkroom_door_labels.png',
    'darkroom_error.png',
    'darkroom_cursor.png',
    'darkroom_startbar.png',
    'darkroom_roll.png',
    'darkroom_reload_sheet.png',
    'darkroom_reload_sheet_glitch.png'
  ];

  assetList.forEach(function(name) {
    const key = name.replace('darkroom_', '').replace('.png', '');
    const img = new Image();
    img.src = name;
    A[key] = img;
  });
};

// ============================================================================
// BOOT SEQUENCE
// ============================================================================

DARKROOM.bootMessages = [
  'LOADING DARKROOM.WAD...',
  'MOUNTING /35MM/ROLL_01...',
  'RENDERING MEMORY TEXTURES...',
  'GALLERY..........[OK]',
  'CONTACT_SHEET....[OK]',
  'CRT_ROOM.........[OK]',
  'NEGATIVE_ROOM....[OK]',
  'EXIT..............[OK]',
  'FILM: KODAK GOLD 200',
  'ENTERING C:\\DPOS\\35MM\\DARKROOM'
];

DARKROOM.runBoot = function() {
  DARKROOM.boot.lines = DARKROOM.bootMessages.slice();
  DARKROOM.boot.currentLine = 0;
  DARKROOM.boot.charIndex = 0;
  DARKROOM.boot.timer = 0;
  DARKROOM.boot.complete = false;
  DARKROOM.boot.displayLines = [];
};

DARKROOM.updateBoot = function(dt) {
  if (DARKROOM.boot.complete) return;

  DARKROOM.boot.timer += dt;
  const charDelay = 0.025; // seconds per character
  const lineDelay = 0.15;  // pause between lines

  if (DARKROOM.boot.currentLine >= DARKROOM.boot.lines.length) {
    // All lines typed, fade delay
    if (DARKROOM.boot.timer > 0.8) {
      DARKROOM.boot.complete = true;
      DARKROOM.booted = true;
    }
    return;
  }

  const line = DARKROOM.boot.lines[DARKROOM.boot.currentLine];
  if (DARKROOM.boot.charIndex <= line.length) {
    if (DARKROOM.boot.timer >= charDelay) {
      DARKROOM.boot.charIndex++;
      DARKROOM.boot.timer = 0;
      // Update current display line
      DARKROOM.boot.displayLines[DARKROOM.boot.currentLine] = line.substring(0, DARKROOM.boot.charIndex);
    }
  }
  if (DARKROOM.boot.charIndex > line.length) {
    if (DARKROOM.boot.timer >= lineDelay) {
      DARKROOM.boot.currentLine++;
      DARKROOM.boot.charIndex = 0;
      DARKROOM.boot.timer = 0;
    }
  }
};

DARKROOM.renderBoot = function() {
  const ctx = DARKROOM.renderCtx;
  const W = DARKROOM.RENDER_W, H = DARKROOM.RENDER_H;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  ctx.font = '5px monospace';
  ctx.textBaseline = 'top';

  const lineH = 8;
  const startX = 6;
  const startY = 6;

  for (let i = 0; i < DARKROOM.boot.displayLines.length; i++) {
    const text = DARKROOM.boot.displayLines[i] || '';
    const isOK = text.includes('[OK]');
    ctx.fillStyle = isOK ? '#00ff00' : '#00cc00';
    ctx.fillText(text, startX, startY + i * lineH);
  }

  // Blinking cursor
  if (Math.floor(Date.now() / 400) % 2 === 0) {
    const cy = startY + DARKROOM.boot.displayLines.length * lineH;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(startX, cy, 4, 5);
  }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

DARKROOM.init = function() {
  DARKROOM.canvas = document.getElementById('fpsCanvas');
  DARKROOM.ctx = DARKROOM.canvas.getContext('2d');
  DARKROOM.ctx.imageSmoothingEnabled = false;

  // Create offscreen low-res render buffer
  DARKROOM.renderCanvas = document.createElement('canvas');
  DARKROOM.renderCanvas.width = DARKROOM.RENDER_W;
  DARKROOM.renderCanvas.height = DARKROOM.RENDER_H;
  DARKROOM.renderCtx = DARKROOM.renderCanvas.getContext('2d');
  DARKROOM.renderCtx.imageSmoothingEnabled = false;

  // Z-buffer for sprite rendering
  DARKROOM.zBuffer = new Float32Array(DARKROOM.RENDER_W);

  // Build world
  DARKROOM.buildMap();
  DARKROOM.generateTextures();
  DARKROOM.preloadAssets();

  // Reset player
  DARKROOM.player.x = 5.5;
  DARKROOM.player.y = 5.5;
  DARKROOM.player.angle = Math.PI; // Face south (toward corridor)
  DARKROOM.player.pitch = 0;
  DARKROOM.player.bobPhase = 0;
  DARKROOM.player.bobAmount = 0;

  // Reset state
  DARKROOM.doors = {};
  DARKROOM.booted = false;
  DARKROOM.viewfinder.active = false;
  DARKROOM.flicker.nextTime = performance.now() + 25000 + Math.random() * 15000;
  DARKROOM.flicker.active = false;
  DARKROOM.pushWall.active = false;
  DARKROOM.pushWall.progress = 0;
  DARKROOM.hud.interactMsg = '';
  DARKROOM.lastTime = performance.now();

  // Start boot sequence
  DARKROOM.runBoot();

  // Setup input
  DARKROOM.setupInput();
  DARKROOM.setupMobileControls();

  // Hide viewfinder, show crosshair
  document.getElementById('fpsViewfinder').style.display = 'none';
  document.getElementById('fpsCrosshair').style.display = 'block';

  // Start game loop
  DARKROOM.active = true;
  DARKROOM.gameLoop();
};

// ============================================================================
// GAME LOOP
// ============================================================================

DARKROOM.gameLoop = function() {
  if (!DARKROOM.active) return;

  const now = performance.now();
  const dt = Math.min((now - DARKROOM.lastTime) / 1000, 0.05); // Cap dt at 50ms
  DARKROOM.lastTime = now;

  // Check if window is visible
  const win = document.getElementById('win-fps');
  if (!win || !win.classList.contains('open') || win.classList.contains('minimized')) {
    DARKROOM.animFrame = requestAnimationFrame(DARKROOM.gameLoop);
    return;
  }

  // Resize display canvas to fill container
  const container = document.getElementById('fpsBody');
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (DARKROOM.canvas.width !== cw || DARKROOM.canvas.height !== ch) {
    DARKROOM.canvas.width = cw;
    DARKROOM.canvas.height = ch;
    DARKROOM.ctx.imageSmoothingEnabled = false;
  }

  if (!DARKROOM.booted) {
    // Boot sequence
    DARKROOM.updateBoot(dt);
    DARKROOM.renderBoot();
  } else if (DARKROOM.viewfinder.active) {
    // Viewfinder mode handled by HTML overlay
  } else {
    // Main game
    DARKROOM.updatePlayer(dt);
    DARKROOM.updateDoors(dt);
    DARKROOM.updatePushWall(dt);
    DARKROOM.triggerFlicker(now);
    DARKROOM.render();
    DARKROOM.renderSprites();
    DARKROOM.renderHUD();
  }

  // Upscale render buffer to display canvas (nearest neighbor)
  DARKROOM.ctx.drawImage(
    DARKROOM.renderCanvas,
    0, 0, DARKROOM.RENDER_W, DARKROOM.RENDER_H,
    0, 0, cw, ch
  );

  DARKROOM.animFrame = requestAnimationFrame(DARKROOM.gameLoop);
};

// ============================================================================
// PLAYER UPDATE
// ============================================================================

DARKROOM.updatePlayer = function(dt) {
  const p = DARKROOM.player;
  const keys = DARKROOM.keys;
  let moved = false;

  // Sprint multiplier (Shift key)
  const sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed = p.moveSpeed * (sprinting ? 1.8 : 1.0);

  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  let dx = 0, dy = 0;

  // Keyboard input
  if (keys['KeyW'] || keys['ArrowUp']) { dx += sin * speed * dt; dy += cos * speed * dt; moved = true; }
  if (keys['KeyS'] || keys['ArrowDown']) { dx -= sin * speed * dt; dy -= cos * speed * dt; moved = true; }
  if (keys['KeyA']) { dx -= cos * speed * dt; dy += sin * speed * dt; moved = true; }
  if (keys['KeyD']) { dx += cos * speed * dt; dy -= sin * speed * dt; moved = true; }

  // Keyboard turning (arrows only if no pointer lock)
  if (!DARKROOM.pointerLocked) {
    if (keys['ArrowLeft']) p.angle -= p.turnSpeed * dt;
    if (keys['ArrowRight']) p.angle += p.turnSpeed * dt;
  }

  // Mobile joystick input
  if (DARKROOM.mobileMove) {
    const mx = DARKROOM.mobileMove.x;
    const my = DARKROOM.mobileMove.y;
    if (Math.abs(mx) > 0.1 || Math.abs(my) > 0.1) {
      dx += sin * my * speed * dt;
      dy += cos * my * speed * dt;
      dx += cos * mx * speed * dt;
      dy -= sin * mx * speed * dt;
      moved = true;
    }
  }
  if (DARKROOM.mobileLook) {
    if (Math.abs(DARKROOM.mobileLook.x) > 0.1) {
      p.angle += DARKROOM.mobileLook.x * p.turnSpeed * dt * 1.5;
    }
    if (Math.abs(DARKROOM.mobileLook.y) > 0.1) {
      p.pitch -= DARKROOM.mobileLook.y * 80 * dt;
    }
  }

  // Clamp pitch
  p.pitch = Math.max(-60, Math.min(60, p.pitch));

  // Collision detection and movement
  const newX = p.x + dx;
  const newY = p.y + dy;

  if (DARKROOM.canMoveTo(newX, p.y, p.radius)) p.x = newX;
  if (DARKROOM.canMoveTo(p.x, newY, p.radius)) p.y = newY;

  // Head bob (faster and stronger when sprinting)
  if (moved) {
    p.bobPhase += (sprinting ? 12 : 8) * dt;
    p.bobAmount = Math.sin(p.bobPhase) * (sprinting ? 3.5 : 2.5);
  } else {
    p.bobAmount *= 0.9;
  }

  // Check sprite pickups (canisters, floppy)
  DARKROOM.checkPickups();

  // Update room lighting based on player position
  DARKROOM.updateRoomInfo();

  // Update HUD interaction message
  DARKROOM.updateInteractHint();
};

// ============================================================================
// COLLISION DETECTION
// ============================================================================

DARKROOM.canMoveTo = function(x, y, radius) {
  const M = DARKROOM.MAP_SIZE;
  // Check all 4 corners of player bounding box
  const offsets = [
    [x - radius, y - radius],
    [x + radius, y - radius],
    [x - radius, y + radius],
    [x + radius, y + radius]
  ];

  for (let i = 0; i < offsets.length; i++) {
    const tx = Math.floor(offsets[i][0]);
    const ty = Math.floor(offsets[i][1]);
    if (tx < 0 || tx >= M || ty < 0 || ty >= M) return false;
    const tile = DARKROOM.map[ty * M + tx];
    if (tile === DARKROOM.TILE_EMPTY || tile === DARKROOM.TILE_DOOR_OPEN) continue;
    if (tile === DARKROOM.TILE_DOOR_CLOSED || tile === DARKROOM.TILE_EXIT_DOOR) return false;
    if (tile === DARKROOM.TILE_PUSH_WALL && !DARKROOM.pushWall.active) return false;
    if (tile === DARKROOM.TILE_PUSH_WALL && DARKROOM.pushWall.active && DARKROOM.pushWall.progress < 0.9) return false;
    if (tile !== DARKROOM.TILE_EMPTY && tile !== DARKROOM.TILE_DOOR_OPEN) return false;
  }
  return true;
};

// ============================================================================
// DOOR SYSTEM
// ============================================================================

DARKROOM.updateDoors = function(dt) {
  for (const key in DARKROOM.doors) {
    const d = DARKROOM.doors[key];
    if (d.opening && d.progress < 1) {
      d.progress = Math.min(1, d.progress + dt * 1.5);
      if (d.progress >= 1) {
        // Mark tile as open
        const parts = key.split(',');
        const tx = parseInt(parts[0]);
        const ty = parseInt(parts[1]);
        DARKROOM.map[ty * DARKROOM.MAP_SIZE + tx] = DARKROOM.TILE_DOOR_OPEN;
      }
    }
    // Auto-close after 5 seconds (optional, disabled for simplicity)
  }
};

DARKROOM.openDoor = function(tx, ty) {
  const key = tx + ',' + ty;
  if (!DARKROOM.doors[key]) {
    DARKROOM.doors[key] = { progress: 0, opening: true };
  } else {
    DARKROOM.doors[key].opening = true;
  }
};

// ============================================================================
// PUSH WALL
// ============================================================================

DARKROOM.updatePushWall = function(dt) {
  if (DARKROOM.pushWall.active && DARKROOM.pushWall.progress < 1) {
    DARKROOM.pushWall.progress += dt * 0.5;
    if (DARKROOM.pushWall.progress >= 1) {
      DARKROOM.pushWall.progress = 1;
      // Clear the push-wall tile
      const tx = DARKROOM.pushWall.targetX;
      const ty = DARKROOM.pushWall.targetY;
      DARKROOM.map[ty * DARKROOM.MAP_SIZE + tx] = DARKROOM.TILE_EMPTY;
      DARKROOM.secrets.devRoom = true;
      DARKROOM.saveSecrets();
    }
  }
};

// ============================================================================
// ROOM DETECTION & LIGHTING
// ============================================================================

DARKROOM.getCurrentRoom = function() {
  const px = DARKROOM.player.x;
  const py = DARKROOM.player.y;

  // Gallery: x=2..8, y=2..8
  if (px >= 2 && px <= 9 && py >= 2 && py <= 9) return 'gallery';
  // Contact Sheet Hall: x=4..6, y=10..24
  if (px >= 3 && px <= 7 && py >= 9 && py <= 25) return 'corridor';
  // CRT Room: x=3..8, y=26..30
  if (px >= 3 && px <= 9 && py >= 25 && py <= 31) return 'crt';
  // Negative Room: x=10..15, y=26..30
  if (px >= 9 && px <= 16 && py >= 25 && py <= 31) return 'negative';
  // Exit corridor: x=16..18, y=27..29
  if (px >= 16 && py >= 27 && py <= 29) return 'exit';
  // Dev room: x=10..12, y=4..6
  if (px >= 9 && px <= 13 && py >= 4 && py <= 7) return 'gallery';
  return 'gallery';
};

DARKROOM.updateRoomInfo = function() {
  const room = DARKROOM.getCurrentRoom();
  switch (room) {
    case 'gallery': DARKROOM.hud.light = 'WARM'; break;
    case 'corridor': DARKROOM.hud.light = 'SAFE'; break;
    case 'crt': DARKROOM.hud.light = 'LOW'; break;
    case 'negative': DARKROOM.hud.light = 'RED SAFE'; break;
    case 'exit': DARKROOM.hud.light = 'GREEN'; break;
  }
};

DARKROOM.getRoomLighting = function() {
  const room = DARKROOM.getCurrentRoom();
  return DARKROOM.roomLighting[room] || DARKROOM.roomLighting.gallery;
};

// ============================================================================
// INTERACTION HINTS & E-KEY
// ============================================================================

DARKROOM.updateInteractHint = function() {
  const p = DARKROOM.player;
  const lookX = Math.floor(p.x + Math.sin(p.angle) * 1.5);
  const lookY = Math.floor(p.y + Math.cos(p.angle) * 1.5);
  const M = DARKROOM.MAP_SIZE;
  let msg = '';

  if (lookX >= 0 && lookX < M && lookY >= 0 && lookY < M) {
    const tile = DARKROOM.map[lookY * M + lookX];
    if (tile === DARKROOM.TILE_DOOR_CLOSED) msg = '[E] OPEN DOOR';
    else if (tile === DARKROOM.TILE_EXIT_DOOR) msg = '[E] OPEN ROLL';
    else if (tile === DARKROOM.TILE_CRT_WALL) msg = '[E] EXIT TO DPOS';
    else if (tile === DARKROOM.TILE_PUSH_WALL) msg = '';
  }

  // Check proximity to camera sprite
  for (let i = 0; i < DARKROOM.sprites.length; i++) {
    const s = DARKROOM.sprites[i];
    if (!s.active) continue;
    const dist = Math.sqrt((p.x - s.x) ** 2 + (p.y - s.y) ** 2);
    if (s.type === 'camera' && dist < 1.5) {
      msg = '[E] PICK UP CAMERA';
      break;
    }
    if (s.type === 'crt' && dist < 1.8) {
      msg = '[E] EXIT TO DPOS';
      break;
    }
  }

  DARKROOM.hud.interactMsg = msg;
};

DARKROOM.interact = function() {
  const p = DARKROOM.player;
  const M = DARKROOM.MAP_SIZE;

  // Check what's in front of player
  const lookDist = 1.8;
  const lookX = Math.floor(p.x + Math.sin(p.angle) * lookDist);
  const lookY = Math.floor(p.y + Math.cos(p.angle) * lookDist);

  if (lookX >= 0 && lookX < M && lookY >= 0 && lookY < M) {
    const tile = DARKROOM.map[lookY * M + lookX];

    // Open a door
    if (tile === DARKROOM.TILE_DOOR_CLOSED) {
      DARKROOM.openDoor(lookX, lookY);
      return;
    }

    // Exit door -> open 35mm gallery
    if (tile === DARKROOM.TILE_EXIT_DOOR) {
      DARKROOM.exitTo35mm();
      return;
    }

    // CRT wall -> exit to desktop
    if (tile === DARKROOM.TILE_CRT_WALL) {
      DARKROOM.exitToDesktop();
      return;
    }

    // Push wall (hold E for 2 seconds handled separately)
    if (tile === DARKROOM.TILE_PUSH_WALL && !DARKROOM.pushWall.active) {
      DARKROOM.pushWall.holdStart = performance.now();
      DARKROOM.pushWall.targetX = lookX;
      DARKROOM.pushWall.targetY = lookY;
      return;
    }
  }

  // Check proximity to sprites
  for (let i = 0; i < DARKROOM.sprites.length; i++) {
    const s = DARKROOM.sprites[i];
    if (!s.active) continue;
    const dist = Math.sqrt((p.x - s.x) ** 2 + (p.y - s.y) ** 2);

    if (s.type === 'camera' && dist < 1.5) {
      DARKROOM.enterViewfinder();
      return;
    }
    if (s.type === 'crt' && dist < 1.8) {
      DARKROOM.exitToDesktop();
      return;
    }
  }
};

// ============================================================================
// PICKUPS
// ============================================================================

DARKROOM.checkPickups = function() {
  const p = DARKROOM.player;
  for (let i = 0; i < DARKROOM.sprites.length; i++) {
    const s = DARKROOM.sprites[i];
    if (!s.active) continue;
    const dist = Math.sqrt((p.x - s.x) ** 2 + (p.y - s.y) ** 2);

    if (s.type === 'canister' && dist < 0.6) {
      s.active = false;
      DARKROOM.secrets.canisters = Math.min(3, DARKROOM.secrets.canisters + 1);
      DARKROOM.hud.canisterCount = DARKROOM.secrets.canisters;
      DARKROOM.saveSecrets();
    }
    if (s.type === 'floppy' && dist < 0.6) {
      s.active = false;
      DARKROOM.secrets.floppyDisk = true;
      DARKROOM.saveSecrets();
    }
  }
};

// ============================================================================
// VIEWFINDER (CAMERA MODE)
// ============================================================================

DARKROOM.enterViewfinder = function() {
  DARKROOM.viewfinder.active = true;
  DARKROOM.viewfinder.rollStart = DARKROOM.viewfinder.rollStart || 0;
  DARKROOM.viewfinder.rollPos = 0;
  DARKROOM.viewfinder.photoIndex = DARKROOM.viewfinder.rollStart;

  document.getElementById('fpsViewfinder').style.display = 'block';
  document.getElementById('fpsCrosshair').style.display = 'none';
  document.getElementById('fpsReloadOverlay').style.display = 'none';

  DARKROOM.updateViewfinderPhoto();

  if (typeof gtag === 'function') {
    gtag('event', 'darkroom_camera_pickup', { roll_number: DARKROOM.hud.roll });
  }
};

DARKROOM.exitViewfinder = function() {
  DARKROOM.viewfinder.active = false;
  document.getElementById('fpsViewfinder').style.display = 'none';
  document.getElementById('fpsCrosshair').style.display = 'block';
};

DARKROOM.updateViewfinderPhoto = function() {
  const vf = DARKROOM.viewfinder;
  const file = photoFiles[vf.photoIndex % photoFiles.length];
  document.getElementById('fpsPhoto').src = PHOTO_DIR + file;

  const shotNum = vf.rollPos + 1;
  document.getElementById('fpsPhotoCounter').textContent =
    shotNum + ' / 36  \u00b7  Roll ' + DARKROOM.hud.roll;

  DARKROOM.hud.frame = shotNum;

  if (vf.rollPos >= 35) {
    document.getElementById('fpsViewfinderHint').textContent = 'END OF ROLL \u2014 Press [E] to load new film';
    document.getElementById('fpsViewfinderHint').style.color = '#ff8800';
  } else {
    document.getElementById('fpsViewfinderHint').textContent = 'SCROLL or \u2190/\u2192 to browse \u00b7 [E] reload film';
    document.getElementById('fpsViewfinderHint').style.color = '#888';
  }
};

DARKROOM.advancePhoto = function(dir) {
  const vf = DARKROOM.viewfinder;
  const newPos = vf.rollPos + dir;
  if (newPos < 0 || newPos > 35) return;
  vf.rollPos = newPos;
  vf.photoIndex = (vf.rollStart + vf.rollPos) % photoFiles.length;
  DARKROOM.updateViewfinderPhoto();
};

DARKROOM.reloadFilm = function() {
  const vf = DARKROOM.viewfinder;
  vf.rollStart = (vf.rollStart + 36) % photoFiles.length;
  vf.rollPos = 0;
  vf.photoIndex = vf.rollStart;
  DARKROOM.hud.roll++;
  DARKROOM.updateViewfinderPhoto();

  if (typeof gtag === 'function') {
    gtag('event', 'darkroom_film_reload', { new_roll_number: DARKROOM.hud.roll });
  }
};

// ============================================================================
// EXIT FUNCTIONS
// ============================================================================

DARKROOM.exitToDesktop = function() {
  DARKROOM.stop();
  closeWindow('fps');
};

DARKROOM.exitTo35mm = function() {
  DARKROOM.stop();
  closeWindow('fps');
  setTimeout(function() { openWindow('photos'); }, 200);
};

// ============================================================================
// SECRETS (localStorage)
// ============================================================================

DARKROOM.loadSecrets = function() {
  try {
    const saved = localStorage.getItem('darkroomSecrets');
    if (saved) {
      const data = JSON.parse(saved);
      DARKROOM.secrets.canisters = data.canisters || 0;
      DARKROOM.secrets.floppyDisk = data.floppyDisk || false;
      DARKROOM.secrets.devRoom = data.devRoom || false;
      DARKROOM.hud.canisterCount = DARKROOM.secrets.canisters;

      // Deactivate already-collected sprites
      DARKROOM.sprites.forEach(function(s) {
        if (s.type === 'canister' && s.id < DARKROOM.secrets.canisters) s.active = false;
        if (s.type === 'floppy' && DARKROOM.secrets.floppyDisk) s.active = false;
      });

      // If push-wall already opened
      if (DARKROOM.secrets.devRoom) {
        DARKROOM.pushWall.active = true;
        DARKROOM.pushWall.progress = 1;
        // Open the push-wall tile
        DARKROOM.map[5 * DARKROOM.MAP_SIZE + 9] = DARKROOM.TILE_EMPTY;
      }
    }
  } catch (e) { /* ignore */ }
};

DARKROOM.saveSecrets = function() {
  try {
    localStorage.setItem('darkroomSecrets', JSON.stringify(DARKROOM.secrets));
  } catch (e) { /* ignore */ }
};

// ============================================================================
// STOP / CLEANUP
// ============================================================================

DARKROOM.stop = function() {
  DARKROOM.active = false;
  if (DARKROOM.animFrame) {
    cancelAnimationFrame(DARKROOM.animFrame);
    DARKROOM.animFrame = null;
  }
  DARKROOM.keys = {};
  DARKROOM.mobileMove = null;
  DARKROOM.mobileLook = null;
  DARKROOM.pointerLocked = false;
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }
};

// ============================================================================
// RENDERING - MAIN
// ============================================================================

DARKROOM.render = function() {
  const ctx = DARKROOM.renderCtx;
  const W = DARKROOM.RENDER_W;
  const H = DARKROOM.RENDER_H;
  const p = DARKROOM.player;
  const lighting = DARKROOM.getRoomLighting();
  const halfH = H / 2 + p.pitch + p.bobAmount;

  // Clear z-buffer
  DARKROOM.zBuffer.fill(Infinity);

  // === CEILING ===
  DARKROOM.renderFloorCeiling(ctx, W, H, halfH, lighting);

  // === WALLS (raycasting) ===
  DARKROOM.renderWalls(ctx, W, H, halfH, lighting);
};

// ============================================================================
// FLOOR & CEILING RENDERING
// ============================================================================

DARKROOM.renderFloorCeiling = function(ctx, W, H, halfH, lighting) {
  const p = DARKROOM.player;
  const amb = lighting.ambient;
  const fog = lighting.fog;
  const room = DARKROOM.getCurrentRoom();

  // Ceiling color by room
  let ceilR = 12, ceilG = 12, ceilB = 16;
  if (room === 'crt') { ceilR = 5; ceilG = 8; ceilB = 20; }
  else if (room === 'negative') { ceilR = 20; ceilG = 3; ceilB = 3; }

  // Floor color by room
  let floorDark = [24, 20, 16];
  let floorLight = [36, 30, 24];
  if (room === 'negative') { floorDark = [30, 8, 8]; floorLight = [45, 12, 10]; }
  else if (room === 'crt') { floorDark = [10, 14, 24]; floorLight = [16, 20, 32]; }

  const cosA = Math.cos(p.angle);
  const sinA = Math.sin(p.angle);
  const tanHalfFov = Math.tan(DARKROOM.FOV / 2);

  // Draw ceiling as solid bands
  for (let y = 0; y < Math.min(halfH, H); y += 2) {
    const rowDist = (H * 0.4) / (halfH - y);
    if (rowDist <= 0) continue;
    const brightness = Math.max(0.1, 1.0 - rowDist * fog);
    const r = (ceilR * brightness * amb[0]) | 0;
    const g = (ceilG * brightness * amb[1]) | 0;
    const b = (ceilB * brightness * amb[2]) | 0;
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fillRect(0, y, W, 2);
  }

  // Draw floor with checkerboard
  for (let y = Math.max(0, Math.floor(halfH)); y < H; y += 2) {
    const rowDist = (H * 0.4) / (y - halfH);
    if (rowDist <= 0 || rowDist > 30) {
      ctx.fillStyle = 'rgb(' + floorDark[0] + ',' + floorDark[1] + ',' + floorDark[2] + ')';
      ctx.fillRect(0, y, W, 2);
      continue;
    }
    const brightness = Math.max(0.15, 1.0 - rowDist * fog);

    // Sample a few points across the row for checker effect
    const samples = Math.min(W, 40);
    const sampleW = W / samples;
    const leftAngle = p.angle - DARKROOM.FOV / 2;
    const rightAngle = p.angle + DARKROOM.FOV / 2;
    const flStartX = p.x + Math.sin(leftAngle) * rowDist;
    const flStartY = p.y + Math.cos(leftAngle) * rowDist;
    const flEndX = p.x + Math.sin(rightAngle) * rowDist;
    const flEndY = p.y + Math.cos(rightAngle) * rowDist;

    for (let s = 0; s < samples; s++) {
      const frac = s / samples;
      const wx = flStartX + (flEndX - flStartX) * frac;
      const wy = flStartY + (flEndY - flStartY) * frac;
      const tileX = Math.floor(wx);
      const tileY = Math.floor(wy);
      const checker = ((tileX + tileY) & 1) === 0;
      const col = checker ? floorLight : floorDark;
      const r = (col[0] * brightness * amb[0]) | 0;
      const g = (col[1] * brightness * amb[1]) | 0;
      const b = (col[2] * brightness * amb[2]) | 0;
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(s * sampleW, y, sampleW + 1, 2);
    }
  }
};

// ============================================================================
// WALL RAYCASTING
// ============================================================================

DARKROOM.renderWalls = function(ctx, W, H, halfH, lighting) {
  const p = DARKROOM.player;
  const M = DARKROOM.MAP_SIZE;
  const map = DARKROOM.map;
  const amb = lighting.ambient;
  const fog = lighting.fog;
  const halfFov = DARKROOM.FOV / 2;
  const numRays = W; // One ray per pixel column

  for (let col = 0; col < numRays; col++) {
    const rayAngle = p.angle - halfFov + (col / numRays) * DARKROOM.FOV;
    const rdx = Math.sin(rayAngle);
    const rdy = Math.cos(rayAngle);

    // DDA raycasting
    let mapX = Math.floor(p.x);
    let mapY = Math.floor(p.y);

    const deltaDistX = Math.abs(1 / rdx) || 1e10;
    const deltaDistY = Math.abs(1 / rdy) || 1e10;

    let stepX, stepY;
    let sideDistX, sideDistY;

    if (rdx < 0) {
      stepX = -1;
      sideDistX = (p.x - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1.0 - p.x) * deltaDistX;
    }
    if (rdy < 0) {
      stepY = -1;
      sideDistY = (p.y - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1.0 - p.y) * deltaDistY;
    }

    // Perform DDA
    let hit = false;
    let side = 0; // 0 = X side, 1 = Y side
    let dist = 0;
    let tileType = 0;
    let maxSteps = 32;

    while (!hit && maxSteps-- > 0) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (mapX < 0 || mapX >= M || mapY < 0 || mapY >= M) break;

      const tile = map[mapY * M + mapX];
      if (tile !== DARKROOM.TILE_EMPTY && tile !== DARKROOM.TILE_DOOR_OPEN) {
        // Check if door is being animated (partially open)
        const doorKey = mapX + ',' + mapY;
        const doorState = DARKROOM.doors[doorKey];
        if (doorState && doorState.progress > 0 && doorState.progress < 1) {
          // For partially open doors, skip if player can see through the gap
          // Simplified: treat as solid until fully open
          hit = true;
          tileType = tile;
        } else {
          hit = true;
          tileType = tile;
        }
      }
    }

    if (!hit) continue;

    // Calculate perpendicular distance (fixes fisheye)
    if (side === 0) {
      dist = (mapX - p.x + (1 - stepX) / 2) / rdx;
    } else {
      dist = (mapY - p.y + (1 - stepY) / 2) / rdy;
    }

    if (dist <= 0.01) dist = 0.01;
    const corrDist = dist * Math.cos(rayAngle - p.angle);

    // Store in z-buffer
    DARKROOM.zBuffer[col] = corrDist;

    // Wall height on screen
    const wallHeight = H / corrDist;
    const drawStart = Math.floor(halfH - wallHeight / 2);
    const drawEnd = Math.floor(halfH + wallHeight / 2);

    // Calculate wall texture U coordinate (0-1 across wall face)
    let wallX;
    if (side === 0) {
      wallX = p.y + dist * rdy;
    } else {
      wallX = p.x + dist * rdx;
    }
    wallX -= Math.floor(wallX);

    // Brightness based on distance and side
    const brightness = Math.max(0.08, 1.0 - corrDist * fog);
    const sideMul = side === 0 ? 0.7 : 1.0;

    // Render wall column
    DARKROOM.renderWallColumn(ctx, col, drawStart, drawEnd, wallX, tileType, brightness * sideMul, amb, wallHeight);
  }
};

// ============================================================================
// WALL COLUMN RENDERING (texture sampling)
// ============================================================================

DARKROOM.renderWallColumn = function(ctx, col, drawStart, drawEnd, wallX, tileType, brightness, amb, wallHeight) {
  const H = DARKROOM.RENDER_H;
  const texSize = 64;

  // Get appropriate texture
  let tex;
  switch (tileType) {
    case DARKROOM.TILE_WALL: tex = DARKROOM.textures.brick; break;
    case DARKROOM.TILE_DOOR_CLOSED: tex = DARKROOM.textures.door; break;
    case DARKROOM.TILE_CONTACT_WALL: tex = DARKROOM.textures.contact; break;
    case DARKROOM.TILE_NEGATIVE_WALL: tex = DARKROOM.textures.negative; break;
    case DARKROOM.TILE_CRT_WALL: tex = DARKROOM.textures.crt; break;
    case DARKROOM.TILE_EXIT_DOOR: tex = DARKROOM.textures.exitDoor; break;
    case DARKROOM.TILE_PUSH_WALL: tex = DARKROOM.textures.pushWall; break;
    default: tex = DARKROOM.textures.brick;
  }

  if (!tex) return;

  // Get texture pixel data for sampling
  const texCtx = tex.getContext('2d');
  const texData = texCtx.getImageData(0, 0, texSize, texSize).data;
  const texX = Math.floor(wallX * texSize) & (texSize - 1);

  // Render column pixel by pixel (at low res this is affordable)
  const colStart = Math.max(0, drawStart);
  const colEnd = Math.min(H, drawEnd);
  const step = Math.max(1, Math.floor((colEnd - colStart) / 64)); // Limit pixel iterations

  for (let y = colStart; y < colEnd; y += step) {
    // Calculate texture Y coordinate
    const texYfrac = (y - drawStart) / (drawEnd - drawStart);
    const texY = Math.floor(texYfrac * texSize) & (texSize - 1);
    const idx = (texY * texSize + texX) * 4;

    let r = texData[idx] * brightness * amb[0];
    let g = texData[idx + 1] * brightness * amb[1];
    let b = texData[idx + 2] * brightness * amb[2];

    ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
    ctx.fillRect(col, y, 1, step);
  }
};

// ============================================================================
// SPRITE RENDERING (billboard, z-buffered)
// ============================================================================

DARKROOM.renderSprites = function() {
  const ctx = DARKROOM.renderCtx;
  const W = DARKROOM.RENDER_W;
  const H = DARKROOM.RENDER_H;
  const p = DARKROOM.player;
  const halfH = H / 2 + p.pitch + p.bobAmount;
  const tanHalf = Math.tan(DARKROOM.FOV / 2);
  const lighting = DARKROOM.getRoomLighting();
  const zBuf = DARKROOM.zBuffer;

  // Sort sprites by distance (far to near)
  const sorted = [];
  for (let i = 0; i < DARKROOM.sprites.length; i++) {
    const s = DARKROOM.sprites[i];
    if (!s.active) continue;
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    sorted.push({ sprite: s, dist: dx * dx + dy * dy });
  }
  sorted.sort(function(a, b) { return b.dist - a.dist; });

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i].sprite;
    const dx = s.x - p.x;
    const dy = s.y - p.y;

    // Transform sprite into player view space
    const cosA = Math.cos(p.angle);
    const sinA = Math.sin(p.angle);
    const tz = dx * sinA + dy * cosA; // Depth
    const tx = dx * cosA - dy * sinA; // Horizontal offset

    if (tz <= 0.3) continue; // Behind player

    // Screen position
    const screenX = Math.floor(W / 2 + (tx / tz) * (W / 2) / tanHalf);
    const spriteHeight = H / tz * 0.6; // Sprite scale
    const spriteWidth = spriteHeight;

    const drawX = Math.floor(screenX - spriteWidth / 2);
    const drawY = Math.floor(halfH - spriteHeight / 2 + spriteHeight * 0.2); // Ground it

    // Z-buffer clipping: find visible column ranges
    const startCol = Math.max(0, drawX);
    const endCol = Math.min(W, drawX + Math.floor(spriteWidth));
    if (startCol >= endCol) continue;

    // Check if ANY column of the sprite is visible (not fully behind walls)
    let hasVisible = false;
    for (let col = startCol; col < endCol; col++) {
      if (tz < zBuf[col]) { hasVisible = true; break; }
    }
    if (!hasVisible) continue;

    // Distance-based brightness
    const dist = Math.sqrt(sorted[i].dist);
    const brightness = Math.max(0.15, 1.0 - dist * lighting.fog);

    // Clip rendering to only columns where sprite is in front of walls
    ctx.save();
    ctx.beginPath();
    var clipStart = -1;
    for (let col = startCol; col <= endCol; col++) {
      var visible = (col < endCol) && (tz < zBuf[col]);
      if (visible && clipStart === -1) {
        clipStart = col;
      } else if (!visible && clipStart !== -1) {
        ctx.rect(clipStart, 0, col - clipStart, H);
        clipStart = -1;
      }
    }
    ctx.clip();

    // Draw the sprite (clipped to visible columns only)
    DARKROOM.drawSprite(ctx, s.type, drawX, drawY, Math.floor(spriteWidth), Math.floor(spriteHeight), brightness, lighting.ambient);

    ctx.restore();
  }
};

DARKROOM.drawSprite = function(ctx, type, x, y, w, h, brightness, amb) {
  const A = DARKROOM.assets;

  // Helper: draw an image asset with brightness dimming
  function drawAsset(img, dx, dy, dw, dh) {
    if (!img || !img.complete || !img.naturalWidth) return false;
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, brightness);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    // Apply darkness overlay for distance fog
    if (brightness < 0.85) {
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - brightness) * 0.6 + ')';
      ctx.fillRect(dx, dy, dw, dh);
    }
    return true;
  }

  switch (type) {
    case 'camera':
      // Use darkroom_camera.png (1408x768, content bbox: x=117 y=12 w=1173 h=738)
      if (drawAsset(A.camera, x, y, w, h)) break;
      // Fallback: simple rectangle
      ctx.fillStyle = 'rgb(' + (40 * brightness | 0) + ',' + (35 * brightness | 0) + ',' + (30 * brightness | 0) + ')';
      ctx.fillRect(x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.5);
      break;

    case 'canister':
      // Use darkroom_canister.png (1024x1024)
      if (drawAsset(A.canister, x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7)) {
        // Add pickup glow pulse
        var pulse = 0.3 + 0.25 * Math.sin(performance.now() / 300);
        ctx.fillStyle = 'rgba(255,200,0,' + (pulse * brightness) + ')';
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.5, w * 0.35, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      ctx.fillStyle = 'rgb(' + (180 * brightness | 0) + ',' + (150 * brightness | 0) + ',' + (30 * brightness | 0) + ')';
      ctx.fillRect(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.5);
      break;

    case 'floppy':
      // Use darkroom_floppy.png (1024x1024)
      if (drawAsset(A.floppy, x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7)) {
        // Add secret glow
        var fpulse = 0.3 + 0.2 * Math.sin(performance.now() / 500);
        ctx.fillStyle = 'rgba(100,200,255,' + (fpulse * brightness) + ')';
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.5, w * 0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      ctx.fillStyle = 'rgb(' + (20 * brightness | 0) + ',' + (20 * brightness | 0) + ',' + (40 * brightness | 0) + ')';
      ctx.fillRect(x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.55);
      break;

    case 'crt':
      // Use darkroom_crt.png (1024x1024)
      if (drawAsset(A.crt, x, y, w, h)) {
        // Add CRT screen flicker
        if (Math.random() < 0.04) {
          ctx.fillStyle = 'rgba(0,255,255,' + (0.2 * brightness) + ')';
          ctx.fillRect(x + w * 0.15, y + h * 0.1, w * 0.7, h * 0.55);
        }
        break;
      }
      ctx.fillStyle = 'rgb(' + (0) + ',' + (80 * brightness | 0) + ',' + (80 * brightness | 0) + ')';
      ctx.fillRect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.6);
      break;
  }
};

// ============================================================================
// HUD RENDERING
// ============================================================================

DARKROOM.renderHUD = function() {
  const ctx = DARKROOM.renderCtx;
  const W = DARKROOM.RENDER_W;
  const H = DARKROOM.RENDER_H;
  const hud = DARKROOM.hud;
  const A = DARKROOM.assets;
  const hudH = 18;
  const hudY = H - hudH;

  // HUD background - use darkroom_hud.png asset if available
  const hudImg = A.hud;
  if (hudImg && hudImg.complete && hudImg.naturalWidth) {
    ctx.drawImage(hudImg, 0, 0, hudImg.naturalWidth, hudImg.naturalHeight, 0, hudY, W, hudH);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, hudY, W, hudH);
    ctx.fillStyle = '#004400';
    ctx.fillRect(0, hudY, W, 1);
  }

  // HUD text
  ctx.font = '6px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00cc00';

  const textY = hudY + hudH / 2 + 1;

  // ROLL
  ctx.textAlign = 'left';
  ctx.fillText('ROLL:' + String(hud.roll).padStart(2, '0'), 4, textY);

  // FRAME
  ctx.fillText('FR:' + String(hud.frame).padStart(2, '0') + '/36', 52, textY);

  // FILM stock
  ctx.fillStyle = '#009900';
  ctx.fillText(hud.filmStock.substring(0, 12), 100, textY);

  // LIGHT indicator
  ctx.fillStyle = hud.light === 'RED SAFE' ? '#ff3333' : '#00cc00';
  ctx.fillText(hud.light, 170, textY);

  // Canister count
  ctx.fillStyle = '#ffaa00';
  ctx.textAlign = 'left';
  ctx.fillText('\u25CE ' + hud.canisterCount + '/' + hud.canisterTotal, 220, textY);

  // Interaction message (center top)
  if (hud.interactMsg) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00ff00';
    ctx.font = '6px monospace';
    ctx.fillText(hud.interactMsg, W / 2, H - hudH - 12);
  }

  // Flicker overlay
  if (DARKROOM.flicker.active) {
    DARKROOM.renderFlickerOverlay(ctx, W, H);
  }

  ctx.textAlign = 'left';
};

// ============================================================================
// META-FLICKER SYSTEM
// ============================================================================

DARKROOM.flickerMessages = [
  'DARKROOM.EXE has entered full screen mode',
  'C:\\DPOS\\35MM\\ROLL_02 mounted successfully',
  'MEMORY TEXTURE LEAK DETECTED',
  'DARKROOM.WAD is not responding',
  'DARKROOM.EXE has performed an illegal exposure'
];

DARKROOM.triggerFlicker = function(now) {
  // Check if active flicker should end
  if (DARKROOM.flicker.active && now > DARKROOM.flicker.endTime) {
    DARKROOM.flicker.active = false;
  }

  // Check if time to trigger new flicker
  if (!DARKROOM.flicker.active && now > DARKROOM.flicker.nextTime) {
    DARKROOM.flicker.active = true;
    DARKROOM.flicker.type = Math.floor(Math.random() * 6);
    DARKROOM.flicker.endTime = now + 500 + Math.random() * 1500;
    DARKROOM.flicker.nextTime = now + 25000 + Math.random() * 15000;
  }
};

DARKROOM.renderFlickerOverlay = function(ctx, W, H) {
  const type = DARKROOM.flicker.type;
  const A = DARKROOM.assets;

  switch (type) {
    case 0:
      // HUD becomes Windows 95 taskbar - use darkroom_startbar.png
      var sbImg = A.startbar;
      if (sbImg && sbImg.complete && sbImg.naturalWidth) {
        ctx.drawImage(sbImg, 0, 0, sbImg.naturalWidth, sbImg.naturalHeight, 0, H - 18, W, 18);
      } else {
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(0, H - 18, W, 18);
        ctx.fillStyle = '#000';
        ctx.font = '5px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Start', 4, H - 8);
        ctx.textAlign = 'right';
        ctx.fillText('12:00 AM', W - 4, H - 8);
        ctx.textAlign = 'left';
      }
      break;

    case 1:
      // Teal wall flash
      ctx.fillStyle = 'rgba(0,128,128,0.3)';
      ctx.fillRect(0, 0, W, H);
      break;

    case 2:
      // Floating Win95 error dialog - use darkroom_error.png
      var errImg = A.error;
      if (errImg && errImg.complete && errImg.naturalWidth) {
        var ew = W * 0.55, eh = ew * (errImg.naturalHeight / errImg.naturalWidth);
        var ex = (W - ew) / 2, ey = (H - eh) / 2 - 10;
        ctx.drawImage(errImg, ex, ey, ew, eh);
      } else {
        var dw = 140, dh = 50;
        var dx = (W - dw) / 2, dy = (H - dh) / 2 - 20;
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.fillStyle = '#000080';
        ctx.fillRect(dx, dy, dw, 12);
        ctx.fillStyle = '#fff';
        ctx.font = '5px monospace';
        ctx.fillText('DARKROOM.EXE', dx + 2, dy + 9);
      }
      break;

    case 3:
      // Crosshair becomes Windows cursor - use darkroom_cursor.png
      var curImg = A.cursor;
      if (curImg && curImg.complete && curImg.naturalWidth) {
        var cs = 16; // cursor size on the low-res buffer
        ctx.drawImage(curImg, W / 2 - cs / 2, H / 2 - cs / 2, cs, cs);
      } else {
        // Scanline glitch fallback
        for (var i = 0; i < 5; i++) {
          var gy = Math.floor(Math.random() * H);
          ctx.fillStyle = 'rgba(0,255,0,0.15)';
          ctx.fillRect(0, gy, W, 2);
        }
      }
      break;

    case 4:
      // Brief color inversion band
      var bandY = Math.floor(Math.random() * (H - 30));
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, bandY, W, 20);
      ctx.globalCompositeOperation = 'source-over';
      break;

    case 5:
      // Text glitch on screen
      ctx.fillStyle = 'rgba(0,255,0,0.8)';
      ctx.font = '5px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('C:\\DPOS\\35MM\\DARKROOM.EXE', W / 2, H / 2);
      ctx.textAlign = 'left';
      break;
  }
};

// ============================================================================
// INPUT HANDLING
// ============================================================================

DARKROOM.setupInput = function() {
  // Keyboard
  document.addEventListener('keydown', DARKROOM._onKeyDown);
  document.addEventListener('keyup', DARKROOM._onKeyUp);

  // Mouse look (pointer lock)
  var body = document.getElementById('fpsBody');
  body.addEventListener('click', DARKROOM._onBodyClick);
  document.addEventListener('mousemove', DARKROOM._onMouseMove);
  document.addEventListener('pointerlockchange', DARKROOM._onPointerLockChange);

  // Scroll for viewfinder
  body.addEventListener('wheel', DARKROOM._onWheel, { passive: false });
};

DARKROOM._onKeyDown = function(e) {
  if (!DARKROOM.active) return;
  var win = document.getElementById('win-fps');
  if (!win || !win.classList.contains('open') || win.classList.contains('minimized')) return;
  if (typeof windowOrder !== 'undefined' && windowOrder[windowOrder.length - 1] !== 'fps') return;

  DARKROOM.keys[e.code] = true;

  if (e.code === 'KeyE') {
    if (DARKROOM.viewfinder.active) {
      DARKROOM.reloadFilm();
    } else {
      DARKROOM.interact();
    }
    e.preventDefault();
  }

  if (e.code === 'Escape') {
    if (DARKROOM.viewfinder.active) {
      DARKROOM.exitViewfinder();
      e.preventDefault();
    }
  }

  // Viewfinder photo browsing
  if (DARKROOM.viewfinder.active) {
    if (e.code === 'ArrowRight') { DARKROOM.advancePhoto(1); e.preventDefault(); }
    if (e.code === 'ArrowLeft') { DARKROOM.advancePhoto(-1); e.preventDefault(); }
  }
};

DARKROOM._onKeyUp = function(e) {
  DARKROOM.keys[e.code] = false;

  // Push-wall hold release
  if (e.code === 'KeyE') {
    DARKROOM.pushWall.holdStart = 0;
  }
};

DARKROOM._onBodyClick = function(e) {
  if (!DARKROOM.active || !DARKROOM.booted) return;
  if (DARKROOM.viewfinder.active) return;
  var body = document.getElementById('fpsBody');
  if (document.pointerLockElement !== body) {
    body.requestPointerLock();
  }
};

DARKROOM._onMouseMove = function(e) {
  if (!DARKROOM.active || !DARKROOM.booted) return;
  if (DARKROOM.viewfinder.active) return;
  if (document.pointerLockElement === document.getElementById('fpsBody')) {
    DARKROOM.player.angle += e.movementX * 0.002;
    DARKROOM.player.pitch -= e.movementY * 0.5;
    DARKROOM.player.pitch = Math.max(-60, Math.min(60, DARKROOM.player.pitch));
  }
};

DARKROOM._onPointerLockChange = function() {
  DARKROOM.pointerLocked = document.pointerLockElement === document.getElementById('fpsBody');
};

DARKROOM._onWheel = function(e) {
  if (!DARKROOM.active) return;
  if (DARKROOM.viewfinder.active) {
    e.preventDefault();
    DARKROOM.advancePhoto(e.deltaY > 0 ? 1 : -1);
  }
};

// ============================================================================
// MOBILE TOUCH CONTROLS
// ============================================================================

DARKROOM.setupMobileControls = function() {
  if (!('ontouchstart' in window)) return;
  document.getElementById('fpsMobileControls').style.display = 'block';

  var moveStick = document.getElementById('fpsMoveStick');
  var moveKnob = document.getElementById('fpsMoveKnob');
  var lookStick = document.getElementById('fpsLookStick');
  var lookKnob = document.getElementById('fpsLookKnob');
  var actionBtn = document.getElementById('fpsActionBtn');

  var moveTouch = null, lookTouch = null;

  function getStickInput(stick, touch) {
    var rect = stick.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var dx = (touch.clientX - cx) / (rect.width / 2);
    var dy = (touch.clientY - cy) / (rect.height / 2);
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) { dx /= len; dy /= len; }
    return { x: dx, y: -dy };
  }

  function updateKnob(knob, input) {
    knob.style.transform = 'translate(' + (input.x * 25) + 'px,' + (-input.y * 25) + 'px)';
  }

  moveStick.addEventListener('touchstart', function(e) {
    e.preventDefault();
    moveTouch = e.changedTouches[0].identifier;
    DARKROOM.mobileMove = getStickInput(moveStick, e.changedTouches[0]);
    updateKnob(moveKnob, DARKROOM.mobileMove);
  }, { passive: false });

  moveStick.addEventListener('touchmove', function(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === moveTouch) {
        DARKROOM.mobileMove = getStickInput(moveStick, e.changedTouches[i]);
        updateKnob(moveKnob, DARKROOM.mobileMove);
      }
    }
  }, { passive: false });

  moveStick.addEventListener('touchend', function(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === moveTouch) {
        moveTouch = null;
        DARKROOM.mobileMove = null;
        moveKnob.style.transform = '';
      }
    }
  });

  lookStick.addEventListener('touchstart', function(e) {
    e.preventDefault();
    lookTouch = e.changedTouches[0].identifier;
    DARKROOM.mobileLook = getStickInput(lookStick, e.changedTouches[0]);
    updateKnob(lookKnob, DARKROOM.mobileLook);
  }, { passive: false });

  lookStick.addEventListener('touchmove', function(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === lookTouch) {
        DARKROOM.mobileLook = getStickInput(lookStick, e.changedTouches[i]);
        updateKnob(lookKnob, DARKROOM.mobileLook);
      }
    }
  }, { passive: false });

  lookStick.addEventListener('touchend', function(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === lookTouch) {
        lookTouch = null;
        DARKROOM.mobileLook = null;
        lookKnob.style.transform = '';
      }
    }
  });

  // Action button
  actionBtn.addEventListener('touchstart', function(e) {
    e.preventDefault();
    if (DARKROOM.viewfinder.active) {
      DARKROOM.reloadFilm();
    } else {
      DARKROOM.interact();
    }
  }, { passive: false });

  // Swipe on viewfinder for photo browsing
  var vfTouchX = 0;
  var vf = document.getElementById('fpsViewfinder');
  vf.addEventListener('touchstart', function(e) {
    vfTouchX = e.changedTouches[0].clientX;
  }, { passive: true });
  vf.addEventListener('touchend', function(e) {
    var diff = vfTouchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      DARKROOM.advancePhoto(diff > 0 ? 1 : -1);
    }
  }, { passive: true });
};

// ============================================================================
// PUSH-WALL HOLD DETECTION (E held for 2 seconds)
// ============================================================================

// Check in the game loop if E is being held against a push-wall
DARKROOM._checkPushWallHold = function() {
  if (!DARKROOM.keys['KeyE']) {
    DARKROOM.pushWall.holdStart = 0;
    return;
  }
  if (DARKROOM.pushWall.active) return;
  if (DARKROOM.pushWall.holdStart === 0) return;

  var elapsed = performance.now() - DARKROOM.pushWall.holdStart;
  if (elapsed >= 2000) {
    // Activate push-wall
    DARKROOM.pushWall.active = true;
    DARKROOM.pushWall.progress = 0;
    DARKROOM.pushWall.holdStart = 0;
  }
};

// Patch updatePlayer to also check push-wall hold
var _origUpdatePlayer = DARKROOM.updatePlayer;
DARKROOM.updatePlayer = function(dt) {
  _origUpdatePlayer(dt);
  DARKROOM._checkPushWallHold();
};

// ============================================================================
// VIEWFINDER BUTTON HOOKS (connect HTML buttons to DARKROOM)
// ============================================================================

// Override the global fpsReloadFilm function used by the HTML button
function fpsReloadFilm() {
  if (DARKROOM.active && DARKROOM.viewfinder.active) {
    DARKROOM.reloadFilm();
  }
}

function hideFPSViewfinder() {
  if (DARKROOM.active && DARKROOM.viewfinder.active) {
    DARKROOM.exitViewfinder();
  }
}

// ============================================================================
// TERMINAL COMMANDS INTEGRATION
// ============================================================================

DARKROOM.registerTerminalCommands = function() {
  if (typeof terminalCommands === 'undefined') return;

  terminalCommands['run darkroom'] = function() {
    openWindow('fps');
    return 'LOADING DARKROOM.WAD...\nMOUNTING /35MM/ROLL_01...\nENTERING C:\\DPOS\\35MM\\DARKROOM';
  };

  terminalCommands['load darkroom.wad'] = function() {
    openWindow('fps');
    return 'LOADING DARKROOM.WAD...\nMOUNTING /35MM/ROLL_01...\nENTERING C:\\DPOS\\35MM\\DARKROOM';
  };

  terminalCommands['secrets'] = function() {
    var s = DARKROOM.secrets;
    var total = s.canisters + (s.floppyDisk ? 1 : 0) + (s.devRoom ? 1 : 0);
    var lines = 'DARKROOM SECRETS: ' + total + '/5 found\n';
    lines += '  Film Canisters: ' + s.canisters + '/3 ' + (s.canisters >= 3 ? '[FOUND]' : '') + '\n';
    lines += '  Floppy Disk:    ' + (s.floppyDisk ? '[FOUND]' : '[???]') + '\n';
    lines += '  Dev Room:       ' + (s.devRoom ? '[FOUND]' : '[???]');
    if (total >= 5) lines += '\n\n  >> ALL FOUND <<';
    return lines;
  };
};

// ============================================================================
// DESKTOP INTEGRATION (check secrets on load, show LOST_ROLL icon)
// ============================================================================

DARKROOM.checkDesktopSecrets = function() {
  try {
    var saved = localStorage.getItem('darkroomSecrets');
    if (saved) {
      var data = JSON.parse(saved);
      if (data.floppyDisk) {
        // Check if icon already exists
        if (!document.getElementById('lostRollIcon')) {
          var icons = document.getElementById('desktopIcons');
          var icon = document.createElement('div');
          icon.className = 'desktop-icon';
          icon.id = 'lostRollIcon';
          icon.style.cssText = 'left:184px;top:268px;';
          icon.setAttribute('ondblclick', "openWindow('photos')");
          icon.innerHTML = '<svg class="icon-img" viewBox="0 0 32 32">' +
            '<rect x="4" y="2" width="24" height="28" fill="#1a1a2a" stroke="#444" stroke-width="1"/>' +
            '<rect x="8" y="4" width="16" height="4" fill="#c0c0c0"/>' +
            '<text x="16" y="20" font-size="6" font-family="monospace" fill="#0f0" text-anchor="middle">LOST</text>' +
            '<text x="16" y="27" font-size="6" font-family="monospace" fill="#0f0" text-anchor="middle">ROLL</text>' +
            '</svg><span class="icon-label">LOST_ROLL.dsk</span>';
          icons.appendChild(icon);
        }
      }
    }
  } catch (e) { /* ignore */ }
};

// ============================================================================
// INITIALIZATION HOOK (called from index.html)
// ============================================================================

// Register terminal commands immediately
DARKROOM.registerTerminalCommands();

// Check desktop secrets on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', DARKROOM.checkDesktopSecrets);
} else {
  DARKROOM.checkDesktopSecrets();
}
