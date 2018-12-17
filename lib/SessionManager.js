const crypto = require('crypto');
const zlib = require('zlib');
const {ArgumentError} = require('errorex');
const waterfall = require('putil-waterfall');
const RedisScript = require('./RedisScript');

function createWriteScript(fields) {

  let s = '';
  if (fields) {
    for (let i = 0; i < fields.length; i++) {
      s += ', "f' + i + '", ARGV[' + (7 + i) + ']';
    }
  }

  return new RedisScript(`
    local prefix = ARGV[1]
    local lastAccess = tonumber(ARGV[2])
    local userId = ARGV[3]
    local sessionId = ARGV[4]
    local expires = tonumber(ARGV[5])
    local ttl = tonumber(ARGV[6])
    
    redis.call("zadd", prefix..":USERS", lastAccess, userId) 
    redis.call("zadd", prefix..":ACTIVITY", lastAccess, sessionId)          
    redis.call("zadd", prefix..":user_"..userId, lastAccess, sessionId)
    redis.call("hmset", prefix..":sess_"..sessionId, "us", userId, "la", lastAccess, "ex", expires, "ttl", ttl` +
      s + `)                       
    if (expires > 0) then
      redis.call("zadd", prefix..":EXPIRES", expires, sessionId)
    else
      redis.call("zrem", prefix..":EXPIRES", sessionId)
    end          
    return 1
    `);
}

const killScript = new RedisScript(`
    local prefix = ARGV[1]
    local sessionId = ARGV[2]
    local userId = ARGV[3]
    
    redis.call("zrem", prefix..":ACTIVITY", sessionId)          
    redis.call("zrem", prefix..":EXPIRES", sessionId)
    redis.call("zrem", prefix..":user_"..userId, sessionId)
    redis.call("del", prefix..":sess_"..sessionId)        
    if (redis.call("zcount", prefix..":user_"..userId, "+inf", "-inf")>0) then
      redis.call("zrem", prefix..":USERS", userId)
    end          
    return 1        
    `);

const wipeScript = new RedisScript(`
    -- find keys with wildcard
    local matches = redis.call("zrevrangebyscore", ARGV[1]..":EXPIRES", ARGV[2], "-inf")
    if unpack(matches) == nil then
      return 0 
    end
    -- Iterate keys
    for _,key in ipairs(matches) do
      local userId = redis.call("HGET", ARGV[1]..":sess_"..key, "us")
      if userId ~= nil then
        redis.call('zrem', ARGV[1]..":user_"..userId, key)            
      end
      redis.call("del", ARGV[1]..":sess_"..key)            
    end          
    redis.call("zrem", ARGV[1]..":ACTIVITY", unpack(matches))
    redis.call("zrem", ARGV[1]..":EXPIRES", unpack(matches))                    
    `);

const killAllScript = new RedisScript(`
    -- find keys with wildcard
    local matches = redis.call("keys", ARGV[1]) 
    --if there are any keys
    if unpack(matches) ~= nil then
      --delete all
      return redis.call("del", unpack(matches)) 
    else 
      return 0 --if no keys to delete
    end
    `);

/**
 *
 * @class
 */
class SessionManager {

  /**
   *
   * @param {Object} client
   * @param {Object} [options]
   * @param {Object} [options.namespace='sm']
   * @param {number} [options.ttl] Time-To-Live value in seconds
   * @param {number} [options.wipeInterval=1000]
   * @param {Array<String>} [options.additionalFields]
   */
  constructor(client, options) {
    if (!(client && typeof client.hmget === 'function'))
      throw new ArgumentError('You must provide redis instance');
    options = options || {};
    this._client = client;
    this._ns = (options.namespace || 'sessions');
    this._ttl = Number(options.ttl) >= 0 ? Number(options.ttl) : (30 * 60);
    this._timediff = null; // Difference between local time and redis server time in seconds
    this._wipeInterval = options.wipeInterval || 1000;
    this._wipeTimer = null;
    this._additionalFields = options.additionalFields;
    this._writeScript = createWriteScript(options.additionalFields);
    client.once('close', () => this.quit());
  }

  get namespace() {
    return this._ns;
  }

