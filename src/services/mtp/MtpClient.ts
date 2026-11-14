import { USBManager } from '../usb/USBManager';
import { MtpPacket, parseMtpString, parseMtpUInt32Array, serializeMtpString } from './MtpPacket';
import { ContainerType, MtpOperationCode, MtpResponseCode, HEADER_LENGTH, MTP_PROP_OBJECT_FILENAME, MTP_PROP_OBJECT_SIZE, MTP_PROP_DATE_MODIFIED } from './MtpConstants';

export interface StorageInfo {
  storageType: number;
  filesystemType: number;
  accessCapability: number;
  maxCapacity: number;
  freeSpaceInBytes: number;
  freeSpaceInObjects: number;
  storageDescription: string;
  volumeIdentifier: string;
}

export interface ObjectInfo {
  storageID: number;
  objectFormat: number;
  protectionStatus: number;
  objectCompressedSize: number;
  thumbFormat: number;
  thumbCompressedSize: number;
  thumbPixWidth: number;
  thumbPixHeight: number;
  imagePixWidth: number;
  imagePixHeight: number;
  imageBitDepth: number;
  parentObject: number;
  associationType: number;
  associationDesc: number;
  sequenceNumber: number;
  filename: string;
  dateCreated: string;
  dateModified: string;
}

/** Tamaño de cada lectura bulk-in. */
const CHUNK_SIZE = 65536;

function abortError(): DOMException {
  return new DOMException('Download cancelled', 'AbortError');
}

export class MtpClient {
  private usbManager: USBManager;
  private transactionId: number = 0;
  private sessionId: number = 0;

  /**
   * Cola de transacciones. MTP admite una sola transacción a la vez sobre el
   * par de endpoints bulk: si dos operaciones se intercalan (p.ej. listado +
   * miniaturas + preview), cada una puede leer la respuesta de la otra.
   * Toda operación pública pasa por exclusive(), que la encadena detrás de
   * la anterior. Las operaciones largas (descargas, streaming de video)
   * retienen la cola hasta terminar o ser abortadas.
   */
  private queue: Promise<void> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  constructor() {
    this.usbManager = new USBManager();
  }

  public get isConnected(): boolean {
    return this.usbManager.isConnected;
  }

  public get deviceName(): string {
    return this.usbManager.deviceName;
  }

  public get currentUsbDevice(): USBDevice | null {
    return this.usbManager.currentUsbDevice;
  }


  public async connect(): Promise<void> {
    await this.usbManager.requestDevice();
    try { await this.getDeviceInfo(); } catch (e) {
      console.log('[MTP] GetDeviceInfo failed, continuing...', e);
    }
    await this.openSession();
  }

  /** Connect to a specific already-known USBDevice (no picker dialog) */
  public async connectTo(usbDevice: USBDevice): Promise<void> {
    await this.usbManager.connectTo(usbDevice);
    try { await this.getDeviceInfo(); } catch (e) {
      console.warn('[MTP] getDeviceInfo failed (continuing):', e);
    }
    await this.openSession();
  }

  public async disconnect(): Promise<void> {
    if (this.sessionId !== 0) {
      const closeSession = this.exclusive(async () => {
        await this.sendCommand(MtpOperationCode.CloseSession, [this.sessionId]);
        // IMPORTANT: must read the CloseSession response before closing the device.
        // On macOS, leaving unread data in the bulk-IN buffer puts the bulk-OUT
        // endpoint in a stall state. On reconnect, transferOut hangs indefinitely.
        await this.receiveResponse();
      }).catch(() => {
        // Ignore errors — device may have already disconnected
      });
      // Si hay una transferencia larga en curso, no esperar indefinidamente:
      // cerrar el dispositivo hace fallar los transfers pendientes y libera la cola.
      await Promise.race([closeSession, new Promise(r => setTimeout(r, 2000))]);
    }
    await this.usbManager.disconnect();
    this.sessionId = 0;
    this.transactionId = 0;
  }

  /** Envía un comando y devuelve su transaction ID (lo usa la fase de datos). */
  private async sendCommand(code: number, args: number[] = []): Promise<number> {
    const tid = ++this.transactionId;
    const packet = MtpPacket.buildCommand(code, tid, args);
    await this.usbManager.sendBulk(packet.serialize());
    return tid;
  }

