import { describe, expect, it } from 'vitest';
import { getTotalWorkshopSpent, runModsFromUpgrades, SPECIALIZATIONS } from '../../src/app/meta';
import { loadSave } from '../../src/app/save';
import { OVERLIMIT_RESONANCES } from '../../src/config/blitz';
import { spawnSectorBoss } from '../../src/sim/bosses';
import { spawnReflector, syncActiveFusions } from '../../src/sim/competition';
import { spawnEnemy } from '../../src/sim/enemies';
import { applyFiringRangeCommand, computeRangeFrontCounterMult } from '../../src/sim/firingRange';
import {
  buildSimSnapshot,
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';
import type { SimEvent } from '../../src/types/game';

describe('V19 AAA Five-Stage Overhaul — Simulation, Resonance, Boss Subsystems & Firing Range', () => {
  it('Stage 2: Boss Phase-2 transition unveils 3rd reactor subsystem, spawns arena reflectors, and reactor break collapses shield', () => {
    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { layoutSeed: 202619 });
    const events: SimEvent[] = [];
    const boss = spawnSectorBoss(w, events);
    boss.introProgress = 1.0;

    expect(boss.parts.length).toBe(2);

    boss.shielded = false;
    for (const p of boss.pylons) p.destroyed = true;
    boss.hp = Math.floor(boss.maxHp * 0.505);
    w.squadCount = 150;
    w.weapon = 'rail';
    w.weaponLevel = 3;
    w.learnedWeaponLevels.rail = 3;
    reconcileFormationAndDps(w);

    let phaseBreakEvt: SimEvent | undefined;
    for (let i = 0; i < 60; i++) {
      w.squadX = boss.x;
      const evs = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
      const found = evs.find((e) => e.type === 'BOSS_PHASE_BREAK');
      if (found) {
        phaseBreakEvt = found;
        break;
      }
    }
    expect(phaseBreakEvt).toBeDefined();
    if (phaseBreakEvt && phaseBreakEvt.type === 'BOSS_PHASE_BREAK') {
      expect(phaseBreakEvt.arenaShift).toBeTruthy();
    }

    expect(boss.parts.length).toBe(3);
    const reactor = boss.parts.find((p) => p.slot === 'reactor');
    expect(reactor).toBeDefined();
    expect(reactor!.destroyed).toBe(false);
    expect(w.reflectors.length).toBeGreaterThanOrEqual(2);

    w.gatePool.releaseAll(w.gates);
    w.reflectors.length = 0;
    w.enemyPool.releaseAll(w.enemies);
    boss.shielded = true;
    const lensesBefore = w.lenses.filter((l) => l.active).length;
    reactor!.hp = 8;
    let brokeReactor = false;
    for (let i = 0; i < 75; i++) {
      w.squadX = reactor!.x;
      const evs = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'BOSS_PART_BREAK' && e.slot === 'reactor')) {
        brokeReactor = true;
        break;
      }
    }
    expect(brokeReactor).toBe(true);
    expect(boss.shielded).toBe(false);
    expect(w.lenses.filter((l) => l.active).length).toBeGreaterThan(lensesBefore);
  });

  it('Stage 3: Overlimit Dual-Weapon Resonance covers all 10 pairs and triggers reflector chain-arcs', () => {
    expect(Object.keys(OVERLIMIT_RESONANCES).length).toBe(10);

    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { layoutSeed: 202620 });
    w.squadCount = 100;
    w.stats.vaultsCracked = 2;

    w.activeLoadout = ['pulse', 'rail'];
    w.weapon = 'rail';
    w.weaponLevel = 1;
    w.learnedWeaponLevels.pulse = 2;
    w.learnedWeaponLevels.rail = 1;
    syncActiveFusions(w);
    expect(w.activeDualSynergy).not.toBeNull();
    expect(w.overlimitResonance).toBeNull();

    // Cultivated Dual Loadout (pulse Lv.2 + rail Lv.3 => sum >= 5) -> unlocks `prism_arc_lattice`!
    w.learnedWeaponLevels.pulse = 2;
    w.learnedWeaponLevels.rail = 3;
    w.weaponLevel = 3;
    syncActiveFusions(w);
    expect(w.overlimitResonance).toBe('prism_arc_lattice');

    w.gatePool.releaseAll(w.gates);
    w.enemyPool.releaseAll(w.enemies);
    w.spawnCursor = 999999;
    w.weapon = 'pulse';
    w.weaponLevel = 3;
    const ref = spawnReflector(w, 0, -4.0, 0, 1);
    ref.angleDeg = 38;
    const e1 = spawnEnemy(w, 'phalanx', 3.1, -6.2, { hp: 2500 });
    const e2 = spawnEnemy(w, 'glacier', -3.1, -6.8, { hp: 2500 });
    reconcileFormationAndDps(w);
    const fusionDmgBefore = w.damageBySource.fusions;
    let chainArcs = 0;
    for (let i = 0; i < 45; i++) {
      w.squadX = 0;
      const evs = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
      chainArcs += evs.filter((e) => e.type === 'CHAIN_ARC').length;
    }
    expect(chainArcs).toBeGreaterThan(0);
    expect(w.damageBySource.fusions).toBeGreaterThan(fusionDmgBefore);
    expect(e1.hp + e2.hp).toBeLessThan(5000);

    w.activeLoadout = ['scatter', 'plasma'];
    w.weapon = 'plasma';
    w.learnedWeaponLevels.scatter = 3;
    w.learnedWeaponLevels.plasma = 3;
    syncActiveFusions(w);
    expect(w.overlimitResonance).toBe('gravity_lens_well');

    w.activeLoadout = ['cryo', 'plasma'];
    w.weapon = 'cryo';
    w.learnedWeaponLevels.cryo = 2;
    syncActiveFusions(w);
    expect(w.overlimitResonance).toBe('cryo_thermo_shatter');
  });

  it('Stage 3 & 4: Workshop Specialization branches refund 100%, isolate cleanly in Fair Trial, and normalize custom keybinds', () => {
    expect(SPECIALIZATIONS.length).toBe(3);
    const mods = runModsFromUpgrades(
      { squad: 2, power: 1 },
      1,
      { spec_ricochet: 2, spec_vortex: 3, spec_shatter: 1 },
    );
    expect(mods.specRicochet).toBe(2);
    expect(mods.specVortex).toBe(3);
    expect(mods.specShatter).toBe(1);

    const baseSpent = getTotalWorkshopSpent({ squad: 2, power: 1, reso: 0, aegis: 0, crit: 0, bounty: 0 }, 1);
    const fullSpent = getTotalWorkshopSpent(
      { squad: 2, power: 1, reso: 0, aegis: 0, crit: 0, bounty: 0 },
      1,
      { spec_ricochet: 2, spec_vortex: 1, spec_shatter: 0 },
    );
    expect(fullSpent - baseSpent).toBe(80 + 150 + 80);

    const fairWorld = createSimWorld();
    resetSimWorldForSector(fairWorld, 1, {
      ...mods,
      blitz: true,
      fairTrial: true,
      layoutSeed: 202611,
    });
    expect(fairWorld.mods.specRicochet).toBe(0);
    expect(fairWorld.mods.specVortex).toBe(0);
    expect(fairWorld.mods.specShatter).toBe(0);

    const prevLS = (globalThis as Record<string, unknown>).localStorage;
    const mockStorage = {
      data: new Map<string, string>([
        [
          'prism-swarm-save-v1',
          JSON.stringify({
            version: 1,
            cores: 500,
            specializations: { spec_ricochet: 2, spec_vortex: 99 },
            keybinds: { swapWeapon: 'q', overdrive: 'f' },
          }),
        ],
      ]),
      getItem(k: string) {
        return this.data.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        this.data.set(k, v);
      },
    };
    try {
      (globalThis as Record<string, unknown>).localStorage = mockStorage;
      const loaded = loadSave();
      expect(loaded.specializations.spec_ricochet).toBe(2);
      expect(loaded.specializations.spec_vortex).toBe(3);
      expect(loaded.specializations.spec_shatter).toBe(0);
      expect(loaded.keybinds.swapWeapon).toBe('q');
      expect(loaded.keybinds.overdrive).toBe('f');
      expect(loaded.keybinds.moveLeft).toBe('a');
    } finally {
      (globalThis as Record<string, unknown>).localStorage = prevLS;
    }
  });

  it('Stage 5: Holographic Tactical Firing Range switches dual weapons, adjusts reflector angle, and computes live realized DPS & counter multiplier', () => {
    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { firingRange: true, layoutSeed: 202619 });
    expect(w.isFiringRange).toBe(true);
    expect(w.reflectors.length).toBeGreaterThanOrEqual(1);

    applyFiringRangeCommand(w, { leadWeapon: 'rail', partnerWeapon: 'pulse', reflectorAngle: -42, overlimit: true });
    reconcileFormationAndDps(w);
    expect(w.weapon).toBe('rail');
    expect(w.activeLoadout).toContain('rail');
    expect(w.activeLoadout).toContain('pulse');
    expect(w.reflectors[0]!.angleDeg).toBe(-42);
    expect(w.overlimitResonance).toBe('prism_arc_lattice');
    expect(computeRangeFrontCounterMult(w)).toBeGreaterThan(1.4);

    for (let i = 0; i < 90; i++) {
      w.squadX = 0;
      stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
    }
    const snap = buildSimSnapshot(w);
    expect(snap.isFiringRange).toBe(true);
    expect(snap.rangeRealizedDps).toBeGreaterThan(0);
    expect(w.phase).toBe('PLAYING');

    applyFiringRangeCommand(w, { preset: 'boss_dummy' });
    expect(w.boss).not.toBeNull();
    expect(w.boss!.parts.length).toBe(3);
  });
});
