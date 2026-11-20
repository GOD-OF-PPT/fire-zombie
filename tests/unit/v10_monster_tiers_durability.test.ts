import { describe, expect, it } from 'vitest';
import { ENEMY_CONFIGS, getEnemyTier } from '../../src/config/enemies';
import { getVolleyStreamCount } from '../../src/config/weapons';
import { computeTieredEnemyHp } from '../../src/sim/spawner';
import { createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';

describe('V10 4-Tier Monster Hierarchy & Anti-One-Shot Realistic Durability', () => {
  it('classifies all 14 archetypes into a strict 4-Tier combat hierarchy (Tier 1 < Tier 2 < Tier 3 < Tier 4)', () => {
    expect(getEnemyTier('crawler')).toBe(1);
    expect(getEnemyTier('bomber')).toBe(2);
    expect(getEnemyTier('stalker')).toBe(2);
    expect(getEnemyTier('burrower')).toBe(2);
    expect(getEnemyTier('dasher')).toBe(2);
    expect(getEnemyTier('mitosis')).toBe(2);
    expect(getEnemyTier('phalanx')).toBe(3);
    expect(getEnemyTier('howler')).toBe(3);
    expect(getEnemyTier('beholder')).toBe(3);
    expect(getEnemyTier('necromancer')).toBe(3);
    expect(getEnemyTier('siphon')).toBe(3);
    expect(getEnemyTier('glacier')).toBe(4);
    expect(getEnemyTier('brood')).toBe(4);
    expect(getEnemyTier('bastion')).toBe(4);

    expect(ENEMY_CONFIGS.crawler.hp).toBeLessThan(ENEMY_CONFIGS.burrower.hp);
    expect(ENEMY_CONFIGS.burrower.hp).toBeLessThan(ENEMY_CONFIGS.phalanx.hp);
    expect(ENEMY_CONFIGS.phalanx.hp).toBeLessThan(ENEMY_CONFIGS.glacier.hp);
  });

  it('prevents 1-shot insta-kills across all 4 tiers even when squad firepower reaches high late-game DPS', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 3, { bonusSquad: 45, damageMult: 1.5, critChance: 0.25 });
    // Step once so trueSquadDps & weapon volleys initialize
    stepWorldFixed(world, { dragDeltaX: 0.1, keyAxisX: 0 });

    const streams = getVolleyStreamCount(world.weapon, world.weaponLevel, world.squadCount);
    const singleBulletDmg = (world.trueSquadDps / 9.5 / Math.max(1, streams)) * world.mods.damageMult;

    const hpT1 = computeTieredEnemyHp(world, 'crawler');
    const hpT2 = computeTieredEnemyHp(world, 'burrower');
    const hpT3 = computeTieredEnemyHp(world, 'phalanx');
    const hpT4 = computeTieredEnemyHp(world, 'bastion');

    // Even a Tier 1 crawler survives multiple single-stream bullets (never 1-grazed!)
    expect(hpT1).toBeGreaterThan(singleBulletDmg * 2.2);
    // Strict multi-tier HP separation: Tier 2 > 2.3x Tier 1, Tier 3 > 1.8x Tier 2, Tier 4 > 1.6x Tier 3!
    expect(hpT2).toBeGreaterThan(hpT1 * 2.3);
    expect(hpT3).toBeGreaterThan(hpT2 * 1.8);
    expect(hpT4).toBeGreaterThan(hpT3 * 1.6);
  });
});
