export const MtpOperationCode = {
  OpenSession: 0x1002,
  CloseSession: 0x1003,
  GetStorageIDs: 0x1004,
  GetStorageInfo: 0x1005,
  GetNumObjects: 0x1006,
  GetObjectHandles: 0x1007,
  GetObjectInfo: 0x1008,
  GetObject: 0x1009,
  GetThumb: 0x100A,
  DeleteObject: 0x100B,
  SendObjectInfo: 0x100C,
  GetDevicePropDesc: 0x1014,
  GetDevicePropValue: 0x1015,
  SetObjectPropValue: 0x1016,
  GetDeviceInfo: 0x1001,
  MoveObject: 0x1019,
  GetObjectPropValue: 0x9803,
} as const;

/** MTP property code for the object filename */
export const MTP_PROP_OBJECT_FILENAME = 0xDC07;
/** MTP property code for 64-bit object size */
export const MTP_PROP_OBJECT_SIZE = 0xDC11;
/** MTP property code for date modified (string, ISO 8601) */
export const MTP_PROP_DATE_MODIFIED = 0xDC09;
/** MTP property code for date created (string, ISO 8601) */
export const MTP_PROP_DATE_CREATED = 0xDC08;

export const MtpResponseCode = {
  Undefined: 0x2000,
  OK: 0x2001,
  GeneralError: 0x2002,
  SessionNotOpen: 0x2003,
  InvalidTransactionID: 0x2004,
  OperationNotSupported: 0x2005,
  ParameterNotSupported: 0x2006,
  IncompleteTransfer: 0x2007,
  InvalidStorageID: 0x2008,
  InvalidObjectHandle: 0x2009,
  DevicePropNotSupported: 0x200A,
  InvalidObjectFormatCode: 0x200B,
  StoreFull: 0x200C,
  ObjectWriteProtected: 0x200D,
  StoreReadOnly: 0x200E,
  AccessDenied: 0x200F,
  DeviceBusy: 0x2019,
} as const;

export const MtpDataType = {
  Undefined: 0x0000,
  Int8: 0x0001,
  UInt8: 0x0002,
  Int16: 0x0003,
  UInt16: 0x0004,
  Int32: 0x0005,
  UInt32: 0x0006,
  Int64: 0x0007,
  UInt64: 0x0008,
  Int128: 0x0009,
  UInt128: 0x000A,
  ArrayInt8: 0x4001,
  ArrayUInt8: 0x4002,
  ArrayInt16: 0x4003,
  ArrayUInt16: 0x4004,
  ArrayInt32: 0x4005,
  ArrayUInt32: 0x4006,
  ArrayInt64: 0x4007,
  ArrayUInt64: 0x4008,
  ArrayInt128: 0x4009,
  ArrayUInt128: 0x400A,
  String: 0xFFFF,
} as const;

export const ContainerType = {
  Undefined: 0,
  Command: 1,
  Data: 2,
  Response: 3,
  Event: 4,
} as const;

// Define types representing the values of the constants
export type ContainerType = typeof ContainerType[keyof typeof ContainerType];

export const HEADER_LENGTH = 12;
