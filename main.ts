// Tiny stack VM for the make.fun tiny-stack ISA: per <id> under
// MAKEFUN_INPUT_DIR, runs program.bin on input.bin, writes stdout.bin +
// exit.txt under MAKEFUN_OUTPUT_DIR/<id>. No dependencies.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [immediate bytes, pops, pushes] per opcode; null = unknown opcode.
function meta(op) {
  if (op < 8) return [[0, 1, 4, 0, 0, 0, 0, 0][op], [0, 0, 0, 1, 1, 2, 2, 3][op], [0, 1, 1, 0, 2, 2, 3, 3][op]];
  if (op >= 0x10 && op <= 0x16) return [0, 2, 1];
  if (op === 0x17 || op === 0x1b) return [0, 1, 1];
  if (op >= 0x18 && op <= 0x1e) return [0, 2, 1];
  if (op >= 0x20 && op <= 0x22) return [0, 2, 1];
  if (op === 0x30 || op === 0x33) return [2, 0, 0];
  if (op === 0x31 || op === 0x32) return [2, 1, 0];
  if (op === 0x34) return [0, 0, 0];
  if (op === 0x40) return [0, 1, 1];
  if (op === 0x41) return [0, 2, 0];
  if (op === 0x50 || op === 0x51 || op === 0x53) return [0, 1, 0];
  if (op === 0x52) return [0, 0, 1];
  return null;
}

function run(prog, input) {
  const st = new Int32Array(256);
  let sp = 0;
  const cs = new Int32Array(64);
  let cp = 0;
  const mem = new Int32Array(256);
  const out = Buffer.alloc(65536);
  let olen = 0, ipos = 0, pc = 0, steps = 0;
  const end = (code) => ({ out: out.subarray(0, olen), code });

  for (;;) {
    if (steps === 1000000) return end(10);
    if (pc < 0 || pc >= prog.length) return end(9);
    const op = prog[pc];
    const m = meta(op);
    if (!m) return end(5);
    const il = m[0], pops = m[1], pushes = m[2];
    if (pc + il >= prog.length) return end(9);
    steps++;
    const nx = pc + 1 + il;
    if (sp < pops) return end(2);
    if (sp - pops + pushes > 256) return end(3);
    pc = nx;
    switch (op) {
      case 0x00: return end(0);
      case 0x01: st[sp++] = (prog[nx - 1] << 24) >> 24; break;
      case 0x02: st[sp++] = prog[nx - 4] | (prog[nx - 3] << 8) | (prog[nx - 2] << 16) | (prog[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; }
      case 0x06: st[sp] = st[sp - 2]; sp++; break;
      case 0x07: { const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; break; }
      case 0x17: st[sp - 1] = -st[sp - 1] | 0; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = st[sp - 1], a = st[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return end(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        st[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[nx - 2] | (prog[nx - 1] << 8)) << 16) >> 16;
        let take = op === 0x30;
        if (op !== 0x30) { const v = st[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return end(7);
        cs[cp++] = nx;
        pc = prog[nx - 2] | (prog[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return end(8);
        pc = cs[--cp];
        break;
      case 0x40: {
        const addr = st[sp - 1];
        if (addr < 0 || addr > 255) return end(6);
        st[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = st[sp - 1], v = st[sp - 2];
        if (addr < 0 || addr > 255) return end(6);
        mem[addr] = v;
        sp -= 2;
        break;
      }
      case 0x50: {
        const s = String(st[sp - 1]);
        if (olen + s.length > 65536) return end(11);
        sp--;
        olen += out.write(s, olen);
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return end(11);
        out[olen++] = st[--sp] & 255;
        break;
      case 0x52:
        st[sp++] = ipos < input.length ? input[ipos++] : -1;
        break;
      case 0x53:
        return end(st[--sp] & 255);
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const dir = join(IN_DIR, id);
  const prog = readFileSync(join(dir, 'program.bin'));
  const input = readFileSync(join(dir, 'input.bin'));
  const { out, code } = run(prog, input);
  const od = join(OUT_DIR, id);
  mkdirSync(od, { recursive: true });
  writeFileSync(join(od, 'stdout.bin'), out);
  writeFileSync(join(od, 'exit.txt'), code + '\n');
}
