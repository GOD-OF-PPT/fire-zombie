import type { AbyssalPactId, BossId, CustomTrackBlueprint, CustomTrackItem, CustomTrackItemKind, EnemyKind, SectorId } from '../types/game';
import type { RunwayEncounter, SectorScriptConfig } from '../config/sectors';
import { SECTORS } from '../config/sectors';
import { clamp } from './math';

const VALID_KINDS: readonly CustomTrackItemKind[] = [
  'reflector',
  'lens',
  'mag_rail',
  'cap_tower',
  'bridge_gap',
  'high_spire',
  'gate_pair',
  'vault',
  'enemy_wave',
];

const VALID_ENEMIES: readonly EnemyKind[] = [
  'crawler',
  'dasher',
  'bastion',
  'mitosis',
  'siphon',
  'bomber',
  'phalanx',
  'stalker',
  'brood',
  'howler',
  'glacier',
  'beholder',
  'burrower',
  'necromancer',
];

const VALID_BOSSES: readonly BossId[] = ['warden_01', 'hydra_02', 'omega_zero'];
const VALID_PACTS: readonly AbyssalPactId[] = [
  'pact_oscillating_mirrors',
  'pact_volatile_chain',
  'pact_harmonic_aegis',
  'pact_rift_turbulence',
  'pact_apex_mutations',
  'pact_elite_vanguard',
];

export const BUILTIN_TRACK_PRESETS: readonly CustomTrackBlueprint[] = [
  {
    title: '三角折镜试炼走廊',
    sectorTheme: 2,
    runwayLength: 300,
    bossId: 'hydra_02',
    abyssalPacts: ['pact_oscillating_mirrors', 'pact_harmonic_aegis'],
    forceNemesis: true,
    items: [
      { id: 1, kind: 'gate_pair', dist: 45, x: 0 },
      { id: 2, kind: 'vault', dist: 72, x: -2.0 },
      { id: 3, kind: 'reflector', dist: 105, x: -2.8, angleDeg: 36 },
      { id: 4, kind: 'enemy_wave', dist: 122, x: 1.5, enemyKind: 'phalanx' },
      { id: 5, kind: 'reflector', dist: 158, x: 2.8, angleDeg: -36 },
      { id: 6, kind: 'cap_tower', dist: 176, x: 0 },
      { id: 7, kind: 'bridge_gap', dist: 210, x: 0 },
      { id: 8, kind: 'high_spire', dist: 238, x: -2.9 },
      { id: 9, kind: 'enemy_wave', dist: 252, x: 0, enemyKind: 'glacier' },
    ],
  },
  {
    title: '极速滑轨破盾狂飙',
    sectorTheme: 3,
    runwayLength: 320,
    bossId: 'omega_zero',
    abyssalPacts: ['pact_apex_mutations', 'pact_volatile_chain'],
    forceNemesis: false,
    items: [
      { id: 1, kind: 'gate_pair', dist: 40, x: 0 },
      { id: 2, kind: 'mag_rail', dist: 84, x: -2.4 },
      { id: 3, kind: 'lens', dist: 112, x: -2.2 },
      { id: 4, kind: 'enemy_wave', dist: 138, x: 0, enemyKind: 'bastion' },
      { id: 5, kind: 'vault', dist: 168, x: 2.2 },
      { id: 6, kind: 'reflector', dist: 204, x: 2.6, angleDeg: -38 },
      { id: 7, kind: 'high_spire', dist: 242, x: 2.8 },
    ],
  },
];

function toBase64Url(str: string): string {
  const utf8 = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1: string) =>
    String.fromCharCode(parseInt(p1, 16)),
  );
  const b64 = typeof btoa === 'function' ? btoa(utf8) : Buffer.from(utf8, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const pct = Array.from(bin)
    .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return decodeURIComponent(pct);
}

/** Encodes a CustomTrackBlueprint into a compact shareable `PZ23-...` code */
export function encodeTrackShareCode(bp: CustomTrackBlueprint): string {
  const payload = {
    t: (bp.title || '自定义挑战').slice(0, 24),
    s: bp.sectorTheme,
    l: clamp(Math.round(bp.runwayLength || 300), 220, 460),
    b: bp.bossId,
    n: bp.forceNemesis ? 1 : 0,
    p: (bp.abyssalPacts || []).map((p) => VALID_PACTS.indexOf(p)).filter((i) => i >= 0),
    i: bp.items.slice(0, 32).map((it) => [
      VALID_KINDS.indexOf(it.kind),
      Math.round(clamp(it.dist, 30, 440)),
      Math.round(clamp(it.x, -4.2, 4.2) * 10) / 10,
      it.angleDeg ?? 36,
      it.enemyKind ? VALID_ENEMIES.indexOf(it.enemyKind) : 0,
    ]),
  };
  return 'PZ23-' + toBase64Url(JSON.stringify(payload));
}

