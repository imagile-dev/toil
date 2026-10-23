import { useCallback, useEffect, useRef, useState } from "react";
import titleArt from "./title.png";
import spriteArt from "./sprites.png";
import { StoryIntro } from "./StoryIntro.tsx";
import "./powershell-man.css";

type Mode = "intro" | "story" | "playing" | "paused" | "won" | "lost";
type Rect = { x: number; y: number; w: number; h: number };

// One authored atlas, eight columns by four rows. Trim each cell's transparent
// padding once, then use one scale per character family to avoid size jitter.
const spriteImage = new Image();
spriteImage.src = spriteArt;
let spriteFrames: Rect[][] = [];
let spriteScales: number[] = [];
function prepareSprites() {
  if (spriteFrames.length || !spriteImage.naturalWidth) return;
  const sheet = document.createElement("canvas");
  sheet.width = spriteImage.naturalWidth;
  sheet.height = spriteImage.naturalHeight;
  const context = sheet.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.drawImage(spriteImage, 0, 0);
  const pixels = context.getImageData(0, 0, sheet.width, sheet.height).data;
  const cw = sheet.width / 8;
  // The generated rows have different safe vertical extents; keep the first
  // architect's hair out of the crawler row and preserve the jump silhouette.
  const rows = [0, 0.265, 0.507, 0.727, 1];
  spriteFrames = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => {
      const left = Math.round(col * cw),
        top = Math.round((rows[row] ?? 0) * sheet.height);
      const ch = Math.round((rows[row + 1] ?? 1) * sheet.height) - top;
      let minX = Math.round(cw),
        minY = Math.round(ch),
        maxX = 0,
        maxY = 0;
      for (let y = 0; y < Math.floor(ch); y++)
        for (let x = 0; x < Math.floor(cw); x++) {
          if ((pixels[((top + y) * sheet.width + left + x) * 4 + 3] ?? 0) < 32)
            continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      return {
        x: left + minX,
        y: top + minY,
        w: Math.max(1, maxX - minX + 1),
        h: Math.max(1, maxY - minY + 1),
      };
    }),
  );
  const heroHeight = Math.max(
    ...spriteFrames
      .slice(0, 2)
      .flat()
      .map((f) => f.h),
  );
  spriteScales = [
    76 / heroHeight,
    76 / heroHeight,
    1,
    140 / Math.max(...(spriteFrames[3] ?? []).map((f) => f.h)),
  ];
}
function drawSprite(
  ctx: CanvasRenderingContext2D,
  row: number,
  frame: number,
  x: number,
  feet: number,
  face = 1,
  height?: number,
) {
  const source = spriteFrames[row]?.[frame];
  if (!source) return;
  const scale = height
    ? height /
      Math.max(
        ...(spriteFrames[row] ?? [])
          .slice(frame - (frame % 2), frame - (frame % 2) + 2)
          .map((f) => f.h),
      )
    : (spriteScales[row] ?? 1);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(feet));
  ctx.scale(face, 1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    spriteImage,
    source.x,
    source.y,
    source.w,
    source.h,
    (-source.w * scale) / 2,
    -source.h * scale,
    source.w * scale,
    source.h * scale,
  );
  ctx.restore();
}
type Foe = {
  x: number;
  y: number;
  hp: number;
  type: "alias" | "job" | "phantom" | "boss";
  base: number;
  phase: number;
  hitAt?: number;
  hitDirection?: number;
};