  /**
   * Aborta la transacción [tid] a mitad de la fase de datos: Cancel Request
   * al dispositivo y luego clearHalt para descartar lo que quede en el pipe.
   */
  private async cancelTransaction(tid: number): Promise<void> {
    await this.usbManager.cancelRequest(tid);
    await this.usbManager.clearHalts();
  }

  private async receiveResponse(): Promise<MtpPacket> {
    const initialBuffer = await this.usbManager.receiveBulk(65536);

    if (initialBuffer.byteLength < HEADER_LENGTH) {
      if (initialBuffer.byteLength === 0) throw new Error('Received empty packet (0 bytes)');
      throw new Error(`Invalid response size: ${initialBuffer.byteLength}`);
    }

    const view = new DataView(initialBuffer);
    const totalLength = view.getUint32(0, true);

    if (totalLength <= initialBuffer.byteLength) {
      return MtpPacket.deserialize(initialBuffer);
    }

    let currentLength = initialBuffer.byteLength;
    const finalBuffer = new Uint8Array(totalLength);
    finalBuffer.set(new Uint8Array(initialBuffer), 0);

    while (currentLength < totalLength) {
      const remainingBytes = totalLength - currentLength;
      const chunk = await this.usbManager.receiveBulk(Math.min(remainingBytes, 65536));
      finalBuffer.set(new Uint8Array(chunk), currentLength);
      currentLength += chunk.byteLength;
    }

    return MtpPacket.deserialize(finalBuffer.buffer);
  }

  public getDeviceInfo(): Promise<void> {
    return this.exclusive(async () => {
      await this.sendCommand(MtpOperationCode.GetDeviceInfo);
    
      const dataPacket = await this.receiveResponse();
      if (dataPacket.type === ContainerType.Response) {
         console.log(`[MTP] GetDeviceInfo received immediate response (Code: 0x${dataPacket.code.toString(16)})`);
         return;
      }
    
      await this.receiveResponse(); // read final response
      console.log('[MTP] GetDeviceInfo completed');
    });
  }

  public openSession(): Promise<void> {
    return this.exclusive(async () => {
      this.sessionId = 1; // Basic session ID
      console.log('[MTP] Sending OpenSession...');
      await this.sendCommand(MtpOperationCode.OpenSession, [this.sessionId]);
      const response = await this.receiveResponse();
      console.log('[MTP] OpenSession response:', response);
    
      if (response.code === 0x201E) {
        console.log('[MTP] Session already open, proceeding normally.');
      } else if (response.code !== 0x2001) {
        console.warn(`[MTP] OpenSession unexpected code: 0x${response.code.toString(16)}`);
      } else {
        console.log('[MTP] OpenSession OK');
      }
    });
  }

  public getStorageIDs(): Promise<number[]> {
    return this.exclusive(async () => {
      console.log('[MTP] Sending GetStorageIDs...');
      await this.sendCommand(MtpOperationCode.GetStorageIDs);
    
      // Some devices might throw an immediate response if session is invalid.
      const dataPacket = await this.receiveResponse();
      console.log('[MTP] getStorageIDs first packet type:', dataPacket.type);
    
      if (dataPacket.type === ContainerType.Response) {
         console.error(`[MTP] Received Response instead of Data for GetStorageIDs! Code: 0x${dataPacket.code.toString(16)}`);
         return [];
      }

      if (dataPacket.type !== ContainerType.Data) {
        console.warn('[MTP] Expected Data packet for GetStorageIDs, got type:', dataPacket.type);
      }
    
      console.log('[MTP] Waiting for final Response for GetStorageIDs...');
      await this.receiveResponse(); // read final response
    
      if (!dataPacket.payload || dataPacket.payload.byteLength === 0) {
        console.warn('[MTP] Payload is empty for GetStorageIDs');
        return [];
      }

      const view = new DataView(dataPacket.payload);
      const { array } = parseMtpUInt32Array(view, 0);
      console.log('[MTP] Parsed Storage IDs:', array);
      return array;
    });
  }

