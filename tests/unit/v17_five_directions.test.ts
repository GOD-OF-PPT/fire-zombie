import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../src/sim/index';
import { createSimWorld, reconcileFormationAndDps, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import { describeVaultRelation, matchDualSynergyPair } from '../../src/config/blitz';
import type { WeaponId } from '../../src/types/game';
import { PLAYER_Z } from '../../src/config/constants';
import { spawnSectorBoss } from '../../src/sim/bosses';
import { damageVault, spawnVault } from '../../src/sim/weapons';

describe('V17 Five-Direction Optimization Suite', () => {
  it('Direction 1: covers all 10 C(5,2) weapon pairs with either a Major Fusion or Dual Synergy (zero dead-end pairs)', () => {
    const weapons: WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];
    for (let i = 0; i < weapons.length; i++) {
      for (let j = i + 1; j < weapons.length; j++) {
        const a = weapons[i]!;
        const b = weapons[j]!;
        const isMajorPair = (a === 'plasma' && b === 'cryo') || (a === 'scatter' && b === 'rail');
        const dual = matchDualSynergyPair(a, b);
        expect(isMajorPair || dual !== null, `pair ${a}+${b} should have Major Fusion or Dual Synergy`).toBe(true);
      }
    }

    const relFusion = describeVaultRelation('cryo', ['plasma'], { pulse: 1, scatter: 0, rail: 0, plasma: 2, cryo: 0 }, 0, [], null);
    expect(relFusion.tag).toContain('黑洞');

    const relDual = describeVaultRelation('rail', ['plasma'], { pulse: 1, scatter: 0, rail: 0, plasma: 1, cryo: 0 }, 0, [], null);
    expect(relDual.tag).toContain('配对');

    const relSalvage = describeVaultRelation('scatter', ['plasma', 'cryo'], { pulse: 1, scatter: 0, rail: 0, plasma: 2, cryo: 1 }, 0, ['cryo_singularity'], null);
    expect(relSalvage.tag).toContain('拆解');

    const relPivot = describeVaultRelation('scatter', ['plasma', 'cryo'], { pulse: 1, scatter: 1, rail: 0, plasma: 2, cryo: 1 }, 0, ['cryo_singularity'], 'scatter');
    expect(relPivot.tag).toContain('切换构筑');
  });

  it('Direction 1b: unlocks Dual Synergy in live simulation when pairing non-major weapons (rail + plasma -> thermo_rail_lance)', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { layoutSeed: 77 });
    world.squadCount = 40;
    reconcileFormationAndDps(world);
    const evs: Parameters<typeof damageVault>[3] = [];
    for (const r of ['rail', 'plasma', 'rail'] as const) {
      const v = spawnVault(world, 0, PLAYER_Z - 5, 0, 10, r);
      damageVault(world, v, 20, evs);
    }
    expect(evs.some((e) => e.type === 'DUAL_SYNERGY_UNLOCK' && e.synergyId === 'thermo_rail_lance')).toBe(true);
    expect(world.activeDualSynergy).toBe('thermo_rail_lance');
  });

  it('Direction 2: WARDEN-01, HYDRA-02 and OMEGA-ZERO expose boss-specific shoulder labels & telegraph fields', () => {
    for (const [sector, expectedLeft, expectedRight] of [
      [1, '重火炮肩甲', '孵化巢肩甲'],
      [2, '紫焰吐息翼', '苍雷分体翼'],
      [3, '歼星重炮肩', '深渊裂隙肩'],
    ] as const) {
      const world = createSimWorld();
      resetSimWorldForSector(world, sector, { layoutSeed: 101 });
      const evs: Parameters<typeof spawnSectorBoss>[1] = [];
      const boss = spawnSectorBoss(world, evs);
      expect(boss.parts[0]?.label).toBe(expectedLeft);
      expect(boss.parts[1]?.label).toBe(expectedRight);
      expect(typeof boss.parts[0]?.telegraph).toBe('number');
    }
  });

  it('Direction 3: Starter Modules apply in standard runs and strictly reset in Fair Trial; Endless resonance/blades protocols alter mechanics', () => {
    const sim = createSimulation();
    sim.startSector(1, { starterWeapon: 'rail', starterBlade: true, fairTrial: false });
    const s1 = sim.getSnapshot();
    expect(s1.weapon).toBe('rail');
    expect(s1.bladesCount).toBe(1);

    // Fair Trial strictly ignores starterWeapon & starterBlade
    sim.startSector(4, { blitz: true, fairTrial: true, starterWeapon: 'rail', starterBlade: true });
    const sFair = sim.getSnapshot();
    expect(sFair.weapon).toBe('pulse');
    expect(sFair.bladesCount).toBe(0);

    // Qualitative Endless Protocols: Overdrive with resonance>=1 spawns tracking Prism Lens; Aegis with blades>=1 spawns Singularity
    const world = createSimWorld();
    resetSimWorldForSector(world, 4, { endless: true, manualOverdrive: true });
    world.endless!.upgrades.resonance = 1;
    world.endless!.upgrades.blades = 1;
    world.resonance = 1.0;
    world.aegisCooldown = 0;
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, overdrive: true, aegisPulse: true });
    expect(world.lenses.some((l) => l.active && l.driftFreq === -999)).toBe(true);
    expect(world.singularities.length).toBeGreaterThanOrEqual(1);
  });
});
