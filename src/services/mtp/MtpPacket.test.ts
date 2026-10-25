import { describe, expect, it } from 'vitest';
import { ContainerType, HEADER_LENGTH } from './MtpConstants';
import {
  MtpPacket,
  parseMtpString,
  parseMtpUInt32Array,
  serializeMtpString,
} from './MtpPacket';

/** Arma un buffer a partir de bytes literales. */
const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe('MtpPacket.serialize', () => {
  it('escribe el header en little endian seguido del payload', () => {
    const packet = new MtpPacket(ContainerType.Command, 0x1002, 0x01020304, bytes(0xAA, 0xBB));
    const out = new Uint8Array(packet.serialize());

    expect(out.byteLength).toBe(HEADER_LENGTH + 2);
    expect([...out]).toEqual([
      0x0E, 0x00, 0x00, 0x00, // length = 14
      0x01, 0x00,             // type = Command
      0x02, 0x10,             // code = 0x1002
      0x04, 0x03, 0x02, 0x01, // transactionId
      0xAA, 0xBB,             // payload
    ]);
  });
});

describe('MtpPacket.deserialize', () => {
  it('es la inversa de serialize', () => {
    const original = MtpPacket.buildCommand(0x1007, 42, [0x00010001, 0xFFFFFFFF]);
    const parsed = MtpPacket.deserialize(original.serialize());

    expect(parsed.length).toBe(original.length);
    expect(parsed.type).toBe(ContainerType.Command);
    expect(parsed.code).toBe(0x1007);
    expect(parsed.transactionId).toBe(42);
    expect(parsed.getResponseParams()).toEqual([0x00010001, 0xFFFFFFFF]);
  });

  it('rechaza buffers más chicos que el header', () => {
    expect(() => MtpPacket.deserialize(new ArrayBuffer(HEADER_LENGTH - 1)))
      .toThrow(/too small/);
  });

  it('conserva el length declarado aunque el buffer venga truncado', () => {
    // Primer chunk de un Data packet grande: el header anuncia 1000 bytes
    // pero el USB transfer solo trajo 16.
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    view.setUint32(0, 1000, true);
    view.setUint16(4, ContainerType.Data, true);
    view.setUint16(6, 0x1009, true);
    view.setUint32(8, 7, true);

    const parsed = MtpPacket.deserialize(buf);
    expect(parsed.length).toBe(1000);
    expect(parsed.type).toBe(ContainerType.Data);
    expect(parsed.payload.byteLength).toBe(4);
  });

  it('ignora bytes extra más allá del length declarado', () => {
    const packet = MtpPacket.buildCommand(0x1001, 1);
    const padded = new Uint8Array(HEADER_LENGTH + 8);
    padded.set(new Uint8Array(packet.serialize()));

    const parsed = MtpPacket.deserialize(padded.buffer);
    expect(parsed.payload.byteLength).toBe(0);
  });
});

describe('MtpPacket.getResponseParams', () => {
  it('descarta bytes sueltos que no completan un uint32', () => {
    const packet = new MtpPacket(ContainerType.Response, 0x2001, 1, bytes(1, 0, 0, 0, 9, 9));
    expect(packet.getResponseParams()).toEqual([1]);
  });
});

describe('strings MTP', () => {
  it('serialize → parse devuelve el mismo texto', () => {
    const buf = serializeMtpString('DCIM ñ');
    const { text, newOffset } = parseMtpString(new DataView(buf), 0);
    expect(text).toBe('DCIM ñ');
    expect(newOffset).toBe(buf.byteLength);
  });

  it('el char count incluye el terminador nulo', () => {
    const view = new DataView(serializeMtpString('ab'));
    expect(view.getUint8(0)).toBe(3);
    expect(view.byteLength).toBe(1 + 3 * 2);
  });

  it('string vacío es un único byte 0', () => {
    const buf = serializeMtpString('');
    expect(buf.byteLength).toBe(1);
    expect(parseMtpString(new DataView(buf), 0)).toEqual({ text: '', newOffset: 1 });
  });

  it('parsea desde un offset y deja el cursor en el siguiente campo', () => {
    const str = new Uint8Array(serializeMtpString('x'));
    const buf = new Uint8Array(2 + str.byteLength + 1);
    buf.set(str, 2);
    buf[buf.length - 1] = 0x7F;

    const view = new DataView(buf.buffer);
    const { text, newOffset } = parseMtpString(view, 2);
    expect(text).toBe('x');
    expect(view.getUint8(newOffset)).toBe(0x7F);
  });

  it('no lee fuera del buffer si el string viene truncado', () => {
    // Declara 10 chars pero solo hay 1
    const view = new DataView(bytes(10, 0x41, 0x00));
    expect(parseMtpString(view, 0).text).toBe('A');
  });

  it('offset fuera de rango devuelve string vacío', () => {
    const view = new DataView(bytes(1, 2));
    expect(parseMtpString(view, 5)).toEqual({ text: '', newOffset: 5 });
  });
});

describe('parseMtpUInt32Array', () => {
  it('lee count + elementos en little endian', () => {
    const view = new DataView(bytes(
      2, 0, 0, 0,
      0x01, 0x00, 0x01, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF,
    ));
    expect(parseMtpUInt32Array(view, 0)).toEqual({
      array: [0x00010001, 0xFFFFFFFF],
      newOffset: 12,
    });
  });

  it('corta en el fin del buffer si el count miente', () => {
    const view = new DataView(bytes(100, 0, 0, 0, 7, 0, 0, 0));
    expect(parseMtpUInt32Array(view, 0)).toEqual({ array: [7], newOffset: 8 });
  });

  it('buffer sin espacio para el count devuelve array vacío', () => {
    expect(parseMtpUInt32Array(new DataView(bytes(1, 2)), 0)).toEqual({ array: [], newOffset: 0 });
  });
});