  public getObjectHandles(storageId: number, parentFormat: number = 0, parentHandle: number = 0xFFFFFFFF): Promise<number[]> {
    return this.exclusive(async () => {
       // parentFormat = 0 means don't filter by format
       // parentHandle = 0xFFFFFFFF means root of the store, 0x00000000 means all objects in store
       await this.sendCommand(MtpOperationCode.GetObjectHandles, [storageId, parentFormat, parentHandle]);
     
       const dataPacket = await this.receiveResponse();
       if (dataPacket.type === ContainerType.Response) {
          // Empty response
          return [];
       }
     
       await this.receiveResponse(); // read final response
     
       const view = new DataView(dataPacket.payload);
       const { array } = parseMtpUInt32Array(view, 0);
       return array;
    });
  }

  public getObjectInfo(objectId: number): Promise<ObjectInfo | null> {
    return this.exclusive(async () => {
       await this.sendCommand(MtpOperationCode.GetObjectInfo, [objectId]);
       const dataPacket = await this.receiveResponse();
     
       if (dataPacket.type === ContainerType.Response) {
         return null;
       }

       await this.receiveResponse();

       const payload = dataPacket.payload;
       if (payload.byteLength < 52) return null; // Minimum size for info

       const view = new DataView(payload);
     
       let offset = 0;
       const storageID = view.getUint32(offset, true); offset += 4;
       const objectFormat = view.getUint16(offset, true); offset += 2;
       const protectionStatus = view.getUint16(offset, true); offset += 2;
       const objectCompressedSize = view.getUint32(offset, true); offset += 4;
       const thumbFormat = view.getUint16(offset, true); offset += 2;
       const thumbCompressedSize = view.getUint32(offset, true); offset += 4;
       const thumbPixWidth = view.getUint32(offset, true); offset += 4;
       const thumbPixHeight = view.getUint32(offset, true); offset += 4;
       const imagePixWidth = view.getUint32(offset, true); offset += 4;
       const imagePixHeight = view.getUint32(offset, true); offset += 4;
       const imageBitDepth = view.getUint32(offset, true); offset += 4;
       const parentObject = view.getUint32(offset, true); offset += 4;
       const associationType = view.getUint16(offset, true); offset += 2;
       const associationDesc = view.getUint32(offset, true); offset += 4;
       const sequenceNumber = view.getUint32(offset, true); offset += 4;

       const filenameResult = parseMtpString(view, offset);
       offset = filenameResult.newOffset;
       const filename = filenameResult.text;

       const dateCreatedResult = parseMtpString(view, offset);
       offset = dateCreatedResult.newOffset;
       const dateCreated = dateCreatedResult.text;

       const dateModified = parseMtpString(view, offset).text;

       return {
         storageID, objectFormat, protectionStatus, objectCompressedSize,
         thumbFormat, thumbCompressedSize, thumbPixWidth, thumbPixHeight,
         imagePixWidth, imagePixHeight, imageBitDepth, parentObject,
         associationType, associationDesc, sequenceNumber, filename,
         dateCreated, dateModified
       };
    });
  }

