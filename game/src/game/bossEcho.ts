import * as THREE from "three";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";
import { forgeHero, type HeroRig } from "../render/heroForge";
import { batchSculpt } from "../render/sculpt";
import { ARENA_RADIUS } from "../render/arena";

const ECHO_CORE = 0x9fe8ff;
const ECHO_EDGE = 0x3aa0ff;

const PHASE_LINES = [
  "I AM WHAT THE RIFT REMEMBERS OF YOU. FASTER. CRUELER.",
  "YOU CANNOT OUTRUN YOUR OWN REFLECTION.",
];

const LANE_LEN = 11;
const LANE_W = 2.2;
const LANE_TELL = 0.6;

type EchoState = "idle" | "lungeTell" | "lunge" | "novaTell" | "recover" | "phaseShift" | "guard";

interface PendingNova { x: number; z: number; count: number; timer: number; }

/**
 * The Rift Echo — a hidden superboss (an optional "Rift Tear" node in Acts IV–V): a
 * fast spectral duelist that mirrors the hero. Two telegraphed attacks — a dashing
 * lane-strike and a radial bolt nova — escalating across two phases. Phase two
 * chains two separately telegraphed lunges before a committed recovery.
 */
export class RiftEcho extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: EchoState = "idle";
  private timer = 1.4;
  private attackPick = 0;
  private novas: PendingNova[] = [];
  private lockAngle = 0;

  private rig: HeroRig;
  private model = new THREE.Group();
  private echo: THREE.Group;
  private echoMat = new THREE.MeshBasicMaterial({ color: 0x87b5d0, transparent: true, opacity: 0.13, depthWrite: false });
  private echoJoints: { source: THREE.Object3D; target: THREE.Object3D }[] = [];
  private dashRemaining = 0;
  private dashHit = false;
  private lungesRemaining = 0;
  private stride = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 1750;
    this.speed = 4.8;
    this.radius = 1.3;
    this.wardColor = ECHO_CORE;

    // The reflection wears the selected hero's actual armor and weapon silhouette.
    const hero = { ...ctx.player.hero, plate: 0x8b9eaf, plateDark: 0x293642, trim: 0xc5d4df, trimEmissive: ECHO_CORE };
    this.model.scale.set(1.65 * hero.bulk, 1.65, 1.65 * hero.bulk);
    this.root.add(this.model);
    this.rig = forgeHero(this.model, hero, 0x55758c, ECHO_CORE);
    for(const node of [this.rig.kneeR,this.rig.kneeL]) this.footContacts.push({node,offset:new THREE.Vector3(0,-.445,.075),radius:.15});
    for (const mat of this.rig.flashMaterials) this.registerFlash(mat);
    this.registerFlash(this.rig.eyes);
    this.bindCinematicParts([this.rig.torso,this.rig.armL,this.rig.armR,this.rig.elbowL,this.rig.elbowR,this.rig.legL,this.rig.legR,this.rig.sword]);
    this.rig.sword.rotation.x = 0.85;
    batchSculpt(this.model, [this.rig.cape]);
    this.echo = this.model.clone(true);
    this.echo.position.z = -0.7;
    this.echo.visible = false;
    const sources: THREE.Object3D[] = [], targets: THREE.Object3D[] = [];
    this.model.traverse(o => sources.push(o));
    this.echo.traverse(o => {
      targets.push(o);
      if (o instanceof THREE.Mesh) { o.material = this.echoMat; o.castShadow = false; o.receiveShadow = false; o.userData.castShadow = false; }
    });
    for(let i=1;i<sources.length;i++) this.echoJoints.push({source:sources[i],target:targets[i]});
    this.root.add(this.echo);
    this.animateDuelist(0.25);
  }

  interruptAttack(): void {
    super.interruptAttack();
    this.novas = []; this.dashRemaining = 0; this.lungesRemaining = 0;
  }

  protected onGuardBroken(): void {
    this.state = "recover";
    this.timer = 1.35;
  }

  protected animateCinematic(action: string, time: number, dt: number): boolean {
    const r = this.rig, draw = Math.min(1,time/0.36), k = Math.min(1,dt*16);
    const challenge=action==="mirror"||action==="phase";
    const sweep=challenge?Math.sin(Math.min(1,Math.max(0,(time-.3)/.54))*Math.PI):0;
    const turn = (o: THREE.Object3D,x: number,y: number,z: number) => {
      o.rotation.x += (x-o.rotation.x)*k; o.rotation.y += (y-o.rotation.y)*k; o.rotation.z += (z-o.rotation.z)*k;
    };
    turn(r.torso,0.035,-0.28+sweep*.55,0);
    turn(r.armR,-0.55-draw*0.6-sweep*.35,-0.2+sweep*1.45,0.28-sweep*.38);
    turn(r.elbowR,-0.5,0,0);
    turn(r.armL,-0.6,0,-0.35);
    turn(r.elbowL,-0.2,0,0);
    turn(r.legR,-0.08,0,-0.08); turn(r.legL,0.08,0,0.08);
    r.sword.rotation.x += (-0.12-r.sword.rotation.x)*k;
    this.echo.visible = this.phase >= 2 || (challenge&&time>.3&&time<1.1);
    if (this.echo.visible) {
      this.echo.position.z = -0.65; this.echo.position.x=-sweep*.65;this.echoMat.opacity = .06+sweep*.09;
      for (const pair of this.echoJoints) pair.target.quaternion.copy(pair.source.quaternion);
    }
    this.drivePose(dt,{lunge:0.025});
    return true;
  }

  protected restoreCinematicPose(): void {
    this.echo.visible=this.phase>=2;this.echo.position.set(0,0,-.7);this.echoMat.opacity=.13;
  }

  protected deathColor(): number { return ECHO_CORE; }
  protected animateDeath(dt: number, progress: number): boolean {
    this.echo.visible = false;
    const sink = Math.min(1, progress / .48);
    this.root.position.y -= sink * sink * (3 - 2 * sink) * .5;
    this.settleDeathPart(this.root, dt, 0, this.root.rotation.y, 0);
    const r = this.rig;
    this.settleDeathPart(r.torso, dt, .23, -.12, -.05);
    this.settleDeathPart(r.legR, dt, -1.2, 0, -.08);
    this.settleDeathPart(r.kneeR, dt, 1.5, 0, 0);
    this.settleDeathPart(r.legL, dt, -.5, 0, .1);
    this.settleDeathPart(r.kneeL, dt, 1.25, 0, 0);
    this.settleDeathPart(r.armR, dt, -.65, -.15, .22);
    this.settleDeathPart(r.elbowR, dt, -.25, 0, 0);
    this.settleDeathPart(r.armL, dt, .13, 0, -.18);
    this.settleDeathPart(r.elbowL, dt, -.14, 0, 0);
    this.settleDeathPart(r.sword, dt, 1.6, 0, 0);
    return true;
  }
  protected barHeight(): number { return 4.2; }

  takeDamage(amount: number, opts = {}): boolean {
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });
    if (!killed && this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      this.interruptAttack();
      this.state = "phaseShift";
      this.timer = 1.1;
      this.speed = 6.2;
      this.setBossScale(1.08);
      this.novas = [];
      this.dashRemaining = 0;
      this.lungesRemaining = 0;
      this.rig.eyes.emissive.set(0xe3f5ff);
      this.rig.eyes.emissiveIntensity = 1.8;
      for (const f of this.flashMats) { f.baseEmissive.copy(f.mat.emissive); f.baseIntensity = f.mat.emissiveIntensity; }
      this.ctx.events.emit("BOSS_PHASE", { phase: 2, line: PHASE_LINES[1] });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 9, color: ECHO_CORE, duration: 0.7 });
      this.ctx.cam.addTrauma(0.5);
      this.ctx.sfx.bossRoar();
    }
    return killed;
  }

  freeze(duration: number): void { super.freeze(duration * 0.4); }

  die(): void {
    if (!this.alive) return;
    this.dashRemaining = 0;
    this.novas = [];
    super.die();
    this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
  }

  // ---------------------------------------------------------------- attacks
  private beginLunge(followUp = false): void {
    this.state = "lungeTell";
    this.timer = followUp ? 0.5 : LANE_TELL;
    if (!followUp) this.lungesRemaining = this.phase >= 2 ? 2 : 1;
    const p = this.ctx.player;
    this.lockAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    this.heading = this.lockAngle;
    this.warnLine(this.pos.x, this.pos.z, this.lockAngle, LANE_LEN, LANE_W, this.timer, ECHO_CORE);
    this.ctx.sfx.beamCharge();
  }

  private startDash(): void {
    this.state = "lunge";
    this.dashRemaining = LANE_LEN;
    this.dashHit = false;
    this.lungesRemaining--;
    this.ctx.sfx.beamFire();
  }

  private advanceDash(dt: number): void {
    const distance = Math.min(this.dashRemaining, dt * 38);
    const steps = Math.max(1, Math.ceil(distance / 0.24));
    const step = distance / steps, sx = Math.sin(this.lockAngle), cz = Math.cos(this.lockAngle);
    const p = this.ctx.player;
    for(let i=0;i<steps && this.dashRemaining>0;i++) {
      const x=this.pos.x,z=this.pos.z;
      this.pos.x += sx*step;this.pos.z += cz*step;
      this.ctx.arena.resolveObstacles(this.pos,this.radius);
      const d=Math.hypot(this.pos.x,this.pos.z),limit=ARENA_RADIUS-this.radius;
      if(d>limit) {this.pos.x*=limit/d;this.pos.z*=limit/d;}
      const dx=this.pos.x-x,dz=this.pos.z-z,length2=dx*dx+dz*dz;
      // Hit only along the body's resolved travel, never through a pillar or behind the landing.
      const along=length2>0?Math.max(0,Math.min(1,((p.pos.x-x)*dx+(p.pos.z-z)*dz)/length2)):0;
      if(!this.dashHit && Math.hypot(p.pos.x-x-dx*along,p.pos.z-z-dz*along)<LANE_W*0.5+p.radius) {
        this.dashHit=true;
        this.ctx.combat.damagePlayer(this.phase>=2?20:16,x,z);
      }
      this.dashRemaining-=step;
      if(Math.hypot(dx-sx*step,dz-cz*step)>0.08) this.dashRemaining=0;
    }
    if(this.dashRemaining<=0) {
      this.state="recover";this.timer=this.lungesRemaining>0?0.24:0.78;
      this.ctx.fx.burst({x:this.pos.x,y:0.2,z:this.pos.z,count:8,color:[ECHO_CORE,0x737d88],speed:[1,3],up:0.5,size:[0.08,0.22],life:[0.15,0.3],gravity:-4,drag:3});
    }
  }

  dispose(): void {
    for(const texture of this.rig.textures) texture.dispose();
    super.dispose();
  }

  private beginNova(): void {
    this.state = "novaTell";
    this.timer = 0.7;
    const count = this.phase >= 2 ? 18 : 12;
    this.warnCircle(this.pos.x, this.pos.z, 3.0, 0.7, ECHO_EDGE);
    this.novas.push({ x: this.pos.x, z: this.pos.z, count, timer: 0.7 });
    this.ctx.sfx.beamCharge();
  }

  private fireNova(nv: PendingNova): void {
    const base = Math.atan2(this.ctx.player.pos.x - nv.x, this.ctx.player.pos.z - nv.z);
    for (let i = 0; i < nv.count; i++) {
      const a = base + (i / nv.count) * Math.PI * 2;
      this.ctx.hostiles.fire(nv.x, nv.z, a, { speed: 9, dmg: 8, color: ECHO_EDGE, radius: 0.3 });
    }
    this.ctx.fx.ring(nv.x, nv.z, { radius: 3, color: ECHO_EDGE, duration: 0.4 });
    this.ctx.cam.addTrauma(0.2);
    this.ctx.sfx.enemyShoot();
  }

  // ---------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.pos.y = 0;
    this.animateDuelist(dt);

    for (let i = this.novas.length - 1; i >= 0; i--) {
      this.novas[i].timer -= dt;
      if (this.novas[i].timer <= 0) { this.fireNova(this.novas[i]); this.novas.splice(i, 1); }
    }
    // Dramatic weight: coil on tells/guard, lunge on commits, rear on the phase shift.
    this.poseForState(dt, this.state, this.state === "idle");

    switch (this.state) {
      case "idle": {
        const d = this.distToPlayer();
        this.facePlayer(dt);
        if (d > 6) this.seek(p.pos.x, p.pos.z, dt, 0.92);
        else { const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + 0.8 * dt; this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.58); }
        if (this.timer <= 0) this.pickAttack();
        break;
      }
      case "lungeTell":
        if (this.timer <= 0) this.startDash();
        break;
      case "lunge":
        this.advanceDash(dt);
        break;
      case "novaTell":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0 && this.novas.length === 0) { this.state = "recover"; this.timer = 0.42; }
        break;
      case "guard":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0) { this.wardShock(4.2, 16, ECHO_CORE); this.state = "recover"; this.timer = 0.7; }
        break;
      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) {
          if(this.lungesRemaining>0) this.beginLunge(true);
          else {this.state="idle";this.timer=Math.max(0.28,0.8-this.phase*0.16);}
        }
        break;
    }
  }

  private animateDuelist(dt: number): void {
    const r=this.rig,tell=this.state==="lungeTell",dash=this.state==="lunge";
    const cast=this.state==="novaTell"||this.state==="guard";
    const k=Math.min(1,dt*16),walk=this.state==="idle"?1:0;
    this.stride+=dt*(walk?this.speed*2.2:2);
    const stride=Math.sin(this.stride)*0.43*walk;
    const turn=(o:THREE.Object3D,x:number,y:number,z:number)=>{o.rotation.x+=(x-o.rotation.x)*k;o.rotation.y+=(y-o.rotation.y)*k;o.rotation.z+=(z-o.rotation.z)*k;};
    turn(r.torso,dash?0.16:tell?-0.1:0,tell?0.65:dash?-0.4:0,0);
    turn(r.armR,tell?-1.68:dash?-1.4:cast?-1.9:-0.48,tell?-0.6:dash?0.16:0,tell?0.62:dash?-0.25:0.14);
    turn(r.armL,cast?-1.4:dash?-0.25:-0.68,0,cast?-0.58:-0.3);
    turn(r.elbowR,tell?-0.85:dash?-0.05:-0.24,0,0);
    turn(r.elbowL,cast?-0.4:-0.12,0,0);
    turn(r.legR,dash?-0.35:stride,0,dash?-0.16:0);
    turn(r.legL,dash?0.32:-stride,0,dash?0.16:0);
    turn(r.kneeR,Math.max(0,-stride)*0.9,0,0);
    turn(r.kneeL,Math.max(0,stride)*0.9,0,0);
    r.sword.rotation.x+=((dash?1.3:tell?0.15:0.85)-r.sword.rotation.x)*k;
    const positions=r.cape.geometry.getAttribute("position") as THREE.BufferAttribute;
    for(let i=0;i<positions.count;i++) {
      const x=r.capeRest[i*3],y=r.capeRest[i*3+1],z=r.capeRest[i*3+2],hang=Math.max(0,-y);
      positions.setXYZ(i,x+Math.sin(this.t*3+hang*4)*hang*0.035,y,z-Math.sin(this.t*3.5+hang*5+x)*hang*0.065-(dash?hang*0.2:0));
    }
    positions.needsUpdate=true;r.cape.geometry.computeVertexNormals();
    this.echo.visible=dash||(this.phase>=2&&(tell||this.state==="phaseShift"));
    if(this.echo.visible) {
      this.echo.position.z=dash?-1.15:-0.65;
      this.echoMat.opacity=dash?0.19:0.1;
      for(const pair of this.echoJoints) {pair.target.quaternion.copy(pair.source.quaternion);pair.target.scale.copy(pair.source.scale);}
    }
  }

  private pickAttack(): void {
    this.attackPick++;
    // A phase ward every 3rd attack — a quick invulnerable blink + close nova.
    if (this.attackPick % 3 === 2) { this.beginGuard(); return; }
    if (this.attackPick % 2 === 0) this.beginLunge();
    else this.beginNova();
  }

  /** Phase ward: a fast invulnerable flicker, then a close nova that punishes hugging. */
  private beginGuard(): void {
    this.raiseGuard();
    this.state = "guard";
    this.timer = 0.82; // wind-up = telegraph duration
    this.warnCircle(this.pos.x, this.pos.z, 4.2, 0.82, ECHO_CORE);
    this.ctx.sfx.beamCharge();
  }
}
