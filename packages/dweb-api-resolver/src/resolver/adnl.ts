import { base32 } from "rfc4648";

const crc16Xmodem = (data: Uint8Array): number => {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
};

export const adnlAddressToHostname = (adnlAddress: string): string | null => {
  if (!/^[0-9a-fA-F]{64}$/.test(adnlAddress)) {
    return null;
  }
  const payload = new Uint8Array(35);
  payload[0] = 0x2d;
  payload.set(Buffer.from(adnlAddress, "hex"), 1);
  const crc = crc16Xmodem(payload.subarray(0, 33));
  payload[33] = crc >> 8;
  payload[34] = crc & 0xff;
  return base32.stringify(payload).slice(1).toLowerCase();
};