/** Decodes & validates a `PZ23-...` Share Code into a sanitized CustomTrackBlueprint */
export function decodeTrackShareCode(code: string): CustomTrackBlueprint | null {
  try {
    const trimmed = code.trim();
    const raw = trimmed.startsWith('PZ23-') ? trimmed.slice(5) : trimmed;
    if (!raw) return null;
    const obj = JSON.parse(fromBase64Url(raw)) as {
      t?: string;
      s?: number;
      l?: number;
      b?: string;
      n?: number;
      p?: number[];
      i?: Array<[number, number, number, number?, number?]>;
    };
    const sectorTheme: SectorId = obj.s === 2 || obj.s === 3 ? obj.s : 1;
    const bossId: BossId = VALID_BOSSES.includes(obj.b as BossId) ? (obj.b as BossId) : 'warden_01';
    const runwayLength = clamp(Math.round(Number(obj.l) || 300), 220, 460);
    const abyssalPacts: AbyssalPactId[] = Array.isArray(obj.p)
      ? obj.p.map((idx) => VALID_PACTS[idx]!).filter((x): x is AbyssalPactId => Boolean(x))
      : [];
    const items: CustomTrackItem[] = Array.isArray(obj.i)
      ? obj.i.slice(0, 32).map((tuple, idx) => {
          const kind = VALID_KINDS[tuple[0] ?? 0] ?? 'reflector';
          const dist = clamp(Number(tuple[1]) || 60 + idx * 24, 30, runwayLength - 24);
          const x = clamp(Number(tuple[2]) || 0, -4.2, 4.2);
          const angleDeg = clamp(Math.round(Number(tuple[3]) || 36), -55, 55);
          const enemyKind = VALID_ENEMIES[tuple[4] ?? 0] ?? 'phalanx';
          return { id: idx + 1, kind, dist, x, angleDeg, enemyKind };
        })
      : [];
    return {
      title: typeof obj.t === 'string' && obj.t.trim() ? obj.t.trim().slice(0, 24) : '导入战术蓝图',
      sectorTheme,
      runwayLength,
      bossId,
      abyssalPacts,
      forceNemesis: Boolean(obj.n),
      items,
    };
  } catch {
    return null;
  }
}

/** Compiles a CustomTrackBlueprint into a playable SectorScriptConfig + dynamic V20/V21 prop schedule */
export function compileCustomBlueprint(bp: CustomTrackBlueprint): {
  script: SectorScriptConfig;
  runtimeProps: Array<{ kind: CustomTrackItemKind; dist: number; x: number; angleDeg?: number; spawned?: boolean }>;
} {
  const base = SECTORS[bp.sectorTheme] ?? SECTORS[1];
  const encounters: RunwayEncounter[] = [];
  const runtimeProps: Array<{ kind: CustomTrackItemKind; dist: number; x: number; angleDeg?: number; spawned?: boolean }> = [];
  const rewards: Array<'rail' | 'scatter' | 'plasma' | 'cryo'> = ['rail', 'scatter', 'plasma', 'cryo'];

  // Always seed an opening gate pair if user didn't place one before 48m so early squad growth feels great
  if (!bp.items.some((it) => it.kind === 'gate_pair' && it.dist <= 55)) {
    encounters.push({
      type: 'gate_row',
      crossDist: 34,
      layout: 'paired',
      left: { op: 'add', value: 8, mutable: true, stepDelta: 2, maxValue: 24 },
      right: { op: 'mul', value: 2, mutable: false },
    });
  }

  let vaultIdx = 0;
  for (const it of bp.items) {
    const d = clamp(Math.round(it.dist), 30, bp.runwayLength - 22);
    const x = clamp(it.x, -4.1, 4.1);
    switch (it.kind) {
      case 'gate_pair':
        encounters.push({
          type: 'gate_row',
          crossDist: d,
          layout: 'paired',
          left: { op: 'add', value: 10, mutable: true, stepDelta: 2, maxValue: 30 },
          right: { op: 'add', value: -4, mutable: true, stepDelta: 3, maxValue: 28 },
        });
        break;
      case 'vault':
        encounters.push({
          type: 'vault',
          crossDist: d,
          x,
          hp: 52,
          reward: rewards[vaultIdx++ % rewards.length]!,
        });
        break;
      case 'lens':
        encounters.push({ type: 'lens', crossDist: d, x });
        break;
      case 'bridge_gap':
        encounters.push({ type: 'jump_pad', crossDist: Math.max(26, d - 10), x });
        runtimeProps.push({ kind: 'bridge_gap', dist: d, x });
        break;
      case 'reflector':
      case 'mag_rail':
      case 'cap_tower':
      case 'high_spire':
        runtimeProps.push({ kind: it.kind, dist: d, x, angleDeg: it.angleDeg ?? (x < 0 ? 36 : -36) });
        if (it.kind === 'reflector') {
          encounters.push({ type: 'barrels', crossDist: d + 10, placements: [{ x: -x * 0.75, dz: 0 }] });
        }
        break;
      case 'enemy_wave': {
        const ek = it.enemyKind ?? 'phalanx';
        encounters.push({
          type: 'enemies',
          crossDist: d,
          units: [
            { kind: ek, x, dz: 0 },
            { kind: 'crawler', x: clamp(x - 1.3, -4.2, 4.2), dz: 1.5 },
            { kind: 'crawler', x: clamp(x + 1.3, -4.2, 4.2), dz: 1.8 },
            { kind: 'bomber', x: clamp(-x * 0.6, -4.0, 4.0), dz: 3.0 },
          ],
        });
        break;
      }
    }
  }

  encounters.sort((a, b) => a.crossDist - b.crossDist);
  const bossNames: Record<BossId, string> = {
    warden_01: '赤焰魔像王',
    hydra_02: '双生魔龙',
    omega_zero: '深渊魔王',
  };

  return {
    script: {
      ...base,
      id: bp.sectorTheme,
      name: `工坊蓝图 · ${bp.title}`,
      subtitle: 'CUSTOM HOLOGRAPHIC CHALLENGE · 全息自定义关卡',
      runwayLength: bp.runwayLength,
      startSquad: 24,
      boss: {
        id: bp.bossId,
        name: bossNames[bp.bossId],
        maxHp: bp.bossId === 'omega_zero' ? 4200 : bp.bossId === 'hydra_02' ? 3200 : 2500,
        maxPhases: 3,
      },
      encounters,
    },
    runtimeProps,
  };
}
