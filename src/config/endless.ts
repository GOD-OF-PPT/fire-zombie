import type { BossId } from '../types/game';
import { generateGauntlet } from './gauntlet';
import type { GateSpecConfig, RunwayEncounter, SectorScriptConfig } from './sectors';

export const ENDLESS_STAGE_DISTANCE_SCALE = 0.74;
export const ENDLESS_RUNWAY_LENGTH = Math.round(1300 * ENDLESS_STAGE_DISTANCE_SCALE);

const BOSS_ROTATION: readonly BossId[] = ['warden_01', 'hydra_02', 'omega_zero'];
const BOSS_NAMES: Record<BossId, string> = {
  warden_01: 'WARDEN-01《赤焰魔像王》·轮回',
  hydra_02: 'HYDRA-02《双生魔龙》·轮回',
  omega_zero: 'OMEGA-ZERO《深渊魔王》·轮回',
};
const BOSS_BASE_HP: Record<BossId, number> = {
  warden_01: 18000,
  hydra_02: 22000,
  omega_zero: 48000,
};

/** Threat escalates beyond the squad cap, while protocols let a build keep up longer. */
export function getEndlessEnemyHpMult(wave: number): number {
  const w = Math.max(0, Math.floor(wave) - 1);
  const eventMult = w % 3 === 1 ? 1.25 : w % 3 === 2 ? 0.85 : 1;
  return (1 + w * 0.18 + w * w * 0.012) * eventMult * Math.pow(1.05, Math.max(0, w - 3));
}

function scaleGate(spec: GateSpecConfig | undefined, wave: number): GateSpecConfig | undefined {
  if (!spec) return spec;
  const late = Math.max(0, wave - 1);
  const supply = Math.min(36, late * 2) + (late % 3 === 1 ? 8 : 0);
  const danger = Math.min(42, late * 3);
  return {
    ...spec,
    value: spec.op === 'add' ? spec.value + supply : spec.op === 'sub' ? spec.value + danger : spec.value,
    ...(spec.maxValue !== undefined ? { maxValue: spec.maxValue + supply } : {}),
    ...(spec.lockHp !== undefined ? { lockHp: Math.round(spec.lockHp * (1 + late * 0.08)) } : {}),
  };
}

function scaleEncounter(enc: RunwayEncounter, wave: number): RunwayEncounter {
  const crossDist = Math.round(enc.crossDist * ENDLESS_STAGE_DISTANCE_SCALE);
  switch (enc.type) {
    case 'gate_row':
      return {
        ...enc,
        crossDist,
        left: scaleGate(enc.left, wave),
        right: scaleGate(enc.right, wave),
        single: enc.single ? { ...scaleGate(enc.single, wave)!, x: enc.single.x, halfWidth: enc.single.halfWidth } : undefined,
      };
    case 'vault':
      return { ...enc, crossDist, hp: Math.round(enc.hp * (1 + (wave - 1) * 0.12)) };
    case 'enemies': {
      // Escalating horde waves fill the runway with satisfying crawler swarms alongside elites
      const units = [...enc.units];
      const extras = Math.min(10, Math.floor((wave - 1) * 2.5));
      for (let i = 0; i < extras; i++) {
        const src = enc.units[(i * 2 + wave) % enc.units.length]!;
        const kind = src.kind === 'bastion' || src.kind === 'dasher' ? 'crawler' : src.kind;
        units.push({
          kind,
          x: Math.max(-3.4, Math.min(3.4, -src.x * 0.82 + ((i % 3) - 1) * 0.6)),
          dz: (src.dz ?? 0) + 5.5 + i * 0.9,
        });
      }
      if ((wave - 1) % 3 === 2) {
        for (const [idx, x] of [-3.0, -1.8, -0.6, 0.6, 1.8, 3.0].entries()) {
          units.push({ kind: 'crawler', x, dz: 9.5 + (idx % 2) * 1.1 });
        }
      }
      return { ...enc, crossDist, units };
    }
    case 'barrels':
    case 'lens':
    case 'jump_pad':
    case 'reflector':
    case 'contract_lane':
      return { ...enc, crossDist };
  }
}

/**
 * One deterministic endless stage. A stage is roughly a minute of runway followed by a boss;
 * generateEndlessStage is called again after each kill, with no final victory state.
 */
export function generateEndlessStage(seed: number, wave: number): SectorScriptConfig {
  const w = Math.max(1, Math.floor(wave));
  const mixedSeed = (Math.imul(seed >>> 0, 0x45d9f3b) ^ Math.imul(w, 0x27d4eb2d)) >>> 0;
  const generated = generateGauntlet(mixedSeed);
  const bossId = BOSS_ROTATION[((seed >>> 0) + w - 1) % BOSS_ROTATION.length]!;
  const hpMult = (1 + (w - 1) * 0.26) * Math.pow(1.12, Math.max(0, w - 3));
  return {
    id: 4,
    name: 'Endless Protocol',
    subtitle: `无尽协议 · 阶段 ${w}`,
    scrollSpeed: 17 + Math.min(6, (w - 1) * 0.45),
    runwayLength: ENDLESS_RUNWAY_LENGTH,
    startSquad: 8,
    boss: {
      id: bossId,
      name: `${BOSS_NAMES[bossId]}${w}`,
      maxHp: Math.round(BOSS_BASE_HP[bossId] * hpMult),
      maxPhases: bossId === 'omega_zero' ? 3 : 2,
      ...(bossId === 'omega_zero' ? { pylonHp: Math.round(3200 * hpMult) } : {}),
      enrageAfterSec: bossId === 'omega_zero' ? 38 : bossId === 'hydra_02' ? 30 : 26,
    },
    encounters: generated.encounters.map((enc) => scaleEncounter(enc, w)),
  };
}