  /**
   * GetObject (0x1009).
   *
   * Cuando se provee `onChunk`, cada bloque USB se entrega al callback en lugar
   * de acumularse en memoria → el llamador puede escribirlo directamente al disco
   * (FSAA) sin mantener el archivo completo en el heap. En ese caso retorna null.
   *
   * Sin `onChunk` acumula los bloques en un array y devuelve un Blob (fallback
   * para navegadores sin File System Access API).
   *
   * Retorna null si el dispositivo responde con error en lugar de datos.
   * Lanza si la transferencia queda incompleta o es abortada; en ese caso la
   * transacción se cancela en el dispositivo para dejar el pipe limpio.
   */
  public getObject(
    objectId: number,
    onChunk?: (chunk: ArrayBuffer) => Promise<void>,
    signal?: AbortSignal,
    knownSize?: number,
  ): Promise<Blob | null> {
    return this.exclusive(async () => {
      if (signal?.aborted) throw abortError();
      const tid = await this.sendCommand(MtpOperationCode.GetObject, [objectId]);

      // Leer el primer paquete USB para ver el tipo de contenedor y el tamaño total.
      // NO usar receiveResponse() genérico: para archivos grandes aloca un único
      // ArrayBuffer del tamaño del archivo, lo que falla con RangeError.
      const initial = await this.usbManager.receiveBulk(CHUNK_SIZE);
      if (initial.byteLength < HEADER_LENGTH) {
        throw new Error(`Respuesta MTP inválida (${initial.byteLength} bytes)`);
      }

      const view = new DataView(initial);
      // El dispositivo devolvió un error en lugar de datos
      if (view.getUint16(4, true) === ContainerType.Response) return null;

      // Longitud del contenedor (32-bit). Por especificación MTP, 0xFFFFFFFF
      // indica un objeto ≥ 4 GB: los datos siguen sin prefijo y el tamaño real
      // hay que conocerlo por otro lado (knownSize, de GetObjectPropValue
      // 64-bit). Si tampoco hay knownSize, se lee hasta el paquete corto que
      // marca el fin de la fase de datos.
      const reportedLength = view.getUint32(0, true);
      let payloadSize: number | null;
      if (reportedLength !== 0xFFFFFFFF) {
        payloadSize = Math.max(0, reportedLength - HEADER_LENGTH);
      } else {
        payloadSize = knownSize && knownSize > 0 ? knownSize : null;
      }

      const parts: ArrayBuffer[] = [];
      const handleChunk = async (chunk: ArrayBuffer) => {
        if (onChunk) await onChunk(chunk);
        else parts.push(chunk);
      };

      try {
        if (initial.byteLength > HEADER_LENGTH) {
          await handleChunk(initial.slice(HEADER_LENGTH));
        }
        let received = initial.byteLength - HEADER_LENGTH;
        let lastWanted = CHUNK_SIZE;
        let lastLength = initial.byteLength;

        while (payloadSize === null ? lastLength === lastWanted : received < payloadSize) {
          if (signal?.aborted) throw abortError();
          lastWanted = payloadSize === null ? CHUNK_SIZE : Math.min(payloadSize - received, CHUNK_SIZE);
          const chunk = await this.usbManager.receiveBulk(lastWanted);
          lastLength = chunk.byteLength;
          if (chunk.byteLength === 0) break;
          await handleChunk(chunk);
          received += chunk.byteLength;
        }

        if (payloadSize !== null && received < payloadSize) {
          throw new Error(`Transferencia incompleta: ${received} de ${payloadSize} bytes`);
        }
      } catch (e) {
        await this.cancelTransaction(tid);
        throw e;
      }

      const response = await this.receiveResponse(); // paquete de respuesta final
      if (response.code !== MtpResponseCode.OK) {
        throw new Error(`GetObject falló: 0x${response.code.toString(16)}`);
      }
      return onChunk ? null : new Blob(parts);
    });
  }

  /**
   * GetThumb (0x100A) — fetches the embedded JPEG thumbnail for an image object.
   * Returns null if the device doesn't support thumbnails or the object has none.
   */
  public getThumb(objectHandle: number): Promise<Blob | null> {
    return this.exclusive(async () => {
      try {
        await this.sendCommand(MtpOperationCode.GetThumb, [objectHandle]);
        const dataPacket = await this.receiveResponse();

        if (dataPacket.type === ContainerType.Response) {
          // Device returned a response directly — no thumbnail available
          return null;
        }

        // Read trailing response packet
        await this.receiveResponse();

        if (!dataPacket.payload || dataPacket.payload.byteLength === 0) {
          return null;
        }

        return new Blob([dataPacket.payload], { type: 'image/jpeg' });
      } catch (e) {
        console.warn(`[MTP] GetThumb failed for handle ${objectHandle}:`, e);
        return null;
      }
    });
  }

