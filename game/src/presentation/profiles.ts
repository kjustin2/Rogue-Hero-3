import type { ActSetId, ActSetProfile, ActorPresentationProfile, AttackFamily, AttackPresentationProfile, ImpactElement, TrailShape } from "./types";

export const HERO_PRESENTATION: Record<string, ActorPresentationProfile> = {
  blade: { id: "blade", poseLanguage: "disciplined diagonal cuts", trail: "edge", accent: 0x5fe0ff, impact: 0xf5fbff, cameraWeight: 1, percussion: "steel", maxLocalParticles: 14 },
  bulwark: { id: "bulwark", poseLanguage: "planted guard-led cleaves", trail: "cleave", accent: 0xffaa55, impact: 0xffe1b8, cameraWeight: 1.28, percussion: "shield", maxLocalParticles: 16 },
  sparkmage: { id: "sparkmage", poseLanguage: "compressed conduit recoil", trail: "fork", accent: 0xc98fff, impact: 0xf7efff, cameraWeight: 0.82, percussion: "spark", maxLocalParticles: 13 },
  reaver: { id: "reaver", poseLanguage: "forward hooked cuts", trail: "hook", accent: 0xa8323c, impact: 0xffd8d2, cameraWeight: 1.14, percussion: "flesh", maxLocalParticles: 15 },
  tempest: { id: "tempest", poseLanguage: "lateral stormfoot arcs", trail: "cyclone", accent: 0x7df3d0, impact: 0xedfffb, cameraWeight: 0.76, percussion: "wind", maxLocalParticles: 13 },
  revenant: { id: "revenant", poseLanguage: "long hollow reaps", trail: "reap", accent: 0x6affb0, impact: 0xecfff4, cameraWeight: 1.02, percussion: "hollow", maxLocalParticles: 14 },
};

export const ENEMY_ATTACK_FAMILY: Record<string, AttackFamily> = {
  husk: "husk-lunge", spitter: "spitter-bolt", sentinel: "sentinel-lance", swarmer: "swarmer-bite",
  bomber: "bomber-burst", splitter: "splitter-burst", wisp: "wisp-bolt", leaper: "leaper-pounce",
  tether: "tether-fan", mirror: "mirror-slam", caster: "caster-mark", shade: "shade-backstab",
  bastion: "bastion-strike", brute: "brute-charge", harrier: "harrier-bolt", voidling: "voidling-pulse",
  warper: "warper-beam", boss: "boss",
};

export const BOSS_ATTACK_FAMILY: Record<string, AttackFamily> = {
  warden: "warden-claw", spire: "spire-lance", colossus: "colossus-pound", tyrant: "tyrant-rift",
  unmaker: "unmaker-star", echo: "echo-reflection", wound: "wound-rake",
};

export const ATTACK_ELEMENT: Partial<Record<AttackFamily, ImpactElement>> = {
  "sparkmage-conduit": "lightning", "wisp-bolt": "lightning", "spire-lance": "lightning",
  "bomber-burst": "fire", "colossus-pound": "fire", "hazard-flame": "fire",
  "voidling-pulse": "void", "warper-beam": "void", "tyrant-rift": "void", "unmaker-star": "void",
  "echo-reflection": "rift", "wound-rake": "rift", "hazard-rift": "rift", "hazard-drifter": "void",
};

const ALL_ATTACK_FAMILIES: AttackFamily[] = [
  "blade-opener", "blade-return", "blade-finisher", "charged-heavy", "bulwark-cleave", "sparkmage-conduit", "reaver-hook", "tempest-cyclone", "revenant-reap",
  "husk-lunge", "spitter-bolt", "sentinel-lance", "swarmer-bite", "bomber-burst", "splitter-burst", "wisp-bolt", "leaper-pounce", "tether-fan", "mirror-slam", "caster-mark", "shade-backstab", "bastion-strike", "brute-charge", "harrier-bolt", "voidling-pulse", "warper-beam",
  "warden-claw", "spire-lance", "colossus-pound", "tyrant-rift", "unmaker-star", "echo-reflection", "wound-rake",
  "hazard-rift", "hazard-sweeper", "hazard-flame", "hazard-spikes", "hazard-drifter", "enemy-contact", "boss", "card", "crash",
];

function trailFor(family: AttackFamily): TrailShape {
  if (family.includes("cleave")) return "cleave";
  if (family.includes("conduit") || family.includes("lightning")) return "fork";
  if (family.includes("hook") || family.includes("claw") || family.includes("rake")) return "hook";
  if (family.includes("cyclone")) return "cyclone";
  if (family.includes("reap")) return "reap";
  if (family.includes("bolt") || family.includes("beam") || family.includes("lance") || family.includes("sweeper")) return "bolt";
  if (family.includes("fan") || family.includes("charge") || family.includes("pounce") || family.includes("backstab")) return "lane";
  if (family.includes("burst") || family.includes("pulse") || family.includes("pound") || family.includes("slam") || family === "crash") return "nova";
  return "edge";
}

