import { ContainerType, HEADER_LENGTH } from './MtpConstants';

export class MtpPacket {
  public length: number;
  public type: ContainerType;
  public code: number;
  public transactionId: number;
  public payload: ArrayBuffer;

  constructor(
    type: ContainerType,
    code: number,
    transactionId: number,
    payload: ArrayBuffer = new ArrayBuffer(0)
  ) {
    this.type = type;
    this.code = code;
    this.transactionId = transactionId;
    this.payload = payload;
    this.length = HEADER_LENGTH + payload.byteLength;
  }

  /**
   * Serializes the MtpPacket into an ArrayBuffer for transmission.
   * Format (Little Endian):
   * 4 bytes: Length
   * 2 bytes: ContainerType
   * 2 bytes: Code (Operation/Response code)
   * 4 bytes: TransactionID
   * N bytes: Payload
   */
  public serialize(): ArrayBuffer {
    const buffer = new ArrayBuffer(this.length);
    const view = new DataView(buffer);

    view.setUint32(0, this.length, true); // Little endian
    view.setUint16(4, this.type, true);
    view.setUint16(6, this.code, true);
    view.setUint32(8, this.transactionId, true);

    const payloadView = new Uint8Array(this.payload);
    const resultView = new Uint8Array(buffer);
    resultView.set(payloadView, HEADER_LENGTH);

    return buffer;
  }

  /**
   * Parses an ArrayBuffer (from WebUSB BulkIn) into an MtpPacket.
   */
  public static deserialize(buffer: ArrayBuffer): MtpPacket {
    if (buffer.byteLength < HEADER_LENGTH) {
      throw new Error(`Buffer too small to be an MTP packet: ${buffer.byteLength} bytes`);
    }

    const view = new DataView(buffer);
    const length = view.getUint32(0, true);
    const type = view.getUint16(4, true);
    const code = view.getUint16(6, true);
    const transactionId = view.getUint32(8, true);

    const payloadLength = length > HEADER_LENGTH ? length - HEADER_LENGTH : 0;
    const payload = buffer.slice(HEADER_LENGTH, HEADER_LENGTH + payloadLength);

    const packet = new MtpPacket(type as ContainerType, code, transactionId, payload);
    packet.length = length;
    return packet;
  }

  /**
   * Helper to append uint32 arguments to a command
   */
  public static buildCommand(
    code: number,
    transactionId: number,
    args: number[] = []
  ): MtpPacket {
    const payload = new ArrayBuffer(args.length * 4);
    const view = new DataView(payload);
    for (let i = 0; i < args.length; i++) {
      view.setUint32(i * 4, args[i], true);
    }
    return new MtpPacket(ContainerType.Command, code, transactionId, payload);
  }

  /**
   * Builds a data-phase packet to send to the device (e.g. for SetObjectPropValue).
   */
  public static buildData(
    code: number,
    transactionId: number,
    payload: ArrayBuffer
  ): MtpPacket {
    return new MtpPacket(ContainerType.Data, code, transactionId, payload);
  }

  /** Parse uint32 parameters out of a response payload */
  public getResponseParams(): number[] {
    const params: number[] = [];
    const view = new DataView(this.payload);
    for (let i = 0; i + 4 <= this.payload.byteLength; i += 4) {
      params.push(view.getUint32(i, true));
    }
    return params;
  }
}

/**
 * Serializes a JS string into an MTP UTF-16LE string payload.
 * Format: 1-byte char count (including null terminator), then UTF-16LE chars, then null terminator.
 * If the string is empty, returns a 1-byte buffer with value 0.
 */
export function serializeMtpString(text: string): ArrayBuffer {
  if (!text) {
    const buf = new ArrayBuffer(1);
    new DataView(buf).setUint8(0, 0);
    return buf;
  }
  const charCount = text.length + 1; // +1 for null terminator
  const buf = new ArrayBuffer(1 + charCount * 2);
  const view = new DataView(buf);
  view.setUint8(0, charCount);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(1 + i * 2, text.charCodeAt(i), true);
  }
  // null terminator already zero (ArrayBuffer zero-filled)
  return buf;
}

/**
 * Parses an MTP UTF-16LE string from a DataView.
 * MTP strings start with a 1-byte length character count (not bytes),
 * followed by that many 16-bit unicode characters, ending with a null terminator.
 */
export function parseMtpString(view: DataView, offset: number): { text: string; newOffset: number } {
  if (offset >= view.byteLength) return { text: '', newOffset: offset };
  
  const charCount = view.getUint8(offset);
  offset += 1;
  
  if (charCount === 0 || offset >= view.byteLength) {
    return { text: '', newOffset: offset };
  }

  let result = '';
  // charCount includes the null terminator in most implementations
  const lengthToRead = charCount > 0 ? charCount - 1 : 0;
  
  for (let i = 0; i < lengthToRead; i++) {
    if (offset + 1 < view.byteLength) {
      const charCode = view.getUint16(offset, true);
      if (charCode !== 0) {
        result += String.fromCharCode(charCode);
      }
      offset += 2;
    }
  }
  
  // Skip the null terminator if it exists
  if (charCount > 0 && offset + 1 < view.byteLength) {
    offset += 2;
  }
  
  return { text: result, newOffset: offset };
}

/**
 * Parses an array of UInt32s.
 * Format: 4-byte element count N, followed by N * 4 bytes of elements.
 */
export function parseMtpUInt32Array(view: DataView, offset: number): { array: number[]; newOffset: number } {
  if (offset + 4 > view.byteLength) return { array: [], newOffset: offset };
  
  const count = view.getUint32(offset, true);
  offset += 4;
  
  const array: number[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 4 > view.byteLength) break;
    array.push(view.getUint32(offset, true));
    offset += 4;
  }
  
  return { array, newOffset: offset };
}
