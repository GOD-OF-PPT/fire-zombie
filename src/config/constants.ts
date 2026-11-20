export const FIXED_DT = 1 / 60;
export const MAX_WALL_DT = 0.1;
export const ACCUMULATOR_EPS = 1e-9;

// Track & World Coordinate Constants
export const TRACK_HALF_WIDTH = 5.0;
export const PLAYER_Z = 6.0;
export const SPAWN_Z = -78.0;
export const HORIZON_AHEAD = PLAYER_Z - SPAWN_Z; // 84.0 units ahead of playerZ
export const DESPAWN_Z = 12.0;

// Squad & 3-Tier Visual Formation Constants
export const MIN_SQUAD_COUNT = 0;
export const MAX_SQUAD_COUNT = 999;
export const MAX_VISIBLE_UNITS = 48;
export const MIN_FORMATION_RADIUS = 0.35;
export const MAX_FORMATION_RADIUS = 1.65;
export const SPIRAL_SPACING = 0.212;
export const DRONE_BODY_MARGIN = 0.19;
export const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

// Lateral Steering Speed
export const KEYBOARD_MOVE_SPEED = 11.5;

// Combat & Arsenal Scaling
export const BASE_DRONE_DPS = 2.0;
export const MASTERY_DAMAGE_PER_VAULT = 0.12;

// Gate & Overclock Vault Hitboxes
export const GATE_HALF_DEPTH = 0.28;
export const DEFAULT_PAIRED_GATE_HALF_WIDTH = 2.5;
export const DEFAULT_STANDALONE_GATE_HALF_WIDTH = 2.3;
export const VAULT_HALF_WIDTH = 1.2;
export const VAULT_HALF_DEPTH = 0.65;

// Orbital Bit-Blades Close Defense
export const BLADES_MAX_COUNT = 4;
export const BLADES_ORBIT_RADIUS = 2.6;
export const BLADES_ANGULAR_SPEED = 5.2;
export const BLADES_HIT_RADIUS = 0.65;
export const BLADES_DAMAGE = 22;
export const BLADES_HIT_COOLDOWN = 0.20;
export const BLADES_BONUS_DRONES = 6;

// Signature Twist: Golden Prism Lens & V-Wing Resonance Overdrive
export const PRISM_LENS_HALF_WIDTH = 1.6;
export const PRISM_LENS_HALF_DEPTH = 0.30;
export const PRISM_LENS_DAMAGE_MULT = 1.35;
export const PRISM_LENS_SPLIT_ANGLE_RAD = (3.5 * Math.PI) / 180;
export const PRISM_LENS_SPLIT_OFFSET_X = 0.14;

export const OVERDRIVE_DURATION = 6.0;
export const OVERDRIVE_FIRE_RATE_MULT = 1.5;
export const OVERDRIVE_BONUS_PIERCE = 1;

export const RESONANCE_GAIN_POSITIVE_GATE = 0.20;
export const RESONANCE_GAIN_GATE_FLIP = 0.35;
export const RESONANCE_GAIN_BARREL_EXPLODE = 0.20;
export const RESONANCE_GAIN_BARREL_CHAIN = 0.10;
export const RESONANCE_GAIN_VAULT_BREAK = 0.30;

// Surge Barrel Constants
export const BARREL_RADIUS = 0.75;
export const BARREL_MAX_HP = 15;
export const BARREL_BLAST_RADIUS = 4.5;
export const BARREL_BLAST_DAMAGE = 130;
export const BARREL_GATE_BOOST_RADIUS = 5.0;
export const BARREL_GATE_BOOST_DELTA = 5;
export const BARREL_CHAIN_TRIGGER_RADIUS = 5.2;
export const BARREL_CHAIN_DELAY_SEC = 0.11;

// Transient Visual Feedback Decay Rates (per second)
export const HIT_PULSE_DECAY_PER_SEC = 6.0;
export const FLIP_PULSE_DECAY_PER_SEC = 2.2;
export const LENS_PULSE_DECAY_PER_SEC = 4.5;

export const JUMP_DURATION_SEC = 1.32;
