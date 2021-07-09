/* eslint-disable */
import './support/env';
import redis from 'redis';
import {initSessionManagerTests} from './session-manager.test';

describe('redis', function () {

    const ctx: any = {};

    before((done) => {
        ctx.redis = redis.createClient();
        const callDone = (e?) => {
            ctx.redis.removeListener('ready', done);
            ctx.redis.removeListener('error', done);
            done(e);
        };
        ctx.redis.once('ready', callDone);
        ctx.redis.once('error', callDone);
    });

    after(() => {
        ctx.redis.end(true);
    });

    initSessionManagerTests(ctx);

});
