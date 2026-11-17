export const K: number;
export function trig(rot: number): { cs: number; sn: number };
export function project(u: number, v: number, cs: number, sn: number, c0: number): [number, number];
export function unproject(wx: number, wy: number, cs: number, sn: number, c0: number): [number, number];
export function snapRot(rot: number): number;
export function isSnap(rot: number): boolean;
export function quarterOf(rot: number): number;
export function normRot(rot: number): number;
