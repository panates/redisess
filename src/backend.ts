import Redis, { Cluster } from 'ioredis';
import promisify from 'putil-promisify';
import { RedisScript } from './redis-script.js';
import {
  getKillAllScript,
  getKillScript,
  getWipeScript,
  getWriteScript,
} from './scripts.js';
import { Session } from './session.js';

export namespace SessionManager {
  export interface Options {
    namespace?: string;
    ttl?: number;
    wipeInterval?: number;
    additionalFields?: string[];
  }
}

export type ResultSession = Session & Record<string, any>;

/**
 *
 * @class
 */
export class Backend {
  readonly client: Redis | Cluster;
  readonly ns?: string;
  readonly ttl?: number;
  readonly additionalFields?: string[];
  readonly killScript: RedisScript;
  readonly writeScript: RedisScript;
  readonly wipeScript: RedisScript;
  readonly killAllScript: RedisScript;
  private wipeInterval?: number;
  private _wipeTimer?: NodeJS.Timeout;
  private _timeDiff: number;

  /**
   *
   * @param {Object} client
   * @param {Object} [props]
   * @param {Object} [props.namespace='sm']
   * @param {number} [props.ttl] Time-To-Live value in seconds
   * @param {number} [props.wipeInterval=1000]
   * @param {Array<String>} [props.additionalFields]
   */
  constructor(client: Redis | Cluster, props: SessionManager.Options = {}) {
    if (!(client && typeof client.hmset === 'function')) {
      throw new TypeError('You must provide redis instance');
    }
    this.client = client;
    this.additionalFields = props.additionalFields
      ? (Object.freeze(props.additionalFields) as string[])
      : undefined;
    this.ns = props.namespace || 'sessions';
    this.ttl = Number(props.ttl) >= 0 ? Number(props.ttl) : 30 * 60;
    this.killScript = new RedisScript(getKillScript());
    this.writeScript = new RedisScript(getWriteScript(props.additionalFields));
    this.wipeScript = new RedisScript(getWipeScript());
    this.killAllScript = new RedisScript(getKillAllScript());
    this._timeDiff = 0;
    this.wipeInterval = props.wipeInterval || 1000;
  }

  /* istanbul ignore next */
  /**
   * Stops wipe timer
   */
  quit(): void {
    this._stopWipeTimer();
  }

  async wipe(): Promise<void> {
    this._stopWipeTimer();
    const client = await this.getClient();
    await this.wipeScript.execute(client, this.ns, this.now());
    this._startWipeTimer();
  }

  async getClient(): Promise<Redis | Cluster> {
    this._startWipeTimer();
    if (this.client.status !== 'ready') {
      await new Promise(resolve => {
        this.client.once('ready', resolve);
      });
    }
    if (this._timeDiff == null) await this.syncTime(this.client);
    return this.client;
  }

  now(): number {
    return Math.floor(Date.now() / 1000 + this._timeDiff);
  }

  private _stopWipeTimer() {
    if (!this._wipeTimer) return;
    clearTimeout(this._wipeTimer);
    this._wipeTimer = undefined;
  }

  private _startWipeTimer() {
    if (this._wipeTimer) return;
    this._wipeTimer = setTimeout(() => {
      this.wipe().catch(/* istanbul ignore next */ () => 1);
    }, this.wipeInterval);
    this._wipeTimer.unref();
  }

  async syncTime(client: Redis | Cluster): Promise<number> {
    const resp = await promisify.fromCallback(cb => client.time(cb));
    // Synchronize redis server time with local time
    this._timeDiff =
      Date.now() / 1000 -
      Math.floor(Number(resp[0]) + Number(resp[1]) / 1000000);
    return this.now();
  }
}
