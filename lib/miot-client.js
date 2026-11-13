'use strict';

const { createSocket } = require('node:dgram');
const { createHash, createCipheriv, createDecipheriv, randomInt, timingSafeEqual } = require('node:crypto');

const PORT = 54321;
const TIMEOUT = 1500;
const HEADER_SIZE = 32;
const MAGIC = 0x2131;
const HELLO = Buffer.alloc(HEADER_SIZE, 0xff);
HELLO.writeUInt16BE(MAGIC, 0);
HELLO.writeUInt16BE(HEADER_SIZE, 2);

function md5(...parts) {
  const hash = createHash('md5');
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

function validHeader(packet) {
  return packet.length >= HEADER_SIZE &&
    packet.readUInt16BE(0) === MAGIC &&
    packet.readUInt16BE(2) === packet.length;
}

class MiotClient {
  constructor(ip, token) {
    this.ip = ip;
    this.token = Buffer.from(token, /^[a-f0-9]{32}$/i.test(token) ? 'hex' : 'ascii');
    this.key = md5(this.token);
    this.iv = md5(this.key, this.token);
    this.requestId = randomInt(1, 9999);
  }

  exchange(packet, parse) {
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4');
      let done = false;
      const finish = (error, response) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        socket.close();
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      };
      const timeout = setTimeout(() => finish(new Error('No reply from fridge. Check the IP address, LAN access, and token.')), TIMEOUT);
      socket.on('error', () => finish(new Error('Unable to reach fridge over the LAN.')));
      socket.on('message', (reply, remote) => {
        if (remote.address !== this.ip || remote.port !== PORT || !validHeader(reply)) {
          return;
        }
        try {
          const response = parse(reply);
          if (response !== undefined) {
            finish(null, response);
          }
        } catch (error) {
          finish(error);
        }
      });
      socket.send(packet, PORT, this.ip, (error) => {
        if (error) {
          finish(new Error('Unable to send request to the fridge.'));
        }
      });
    });
  }

  async handshake() {
    const reply = await this.exchange(HELLO, (packet) => {
      if (packet.length === HEADER_SIZE && !packet.equals(HELLO)) {
        return packet;
      }
    });
    const deviceId = reply.readUInt32BE(8);
    if (this.authenticatedDeviceId !== undefined && this.authenticatedDeviceId !== deviceId) {
      throw new Error('A different device is using this IP address. Check the fridge configuration.');
    }
    this.deviceId = deviceId;
    this.timestamp = reply.readUInt32BE(12);
  }

  encode(request) {
    const cipher = createCipheriv('aes-128-cbc', this.key, this.iv);
    const payload = Buffer.concat([cipher.update(JSON.stringify(request), 'utf8'), cipher.final()]);
    const header = Buffer.alloc(16);
    header.writeUInt16BE(MAGIC, 0);
    header.writeUInt16BE(HEADER_SIZE + payload.length, 2);
    header.writeUInt32BE(this.deviceId, 8);
    header.writeUInt32BE((this.timestamp + 1) >>> 0, 12);
    return Buffer.concat([header, md5(header, this.token, payload), payload]);
  }

  decode(packet, id) {
    if (packet.length === HEADER_SIZE || packet.readUInt32BE(8) !== this.deviceId) {
      return;
    }
    const payload = packet.subarray(HEADER_SIZE);
    const digest = md5(packet.subarray(0, 16), this.token, payload);
    if (!timingSafeEqual(digest, packet.subarray(16, HEADER_SIZE))) {
      throw new Error('Fridge reply could not be authenticated. Check the LAN token.');
    }
    let response;
    try {
      const decipher = createDecipheriv('aes-128-cbc', this.key, this.iv);
      const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
      response = JSON.parse(plaintext.toString('utf8').replace(/\0+$/, ''));
    } catch {
      throw new Error('Fridge returned an unreadable reply.');
    }
    if (response?.id === id) {
      this.authenticatedDeviceId = this.deviceId;
      this.timestamp = packet.readUInt32BE(12);
      return response;
    }
  }

  async request(method, params = []) {
    if (this.timestamp === undefined) {
      await this.handshake();
    }
    const id = this.requestId;
    this.requestId = (id % 9999) + 1;
    let reply;
    try {
      reply = await this.exchange(this.encode({ id, method, params }), (packet) => this.decode(packet, id));
    } catch (error) {
      this.timestamp = undefined;
      throw error;
    }
    if (reply.error || !Object.hasOwn(reply, 'result')) {
      throw new Error(`Fridge rejected the ${method} request.`);
    }
    return reply.result;
  }

  getInfo() {
    return this.request('miIO.info');
  }

  async readProperties(properties) {
    const result = await this.request('get_properties', properties);
    if (!Array.isArray(result)) {
      throw new Error('Fridge returned an invalid property response.');
    }
    const values = new Map();
    for (const property of properties) {
      const reading = result.find((entry) => entry?.code === 0 &&
        entry.siid === property.siid && entry.piid === property.piid);
      if (reading) {
        values.set(property.did, reading.value);
      }
    }
    return values;
  }

  async writeProperty(property, value) {
    const result = await this.request('set_properties', [{ ...property, value }]);
    if (!Array.isArray(result) || result[0]?.code !== 0) {
      throw new Error('Fridge rejected the mode change.');
    }
  }
}

module.exports = { MiotClient };