  /**
   * CreateFolder — uses SendObjectInfo (0x100C) to create an Association object.
   * For folders (Association), no subsequent SendObject is required per the MTP spec.
   * Returns the new folder's object handle.
   */
  public createFolder(name: string, parentId: number, storageId: number): Promise<number> {
    const nameBytes  = serializeMtpString(name);
    return this.exclusive(async () => {
      const emptyStr   = serializeMtpString('');

      // ObjectInfo fixed fields: 52 bytes
      // StorageID(4) ObjectFormat(2) Protection(2) Size(4) ThumbFmt(2) ThumbSize(4)
      // ThumbW(4) ThumbH(4) ImgW(4) ImgH(4) Depth(4) Parent(4) AssocType(2)
      // AssocDesc(4) SeqNum(4)  = 52 bytes
      const fixedSize = 52;
      const bufSize = fixedSize + nameBytes.byteLength + emptyStr.byteLength * 3;
      const buf  = new ArrayBuffer(bufSize);
      const view = new DataView(buf);
      let off = 0;

      view.setUint32(off, storageId,  true); off += 4; // StorageID
      view.setUint16(off, 0x3001,     true); off += 2; // ObjectFormat = Association (folder)
      view.setUint16(off, 0,          true); off += 2; // ProtectionStatus
      view.setUint32(off, 0,          true); off += 4; // ObjectCompressedSize
      view.setUint16(off, 0,          true); off += 2; // ThumbFormat
      view.setUint32(off, 0,          true); off += 4; // ThumbCompressedSize
      view.setUint32(off, 0,          true); off += 4; // ThumbPixWidth
      view.setUint32(off, 0,          true); off += 4; // ThumbPixHeight
      view.setUint32(off, 0,          true); off += 4; // ImagePixWidth
      view.setUint32(off, 0,          true); off += 4; // ImagePixHeight
      view.setUint32(off, 0,          true); off += 4; // ImageBitDepth
      view.setUint32(off, parentId,   true); off += 4; // ParentObject
      view.setUint16(off, 0x0001,     true); off += 2; // AssociationType = GenericFolder
      view.setUint32(off, 0,          true); off += 4; // AssociationDesc
      view.setUint32(off, 0,          true); off += 4; // SequenceNumber

      // Variable-length strings
      new Uint8Array(buf, off).set(new Uint8Array(nameBytes)); off += nameBytes.byteLength;
      new Uint8Array(buf, off).set(new Uint8Array(emptyStr));  off += emptyStr.byteLength; // DateCreated
      new Uint8Array(buf, off).set(new Uint8Array(emptyStr));  off += emptyStr.byteLength; // DateModified
      new Uint8Array(buf, off).set(new Uint8Array(emptyStr));                               // Keywords

      const tid        = await this.sendCommand(MtpOperationCode.SendObjectInfo, [storageId, parentId]);
      const dataPacket = MtpPacket.buildData(MtpOperationCode.SendObjectInfo, tid, buf);
      await this.usbManager.sendBulk(dataPacket.serialize());

      const response = await this.receiveResponse();
      if (response.code !== MtpResponseCode.OK) {
        throw new Error(`CreateFolder failed: 0x${response.code.toString(16)}`);
      }
      // Response params[0]=storageId, params[1]=parentHandle, params[2]=new objectHandle
      const params = response.getResponseParams();
      return params[2] ?? 0;
    });
  }

  /**
   * DeleteObject (0x100B) — permanently deletes an object from the device.
   * For folders, most devices delete recursively.
   */
  public deleteObject(objectId: number): Promise<void> {
    return this.exclusive(async () => {
      await this.sendCommand(MtpOperationCode.DeleteObject, [objectId, 0x0000]);
      const response = await this.receiveResponse();
      if (response.code !== MtpResponseCode.OK) {
        throw new Error(`DeleteObject failed: 0x${response.code.toString(16)}`);
      }
    });
  }

  /**
   * MoveObject (0x1019) — moves an object to a different parent folder.
   * Returns the new object handle (may differ from the original on some devices).
   */
  public moveObject(objectId: number, storageId: number, newParentId: number): Promise<number> {
    return this.exclusive(async () => {
      await this.sendCommand(MtpOperationCode.MoveObject, [objectId, storageId, newParentId]);
      const response = await this.receiveResponse();
      if (response.code !== MtpResponseCode.OK) {
        throw new Error(`MoveObject failed: 0x${response.code.toString(16)}`);
      }
      const params = response.getResponseParams();
      return params[0] ?? objectId;
    });
  }

