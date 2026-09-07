/** Per-target, simulation-clock combo. A charged hit spends an already exposed seam. */
export class Unravel {
  private channel: "blade" | "ability" | null = null;
  private memory = 0;
  private recovery = 0;
  exposed = 0;

  update(dt: number): void {
    this.memory = Math.max(0, this.memory - dt);
    this.recovery = Math.max(0, this.recovery - dt);
    this.exposed = Math.max(0, this.exposed - dt);
    if (!this.memory) this.channel = null;
  }

  hit(channel: "blade" | "ability", duration = 3): boolean {
    if (this.recovery || this.exposed) return false;
    if (this.channel && this.channel !== channel) {
      this.exposed = duration;
      this.channel = null;
      this.memory = 0;
      return true;
    }
    this.channel = channel;
    this.memory = 4;
    return false;
  }

  consume(): void {
    this.exposed = this.memory = 0;
    this.channel = null;
    this.recovery = 3;
  }
}
