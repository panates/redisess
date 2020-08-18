
import {SessionManager} from './SessionManager';
import {Redis} from 'ioredis';

function redisess(client: Redis, options?: SessionManager.Options): SessionManager {
    return new SessionManager(client, options);
}
redisess.SessionManager = SessionManager;

export = redisess;

