
export class RedisScript {
    private readonly _src: string;
    private readonly _numberOfKeys: number;
    private _sha: string;

    constructor(src: string, numberOfKeys?: number) {
        this._src = src;
        this._sha = null;
        this._numberOfKeys = numberOfKeys || 0;
    }

    async execute(client, ...args): Promise<boolean> {
        if (!this._sha)
            await this._loadScript(client);
        try {
            return await this._execute(client, ...args);
        } catch (err) {
            /* istanbul ignore next */
            if (!String(err).includes('NOSCRIPT'))
                throw err;
            // Retry
            this._sha = null;
            return await this._execute(client, ...args);
        }
    }

    private async _execute(client, ...args): Promise<boolean> {
        await this._loadScript(client);
        return !!(await client.evalsha(this._sha, this._numberOfKeys, ...args));
    }

    private async _loadScript(client): Promise<void> {
        return client.script('load', this._src).then(resp => {
            /* istanbul ignore next */
            if (!resp)
                throw new Error('Unable to load redis script in to redis cache');
            this._sha = resp;
        });
    }

}
