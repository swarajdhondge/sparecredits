export const VERSION: string;
export const GRID: number;
export const MAX_LINE: number;
export const MAX_CMDS: number;
export const PLAN_MAX_CMDS: number;
export const PLAN_CODE: RegExp;
export const SHAPE_KINDS: string[];
export const MAX_SHAPES_CMD: number;
export const MAX_SHAPES_CELL: number;
export const MAX_MOVING: number;
export const PIC_MIN: number;
export const PIC_MAX: number;
export const PIC_PIXELS: number;
export function planName(words: string[]): string;
export function groupColor(id: string): number;
export function groupFromSlug(slug: string): string | null;
export const CENTER: number;
export const OPEN_START: number;
export const OPEN_STEP: number;
export const OPEN_FILL: number;
export const CHUNK_SHIFT: number;
export const MAX_RINGS: number;
export interface Area { x0: number; y0: number; x1: number; y1: number }
export function openArea(rings: number): Area;
export function inArea(a: Area, x: number, y: number): boolean;
export function growRings(rings: number, buildings: number): number;
export const TEAMS: string[];
export const TEAM_LABELS: Record<string, string>;
export const STYLES: string[];
export const PARTS: string[];
export const SIDES: string[];
export const PALETTES: string[];
export const TEMPLATES: string[];
export const WORD_CLASSES: Record<string, string[]>;
export const BLOCKED_COMBOS: string[][];
export const WORD_CLASS: Record<string, string>;
export const WORDS: string[];
export const TAG_WORDS: string[];
export const MAX_TAGS: number;
export const BANNED_PATTERNS: string[][];
export const BANNED_VARIANTS: string[][];

/** One 3D shape of a free build: kind, corner u,v, bottom z, size w,d,h, colour c (3 hex digits), motion m (0-5). */
export interface Shape { k: string; u: number; v: number; z: number; w: number; d: number; h: number; c: string; m: number }

export type Cmd =
  | { v: "B"; x: number; y: number; style: string; h: number; pal: number; seed: number }
  | { v: "E"; x: number; y: number; part: string; side: string; h: number }
  | { v: "S"; x: number; y: number; tpl: number; words: string[] }
  | { v: "C"; x: number; y: number }
  | { v: "F" | "A"; x: number; y: number; shapes: Shape[] }
  | { v: "G"; x: number; y: number; facing: string; w: number; h: number; more: boolean; pixels: string[] }
  | { v: "P"; words: string[]; name: string }
  | { v: "J"; words: string[]; id: string; name: string }
  | { v: "K"; x: number; y: number; words: string[]; dropped?: string[] }
  | { v: "T"; team: string };

export type ParseErr = { ok: false; code: string; message: string };
export type ParsedItem =
  | { index: number; raw: string; ok: true; cmd: Cmd }
  | { index: number; raw: string; ok: false; code: string; message: string };

export function aAn(word: string): "a" | "an";
export function extractKitLine(text: string): string;
export function templateLines(): string[];
export function templateSlots(tpl: number): number;
export function fillTemplate(tpl: number, words: string[]): string;
export function classOf(word: string): string | undefined;
export function blockedCombo(words: string[]): boolean;
export function parseCommand(raw: string): { ok: true; cmd: Cmd } | ParseErr;
export function parseLine(input: string): { ok: true; items: ParsedItem[]; plan: boolean } | ParseErr;
export function parseShapes(text: string, max?: number): { ok: true; shapes: Shape[] } | ParseErr;
export function formatShapes(shapes: Shape[]): string;
export function decodePixels(text: string): { ok: true; pixels: string[] } | ParseErr;
export function encodePixels(pixels: string[]): string;
export function readPicture(text: string): { facing: string; w: number; h: number; pixels: string[] } | null;
export function freeHeight(n: number): number;
export function freeBuild(cmd: Extract<Cmd, { v: "F" | "A" | "G" }>, prevStyle: string | null, prevShape: string | null): { ok: true; style: "free" | "picture"; h: number; pal: number; shape: string } | ParseErr;
export function formatCmd(c: Cmd): string;
export function moveLine(input: string, to: { x: number; y: number }, area?: Area): { ok: true; line: string; first: { x: number; y: number } | null } | ParseErr;
export function createsBannedLayout(occupied: (x: number, y: number) => boolean, x: number, y: number): boolean;
export function specText(): string;
export function freeGuideLines(): string[];
export const GUIDE_V: string;
export function freshLinks(origin: string, now?: number): { guide: string; world: string };
export const TAG_HINT: string;