  /**
   * Get the amount of sessions within the last n seconds.
   * Get all session count if n is not defined or zero
   * @param {number} [n]
   * @return {Promise<Number>}
   */
  count(n) {
    return this._getClient().then(client => {
      n = Number(n);
      const prefix = this._ns;
      return client.zcount(prefix + ':ACTIVITY',
          (n ? Math.floor(this._now() - n) : '-inf'), '+inf')
          .then(resp => Number(resp));
    });
  }

  /**
   * Retrieves session count of single user which were active within the last n seconds.
   *
   * @param {string} userId
   * @param {number} [n]
   * @return {Promise<Array<String>>}
   */
  countForUser(userId, n) {
    if (!userId)
      return Promise.reject(new ArgumentError('You must provide userId'));
    return this._getClient().then(client => {
      n = Number(n);
      return client.zcount(this._ns + ':user_' + userId,
          (n ? Math.floor(this._now() - n) : '-inf'), '+inf')
          .then(resp => Number(resp));
    });
  }

  /**
   * Creates new session
   *
   * @param {string} userId
   * @param {Object} [options]
   * @param {number} [options.ttl] Time-To-Live value in seconds
   * @param {*} [options.*] Additional data to set for this sessions
   * @param options
   */
  create(userId, options) {
    if (!userId)
      return Promise.reject(new ArgumentError('You must provide userId'));

    options = options || {};
    const ttl = Number(options.ttl) >= 0 ? Number(options.ttl) : this._ttl;
    const sessionId = this._createSessionId();
    const session = new Session(this, {sessionId, userId, ttl});
    /* istanbul ignore else */
    if (this._additionalFields) {
      for (const f of this._additionalFields)
        session[f] = options[f];
    }
    return session._write().then(() => session);
  }

  /**
   * Retrieves session by sessionId
   *
   * @param {string} sessionId
   * @param {boolean} [noUpdate=false]
   * @return {Promise<Session>}
   */
  get(sessionId, noUpdate) {
    if (!sessionId)
      return Promise.reject(new ArgumentError('You must provide sessionId'));
    const session = new Session(this, {sessionId});
    return session.read().then(() => {
      if (!session.valid)
        return undefined;
      if (noUpdate)
        return session;
      return session.freshen().then(() => session);
    });
  }

  /**
   * Retrieves all session ids which were active within the last n seconds.
   *
   * @param {number} [n]
   * @return {Promise<Array<String>>}
   */
  getAllSession(n) {
    return this._getClient().then(client => {
      n = Number(n);
      return client.zrevrangebyscore(this._ns + ':ACTIVITY',
          '+inf',
          (n ? Math.floor(this._now() - n) : '-inf')
      );
    });
  }

  /**
   * Retrieves all user ids which were active within the last n seconds.
   *
   * @param {number} [n]
   * @return {Promise<Array<String>>}
   */
  getAllUsers(n) {
    return this._getClient().then(client => {
      n = Number(n);
      return client.zrevrangebyscore(this._ns + ':USERS',
          '+inf',
          (n ? Math.floor(this._now() - n) : '-inf')
      );
    });
  }

  /**
   * Retrieves session ids of single user which were active within the last n seconds.
   *
   * @param {string} userId
   * @param {number} [n]
   * @return {Promise<Array<String>>}
   */
  getUserSessions(userId, n) {
    if (!userId)
      return Promise.reject(new ArgumentError('You must provide userId'));
    return this._getClient().then(client => {
      n = Number(n);
      return client.zrevrangebyscore(this._ns + ':user_' + userId,
          '+inf',
          (n ? Math.floor(this._now() - n) : '-inf'));
    });
  }

  /**
   * Returns true if sessionId exists, false otherwise,
   *
   * @param {string} sessionId
   * @return {Promise<Boolean>}
   */
  exists(sessionId) {
    if (!sessionId)
      return Promise.reject(new ArgumentError('You must provide sessionId'));
    return this._getClient().then(client => {
      return client.exists(this._ns + ':sess_' + sessionId)
          .then(resp => !!Number(resp));
    });
  }

  /**
   * Kills single session
   *
   * @param {string} sessionId
   * @return {Promise<Boolean>}
   */
  kill(sessionId) {
    if (!sessionId)
      return Promise.reject(new ArgumentError('You must provide sessionId'));
    return this.get(sessionId, true)
        .then(session => !!session && session.kill());
  }

