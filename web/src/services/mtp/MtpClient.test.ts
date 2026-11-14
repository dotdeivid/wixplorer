import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerType, HEADER_LENGTH, MtpResponseCode } from './MtpConstants';

/**
 * Dispositivo MTP falso: por cada comando recibido encola en bulk-in los
 * paquetes que respondería el teléfono. Registra el orden de los envíos y
 * lecturas para verificar que las transacciones no se intercalan.
 */
const fake = vi.hoisted(() => ({
  log: [] as string[],
  inbox: [] as ArrayBuffer[],
  /** Arma las respuestas para un comando (code, tid). */
  respond: (() => []) as (code: number, tid: number) => ArrayBuffer[],
}));

vi.mock('../usb/USBManager', () => ({
  USBManager: class {
    isConnected = true;
    deviceName = 'Fake';
    currentUsbDevice = null;
    async sendBulk(data: ArrayBuffer) {
      const view = new DataView(data);
      const type = view.getUint16(4, true);
      const code = view.getUint16(6, true);
      const tid = view.getUint32(8, true);
      fake.log.push(`send:${tid}`);
      await new Promise(r => setTimeout(r, 1));
      if (type === 1) fake.inbox.push(...fake.respond(code, tid));
    }
    async receiveBulk(): Promise<ArrayBuffer> {
      await new Promise(r => setTimeout(r, 1));
      const next = fake.inbox.shift();
      if (!next) throw new Error('nothing to read');
      fake.log.push(next.byteLength >= HEADER_LENGTH ? `recv:${new DataView(next).getUint32(8, true)}` : 'recv:empty');
      return next;
    }
    async cancelRequest() { fake.log.push('cancel'); }
    async clearHalts() {}
    async disconnect() {}
  },
}));

const { MtpClient } = await import('./MtpClient');

function packet(type: ContainerType, code: number, tid: number, payload = new Uint8Array(0), length?: number) {
  const buf = new ArrayBuffer(HEADER_LENGTH + payload.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, length ?? buf.byteLength, true);
  view.setUint16(4, type, true);
  view.setUint16(6, code, true);
  view.setUint32(8, tid, true);
  new Uint8Array(buf).set(payload, HEADER_LENGTH);
  return buf;
}

const ok = (tid: number) => packet(ContainerType.Response, MtpResponseCode.OK, tid);

beforeEach(() => {
  fake.log.length = 0;
  fake.inbox.length = 0;
});

describe('MtpClient — serialización de transacciones', () => {
  it('no intercala operaciones concurrentes', async () => {
    // ObjectInfo mínimo: 52 bytes fijos + 3 strings vacíos
    fake.respond = (code, tid) => [packet(ContainerType.Data, code, tid, new Uint8Array(55)), ok(tid)];
    const client = new MtpClient();

    const results = await Promise.all([1, 2, 3].map(h => client.getObjectInfo(h)));

    expect(results.every(r => r !== null)).toBe(true);
    expect(fake.log).toEqual([
      'send:1', 'recv:1', 'recv:1',
      'send:2', 'recv:2', 'recv:2',
      'send:3', 'recv:3', 'recv:3',
    ]);
  });

  it('una operación que falla no traba la cola', async () => {
    fake.respond = () => []; // sin respuesta → receiveBulk lanza
    const client = new MtpClient();
    await expect(client.getObjectHandles(1)).rejects.toThrow();

    fake.respond = (_code, tid) => [ok(tid)];
    await expect(client.deleteObject(5)).resolves.toBeUndefined();
  });
});

describe('MtpClient.getObject', () => {
  it('devuelve el contenido completo', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    fake.respond = (code, tid) => [packet(ContainerType.Data, code, tid, data), ok(tid)];
    const blob = await new MtpClient().getObject(9);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(data);
  });

  it('lanza y cancela la transacción si la transferencia queda incompleta', async () => {
    // El header anuncia 10 bytes de payload pero llegan 3 y luego un paquete vacío
    fake.respond = (code, tid) => [
      packet(ContainerType.Data, code, tid, new Uint8Array([1, 2, 3]), HEADER_LENGTH + 10),
      new ArrayBuffer(0),
    ];
    await expect(new MtpClient().getObject(9)).rejects.toThrow(/incompleta/);
    expect(fake.log).toContain('cancel');
  });

  it('con longitud 0xFFFFFFFF (≥ 4 GB) usa knownSize y no descarta bytes del payload', async () => {
    const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    fake.respond = (code, tid) => [packet(ContainerType.Data, code, tid, data, 0xFFFFFFFF), ok(tid)];
    const blob = await new MtpClient().getObject(9, undefined, undefined, data.byteLength);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(data);
  });

  it('devuelve null si el dispositivo responde con error', async () => {
    fake.respond = (_code, tid) => [packet(ContainerType.Response, MtpResponseCode.InvalidObjectHandle, tid)];
    expect(await new MtpClient().getObject(9)).toBeNull();
  });
});
