export type AttackFamily =
  | "blade-opener" | "blade-return" | "blade-finisher" | "charged-heavy" | "dash-strike"
  | "husk-lunge" | "spitter-bolt" | "sentinel-lance" | "swarmer-bite" | "bomber-burst" | "splitter-burst"
  | "wisp-bolt" | "leaper-pounce" | "tether-fan" | "mirror-slam" | "caster-mark"
  | "shade-backstab" | "bastion-strike" | "brute-charge" | "harrier-bolt" | "voidling-pulse" | "warper-beam"
  | "warden-claw" | "spire-lance" | "colossus-pound" | "tyrant-rift" | "unmaker-star"
  | "echo-reflection" | "wound-rake" | "hazard-rift" | "hazard-sweeper" | "hazard-flame"
  | "hazard-spikes" | "hazard-drifter" | "enemy-contact" | "boss" | "card" | "crash";

export type ActSetId = "rift" | "spire" | "forge" | "abyss" | "hollow" | "echo" | "wound";
export type ActComposition = "combat" | "elite" | "boss" | "noncombat";
export type TrailShape = "edge" | "cleave" | "fork" | "hook" | "cyclone" | "reap" | "bolt" | "lane" | "nova";

export interface ActorPresentationProfile {
  id: string;
  poseLanguage: string;
  trail: TrailShape;
  accent: number;
  impact: number;
  cameraWeight: number;
  percussion: "steel" | "shield" | "spark" | "flesh" | "wind" | "hollow" | "stone" | "rift";
  maxLocalParticles: number;
}

export interface AttackPresentationProfile {
  family: AttackFamily;
  trail: TrailShape;
  accent: number;
  contactCore: number;
  particleScale: number;
  shardSpread: number;
  cameraWeight: number;
  sound: "slice" | "crush" | "spark" | "rupture" | "void";
}

export interface ActSetProfile {
  id: ActSetId;
  act: number;
  name: string;
  accent: number;
  secondary: number;
  stone: number;
  emissive: number;
  mapSilhouette: "basilica" | "spire" | "foundry" | "causeway" | "observatory" | "reflection" | "underworld";
  ambientMotion: number;
  seed: number;
}

export type ImpactStrength = "light" | "heavy" | "critical" | "execute";
export type ImpactElement = "steel" | "rift" | "fire" | "frost" | "lightning" | "void" | "blood";

/** One resolved hit, consumed by VFX, camera, audio and UI. */
export interface ImpactCue {
  sourceId: string;
  sourceKind: string;
  targetId: string;
  targetKind: string;
  attackFamily: AttackFamily;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  damage: number;
  color: number;
  strength: ImpactStrength;
  element: ImpactElement;
  shielded: boolean;
  killed: boolean;
  sustained?: boolean;
}

export type PresentationPriority = "ambient" | "action" | "critical" | "telegraph";
export interface PresentationBudget {
  priority: PresentationPriority;
  maxActive: number;
  maxParticles: number;
  coverage: "tiny" | "local" | "wide";
}

export type CinematicBeat =
  | { at: number; type: "camera"; x: number; z: number; zoom: number; preset?: "wide" | "hero" | "threat" | "low-reveal" | "handoff"; duration?: number; easing?: "linear" | "smooth" | "dramatic" }
  | { at: number; type: "hero-reaction"; x: number; z: number }
  | { at: number; type: "boss-action"; action: "gate" | "drop" | "land" | "drag" | "roar" | "phase" | "last-stand" | "manifest" | "channel" | "shatter" | "ignite" | "tear" | "mirror" | "rise" | "strip" }
  | { at: number; type: "impact"; cue: ImpactCue }
  | { at: number; type: "title"; title: string; subtitle: string; className: string }
  | { at: number; type: "letterbox"; on: boolean }
  | { at: number; type: "hud"; hidden: boolean }
  | { at: number; type: "environment"; dim: number }
  | { at: number; type: "sound"; cue: "riser" | "roar" | "sting" };

export interface CinematicSequence {
  id: string;
  duration: number;
  beats: CinematicBeat[];
  onFinish?: () => void;
}
