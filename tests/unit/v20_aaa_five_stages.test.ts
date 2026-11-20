import { describe, expect, it } from 'vitest';
import { getTotalWorkshopSpent, OVERCLOCK_CHIPS, runModsFromUpgrades } from '../../src/app/meta';
import { matchOverlimitResonance, OVERLIMIT_RESONANCES } from '../../src/config/blitz';
import { createSimulation, verifyDeterministicReplay } from '../../src/sim/index';
import { spawnSectorBoss } from '../../src/sim/bosses';
import { syncActiveFusions } from '../../src/sim/competition';
import { spawnEnemy } from '../../src/sim/enemies';
import { applyFiringRangeCommand } from '../../src/sim/firingRange';
import {
  chargeCapacitorTower,
  registerOmegaReflectorHitOnBoss,
  spawnCapacitorTower,
  spawnCoreShard,
  spawnMagRail,
  spawnPhaseGate,
} from '../../src/sim/v20Mechanics';
import { createSimWorld, reconcileFormationAndDps, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import type { SimEvent, WeaponId } from '../../src/types/game';

describe('V20 Five-Stage AAA Sci-Fi Bullet-Hell Action Overhaul', () => {
  it('Stage 1: Boss Phase-3 Omega Overdrive activates sector weather, Twin-Reflector Cross-Focus & Aegis Beam Parry trigger OMEGA_EXECUTION', () => {
    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { layoutSeed: 202621 });
    const initEvents: SimEvent[] = [];
    const boss = spawnSectorBoss(w, initEvents);
    boss.introProgress = 1.0;
    boss.shielded = false;
    for (const p of boss.pylons) p.destroyed = true;
    boss.phase = 2;
    boss.hp = Math.floor(boss.maxHp * 0.28); // <= 30% triggers Omega Overdrive!

    const evs1 = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
    const odEvt = evs1.find((e) => e.type === 'BOSS_OMEGA_OVERDRIVE');
    expect(odEvt).toBeDefined();
    expect(boss.omegaOverdrive).toBe(true);
    expect(w.weatherState).toBe('solar_emp');
    expect(w.reflectors.length).toBeGreaterThanOrEqual(2);

    // Path A: Twin 45-degree Reflector Cross-Focus triggers OMEGA_EXECUTION (`trigger: 'mirror_focus'`)
    const execEvtsA: SimEvent[] = [];
    const hpBeforeA = boss.hp;
    const leftRefProj = w.projectilePool.acquire();
    leftRefProj.amplified = true;
    leftRefProj.vx = 18.0;
    registerOmegaReflectorHitOnBoss(w, leftRefProj, execEvtsA);
    expect(execEvtsA.some((e) => e.type === 'OMEGA_EXECUTION')).toBe(false);

    const rightRefProj = w.projectilePool.acquire();
    rightRefProj.amplified = true;
    rightRefProj.vx = -18.0;
    registerOmegaReflectorHitOnBoss(w, rightRefProj, execEvtsA);
    expect(execEvtsA.some((e) => e.type === 'OMEGA_EXECUTION' && e.trigger === 'mirror_focus')).toBe(true);
    expect(boss.hp).toBeLessThan(hpBeforeA);
    expect(boss.omegaExecuted).toBe(true);

    // Path B: Perfect Phase Aegis Parry of Boss Omega Beam triggers OMEGA_EXECUTION (`trigger: 'aegis_parry'`)
    const w2 = createSimWorld();
    resetSimWorldForSector(w2, 3, { layoutSeed: 202622 });
    const b2 = spawnSectorBoss(w2, []);
    b2.introProgress = 1.0;
    b2.shielded = false;
    b2.phase = 3;
    b2.hp = Math.floor(b2.maxHp * 0.25);
    stepWorldFixed(w2, { dragDeltaX: 0, keyAxisX: 0 });
    expect(w2.weatherState).toBe('cryo_blizzard');
    b2.omegaBeamState = 'firing';
    b2.omegaBeamX = 0;
    b2.omegaBeamTimer = 0.3;
    w2.squadX = 0;
    w2.aegisCooldown = 0;
    const evsB = stepWorldFixed(w2, { dragDeltaX: 0, keyAxisX: 0, aegisPulse: true });
    expect(evsB.some((e) => e.type === 'OMEGA_EXECUTION' && e.trigger === 'aegis_parry')).toBe(true);
    expect(b2.omegaExecuted).toBe(true);
  });

  it('Stage 2: Complete 10/10 Dual-Weapon Overlimit Resonance Matrix & 3-Slot Tactical Overclock Chips (+ Fair Trial isolation)', () => {
    const weapons: WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];
    const unlockedIds = new Set<string>();
    for (let i = 0; i < weapons.length; i++) {
      for (let j = i + 1; j < weapons.length; j++) {
        const res = matchOverlimitResonance(weapons[i]!, weapons[j]!);
        expect(res).toBeTruthy();
        unlockedIds.add(res);
      }
    }
    expect(unlockedIds.size).toBe(10);
    expect(Object.keys(OVERLIMIT_RESONANCES).length).toBe(10);

    // Verify Overclock Chips workshop cost refund & Fair Trial #202611 zero-chip isolation
    expect(OVERCLOCK_CHIPS.length).toBe(6);
    const chipA = OVERCLOCK_CHIPS.find((c) => c.id === 'chip_phase_blink')!;
    const chipB = OVERCLOCK_CHIPS.find((c) => c.id === 'chip_exec_protocol')!;
    const spent = getTotalWorkshopSpent(
      { squad: 0, power: 0, reso: 0, aegis: 0, crit: 0, bounty: 0 },
      0,
      {},
      ['chip_phase_blink', 'chip_exec_protocol'],
    );
    expect(spent).toBe(chipA.cost + chipB.cost);

    const mods = runModsFromUpgrades({}, 0, {}, ['chip_phase_blink', 'chip_prism_split', 'chip_volatile_core', 'chip_aegis_nova']);
    expect(mods.equippedChips?.length).toBe(3);

    const fairW = createSimWorld();
    resetSimWorldForSector(fairW, 4, {
      ...mods,
      blitz: true,
      fairTrial: true,
      layoutSeed: 202611,
    });
    expect(fairW.mods.equippedChips?.length ?? 0).toBe(0);

    // Verify `hyper_rail_flechette` (scatter + rail) qualitative evolution in live combat
    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { layoutSeed: 202623, equippedChips: ['chip_prism_split'] });
    w.gatePool.releaseAll(w.gates);
    w.enemyPool.releaseAll(w.enemies);
    w.spawnCursor = 999999;
    w.squadCount = 90;
    w.stats.vaultsCracked = 2;
    w.activeLoadout = ['scatter', 'rail'];
    w.weapon = 'rail';
    w.weaponLevel = 3;
    w.learnedWeaponLevels.scatter = 3;
    w.learnedWeaponLevels.rail = 3;
    syncActiveFusions(w);
    expect(w.overlimitResonance).toBe('hyper_rail_flechette');
    const target = spawnEnemy(w, 'bastion', 0, -9, { hp: 3000 });
    const flank = spawnEnemy(w, 'crawler', 2.4, -9.2, { hp: 800 });
    reconcileFormationAndDps(w);
    for (let i = 0; i < 45; i++) {
      stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(target.hp).toBeLessThan(3000);
    expect(flank.hp).toBeLessThan(800);
  });

  it('Stage 3: Stereoscopic Runway Tactical Set-Pieces (Mag-Rail, Overload Capacitor Tower, Dual-Color Phase Gate & Core Shards)', () => {
    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { layoutSeed: 202624, equippedChips: ['chip_magnet_harvester'] });
    w.gatePool.releaseAll(w.gates);
    w.enemyPool.releaseAll(w.enemies);
    w.spawnCursor = 999999;
    w.squadX = 0;

    // 1) Polarity Mag-Rail boosts lateral speed & grants electromagnetic pierce timer
    spawnMagRail(w, 0, 5.5, 9.0, 1);
    const railEvs = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 1 });
    expect(railEvs.some((e) => e.type === 'MAG_RAIL_BOOST')).toBe(true);
    expect(w.magBoostTimer).toBeGreaterThan(1.2);

    // 2) Overload Capacitor Tower charges via amplified bank-shots to 100% and discharges screen-wide EMP storm
    const tower = spawnCapacitorTower(w, 0, -14, 0);
    const victim = spawnEnemy(w, 'phalanx', 2.2, -16, { hp: 600 });
    const capEvs: SimEvent[] = [];
    chargeCapacitorTower(w, tower, 180, true, capEvs);
    chargeCapacitorTower(w, tower, 180, true, capEvs);
    expect(capEvs.some((e) => e.type === 'CAPACITOR_DISCHARGE')).toBe(true);
    expect(tower.discharged).toBe(true);
    expect(victim.hp).toBeLessThan(600);

    // 3) Dual-Color Phase Gate rewards matching weapon attunement (`kinetic` with `pulse`)
    w.weapon = 'pulse';
    w.squadX = 0;
    const sqBefore = w.squadCount;
    spawnPhaseGate(w, 0, 5.9, 'kinetic');
    const pgEvs = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
    expect(pgEvs.some((e) => e.type === 'PHASE_GATE_SYNC' && e.synced === true)).toBe(true);
    expect(w.squadCount).toBeGreaterThan(sqBefore);

    // 4) Magnetized Core Shard drops pull into squad and award shards
    spawnCoreShard(w, 1.5, 5.8, 2);
    let collected = 0;
    for (let i = 0; i < 30; i++) {
      const evs = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
      for (const ev of evs) {
        if (ev.type === 'SHARD_COLLECT') collected += ev.value;
      }
    }
    expect(collected).toBeGreaterThanOrEqual(2);

    // Firing Range `setpieces` preset spawns all 3 set-pieces simultaneously
    const rw = createSimWorld();
    resetSimWorldForSector(rw, 1, { firingRange: true, layoutSeed: 202619 });
    applyFiringRangeCommand(rw, { preset: 'setpieces' });
    expect(rw.magRails.length).toBeGreaterThanOrEqual(1);
    expect(rw.capTowers.length).toBeGreaterThanOrEqual(1);
    expect(rw.phaseGates.length).toBeGreaterThanOrEqual(1);
  });

  it('Stage 5: Deterministic Tactical Replay Recorder & Verifier reproduces bit-exact squad, kills, and phase', () => {
    const sim = createSimulation();
    sim.startSector(1, {
      layoutSeed: 202625,
      bonusSquad: 4,
      damageMult: 1.12,
      equippedChips: ['chip_phase_blink', 'chip_prism_split'],
    });
    for (let t = 0; t < 360; t++) {
      const snap = sim.getSnapshot();
      if (snap.phase !== 'PLAYING') break;
      const steer = Math.sin(t * 0.07) * 0.18;
      sim.stepFixed({
        dragDeltaX: steer,
        keyAxisX: t % 90 < 45 ? 0.5 : -0.5,
        overdrive: t === 180,
        aegisPulse: t === 120,
        swapWeapon: t === 240,
      });
    }
    const log = sim.exportReplayLog();
    expect(log.totalTicks).toBe(360);
    expect(log.keyframes.length).toBeGreaterThan(5);

    const verified = verifyDeterministicReplay(log);
    expect(verified.matched).toBe(true);
    expect(verified.simulatedTicks).toBe(360);
    expect(verified.actualFinalSquad).toBe(log.expectedFinalSquad);
    expect(verified.actualKills).toBe(log.expectedKills);
  });
});