  /**
   * RenameObject — uses SetObjectPropValue (0x1016) to change the filename property.
   *
   * Some OEM Android firmwares (Xiaomi, Samsung custom ROMs, etc.) send a
   * proprietary non-standard intermediate response code (e.g. 0x200) right after
   * the command phase, before our data reaches them. Valid MTP response codes start
   * at 0x2000, so any code below that is treated as an intermediate packet and we
   * read one more response to get the actual result.
   */
  public renameObject(objectId: number, newName: string): Promise<void> {
    const payload = serializeMtpString(newName);
    return this.exclusive(async () => {
      const tid = await this.sendCommand(MtpOperationCode.SetObjectPropValue, [objectId, MTP_PROP_OBJECT_FILENAME]);
      const dataPacket = MtpPacket.buildData(MtpOperationCode.SetObjectPropValue, tid, payload);
      await this.usbManager.sendBulk(dataPacket.serialize());

      let response = await this.receiveResponse();

      // If the code is below the valid MTP response range (0x2000+), it's a
      // non-standard intermediate packet from OEM firmware — read the real response.
      if (response.code < 0x2000) {
        console.log(`[MTP] RenameObject: got intermediate code 0x${response.code.toString(16)}, reading final response...`);
        try {
          response = await this.receiveResponse();
        } catch (e) {
          // USB transfer timed out or failed — the intermediate was the only response.
          // Fall through and report it as an error below.
          console.warn('[MTP] RenameObject: failed to read second response after intermediate', e);
        }
      }

      if (response.code !== MtpResponseCode.OK) {
        const knownErrors: Record<number, string> = {
          [MtpResponseCode.OperationNotSupported]: 'El dispositivo no permite renombrar archivos',
          [MtpResponseCode.AccessDenied]:          'Acceso denegado: el archivo está protegido',
          [MtpResponseCode.ObjectWriteProtected]:  'El archivo está protegido contra escritura',
          [MtpResponseCode.InvalidObjectHandle]:   'El archivo ya no existe en el dispositivo',
          [MtpResponseCode.GeneralError]:          'Error general del dispositivo',
        };
        const msg = knownErrors[response.code]
          ?? `El dispositivo rechazó el renombrado (código 0x${response.code.toString(16)})`;
        throw new Error(msg);
      }
    });
  }

  /**
   * GetObjectPropValue (0x9803) — reads a single property of an object.
   * Returns the raw payload DataView; caller interprets the type.
   */
  public getObjectPropValue(objectId: number, propCode: number): Promise<DataView | null> {
    return this.exclusive(async () => {
      try {
        await this.sendCommand(MtpOperationCode.GetObjectPropValue, [objectId, propCode]);
        const dataPacket = await this.receiveResponse();
        if (dataPacket.type === ContainerType.Response) return null;
        await this.receiveResponse();
        return new DataView(dataPacket.payload);
      } catch {
        return null;
      }
    });
  }

  /**
   * Returns the 64-bit size (as number) and dateModified string for an object,
   * using GetObjectPropValue as a fallback when GetObjectInfo returns size=0.
   */
  public async getObjectSizeAndDate(objectId: number, fallbackSize: number, fallbackDate: string): Promise<{ size: number; dateModified: string }> {
    let size = fallbackSize;
    let dateModified = fallbackDate;

    if (size === 0 || size === 0xFFFFFFFF) {
      const view = await this.getObjectPropValue(objectId, MTP_PROP_OBJECT_SIZE);
      if (view && view.byteLength >= 8) {
        // UInt64 little-endian — JavaScript can't represent >53-bit integers exactly,
        // but file sizes in practice fit safely within Number.MAX_SAFE_INTEGER (8 PB).
        const lo = view.getUint32(0, true);
        const hi = view.getUint32(4, true);
        size = hi * 0x100000000 + lo;
      }
    }

    if (!dateModified) {
      const view = await this.getObjectPropValue(objectId, MTP_PROP_DATE_MODIFIED);
      if (view && view.byteLength > 0) {
        dateModified = parseMtpString(view, 0).text;
      }
    }

    return { size, dateModified };
  }
}