  /**
   * Kills all sessions of user
   *
   * @param {string} userId
   * @return {Promise<Boolean>}
   */
  killUser(userId) {
    if (!userId)
      return Promise.reject(new ArgumentError('You must provide userId'));
    return this.getUserSessions(userId).then(sessions => {
      return waterfall.every(sessions, (next, sid) => this.kill(sid));
    });
  }

  /**
   * Kills all sessions for application
   *
   * @return {Promise}
   */
  killAll() {
    return this._getClient().then(client =>
      killAllScript.execute(client, this._ns + ':*').then(() => true)
    );
  }

  now() {
    return this._client.time().then((resp) => {
      // Synchronize redis server time with local time
      this._timediff = (Date.now() / 1000) -
          Math.floor(Number(resp[0]) + (Number(resp[1]) / 1000000));
      return this._now();
    });
  }

  /* istanbul ignore next */
  /**
   * Stops wipe timer
   */
  quit() {
    clearTimeout(this._wipeInterval);
    this._wipeInterval = null;
  }

  // noinspection JSMethodCanBeStatic
  /**
   *
   * @return {string}
   * @private
   */
  _createSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  _now() {
    return Math.floor(Date.now() / 1000 + this._timediff);
  }

  _getClient() {
    if (!this._wipeTimer)
      this._wipeTimer =
          setTimeout(() => {
            this._wipe().catch(/* istanbul ignore next */() => 1)
          }, this._wipeInterval)
              .unref();
    if (this._timediff == null)
      return this.now().then(() => this._client);
    return Promise.resolve(this._client);
  }

  _wipe() {
    clearTimeout(this._wipeTimer);
    this._wipeTimer = null;
    return this._getClient().then(client =>
      wipeScript.execute(client, this._ns, this._now())
    );
  }

}

class Session {

  /**
   *
   * @param {SessionManager} manager
   * @param {Object} prop
   * @param {string} prop.sessionId
   * @param {string} [prop.userId]
   * @param {number} [prop.ttl]
   * @constructor
   */
  constructor(manager, prop) {
    this._manager = manager;
    this._sessionId = prop.sessionId;
    this._userId = prop.userId;
    this._ttl = prop.ttl || 0;
    this._lastAccess = 0;
    this._expires = 0;
  }

  /**
   * Retrieves the SessionManager instance
   *
   * @return {SessionManager}
   */
  get manager() {
    return this._manager;
  }

  /**
   * Retrieves session id value
   *
   * @return {string}
   */
  get sessionId() {
    return this._sessionId;
  }

  /**
   * Retrieves user id value
   *
   * @return {number}
   */
  get userId() {
    return this._userId;
  }

  /**
   * Retrieves Time-To-Live value
   *
   * @return {number}
   */
  get ttl() {
    return this._ttl;
  }

  /**
   * Retrieves the time (unix) of last access
   *
   * @return {number}
   */
  get lastAccess() {
    return this._lastAccess;
  }

  /**
   * Retrieves the time (unix) that session be expired.
   *
   * @return {number}
   */
  get expires() {
    return this._expires;
  }

  /**
   * Retrieves duration that session be expired.
   *
   * @return {number}
   */
  get expiresIn() {
    return this._expires ?
        this._expires - this.manager._now() : 0;
  }

  get valid() {
    return !!(this._sessionId && this._userId && this._lastAccess);
  }

  /**
   * Retrieves idle duration in seconds
   *
   * @return {number}
   */
  get idle() {
    return this.manager._now() - this.lastAccess;
  }

  /**
   * Reads session info from redis server
   *
   * @return {Promise}
   */
  read() {
    const manager = this._manager;
    const sessKey = manager._ns + ':sess_' + this.sessionId;
    return manager._getClient().then(client => {
          const args = ['us', 'la', 'ex', 'ttl'];
          /* istanbul ignore else */
          if (manager._additionalFields) {
            for (const [i] of manager._additionalFields.entries())
              args.push('f' + i);
          }
          return client.hmget(sessKey, ...args).then(resp => {
            this._userId = resp[0];
            this._lastAccess = Number(resp[1]) || 0;
            this._expires = Number(resp[2]) || 0;
            this._ttl = Number(resp[3]) || 0;
            /* istanbul ignore else */
            if (manager._additionalFields) {
              for (const [i, f] of manager._additionalFields.entries())
                this[f] = resp[4 + i];
            }
          });
        }
    );
  }

