import crypto from 'crypto';
import Redis, { Cluster } from 'ioredis';
import promisify from 'putil-promisify';
import { Backend } from './backend';
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
export class SessionManager {
  private readonly _backend: Backend;
  private readonly _additionalFields: string[];

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
    this._backend = new Backend(client, props);
    if (!(client && typeof client.hmset === 'function')) {
      throw new TypeError('You must provide redis instance');
    }
    this._additionalFields = [...(props.additionalFields || [])];
    client.once('close', () => this.quit());
  }

  get additionalFields(): string[] {
    return this._additionalFields;
  }

  get namespace(): string | undefined {
    return this._backend.ns;
  }

  get ttl(): number | undefined {
    return this._backend.ttl;
  }

  /**
   * Returns the number of sessions within the last n seconds.
   * @param {number} [secs] The elapsed time since the last activity of the session. Returns total count of sessions If not defined or zero
   * @return {Promise<Number>}
   */
  async count(secs: number = 0): Promise<number> {
    const client = await this._backend.getClient();
    secs = Number(secs);
    const prefix = this._backend.ns;
    const resp = await promisify.fromCallback(cb =>
      client.zcount(
        prefix + ':ACTIVITY',
        secs ? Math.floor(this._backend.now() - secs) : '-inf',
        '+inf',
        cb,
      ),
    );
    return Number(resp);
  }

  /**
   * Retrieves session count of single user which were active within the last n seconds.
   *
   * @param {string} userId
   * @param {number} [secs]
   * @return {Promise<number>}
   */
  async countForUser(userId: string, secs: number = 0): Promise<number> {
    if (!userId) throw new TypeError('You must provide userId');
    const client = await this._backend.getClient();
    secs = Number(secs);
    const resp = await client.zcount(
      this._backend.ns + ':user_' + userId,
      secs ? Math.floor(this._backend.now() - secs) : '-inf',
      '+inf',
    );
    return Number(resp);
  }

  /**
   * Creates a new session for the user
   *
   * @param {string} userId
   * @param {Object.<string, *>} [props]
   * @param {number} [props.ttl] Time-To-Live value in seconds
   * @param props
   */
  async create(
    userId: string,
    props?: { ttl?: number; [index: string]: any },
  ): Promise<ResultSession> {
    if (!userId) throw new TypeError('You must provide userId');

    props = props || {};
    const ttl = Number(props.ttl) >= 0 ? Number(props.ttl) : this.ttl;
    const sessionId = this._createSessionId();
    const session = new Session(this._backend, {
      sessionId,
      userId,
      ttl,
    });
    /* istanbul ignore else */
    if (this._backend.additionalFields) {
      for (const f of this._backend.additionalFields) session[f] = props[f];
    }
    await session.write();
    return session;
  }

  /**
   * Retrieves session by sessionId
   *
   * @param {string} sessionId
   * @param {boolean} [noUpdate=false]
   * @return {Promise<ResultSession>}
   */
  async get(
    sessionId: string,
    noUpdate: boolean = false,
  ): Promise<ResultSession | undefined> {
    if (!sessionId) throw new TypeError('You must provide sessionId');
    const session = new Session(this._backend, { sessionId });
    await session.read();
    if (!session.valid) return undefined;
    if (noUpdate) return session;
    await session.write();
    return session;
  }

  /**
   * Retrieves all session ids which were active within the last n seconds.
   *
   * @param {number} [secs]
   * @return {Promise<Array<String>>}
   */
  async getAllSessions(secs?: number): Promise<string[]> {
    const client = await this._backend.getClient();
    secs = secs || Number.MAX_SAFE_INTEGER;
    return await promisify.fromCallback(cb =>
      client.zrevrangebyscore(
        this._backend.ns + ':ACTIVITY',
        '+inf',
        secs ? Math.floor(this._backend.now() - secs) : '-inf',
        cb,
      ),
    );
  }

  /**
   * Retrieves all user ids which were active within the last n seconds.
   *
   * @param {number} [secs]
   * @return {Promise<Array<String>>}
   */
  async getAllUsers(secs: number = 0): Promise<string[]> {
    const client = await this._backend.getClient();
    secs = Number(secs);
    return await promisify.fromCallback(cb =>
      client.zrevrangebyscore(
        this._backend.ns + ':USERS',
        '+inf',
        secs ? Math.floor(this._backend.now() - secs) : '-inf',
        cb,
      ),
    );
  }

  /**
   * Retrieves session ids of single user which were active within the last n seconds.
   *
   * @param {string} userId
   * @param {number} [n]
   * @return {Promise<Array<String>>}
   */
  async getUserSessions(userId: string, n: number = 0): Promise<string[]> {
    if (!userId) throw new TypeError('You must provide userId');
    const client = await this._backend.getClient();
    n = Number(n);
    return await promisify.fromCallback(cb =>
      client.zrevrangebyscore(
        this._backend.ns + ':user_' + userId,
        '+inf',
        n ? Math.floor(this._backend.now() - n) : '-inf',
        cb,
      ),
    );
  }

  /**
   * Retrieves oldest session of user
   *
   * @param {string} userId
   * @param {boolean} [noUpdate=false]
   * @return {Promise<ResultSession>}
   */
  async getOldestUserSession(
    userId: string,
    noUpdate: boolean = false,
  ): Promise<ResultSession | undefined> {
    if (!userId) throw new TypeError('You must provide userId');
    const client = await this._backend.getClient();
    const sessionId = await promisify.fromCallback(cb =>
      client.zrevrange(this._backend.ns + ':user_' + userId, -1, -1, cb),
    );
    if (sessionId && sessionId.length) {
      return await this.get(sessionId[0], noUpdate);
    }
  }

  /**
   * Returns true if sessionId exists, false otherwise,
   *
   * @param {string} sessionId
   * @return {Promise<Boolean>}
   */
  async exists(sessionId: string): Promise<Boolean> {
    if (!sessionId) throw new TypeError('You must provide sessionId');
    const client = await this._backend.getClient();
    const resp = await promisify.fromCallback(cb =>
      client.exists(this._backend.ns + ':sess_' + sessionId, cb),
    );
    return !!Number(resp);
  }

  /**
   * Kills single session
   *
   * @param {string} sessionId
   * @return {Promise<void>}
   */
  async kill(sessionId: string): Promise<void> {
    if (!sessionId) throw new TypeError('You must provide sessionId');
    const session = await this.get(sessionId, true);
    if (session) return await session.kill();
  }

  /**
   * Kills all sessions of user
   *
   * @param {string} userId
   * @return {Promise}
   */
  async killUser(userId: string): Promise<void> {
    if (!userId) throw new TypeError('You must provide userId');
    const sessions = await this.getUserSessions(userId);
    for (const sid of sessions) {
      await this.kill(sid);
    }
  }

  /**
   * Kills all sessions for application
   *
   * @return {Promise}
   */
  async killAll(): Promise<void> {
    const client = await this._backend.getClient();
    await this._backend.killAllScript.execute(client, this._backend.ns + ':*');
  }

  async now(): Promise<number> {
    const client = await this._backend.getClient();
    await this._backend.syncTime(client);
    return this._backend.now();
  }

  /* istanbul ignore next */
  /**
   * Stops wipe timer
   */
  quit(): void {
    this._backend.quit();
  }

  async wipe(): Promise<void> {
    return this._backend.wipe();
  }

  // noinspection JSMethodCanBeStatic
  /**
   *
   * @return {string}
   * @private
   */
  private _createSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