function drawChargeAura(
  ctx: CanvasRenderingContext2D,
  x: number,
  feet: number,
  charge: number,
  now: number,
  foreground: boolean,
) {
  if (charge < 0.12) return;
  const strength = Math.min(1, (charge - 0.12) / 0.88);
  const pulse = 1 + Math.sin(now / 95) * 0.06;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (!foreground) {
    const radius = (42 + strength * 30) * pulse;
    const glow = ctx.createRadialGradient(
      x,
      feet - 36,
      3,
      x,
      feet - 36,
      radius,
    );
    glow.addColorStop(0, `rgba(100,240,255,${0.12 + strength * 0.12})`);
    glow.addColorStop(0.5, `rgba(76,130,255,${strength * 0.2})`);
    glow.addColorStop(1, "rgba(70,80,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, feet - 36 - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 0.13 + strength * 0.18;
    ctx.filter = "blur(7px)";
    drawSprite(ctx, 2, 7, x, feet + 12, 1, (90 + strength * 50) * pulse);
  } else {
    ctx.globalAlpha = strength * 0.22;
    ctx.filter = "blur(2px)";
    drawSprite(
      ctx,
      2,
      7,
      x + Math.sin(now / 150) * 5,
      feet + 3,
      -1,
      (65 + strength * 38) * pulse,
    );
    ctx.filter = "none";
    ctx.globalAlpha = 0.35 + strength * 0.4;
    for (let i = 0; i < 12; i++) {
      const phase = now / 380 + (i * Math.PI) / 6;
      const orbit = 25 + strength * 20 + Math.sin(phase * 3) * 4;
      ctx.fillStyle = i % 2 ? "#8affed" : "#ffc5f1";
      ctx.beginPath();
      ctx.arc(
        x + Math.cos(phase) * orbit,
        feet - 36 + Math.sin(phase) * orbit * 1.15,
        0.7 + strength,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}
type Shot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  charge: number;
  hostile?: boolean;
};
type GameState = {
  player: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    grounded: boolean;
    face: number;
    invuln: number;
    health: number;
    checkpoint: number;
    coyote: number;
    buffer: number;
    emergency: number;
    emergencyCooldown: number;
  };
  foes: Foe[];
  shots: Shot[];
  camera: number;
  charge: number;
  last: number;
  time: number;
  accumulator: number;
  shotAt: number;
  lastFire: number;
  bossPhase: number;
  bossTelegraph: number;
  padJump: boolean;
  padFire: boolean;
  padEmergency: boolean;
  padStart: boolean;
};
const W = 960,
  H = 540,
  GRAVITY = 1850,
  SPEED = 235,
  JUMP = 665;
const solids: Rect[] = [
  { x: 0, y: 476, w: 720, h: 80 },
  { x: 790, y: 476, w: 520, h: 80 },
  { x: 1400, y: 476, w: 740, h: 80 },
  { x: 2240, y: 476, w: 720, h: 80 },
  { x: 3060, y: 476, w: 760, h: 80 },
  { x: 3900, y: 476, w: 740, h: 80 },
  { x: 520, y: 390, w: 120, h: 20 },
  { x: 925, y: 370, w: 140, h: 20 },
  { x: 1190, y: 410, w: 120, h: 20 },
  { x: 1640, y: 370, w: 150, h: 20 },
  { x: 1900, y: 405, w: 130, h: 20 },
  { x: 2460, y: 380, w: 140, h: 20 },
  { x: 2780, y: 410, w: 130, h: 20 },
  { x: 3270, y: 365, w: 150, h: 20 },
  { x: 3550, y: 400, w: 130, h: 20 },
  { x: 4100, y: 370, w: 160, h: 20 },
  { x: 4390, y: 400, w: 150, h: 20 },
  { x: 4740, y: 476, w: 650, h: 80 },
  { x: 5470, y: 476, w: 650, h: 80 },
  { x: 6260, y: 476, w: 680, h: 80 },
  { x: 7090, y: 476, w: 640, h: 80 },
  { x: 7880, y: 476, w: 1000, h: 80 },
  { x: 4930, y: 400, w: 130, h: 20 },
  { x: 5700, y: 380, w: 140, h: 20 },
  { x: 6030, y: 410, w: 120, h: 20 },
  { x: 6530, y: 370, w: 150, h: 20 },
  { x: 6840, y: 405, w: 130, h: 20 },
  { x: 7370, y: 375, w: 140, h: 20 },
  { x: 7660, y: 410, w: 120, h: 20 },
];
const checkpoints = [0, 1400, 3060, 4740, 6260, 7880];
const phantomVisible = (foe: Foe, now: number) =>
  foe.type !== "phantom" || Math.sin(now / 690 + foe.phase) < 0.45;
const spawnFoes = (): Foe[] => [
  ...[
    300, 620, 1010, 1320, 1550, 1810, 2090, 2360, 2650, 2960, 3210, 3470, 3780,
    4050, 4300, 4610, 4910, 5180, 5500, 5810, 6120, 6400, 6670, 6940, 7220,
    7490, 7770,
  ].map((x, i) => ({
    x,
    y: 465,
    hp: 2,
    type: (i % 3 === 0
      ? "job"
      : i % 3 === 1
        ? "alias"
        : "phantom") as Foe["type"],
    base: x,
    phase: i * 1.8,
  })),
  { x: 8310, y: 405, hp: 18, type: "boss", base: 8310, phase: 0 },
];

function drawWorld(ctx: CanvasRenderingContext2D, s: GameState, now: number) {
  const cam = s.camera,
    sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#071522");
  sky.addColorStop(1, "#102a3b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // Distant server stacks and grid.
  for (let i = 0; i < 28; i++) {
    const x = ((((i * 213 - cam * 0.22) % 6200) + 6200) % 6200) - 80;
    const h = 100 + ((i * 47) % 145);
    ctx.fillStyle = i % 2 ? "#0b2130" : "#0d2636";
    ctx.fillRect(x, 470 - h, 92, h);
    ctx.fillStyle = "#17394a";
    for (let y = 485 - h; y < 455; y += 24) {
      ctx.fillRect(x + 12, y, 6, 7);
      ctx.fillRect(x + 28, y, 6, 7);
      ctx.fillRect(x + 62, y, 6, 7);
    }
  }
  ctx.strokeStyle = "rgba(68,163,185,.08)";
  ctx.lineWidth = 1;
  for (let x = -(cam % 48); x < W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  // platforms
  for (const p of solids) {
    const x = p.x - cam;
    if (x + p.w < -20 || x > W + 20) continue;
    ctx.fillStyle = "#193547";
    ctx.fillRect(x, p.y, p.w, p.h);
    ctx.fillStyle = "#2b6270";
    ctx.fillRect(x, p.y, p.w, 5);
    ctx.fillStyle = "#102634";
    for (let bx = x + 10; bx < x + p.w - 5; bx += 40)
      ctx.fillRect(bx, p.y + 14, 20, 3);
  }
  const signs: [number, string][] = [
    [520, "Execution Policy: Bypass?"],
    [1620, "Object → string"],
    [2780, "Final_v7_REAL.ps1"],
    [4120, "TODO: add retries"],
    [5660, "Reviewed by /dev/null"],
    [7130, "This log is not a database"],
  ];
  for (const [sx, label] of signs) {
    const x = sx - cam;
    if (x < -180 || x > W + 30) continue;
    ctx.fillStyle = "#302f3b";
    ctx.fillRect(x, 398, 3, 78);
    ctx.fillStyle = "#41394a";
    ctx.fillRect(x - 8, 399, Math.min(190, label.length * 6 + 18), 30);
    ctx.fillStyle = "#f1b4c0";
    ctx.font = "9px monospace";
    ctx.fillText(label, x, 418);
    ctx.fillStyle = "#ef77a5";
    ctx.fillRect(x - 2, 396, 7, 4);
  }
  // checkpoint beacons
  checkpoints.slice(1).forEach((cp, i) => {
    const x = cp - cam;
    if (x > -30 && x < W + 30) {
      ctx.fillStyle = "#f7b955";
      ctx.fillRect(x, 416, 4, 60);
      ctx.fillStyle = `rgba(247,185,85,${0.2 + 0.12 * Math.sin(now / 240)})`;
      ctx.beginPath();
      ctx.arc(x + 2, 412, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffda8b";
      ctx.font = "10px monospace";
      ctx.fillText(`CHECKPOINT ${i + 1}`, x - 42, 398);
    }
  });
  for (const f of s.foes) {
    const x = f.x - cam;
    const hitAge = s.time - (f.hitAt ?? -Infinity);
    const dying = f.hp <= 0;
    if (
      x < -100 ||
      x > W + 100 ||
      (dying && hitAge > 0.45) ||
      (!phantomVisible(f, now) && hitAge > 0.3)
    )
      continue;
    ctx.save();
    if (hitAge < 0.32)
      ctx.translate(
        (f.hitDirection ?? 1) * Math.sin((hitAge * Math.PI) / 0.32) * 9,
        0,
      );
    if (dying) {
      ctx.globalAlpha = Math.max(0, 1 - hitAge / 0.45);
      ctx.translate(0, -hitAge * 40);
    }
    if (hitAge < 0.075) ctx.filter = "brightness(3) saturate(0.4)";
    const boss = f.type === "boss";
    if (boss) {
      const bossFrame =
        hitAge < 0.26
          ? 6 + Math.min(1, Math.floor(hitAge / 0.13))
          : s.bossTelegraph > 0
            ? 4 + (Math.floor(now / 100) % 2)
            : Math.floor(now / 180) % 4;
      drawSprite(ctx, 3, bossFrame, x, 476);
      if (s.bossTelegraph > 0) {
        const quip = [
          "“Could we add validation before deploy?”",
          "“Let’s keep this to least privilege.”",
          "“One quick review before merge?”",
        ][s.bossPhase];
        ctx.fillStyle = "#f3ebdf";
        ctx.fillRect(x - 120, 276, 240, 26);
        ctx.fillStyle = "#302c39";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(quip ?? "Please add a test.", x, 293);
        ctx.textAlign = "start";
        ctx.fillStyle = "#ef77a5";
        ctx.fillRect(x - 3, 301, 6, 8);
      }
    } else {
      const fy = f.y;
      const pair = f.type === "job" ? 0 : f.type === "alias" ? 2 : 4;
      drawSprite(
        ctx,
        2,
        pair + (Math.floor(now / 140 + f.phase) % 2),
        x,
        fy + 9,
        1,
        f.type === "phantom" ? 46 : 39,
      );
      ctx.fillStyle = "#d8b9bc";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        f.type === "job" ? "JOB" : f.type === "alias" ? "ALIAS" : "PROFILE",
        x,
        fy - 30,
      );
      ctx.textAlign = "start";
    }
    ctx.filter = "none";
    if (hitAge < 0.25) {
      ctx.globalAlpha = 1 - hitAge / 0.25;
      drawSprite(
        ctx,
        2,
        7,
        x,
        (f.type === "boss" ? 425 : f.y) + 14,
        1,
        24 + hitAge * 120,
      );
    }
    if (dying) {
      ctx.fillStyle = "#ffb8e6";
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        ctx.fillRect(
          x + Math.cos(angle) * hitAge * 95,
          f.y - 12 + Math.sin(angle) * hitAge * 80,
          3,
          3,
        );
      }
    }
    ctx.restore();
  }
  for (const b of s.shots) {
    const bx = b.x - cam,
      color = b.hostile ? "#ffb547" : b.charge > 0 ? "#8affed" : "#ff58a5";
    ctx.strokeStyle = color;
    ctx.lineWidth = b.charge ? 5 : 3;
    ctx.shadowBlur = b.charge ? 14 : 7;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.moveTo(bx - b.vx * 0.035, b.y - b.vy * 0.035);
    ctx.bezierCurveTo(
      bx - b.vx * 0.024 + 3,
      b.y - b.vy * 0.025 + 5,
      bx - b.vx * 0.012 - 4,
      b.y - b.vy * 0.012 - 5,
      bx,
      b.y,
    );
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(bx - 3, b.y - 3, 6, 6);
    ctx.shadowBlur = 0;
  }
  // Hero: helmet, visor and unmistakable cable backpack.
  const p = s.player,
    x = p.x - cam,
    y = p.y;
  const blink = p.invuln > 0 && Math.floor(now / 65) % 2 === 0;
  if (!blink) {
    const firing = s.time - s.lastFire < 0.23;
    const moving = Math.abs(p.vx) > 1;
    const row = p.grounded && moving && !firing ? 0 : 1;
    const frame =
      row === 0
        ? Math.floor(now / 75) % 8
        : firing
          ? 5 + Math.min(2, Math.floor((s.time - s.lastFire) / 0.077))
          : !p.grounded
            ? p.vy < -160
              ? 2
              : p.vy < 150
                ? 3
                : 4
            : Math.floor(now / 320) % 2;
    drawChargeAura(ctx, x, y, s.charge, now, false);
    drawSprite(ctx, row, frame, x, y, p.face);
    drawChargeAura(ctx, x, y, s.charge, now, true);
    if (s.charge > 0.85) {
      ctx.strokeStyle = "#8affed";
      ctx.lineWidth = 1 + s.charge;
      ctx.beginPath();
      ctx.arc(
        x + p.face * 27,
        y - 44,
        5 + s.charge * 9 + Math.sin(now / 45) * 2,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    if (firing)
      drawSprite(
        ctx,
        2,
        6 + (Math.floor(now / 65) % 2),
        x + p.face * 40,
        y - 27,
        p.face,
        24,
      );
  }
}

export function PowershellMan({ onClose }: { onClose: () => void }) {
  const [spritesReady, setSpritesReady] = useState(false);
  const [spriteError, setSpriteError] = useState(false);
  const [hits, setHits] = useState(0);
  useEffect(() => {
    const ready = () => {
      prepareSprites();
      setSpritesReady(spriteFrames.length === 4);
    };
    const failed = () => setSpriteError(true);
    spriteImage.addEventListener("load", ready);
    spriteImage.addEventListener("error", failed);
    if (spriteImage.complete) {
      if (spriteImage.naturalWidth) ready();
      else failed();
    }
    return () => {
      spriteImage.removeEventListener("load", ready);
      spriteImage.removeEventListener("error", failed);
    };
  }, []);
  const canvas = useRef<HTMLCanvasElement>(null),
    game = useRef<GameState | null>(null),
    keys = useRef(new Set<string>()),
    jumpPressed = useRef(false),
    [mode, setMode] = useState<Mode>("intro"),
    [charge, setCharge] = useState(0),
    [health, setHealth] = useState(8),
    [bossHp, setBossHp] = useState(18);
  const start = useCallback(() => {
    game.current = {
      player: {
        x: 90,
        y: 476,
        vx: 0,
        vy: 0,
        grounded: true,
        face: 1,
        invuln: 0,
        health: 8,
        checkpoint: 0,
        coyote: 0.1,
        buffer: 0,
        emergency: 0,
        emergencyCooldown: 0,
      },
      foes: spawnFoes(),
      shots: [],
      camera: 0,
      charge: 0,
      last: 0,
      accumulator: 0,
      shotAt: 0,
      lastFire: -Infinity,
      bossPhase: 0,
      time: 0,
      bossTelegraph: 0,
      padJump: false,
      padFire: false,
      padEmergency: false,
      padStart: false,
    };
    keys.current.clear();
    setHealth(8);
    setBossHp(18);
    setCharge(0);
    setHits(0);
    setMode("playing");
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
      ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    const down = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(e.code))
        e.preventDefault();
      if (e.code === "Escape") {
        if (e.repeat) return;
        if (mode === "playing") keys.current.clear();
        setMode((m) =>
          m === "playing" ? "paused" : m === "paused" ? "playing" : m,
        );
        return;
      }
      if (e.code === "KeyR" && (mode === "won" || mode === "lost")) {
        start();
        return;
      }
      if (
        mode === "playing" &&
        !keys.current.has(e.code) &&
        ["ArrowUp", "KeyZ", "Space"].includes(e.code)
      )
        jumpPressed.current = true;
      if (
        mode === "playing" &&
        !keys.current.has(e.code) &&
        e.code === "KeyC" &&
        game.current &&
        game.current.player.emergencyCooldown <= 0
      ) {
        game.current.player.emergency = 1.25;
        game.current.player.emergencyCooldown = 7;
        game.current.player.invuln = 1.25;
      }
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
      if (mode === "playing" && e.code === "KeyX" && game.current) {
        const s = game.current,
          p = s.player;
        if (performance.now() - s.shotAt > 180) {
          s.shots.push({
            x: p.x + p.face * 24,
            y: p.y - 45,
            vx: p.face * (s.charge > 0.9 ? 600 : 510),
            vy: 0,
            life: 1.5,
            charge: s.charge > 0.9 ? 1 : 0,
          });
          s.shotAt = performance.now();
          s.lastFire = s.time;
        }
        s.charge = 0;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const step = (dt: number, s: GameState) => {
      s.time += dt;
      const now = s.time * 1000;
      const p = s.player,
        k = keys.current,
        pad = navigator.getGamepads?.()[0];
      const padJump = Boolean(pad?.buttons[0]?.pressed),
        padFire = Boolean(pad?.buttons[2]?.pressed),
        padEmergency = Boolean(pad?.buttons[1]?.pressed),
        padStart = Boolean(pad?.buttons[9]?.pressed);
      if (padJump && !s.padJump) jumpPressed.current = true;
      if (padEmergency && !s.padEmergency && p.emergencyCooldown <= 0) {
        p.emergency = 1.25;
        p.emergencyCooldown = 7;
        p.invuln = 1.25;
      }
      if (padStart && !s.padStart) {
        keys.current.clear();
        setMode("paused");
      }
      if (padFire && !s.padFire) s.charge = 0;
      if (!padFire && s.padFire && performance.now() - s.shotAt > 180) {
        s.shots.push({
          x: p.x + p.face * 24,
          y: p.y - 45,
          vx: p.face * (s.charge > 0.9 ? 600 : 510),
          vy: 0,
          life: 1.5,
          charge: s.charge > 0.9 ? 1 : 0,
        });
        s.shotAt = performance.now();
        s.lastFire = s.time;
        s.charge = 0;
      }
      s.padJump = padJump;
      s.padFire = padFire;
      s.padEmergency = padEmergency;
      s.padStart = padStart;
      p.invuln = Math.max(0, p.invuln - dt);
      p.emergency = Math.max(0, p.emergency - dt);
      p.emergencyCooldown = Math.max(0, p.emergencyCooldown - dt);
      p.coyote = p.grounded ? 0.11 : Math.max(0, p.coyote - dt);
      p.buffer = jumpPressed.current ? 0.12 : Math.max(0, p.buffer - dt);
      jumpPressed.current = false;
      const padAxis = pad?.axes[0] ?? 0,
        axis =
          (k.has("ArrowRight") ||
          k.has("KeyD") ||
          padAxis > 0.25 ||
          Boolean(pad?.buttons[15]?.pressed)
            ? 1
            : 0) -
          (k.has("ArrowLeft") ||
          k.has("KeyA") ||
          padAxis < -0.25 ||
          Boolean(pad?.buttons[14]?.pressed)
            ? 1
            : 0);
      if (axis) p.face = axis;
      p.vx = axis * SPEED;
      if (p.buffer && p.coyote) {
        p.vy = -JUMP;
        p.grounded = false;
        p.coyote = 0;
        p.buffer = 0;
      }
      if (k.has("KeyX") || padFire) s.charge = Math.min(1, s.charge + dt / 1.2);
      p.vy = Math.min(1000, p.vy + GRAVITY * dt);
      const oldX = p.x;
      p.x = Math.max(18, Math.min(8780, p.x + p.vx * dt));
      const oldY = p.y;
      p.y += p.vy * dt;
      p.grounded = false;
      for (const r of solids) {
        const overlapsX = p.x + 12 > r.x && p.x - 12 < r.x + r.w,
          overlapsY = p.y > r.y && p.y - 54 < r.y + r.h;
        if (overlapsX) {
          if (oldY <= r.y && p.y >= r.y && p.vy >= 0) {
            p.y = r.y;
            p.vy = 0;
            p.grounded = true;
          } else if (
            oldY - 54 >= r.y + r.h &&
            p.y - 54 < r.y + r.h &&
            p.vy < 0
          ) {
            p.y = r.y + r.h + 54;
            p.vy = 0;
          }
        }
        if (overlapsY) {
          if (oldX + 12 <= r.x && p.x + 12 > r.x) {
            p.x = r.x - 12;
            p.vx = 0;
          } else if (oldX - 12 >= r.x + r.w && p.x - 12 < r.x + r.w) {
            p.x = r.x + r.w + 12;
            p.vx = 0;
          }
        }
      }
      if (p.y > H + 80) {
        p.health = 0;
      }
      for (const b of s.shots) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (!b.hostile)
          for (const f of s.foes)
            if (
              f.hp > 0 &&
              phantomVisible(f, now) &&
              Math.abs(b.x - f.x) < (f.type === "boss" ? 44 : 23) &&
              Math.abs(b.y - f.y) < (f.type === "boss" ? 118 : 36)
            ) {
              f.hp -= b.charge ? 3 : 1;
              f.hitAt = s.time;
              f.hitDirection = Math.sign(b.vx);
              setHits((count) => count + 1);
              b.life = 0;
              if (f.type === "boss") setBossHp(f.hp);
              break;
            }
        if (
          b.hostile &&
          Math.abs(b.x - p.x) < 20 &&
          Math.abs(b.y - (p.y - 20)) < 30 &&
          !p.invuln
        ) {
          p.health--;
          p.invuln = 1.2;
          b.life = 0;
        }
      }
      s.shots = s.shots.filter(
        (b: Shot) =>
          b.life > 0 && b.x > s.camera - 100 && b.x < s.camera + W + 100,
      );
      for (const f of s.foes) {
        if (f.hp <= 0) continue;
        if (f.type === "boss") {
          f.x = Math.max(
            8110,
            Math.min(8510, f.base + Math.sin(now / 1100) * 160),
          );
          f.phase += dt;
          const phase = f.hp > 12 ? 0 : f.hp > 6 ? 1 : 2;
          s.bossPhase = phase;
          const interval = phase === 0 ? 1.5 : phase === 1 ? 1.2 : 0.9;
          s.bossTelegraph = f.phase > interval - 0.35 ? interval - f.phase : 0;
          if (f.phase > interval) {
            f.phase = 0;
            s.bossTelegraph = 0;
            const dx = p.x - f.x,
              dy = p.y - 22 - 382,
              len = Math.hypot(dx, dy) || 1,
              count = phase === 2 ? 3 : 1;
            for (let j = 0; j < count; j++) {
              const spread = (j - (count - 1) / 2) * 0.2,
                vx = (dx / len) * 300,
                vy = (dy / len) * 300;
              s.shots.push({
                x: f.x,
                y: 382,
                vx: vx * Math.cos(spread) - vy * Math.sin(spread),
                vy: vx * Math.sin(spread) + vy * Math.cos(spread),
                life: 3.2,
                charge: 0,
                hostile: true,
              });
            }
          }
        } else {
          f.x =
            f.type === "job"
              ? f.base + Math.sin(now / 640 + f.phase) * 65
              : f.base + Math.sin(now / 480 + f.phase) * 32;
          f.y =
            f.type === "alias"
              ? 465 - Math.max(0, Math.sin(now / 250 + f.phase)) * 42
              : 465;
          if (
            phantomVisible(f, now) &&
            Math.abs(f.x - p.x) < 28 &&
            Math.abs(f.y - 22 - (p.y - 35)) < 35 &&
            !p.invuln
          ) {
            p.health--;
            p.invuln = 1;
          }
        }
      }
      if (p.health <= 0) {
        p.health = 0;
        setHealth(0);
        setMode("lost");
        return;
      }
      for (let i = p.checkpoint + 1; i < checkpoints.length; i++)
        if (p.x > (checkpoints[i] ?? Infinity)) p.checkpoint = i;
      s.camera = Math.max(0, Math.min(7900, p.x - 290));
      setHealth(p.health);
      setCharge(s.charge);
      if ((s.foes.at(-1)?.hp ?? 18) <= 0) setMode("won");
    };
    const draw = (t: number) => {
      if (mode === "playing") {
        const s = game.current;
        if (s) {
          if (!s.last) s.last = t;
          const d = Math.min(0.05, (t - s.last) / 1000);
          s.last = t;
          s.accumulator += d;
          while (s.accumulator >= 1 / 120) {
            step(1 / 120, s);
            s.accumulator -= 1 / 120;
          }
          drawWorld(ctx, s, s.time * 1000);
        }
      } else if (game.current)
        drawWorld(ctx, game.current, game.current.time * 1000);
      else {
        ctx.fillStyle = "#071522";
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 18; i++) {
          ctx.fillStyle = i % 2 ? "#0b2130" : "#0d2636";
          ctx.fillRect(i * 61, 270 + (i % 4) * 19, 48, 250);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, start]);
  useEffect(() => {
    const pause = () => {
      keys.current.clear();
      setMode((m) => (m === "playing" ? "paused" : m));
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", pause);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", pause);
    };
  }, []);
  const s = game.current;
  return (
    <section
      className="pm-game"
      aria-label="Powershell Man game"
      data-game-state={mode}
      data-health={health}
      data-boss-health={bossHp}
      data-charge={charge.toFixed(2)}
      data-player-x={s?.player.x.toFixed(0)}
      data-player-y={s?.player.y.toFixed(0)}
      data-checkpoint={s?.player.checkpoint}
      data-sprites-ready={spritesReady}
      data-hit-count={hits}
    >
      <canvas
        ref={canvas}
        className="pm-canvas"
        aria-label="Game screen. Arrow keys or A and D to move, Z or Space to jump, X to fire, Escape to pause."
      />
      {mode === "playing" && (
        <>
          <div className="pm-hud">
            <div>
              <b>POWERSHELL MAN</b>
              <span>INCIDENT RESPONSE / FIELD OPS</span>
            </div>
            <div className="pm-life">
              <span title="Works on My Machine">HP</span>
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} className={i < health ? "on" : ""} />
              ))}
            </div>
            <div className="pm-charge">
              <span>CHARGE</span>
              <progress max="100" value={charge * 100} />
            </div>
            <span
              className="pm-emergency"
              data-ready={s && s.player.emergencyCooldown <= 0}
            >
              C · SilentlyContinue{" "}
              {s ? `${Math.ceil(s.player.emergencyCooldown)}s` : ""}
            </span>
            <button onClick={() => setMode("paused")} aria-label="Pause">
              Ⅱ
            </button>
          </div>
          {(s?.foes.at(-1)?.x ?? Infinity) - (s?.camera ?? 0) < 900 && (
            <div className="pm-bossbar">
              <span>
                COMMON-SENSE DEVSECOPS ARCHITECT · PHASE{" "}
                {(s?.bossPhase ?? 0) + 1}
                {s?.bossTelegraph ? " · REVIEWING TARGET" : ""}
              </span>
              <progress max="18" value={Math.max(0, bossHp)} />
            </div>
          )}
          <div className="pm-controls">
            ← → move&nbsp;&nbsp; Z jump&nbsp;&nbsp; X fire / release to
            shoot&nbsp;&nbsp; C emergency&nbsp;&nbsp; Esc pause
          </div>
        </>
      )}
      {mode === "story" && <StoryIntro onFinish={start} onSkip={start} />}
      {mode !== "playing" && mode !== "story" && (
        <div
          className={`pm-overlay ${mode === "intro" ? "pm-overlay--intro" : ""}`}
        >
          {mode === "intro" && (
            <img className="pm-title-art" src={titleArt} alt="" />
          )}
          <div className="pm-card">
            <div className="pm-kicker">
              TOIL SYSTEMS // INCIDENT RESPONSE SIMULATOR
            </div>
            <h1>
              {mode === "intro"
                ? "POWERSHELL MAN"
                : mode === "paused"
                  ? "PAUSED"
                  : mode === "won"
                    ? "PRODUCTION RESTORED"
                    : "INCIDENT UNRECOVERED"}
            </h1>
            {mode === "intro" ? (
              <>
                <p>
                  Compile the stack. Replace the vendor release. Hand Packaging
                  the consequences.
                </p>
                <div className="pm-how">
                  <div>
                    <strong>MOVE</strong>
                    <span>← → or A / D</span>
                  </div>
                  <div>
                    <strong>JUMP</strong>
                    <span>Z or Space</span>
                  </div>
                  <div>
                    <strong>FIRE</strong>
                    <span>X · hold to charge</span>
                  </div>
                  <div>
                    <strong>PAUSE</strong>
                    <span>Esc</span>
                  </div>
                </div>
                <p className="pm-threat">
                  Alias gremlins · orphan jobs · profile phantoms · one
                  architect with opinions.
                </p>
                <p className="pm-gamepad-note">
                  GAMEPAD · left stick / D-pad move · A jump · X hold/release
                  fire · B emergency · Start pause
                </p>
                {spriteError && (
                  <p role="alert">
                    The sprite sheet could not load. Reload the page to retry.
                  </p>
                )}
                <button
                  onClick={() => setMode("story")}
                  disabled={!spritesReady}
                >
                  {spritesReady ? "START INCIDENT" : "LOADING SPRITES…"}{" "}
                  <span>↗</span>
                </button>
                <button className="pm-secondary" onClick={onClose}>
                  BACK TO WORK
                </button>
              </>
            ) : mode === "paused" ? (
              <>
                <p>
                  Runbooks can wait. The incident will not progress while
                  paused.
                </p>
                <button
                  onClick={() => {
                    if (s) s.last = 0;
                    setMode("playing");
                  }}
                >
                  RESUME <span>↗</span>
                </button>
                <button className="pm-secondary" onClick={onClose}>
                  EXIT SIMULATOR
                </button>
              </>
            ) : mode === "won" ? (
              <>
                <p>DEPLOYMENT SUCCESSFUL · Fine.</p>
                <p className="pm-joke">
                  The architect approved the deploy. You now own the on-call
                  rotation. Maintenance begins at 02:00.
                </p>
                <button onClick={start}>
                  RUN IT BACK <span>↗</span>
                </button>
                <button className="pm-secondary" onClick={onClose}>
                  BACK TO WORK
                </button>
              </>
            ) : (
              <>
                <p>
                  Emergency SilentlyContinue: the incident got you. Your last
                  checkpoint is still intact.
                </p>
                <button
                  onClick={() => {
                    if (s) {
                      const cp = checkpoints[s.player.checkpoint] ?? 7880;
                      s.player.x = cp + 40;
                      s.player.y = 476;
                      s.player.vy = 0;
                      s.player.health = 8;
                      s.player.invuln = 2;
                      s.shots = [];
                      for (const f of s.foes)
                        if (f.type !== "boss" && f.x < cp) f.hp = 0;
                      setHealth(8);
                      setMode("playing");
                    }
                  }}
                >
                  RESPAWN AT CHECKPOINT <span>↗</span>
                </button>
                <button className="pm-secondary" onClick={start}>
                  RESTART LEVEL · R
                </button>
                <button className="pm-secondary" onClick={onClose}>
                  BACK TO WORK
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