  /**
   * Updates last access time and resets idle timer
   *
   * @return {Promise}
   */
  freshen() {
    return this._write();
  }

  /**
   * Retrieves user data from session
   *
   * @param {string|Array<String>|Object<String,*>} key
   * @return {Promise<*>}
   */
  get(key) {
    const manager = this._manager;
    const sessKey = manager._ns + ':sess_' + this.sessionId;
    const fromTyped = (v) => {
      let x = v.substring(1);
      switch (v[0]) {
        case 'b':
          x = Buffer.from(x, 'base64');
          break;
        case 'd':
          x = new Date(x);
          break;
        case 'n':
          x = Number(x);
          break;
        case 'o':
          x = JSON.parse(zlib.unzipSync(Buffer.from(x, 'base64')));
          break;
      }
      return x;
    };

    return manager._getClient().then(client => {

          // Prepare keys to query
          let keys;
          if (Array.isArray(key)) {
            keys = key.slice();
            for (const [i, k] of keys.entries())
              keys[i] = '$' + k;
          } else if (typeof key === 'object') {
            keys = Object.keys(key);
            for (const [i, k] of keys.entries())
              keys[i] = '$' + k;
          } else keys = ['$' + key];

          // Query values for keys
          return client.hmget(sessKey, keys).then(resp => {

            // Do type conversion
            for (const [i, v] of resp.entries())
              resp[i] = fromTyped(v);

            if (Array.isArray(key))
              return resp;
            if (typeof key === 'object') {
              for (const [i, k] of keys.entries()) {
                key[k.substring(1)] = resp[i];
              }
              return key;
            }
            return resp[0];
          });
        }
    );
  }

  /**
   * Stores user data to session
   *
   * @param {string|Object} key
   * @param {*} [value]
   * @return {Promise<number>}
   */
  set(key, value) {
    const manager = this._manager;
    const sessKey = manager._ns + ':sess_' + this.sessionId;
    return manager._getClient().then(client => {
          const values = this._prepareUserData(key, value);
          return client.hmset(sessKey, values).then(resp => {
            /* istanbul ignore next */
            if (!String(resp).includes('OK'))
              throw new Error('Redis write operation failed');
            return Math.floor(values.length / 2);
          });
        }
    );
  }

  /**
   * Kills the session
   *
   * @return {Promise}
   */
  kill() {
    const manager = this._manager;
    return manager._getClient().then(client => {
      const {sessionId, userId} = this;
      return killScript.execute(client, manager._ns, sessionId, userId)
          .then(resp => {
            /* istanbul ignore next */
            if (!resp)
              throw new Error('Unable to store session due to an unknown error');
          });
    });
  }

  /**
   *
   * @param {Object} [data]
   * @return {Promise}
   * @private
   */
  _write(data) {
    const manager = this._manager;
    return manager._getClient().then(client => {
      this._lastAccess = manager._now();
      this._expires = this._ttl ?
          this._lastAccess + this._ttl : 0;

      const {sessionId, userId, lastAccess, expires, ttl} = this;
      const args = [manager._ns, lastAccess, userId, sessionId, expires, ttl];
      /* istanbul ignore else */
      if (manager._additionalFields)
        for (const f of manager._additionalFields)
          args.push(this[f] || null);
      return manager._writeScript.execute(client, ...args).then(resp => {
        /* istanbul ignore next */
        if (!resp)
          throw new Error('Unable to store session due to an unknown error');
      });
    });
  }

  /**
   *
   * @param {string|Object} key
   * @param {*} [value]
   * @return {Array<String>}
   * @private
   */
  _prepareUserData(key, value) {
    const makeTyped = (v) => {
      if (v instanceof Buffer)
        return 'b' + v.toString('base64');
      if (v instanceof Date)
        return 'd' + v.toISOString();
      if (typeof v === 'number')
        return 'n' + String(v);
      if (typeof v === 'object')
        return 'o' + zlib.deflateSync(JSON.stringify(v)).toString('base64');
      return 's' + String(v);
    };
    let values = [];
    if (typeof key === 'object') {
      for (const k of Object.keys(key)) {
        values.push('$' + k);
        values.push(makeTyped(key[k]));
      }
    } else values = ['$' + key, makeTyped(value)];
    return values;
  }

}

/**
 * Expose `SessionManager`.
 */
module.exports = SessionManager;