export const ATTACK_PRESENTATION = Object.fromEntries(ALL_ATTACK_FAMILIES.map((family): [AttackFamily, AttackPresentationProfile] => {
  const element = ATTACK_ELEMENT[family] ?? "steel";
  const heavy = family.includes("finisher") || family.includes("cleave") || family.includes("pound") || family.includes("slam") || family.includes("charge") || family === "crash";
  const accent = element === "fire" ? 0xe58b45 : element === "lightning" ? 0x91ddd5 : element === "void" ? 0x9a82bc : element === "rift" ? 0xb07086 : 0xb9c5cc;
  return [family, {
    family, trail: trailFor(family), accent, contactCore: 0xffffff,
    particleScale: heavy ? 1.08 : family.includes("hazard") ? 0.72 : 0.9,
    shardSpread: heavy ? 0.78 : 0.5,
    cameraWeight: heavy ? 1.16 : family.includes("hazard") ? 0.72 : 0.92,
    sound: element === "lightning" ? "spark" : element === "void" ? "void" : element === "fire" ? "rupture" : heavy ? "crush" : "slice",
  }];
})) as Record<AttackFamily, AttackPresentationProfile>;

const ENEMY_POSE: Record<string, string> = {
  husk: "weighted lunge", spitter: "body compression and recoil", swarmer: "skitter and bite", bomber: "fuse swell and burst", splitter: "gooey drag and rupture", sentinel: "braced lance commitment",
  wisp: "hover compression and bolt recoil", leaper: "stalk crouch launch landing", tether: "planted three-lane channel", mirror: "shield presentation and exposed slam", caster: "blink mark recoil rematerialize", shade: "fade rear strike reveal",
  bastion: "braced advance and frontal deflection", brute: "weighted lane charge", harrier: "banking aerial strafe", voidling: "unstable pulse collapse", warper: "directional tear and snap-back",
};

export const ENEMY_PRESENTATION = Object.fromEntries(Object.entries(ENEMY_ATTACK_FAMILY).filter(([id]) => id !== "boss").map(([id, family]): [string, ActorPresentationProfile] => {
  const attack = ATTACK_PRESENTATION[family];
  return [id, { id, poseLanguage: ENEMY_POSE[id] ?? "committed hostile motion", trail: attack.trail, accent: attack.accent, impact: attack.contactCore, cameraWeight: attack.cameraWeight, percussion: attack.sound === "crush" ? "stone" : attack.sound === "spark" ? "spark" : attack.sound === "void" ? "rift" : "flesh", maxLocalParticles: Math.round(12 * attack.particleScale) }];
}));

export const BOSS_PRESENTATION = Object.fromEntries(Object.entries(BOSS_ATTACK_FAMILY).map(([id, family]): [string, ActorPresentationProfile] => {
  const attack = ATTACK_PRESENTATION[family];
  return [id, { id, poseLanguage: `${id} authored entrance, commitment and phase recovery`, trail: attack.trail, accent: attack.accent, impact: attack.contactCore, cameraWeight: Math.min(1.3, attack.cameraWeight + 0.08), percussion: attack.sound === "crush" ? "stone" : attack.sound === "spark" ? "spark" : "rift", maxLocalParticles: 16 }];
}));

export const ACT_SET_PROFILES: Record<ActSetId, ActSetProfile> = {
  rift: { id: "rift", act: 1, name: "Rift Basilica", accent: 0xff6a35, secondary: 0x795044, stone: 0x171521, emissive: 0xffb35c, mapSilhouette: "basilica", ambientMotion: 0.22, seed: 0x14b15ca },
  spire: { id: "spire", act: 2, name: "Shattered Spire", accent: 0x42d7bd, secondary: 0x5d78a6, stone: 0x10191d, emissive: 0x9edfd5, mapSilhouette: "spire", ambientMotion: 0.36, seed: 0x5a17e12 },
  forge: { id: "forge", act: 3, name: "Molten Core", accent: 0xd27a2c, secondary: 0x754228, stone: 0x1b1513, emissive: 0xffc070, mapSilhouette: "foundry", ambientMotion: 0.28, seed: 0xf04e333 },
  abyss: { id: "abyss", act: 4, name: "Sundered Abyss", accent: 0x8468bd, secondary: 0x55758a, stone: 0x11111a, emissive: 0xc4b9e8, mapSilhouette: "causeway", ambientMotion: 0.18, seed: 0xab15544 },
  hollow: { id: "hollow", act: 5, name: "Hollow Star", accent: 0xc1b5d8, secondary: 0x82765f, stone: 0x151319, emissive: 0xf0e9dc, mapSilhouette: "observatory", ambientMotion: 0.14, seed: 0x5011055 },
  echo: { id: "echo", act: 4, name: "Rift Reflection", accent: 0x5d9ec8, secondary: 0x9b6aa7, stone: 0x11141b, emissive: 0xd9f5ff, mapSilhouette: "reflection", ambientMotion: 0.24, seed: 0xec40066 },
  wound: { id: "wound", act: 5, name: "Wound Beneath", accent: 0xa83a49, secondary: 0xc5b7a7, stone: 0x120d10, emissive: 0xf1ded8, mapSilhouette: "underworld", ambientMotion: 0.12, seed: 0x7000d77 },
};

export function heroAttackFamily(heroId: string): AttackFamily {
  if (heroId === "bulwark") return "bulwark-cleave";
  if (heroId === "sparkmage") return "sparkmage-conduit";
  if (heroId === "reaver") return "reaver-hook";
  if (heroId === "tempest") return "tempest-cyclone";
  if (heroId === "revenant") return "revenant-reap";
  return "blade-opener";
}

export function actSetFor(act: number, bossKind?: string): ActSetId {
  if (bossKind === "echo") return "echo";
  if (bossKind === "wound") return "wound";
  return act === 2 ? "spire" : act === 3 ? "forge" : act === 4 ? "abyss" : act === 5 ? "hollow" : "rift";
}
