/// <reference types="w3c-web-usb" />

export interface ConnectedUSBDevice {
  usbDevice: USBDevice;
  name: string;
}

interface MtpEndpoints {
  iface: USBInterface;
  alt: USBAlternateInterface;
  bulkIn: number;
  bulkOut: number;
}

/** Copia exacta de los bytes de un DataView (respeta byteOffset/byteLength). */
function dataViewToBuffer(view: DataView): ArrayBuffer {
  return (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export class USBManager {
  private device: USBDevice | null = null;
  private interfaceNumber: number = -1;
  private endpointIn: number = -1;
  private endpointOut: number = -1;

  /** Devices currently being probed — prevents concurrent probes on the same device */
  private static readonly probingDevices = new Set<string>();

  private static deviceKey(d: USBDevice): string {
    return `${d.vendorId}-${d.productId}-${d.serialNumber ?? ''}`;
  }

  public get isConnected(): boolean {
    return this.device !== null && this.device.opened;
  }

  public get deviceName(): string {
    return this.device
      ? `${this.device.manufacturerName ?? ''} ${this.device.productName ?? ''}`.trim()
      : '';
  }

  public get currentUsbDevice(): USBDevice | null {
    return this.device;
  }

  /**
   * Finds the MTP interface and endpoint numbers on a device.
   * MTP requires bulk-in + bulk-out + interrupt-in. Candidates are ranked so
   * the ADB interface (vendor class 0xFF, subclass 0x42 — bulk only) is never
   * picked when USB debugging is on:
   *   1. Still Image class (0x06) — the standard MTP/PTP class
   *   2. Vendor class with bulk + interrupt (Android MTP without PTP)
   *   3. Any other interface with bulk + interrupt
   * Returns null if no MTP interface is found.
   */
  private static findMTPEndpoints(device: USBDevice): MtpEndpoints | null {
    let best: { score: number; ep: MtpEndpoints } | null = null;
    try {
      for (const config of device.configurations ?? []) {
        for (const iface of config.interfaces) {
          for (const alt of iface.alternates) {
            const bIn  = alt.endpoints.find((e: USBEndpoint) => e.direction === 'in'  && e.type === 'bulk');
            const bOut = alt.endpoints.find((e: USBEndpoint) => e.direction === 'out' && e.type === 'bulk');
            const intIn = alt.endpoints.find((e: USBEndpoint) => e.direction === 'in' && e.type === 'interrupt');
            if (!bIn || !bOut || !intIn) continue;
            if (alt.interfaceClass === 0xFF && alt.interfaceSubclass === 0x42) continue; // ADB
            const score = alt.interfaceClass === 0x06 ? 3 : alt.interfaceClass === 0xFF ? 2 : 1;
            if (!best || score > best.score) {
              best = { score, ep: { iface, alt, bulkIn: bIn.endpointNumber, bulkOut: bOut.endpointNumber } };
            }
          }
        }
      }
    } catch { /* ignore */ }
    return best?.ep ?? null;
  }

  /** Claims the MTP interface and switches to the matching alternate setting if needed. */
  private static async claimMTP(device: USBDevice, ep: MtpEndpoints): Promise<void> {
    await device.claimInterface(ep.iface.interfaceNumber);
    if (ep.iface.alternate?.alternateSetting !== ep.alt.alternateSetting) {
      await device.selectAlternateInterface(ep.iface.interfaceNumber, ep.alt.alternateSetting);
    }
  }

  /**
   * Probes whether the device is truly in MTP file-transfer mode.
   *
   * Samsung (and other OEMs) run the MTP stack even in charging-only mode,
   * so GetDeviceInfo responds in both modes. The definitive check is:
   *   OpenSession → GetStorageIDs → if count > 0 → real MTP mode.
   * In charging mode there are no mounted storages, so count == 0.
   * The session is closed cleanly so the subsequent real connection is not affected.
   */
  private static async probeIsMTPActive(device: USBDevice): Promise<boolean> {
    const endpoints = USBManager.findMTPEndpoints(device);
    if (!endpoints) return false;
    const { bulkIn, bulkOut } = endpoints;
    const ifaceNumber = endpoints.iface.interfaceNumber;

    const buildCmd = (code: number, tid: number, params: number[] = []) => {
      const buf = new Uint8Array(12 + params.length * 4);
      const v = new DataView(buf.buffer);
      v.setUint32(0, buf.byteLength, true);
      v.setUint16(4, 0x0001, true); // type: command
      v.setUint16(6, code, true);
      v.setUint32(8, tid, true);
      params.forEach((p, i) => v.setUint32(12 + i * 4, p, true));
      return buf;
    };

    // Read one USB packet with an optional timeout (ms). Returns null on timeout.
    const recv = (timeoutMs = 1500): Promise<USBInTransferResult | null> => {
      const p = device.transferIn(bulkIn, 65536);
      const t = new Promise<null>(r => setTimeout(() => r(null), timeoutMs));
      const result = Promise.race([p.then(x => x), t]);
      result.then(() => {}).catch(() => {});
      p.catch(() => {}); // silence unhandled rejection if we time out first
      return result;
    };

    const responseCode = (r: USBInTransferResult | null): number => {
      if (!r || r.status !== 'ok' || !r.data || r.data.byteLength < 8) return 0;
      return r.data.getUint16(6, true);
    };

    const packetType = (r: USBInTransferResult | null): number => {
      if (!r || r.status !== 'ok' || !r.data || r.data.byteLength < 6) return 0;
      return r.data.getUint16(4, true);
    };

    const key = USBManager.deviceKey(device);
    if (USBManager.probingDevices.has(key)) return false;
    USBManager.probingDevices.add(key);

    try {
      await device.open();
      if (!device.configuration) await device.selectConfiguration(1);
      await USBManager.claimMTP(device, endpoints);

      // ── OpenSession (0x1002) ────────────────────────────────────────
      await device.transferOut(bulkOut, buildCmd(0x1002, 1, [1]));
      let openR = await recv();
      // Some OEM firmware sends a non-standard intermediate packet first
      if (openR && packetType(openR) < 0x0003) openR = await recv(800);

      const openCode = responseCode(openR);
      if (openCode !== 0x2001 /* OK */ && openCode !== 0x201E /* SessionAlreadyOpen */) {
        console.log(`[USBManager] OpenSession failed (code=0x${openCode.toString(16)}) → not MTP`);
        await device.releaseInterface(ifaceNumber);
        await device.close();
        return false;
      }

      // ── GetStorageIDs (0x1004) ──────────────────────────────────────
      await device.transferOut(bulkOut, buildCmd(0x1004, 2));
      const storageDataR = await recv();

      let hasStorages = false;
      if (storageDataR && packetType(storageDataR) === 0x0002 /* data */) {
        const count = storageDataR.data!.getUint32(12, true);
        hasStorages = count > 0;
        await recv(800); // consume the following response packet
      }


      // ── CloseSession (0x1007) ───────────────────────────────────────
      try {
        await device.transferOut(bulkOut, buildCmd(0x1007, 3));
        await recv(1000);
      } catch { /* ignore — best effort */ }

      await device.releaseInterface(ifaceNumber);
      await device.close();
      return hasStorages;
    } catch {
      try { await device.releaseInterface(ifaceNumber); } catch { /* ignore */ }
      try { await device.close(); } catch { /* ignore */ }
      return false;
    } finally {
      USBManager.probingDevices.delete(key);
    }
  }

  /**
   * Returns all USB devices already granted permission by the user
   * that are currently in MTP mode (MTP stack is running and claimable).
   * Devices connected in charging-only mode are excluded.
   */
  public static async listGrantedDevices(): Promise<ConnectedUSBDevice[]> {
    if (!navigator.usb) return [];
    const devices = await navigator.usb.getDevices();
    const results: ConnectedUSBDevice[] = [];
    for (const d of devices) {
      if (d.opened) continue; // already in use by this session — skip probe
      const active = await USBManager.probeIsMTPActive(d);
      if (active) {
        results.push({
          usbDevice: d,
          name: `${d.manufacturerName ?? ''} ${d.productName ?? ''}`.trim() || 'USB Device',
        });
      }
    }
    return results;
  }

  /**
   * Opens a picker dialog and returns the selected device (grants permission).
   */
  public async requestDevice(): Promise<void> {
    if (!navigator.usb) {
      throw new Error('WebUSB API not supported in this browser.');
    }
    this.device = await navigator.usb.requestDevice({ filters: [] });
    await this.connectToDevice(this.device);
  }

  /**
   * Connects to a specific USBDevice that already had permission granted.
   */
  public async connectTo(usbDevice: USBDevice): Promise<void> {
    this.device = usbDevice;
    await this.connectToDevice(this.device);
  }

  /**
   * Internal: claims the MTP interface and finds bulk endpoints.
   */
  private async connectToDevice(device: USBDevice): Promise<void> {
    await device.open();

    if (!device.configuration) {
      await device.selectConfiguration(1);
    }

    const ep = USBManager.findMTPEndpoints(device);
    if (!ep) {
      await device.close();
      throw new Error('MTP interface not found on this device');
    }

    try {
      await USBManager.claimMTP(device, ep);
    } catch (e) {
      await device.close().catch(() => {});
      throw e;
    }

    this.interfaceNumber = ep.iface.interfaceNumber;
    this.endpointIn = ep.bulkIn;
    this.endpointOut = ep.bulkOut;
  }

  public async disconnect(): Promise<void> {
    if (this.device && this.device.opened) {
      try {
        await this.device.releaseInterface(this.interfaceNumber);
        await this.device.close();
      } catch (e) {
        console.error('Error disconnecting:', e);
      }
    }
    this.device = null;
    this.interfaceNumber = -1;
    this.endpointIn = -1;
    this.endpointOut = -1;
  }

  public async sendBulk(data: ArrayBuffer): Promise<void> {
    if (!this.isConnected) throw new Error('Device not connected');
    const result = await this.device!.transferOut(this.endpointOut, data);
    if (result.status !== 'ok') {
      throw new Error(`Bulk transfer out failed: ${result.status}`);
    }
  }

  public async receiveBulk(length = 65536): Promise<ArrayBuffer> {
    if (!this.isConnected) throw new Error('Device not connected');
    const result = await this.device!.transferIn(this.endpointIn, length);
    if (result.status !== 'ok') {
      throw new Error(`Bulk transfer in failed: ${result.status}`);
    }
    if (!result.data) return new ArrayBuffer(0);
    return dataViewToBuffer(result.data);
  }

  /**
   * MTP class request "Cancel Request" (0x64): le pide al dispositivo que
   * aborte la transacción [transactionId] en curso. Best effort — algunos
   * dispositivos no lo implementan.
   */
  public async cancelRequest(transactionId: number): Promise<void> {
    if (!this.device?.opened) return;
    const data = new DataView(new ArrayBuffer(6));
    data.setUint16(0, 0x4001, true); // Cancellation code
    data.setUint32(2, transactionId, true);
    try {
      await this.device.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x64,
        value: 0,
        index: this.interfaceNumber,
      }, data);
    } catch { /* ignore */ }
  }

  /**
   * Limpia el estado de los endpoints bulk después de una transferencia abortada.
   * clearHalt resetea el data-toggle y descarta cualquier paquete pendiente en el
   * endpoint, dejando el pipe listo para la siguiente operación MTP.
   */
  public async clearHalts(): Promise<void> {
    if (!this.device?.opened) return;
    try { await this.device.clearHalt('in',  this.endpointIn);  } catch { /* ignore */ }
    try { await this.device.clearHalt('out', this.endpointOut); } catch { /* ignore */ }
  }
}
