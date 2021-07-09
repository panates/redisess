/* eslint-disable */
import './support/env';
import Redis from 'ioredis';
import {initSessionManagerTests} from './session-manager.test';

describe('ioredis', function () {

    const ctx: any = {};

    before((done) => {
        ctx.redis = new Redis();
        const callDone = (e?) => {
            ctx.redis.removeListener('ready', done);
            ctx.redis.removeListener('error', done);
            done(e);
        };
        ctx.redis.once('ready', callDone);
        ctx.redis.once('error', callDone);
    });

    after(async () => {
        await ctx.redis.disconnect();
    });

    initSessionManagerTests(ctx);

});
