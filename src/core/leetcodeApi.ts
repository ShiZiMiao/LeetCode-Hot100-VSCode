
import { AuthManager } from './authManager';
import { isTransientNetworkError, attachRetrySafe, retryTransient } from '../utils/networkRetry';
import * as https from 'https';
import * as dns from 'dns';
import * as crypto from 'crypto';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 单次下载大小上限（图片/HLS 分段/JSON），防恶意超大响应撑爆内存 */
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
/** leetcode.cn API 请求超时（无响应即销毁，防代理静默挂起） */
const REQUEST_TIMEOUT_MS = 20000;
/** 下载类请求超时 */
const DOWNLOAD_TIMEOUT_MS = 30000;
/** 瞬断重试退避基数（500ms × 2^n） */
const RETRY_BACKOFF_MS = 500;
/** 阿里云 VOD 播放签名有效期（秒），与网页端 Aliplayer 同参 */
const VOD_AUTH_TIMEOUT_S = '172800';

/** 私网/回环/链路本地 IPv4 字面量判定 */
function isPrivateIpv4(host: string): boolean {
    const ipv4 = host.split('.');
    if (ipv4.length === 4 && ipv4.every(p => /^\d{1,3}$/.test(p))) {
        const [a, b] = ipv4.map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return false;
}

/** 私网/回环/链路本地 IPv6 字面量判定：::1 回环、fe80::/10 链路本地、fc00::/7 唯一本地 */
function isPrivateIpv6(host: string): boolean {
    if (host === '::1' || host === '::') {
        return true;
    }
    return /^(f[cd]|fe[89ab])/.test(host);
}

/**
 * 下载 URL 安全校验（SSRF 面防护）：仅允许 https，拒绝本地回环/私网/链路本地主机名——
 * 题面与社区文章的图片/视频地址来自外部内容，不能让其指向内网或云元数据服务。
 * 注意 URL.hostname 对 IPv6 字面量保留方括号（如 "[::1]"），比较前必须去括号归一化，
 * 否则回环/私网判定全部落空（历史永假分支的根因）。
 */
function assertSafeDownloadUrl(url: string): URL {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
        throw new Error(`仅支持 https 下载: ${url}`);
    }
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new Error(`拒绝本地回环地址下载: ${url}`);
    }
    if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
        throw new Error(`拒绝私网地址下载: ${url}`);
    }
    return u;
}

/**
 * 解析后 IP 复核（防 DNS rebinding）：字面量判定后域名仍可能解析到内网 IP，
 * 下载前把解析结果再过一遍私网判定。IP 字面量无需解析。
 */
async function assertSafeResolvedHost(host: string, url: string): Promise<void> {
    const h = host.toLowerCase().replace(/^\[|\]$/g, '');
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) {
        return;
    }
    const addrs = await dns.promises.lookup(h, { all: true });
    for (const a of addrs) {
        const ip = a.address.toLowerCase().replace(/^\[|\]$/g, '');
        if (isPrivateIpv4(ip) || isPrivateIpv6(ip)) {
            throw new Error(`拒绝解析到私网地址的下载: ${url}（${ip}）`);
        }
    }
}

export interface Question {
    frontendQuestionId: string;
    title: string;
    titleSlug: string;
    difficulty: string;
    status: string | null;
    /** 通过率（百分数，如 72.5） */
    acRate?: number;
    /** 会员题标记 */
    paidOnly?: boolean;
}

export class LeetCodeApi {
    private static readonly HOSTNAME = 'leetcode.cn';
    private authManager: AuthManager;

    constructor(authManager: AuthManager) {
        this.authManager = authManager;
    }

    private async getHeaders(): Promise<Record<string, string>> {
        const cookie = await this.authManager.getCookie();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_UA,
            'Origin': `https://${LeetCodeApi.HOSTNAME}`,
            'Referer': `https://${LeetCodeApi.HOSTNAME}`
        };
        if (cookie) {
            headers['Cookie'] = cookie;
            const match = cookie.match(/csrftoken=([^;]+)/);
            if (match) {
                headers['x-csrftoken'] = match[1];
            }
        }
        return headers;
    }

    /**
     * 订阅会话过期事件（HTTP 401 或业务码 1002）：可多订阅，返回取消订阅函数。
     * 由 extension.ts 注入 toast（限频）；这里不依赖 vscode，保持 API 层可独立测试。
     */
    onSessionExpired(listener: () => void): () => void {
        this.sessionExpiredListeners.push(listener);
        return () => {
            const i = this.sessionExpiredListeners.indexOf(listener);
            if (i >= 0) {
                this.sessionExpiredListeners.splice(i, 1);
            }
        };
    }

    private sessionExpiredListeners: Array<() => void> = [];

    private emitSessionExpired(): void {
        for (const l of [...this.sessionExpiredListeners]) {
            l();
        }
    }

    private static isSessionExpiredResponse(res: { statusCode?: number }, json: any): boolean {
        if (res.statusCode === 401) { return true; }
        // leetcode.cn 未登录时接口仍返回 200，靠业务码判定：1002 = 未登录/会话过期
        return !!(json && typeof json === 'object' && json.status_code === 1002);
    }

    private request(method: string, path: string, data?: any): Promise<any> {
        // 瞬时网络错误自动重试（新连接），指数退避；HTTP 状态错误不重试
        return new Promise((resolve, reject) => {
            const maxAttempts = 3;
            const attempt = (n: number) => {
                this.requestOnce(method, path, data).then(resolve, (err) => {
                    const retriable = isTransientNetworkError(err) && (err as { retrySafe?: boolean })?.retrySafe === true;
                    if (n < maxAttempts && retriable) {
                        setTimeout(() => attempt(n + 1), RETRY_BACKOFF_MS * Math.pow(2, n - 1));
                        return;
                    }
                    if (isTransientNetworkError(err)) {
                        const friendly = new Error(`网络连接不稳定（${err.message}），请检查网络或代理后重试`);
                        (friendly as { cause?: unknown }).cause = err;
                        reject(friendly);
                        return;
                    }
                    reject(err);
                });
            };
            attempt(1);
        });
    }

    // 非 async executor：getHeaders（读 secrets）抛错直接进调用方 catch，
    // 不会产生未处理 rejection / 让外层 Promise 永久挂起
    private async requestOnce(method: string, path: string, data?: any): Promise<any> {
        const headers = await this.getHeaders();
        return new Promise((resolve, reject) => {
            const options: https.RequestOptions = {
                hostname: LeetCodeApi.HOSTNAME,
                port: 443,
                path: path,
                method: method,
                headers: headers,
                // TLS 证书严格校验（0.1.9 起恢复）：代理空闲切断问题已由超时+禁复用+瞬断重试
                // 兜底（见 request/requestOnce），不再靠关闭校验换稳定；若用户环境有 MITM 代理
                // 导致证书失败，会在报错里透出原始证书错误便于排查
                // 代理/中间设备会静默切断空闲 keep-alive 连接，复用死连接会无限挂起；
                // 每次新建连接（连接池关闭），配合超时兜底
                agent: false
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    let parsed: any = undefined;
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            parsed = JSON.parse(body);
                        } catch (e) {
                            parsed = body; // Fallback for non-JSON
                        }
                        if (LeetCodeApi.isSessionExpiredResponse(res, parsed)) {
                            this.emitSessionExpired();
                        }
                        resolve(parsed);
                    } else {
                        if (LeetCodeApi.isSessionExpiredResponse(res, undefined)) {
                            this.emitSessionExpired();
                        }
                        // 错误体截断展示（完整响应可能很大/夹带回显内容）
                        reject(new Error(`Request failed with status ${res.statusCode}: ${body.slice(0, 200)}`));
                    }
                });
            });

            // 请求体是否已完整交给操作系统发送：未完整发出前失败可安全重试（含 POST）
            let requestFinished = false;
            req.on('finish', () => { requestFinished = true; });

            req.on('error', (e) => {
                reject(attachRetrySafe(e, method, requestFinished));
            });

            // 连接建立后若无响应（代理/网络挂起）会无限等待，超时销毁连接走 error 分支
            req.setTimeout(REQUEST_TIMEOUT_MS, () => {
                const timeoutErr = attachRetrySafe(new Error(`请求超时: ${path}`), method, requestFinished);
                req.destroy(timeoutErr);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    async postGraphql(query: string, variables: any = {}): Promise<any> {
        return this.request('POST', '/graphql', { query, variables });
    }

    async post(url: string, data: any): Promise<any> {
        // Ensure url is just the path
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        return this.request('POST', path, data);
    }

    async get(url: string): Promise<any> {
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        return this.request('GET', path);
    }

    /**
     * 获取题解视频的播放信息（阿里云 VOD：playAuth 凭证 + videoId + 封面）。
     * 题解 Markdown 中的 ![xxx.mp4](uuid) 即 uuid 参数；前端网页用
     * Aliplayer（vid + playauth）播放，普通 <video> 直链不可用（video.leetcode.cn 已废弃且 403）。
     */
    async getVideoInfo(uuid: string): Promise<any> {
        const query = `
            query videoInfo($uuid: UUID!) {
                videosVideoInfo(uuid: $uuid, fetchType: PLAY_AUTH) {
                    playAuth
                    status
                    videoInfo {
                        videoId
                        coverUrl
                    }
                    videoSize {
                        width
                        height
                    }
                    articleChargeType
                    canSee
                }
            }
        `;
        return this.postGraphql(query, { uuid });
    }

    /**
     * 下载并合并视频的 HLS 分段为连续 TS 文件（webview 的 MSE 在部分环境不可用，
     * 原生 <video> 可直接播放连续 TS）。返回 Buffer，由调用方缓存到磁盘。
     */
    async getVideoMergedTs(uuid: string): Promise<{ buffer: Buffer; videoId: string; coverUrl: string; playAuth: string }> {
        const play = await this.getVideoPlayUrl(uuid);
        if (!/\.m3u8(\?|$)/i.test(play.videoUrl)) {
            // 非 HLS 直接返回（mp4 等原生可播）
            return { buffer: await this.downloadBinaryRaw(play.videoUrl), videoId: play.videoId, coverUrl: play.coverUrl, playAuth: play.playAuth };
        }
        const m3u8 = await this.getFullText(play.videoUrl);
        const segUrls = m3u8.split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'))
            .map(l => new URL(l, play.videoUrl).toString());
        if (segUrls.length === 0) {
            throw new Error('HLS 清单为空');
        }
        // 顺序下载并合并（分段较小，避免并发打爆连接）
        const chunks: Buffer[] = [];
        const concurrency = 4;
        let idx = 0;
        const api = this;
        async function worker(): Promise<void> {
            while (idx < segUrls.length) {
                const cur = idx++;
                chunks[cur] = await api.downloadBinaryRaw(segUrls[cur]);
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, segUrls.length) }, () => worker()));
        const total = chunks.reduce((s, c) => s + c.length, 0);
        if (total === 0) {
            throw new Error('视频分段下载为空');
        }
        return { buffer: Buffer.concat(chunks, total), videoId: play.videoId, coverUrl: play.coverUrl, playAuth: play.playAuth };
    }

    /** 获取完整 URL 的文本内容（m3u8 清单等非 JSON 响应）；瞬断类错误有限重试 */
    async getFullText(url: string): Promise<string> {
        return retryTransient(async () => (await this.downloadOnce(url, { accept: '*/*' })).toString('utf8'));
    }

    /** 下载完整 URL 的二进制内容（HLS 分段等）；瞬断类错误有限重试 */
    async downloadBinaryRaw(url: string): Promise<Buffer> {
        return retryTransient(() => this.downloadOnce(url, { accept: '*/*' }));
    }

    /**
     * 请求完整 URL（保留 host、path 与 query），用于阿里云 VOD 等非 leetcode.cn 域名。
     * 与 request/get 不同：不剥 query、不改 host。瞬断类错误有限重试。
     */
    async getFullUrl(url: string): Promise<any> {
        return retryTransient(async () => {
            const body = (await this.downloadOnce(url, { accept: 'application/json' })).toString('utf8');
            try {
                return JSON.parse(body);
            } catch (e) {
                throw new Error(`响应非 JSON: ${body.slice(0, 200)}`);
            }
        });
    }

    /**
     * 下载内核（文本/二进制/JSON 三种下载共用）：SSRF 校验 + 解析后 IP 复核 +
     * 大小上限 + 超时 + 3xx 重定向跟随（带上限，防循环重定向挂死）。
     */
    private async downloadOnce(url: string, opts: { accept: string; maxRedirects?: number }): Promise<Buffer> {
        const u = assertSafeDownloadUrl(url);
        await assertSafeResolvedHost(u.hostname, url);
        return new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: u.hostname,
                    port: 443,
                    path: u.pathname + u.search,
                    method: 'GET',
                    headers: { 'User-Agent': BROWSER_UA, 'Accept': opts.accept },
                    agent: false // 同 request()：避免复用被代理静默切断的空闲连接
                },
                (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        req.destroy();
                        const hops = opts.maxRedirects ?? 3;
                        if (hops < 1) {
                            reject(new Error(`重定向次数超限: ${url}`));
                            return;
                        }
                        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
                        resolve(this.downloadOnce(next, { ...opts, maxRedirects: hops - 1 }));
                        return;
                    }
                    if (!(res.statusCode && res.statusCode >= 200 && res.statusCode < 300)) {
                        // 错误体截断展示（与 requestOnce 一致）
                        let errBody = '';
                        res.on('data', (chunk) => errBody += chunk);
                        res.on('end', () => reject(new Error(`请求失败 status ${res.statusCode}: ${errBody.slice(0, 200)}`)));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    let total = 0;
                    res.on('data', (chunk) => {
                        total += chunk.length;
                        if (total > MAX_DOWNLOAD_BYTES) {
                            req.destroy(new Error(`下载超过大小上限: ${url}`));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                }
            );
            req.on('error', reject);

            // 同 request()：无响应时超时销毁，避免永久挂起
            req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
                req.destroy(new Error(`下载超时: ${u.hostname}${u.pathname}`));
            });

            req.end();
        });
    }

    /**
     * 换取视频真实播放地址（阿里云 VOD GetPlayInfo，与网页端 Aliplayer 同款签名流程）。
     * playAuth 解码后含临时 AccessKey/AuthInfo，签名请求 vod.{region}.aliyuncs.com，
     * 返回签名后的 PlayURL（通常是 m3u8，需 hls.js 播放）。
     */
    async getVideoPlayUrl(uuid: string): Promise<{ videoUrl: string; videoId: string; coverUrl: string; playAuth: string }> {
        const data = await this.getVideoInfo(uuid);
        const info = data?.data?.videosVideoInfo;
        if (!info?.playAuth || !info?.videoInfo?.videoId) {
            throw new Error('未获取到播放凭证');
        }
        const decoded = JSON.parse(Buffer.from(info.playAuth, 'base64').toString('utf8'));
        const enc = (s: string) => encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
        const params: Record<string, string> = {
            AccessKeyId: decoded.AccessKeyId,
            Action: 'GetPlayInfo',
            VideoId: info.videoInfo.videoId,
            AuthTimeout: VOD_AUTH_TIMEOUT_S,
            Rand: crypto.randomUUID().slice(0, 16),
            SecurityToken: decoded.SecurityToken,
            Format: 'JSON',
            Version: '2017-03-21',
            SignatureMethod: 'HMAC-SHA1',
            SignatureVersion: '1.0',
            SignatureNonce: crypto.randomUUID(),
            PlayerVersion: '2.9.2',
            Channel: 'HTML5',
            AuthInfo: decoded.AuthInfo
        };
        const qs = Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join('&');
        const stringToSign = `GET&${enc('/')}&${enc(qs)}`;
        const signature = crypto.createHmac('sha1', decoded.AccessKeySecret + '&').update(stringToSign).digest('base64');
        const url = `https://vod.${decoded.Region || 'cn-shanghai'}.aliyuncs.com/?${qs}&Signature=${enc(signature)}`;
        // 注意：签名在 query 里，且域名是 vod.aliyuncs.com，不能经 get()/request()
        //（会剥掉 query / 改 host），必须保留完整 host+path+query
        const res = await this.getFullUrl(url);
        const playInfos = res?.PlayInfoList?.PlayInfo || [];
        const picked = playInfos.find((p: any) => p.Format === 'mp4') || playInfos.find((p: any) => p.Format === 'm3u8') || playInfos[0];
        if (!picked?.PlayURL) {
            throw new Error('未获取到视频地址');
        }
        return {
            videoUrl: picked.PlayURL,
            videoId: info.videoInfo.videoId,
            coverUrl: info.videoInfo.coverUrl || '',
            playAuth: info.playAuth
        };
    }

    async getUserProfile(): Promise<any> {
        // 使用 globalData 查询获取用户状态（参考 leetcode-runner 的 USER_STATUS_QUERY）
        const query = `
            query globalData {
                userStatus {
                    isSignedIn
                    isPremium
                    username
                    realName
                    avatar
                    userSlug
                    isAdmin
                    useTranslation
                    premiumExpiredAt
                    isTranslator
                    isSuperuser
                    isPhoneVerified
                    isVerified
                }
            }
        `;
        return this.postGraphql(query);
    }

    async getHot100Problems(): Promise<Question[]> {
        // 参考 leetcode-runner 项目的 PROBLEM_SET_QUERY
        const query = `
            query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
                problemsetQuestionList(
                    categorySlug: $categorySlug
                    limit: $limit
                    skip: $skip
                    filters: $filters
                ) {
                    hasMore
                    total
                    questions {
                        acRate
                        difficulty
                        frontendQuestionId
                        paidOnly
                        status
                        title
                        titleCn
                        titleSlug
                        topicTags {
                            name
                            nameTranslated
                            id
                            slug
                        }
                    }
                }
            }
        `;

        // 列表接口单页最多返回 100 题（limit 传 3000 也会被截断），必须按 skip 分页；
        // 页数按响应 total 决定（不再用"最大题号"上界——那隐含列表稠密升序的假设，
        // 排序或断号变化会静默漏题），首页串行取 total、其余页并行拉取
        const pageArgs = (skip: number) => ({ categorySlug: "", skip, limit: 100, filters: {} });
        const first = await this.postGraphql(query, pageArgs(0));
        const firstPage = first?.data?.problemsetQuestionList;
        const questions: any[] = [...(firstPage?.questions || [])];
        const total = Number(firstPage?.total) || 0;
        const skips: number[] = [];
        for (let skip = 100; skip < total; skip += 100) {
            skips.push(skip);
        }
        const results = await Promise.all(skips.map((skip) => this.postGraphql(query, pageArgs(skip))));
        for (const result of results) {
            const page = result.data?.problemsetQuestionList?.questions || [];
            questions.push(...page);
        }

        // 映射为 Question 接口格式（列表接口的 paidOnly 为布尔，acRate 为数字）
        return questions.map((q: any) => ({
            frontendQuestionId: q.frontendQuestionId,
            title: q.titleCn || q.title,  // 优先使用中文标题
            titleSlug: q.titleSlug,
            difficulty: q.difficulty,
            status: q.status,
            acRate: typeof q.acRate === 'number' ? q.acRate : undefined,
            paidOnly: q.paidOnly === true
        }));
    }

    async getQuestionContent(titleSlug: string): Promise<any> {
        // 参考 leetcode-runner 项目的 QUESTION_DATA_QUERY
        const query = `
            query questionData($titleSlug: String!) {
                question(titleSlug: $titleSlug) {
                    questionId
                    questionFrontendId
                    categoryTitle
                    boundTopicId
                    title
                    titleSlug
                    content
                    translatedTitle
                    translatedContent
                    isPaidOnly
                    difficulty
                    likes
                    dislikes
                    isLiked
                    similarQuestions
                    topicTags {
                        name
                        slug
                        translatedName
                    }
                    codeSnippets {
                        lang
                        langSlug
                        code
                    }
                    stats
                    hints
                    status
                    sampleTestCase
                    metaData
                    mysqlSchemas
                    exampleTestcases
                }
            }
        `;
        return this.postGraphql(query, { titleSlug });
    }

    /**
     * 题目提交历史（submissionList GraphQL，按时间倒序）。结构异常/无记录时返回空数组。
     */
    async getSubmissions(
        titleSlug: string,
        limit: number = 20
    ): Promise<Array<{ id: string; statusDisplay: string; lang: string; timestamp: number; runtime: string; memory: string; url: string }>> {
        const query = `
            query submissionList($offset: Int, $limit: Int, $lastKey: String, $questionSlug: String!) {
                submissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug) {
                    lastKey
                    hasNext
                    submissions {
                        id
                        status
                        statusDisplay
                        lang
                        timestamp
                        runtime
                        memory
                        url
                    }
                }
            }
        `;
        const data = await this.postGraphql(query, { questionSlug: titleSlug, offset: 0, limit });
        const subs = data?.data?.submissionList?.submissions;
        if (!Array.isArray(subs)) {
            return [];
        }
        return subs
            .filter((s: any) => s && s.id)
            .map((s: any) => {
                // submissionList 的 url 可能为相对路径（如 /submissions/{id}/）或缺失，
                // openExternal 需要绝对 https 地址；仅接受绝对 URL 或 /problems/ 形态的相对路径
                //（其他相对形态拼在根域下是 404），否则回退为按 slug+id 构造的提交页
                let url = typeof s.url === 'string' ? s.url.trim() : '';
                if (url && !/^https?:\/\//i.test(url)) {
                    const pathPart = url.startsWith('/') ? url : `/${url}`;
                    url = /^\/problems\//.test(pathPart) ? 'https://leetcode.cn' + pathPart : '';
                }
                if (!url || !/^https?:\/\//i.test(url)) {
                    url = `https://leetcode.cn/problems/${titleSlug}/submissions/${s.id}/`;
                }
                return {
                    id: String(s.id),
                    statusDisplay: s.statusDisplay || s.status || '',
                    lang: s.lang || '',
                    timestamp: Number(s.timestamp) || 0,
                    runtime: s.runtime || '',
                    memory: s.memory || '',
                    url
                };
            });
    }

    /**
     * 单条提交详情（submissionDetail GraphQL，参数为 ID）：返回该次提交的完整源码（code）。
     * 用于跨设备恢复代码（提交历史 → 恢复本地）；取不到源码（不属于该账号/记录异常）时返回 null。
     */
    async getSubmissionDetail(submissionId: string): Promise<{ id: string; code: string; lang: string; statusDisplay: string; timestamp: number } | null> {
        const query = `
            query submissionDetail($submissionId: ID!) {
                submissionDetail(submissionId: $submissionId) {
                    id
                    code
                    lang
                    statusDisplay
                    timestamp
                }
            }
        `;
        const data = await this.postGraphql(query, { submissionId });
        const detail = data?.data?.submissionDetail;
        if (!detail || typeof detail.code !== 'string') {
            return null;
        }
        return {
            id: String(detail.id || submissionId),
            code: detail.code,
            lang: detail.lang || '',
            statusDisplay: detail.statusDisplay || '',
            timestamp: Number(detail.timestamp) || 0
        };
    }

    async submitCode(titleSlug: string, questionId: string, lang: string, typedCode: string): Promise<any> {
        const url = `/problems/${titleSlug}/submit/`;
        const data = {
            lang: lang,
            question_id: questionId,
            typed_code: typedCode
        };
        return this.post(url, data);
    }

    async checkSubmission(submissionId: string): Promise<any> {
        return this.get(`/submissions/detail/${submissionId}/check/`);
    }

    /**
     * 运行测试用例
     */
    async runCode(titleSlug: string, questionId: string, lang: string, typedCode: string, dataInput: string): Promise<any> {
        const url = `/problems/${titleSlug}/interpret_solution/`;
        const data = {
            lang: lang,
            question_id: questionId,
            typed_code: typedCode,
            data_input: dataInput
        };
        return this.post(url, data);
    }

    /**
     * 获取题目的官方题解
     */
    async getOfficialSolution(titleSlug: string): Promise<any> {
        const query = `
            query officialSolution($titleSlug: String!) {
                question(titleSlug: $titleSlug) {
                    solution {
                        id
                        title
                        content
                        contentTypeId
                        canSeeDetail
                    }
                }
            }
        `;
        return this.postGraphql(query, { titleSlug });
    }

    /**
     * 获取社区题解列表
     */
    async getSolutionArticles(titleSlug: string, skip: number = 0, limit: number = 10): Promise<any> {
        const query = `
            query questionSolutionArticles($questionSlug: String!, $skip: Int, $first: Int, $orderBy: SolutionArticleOrderBy, $userInput: String, $tagSlugs: [String!]) {
                questionSolutionArticles(
                    questionSlug: $questionSlug
                    skip: $skip
                    first: $first
                    orderBy: $orderBy
                    userInput: $userInput
                    tagSlugs: $tagSlugs
                ) {
                    totalNum
                    edges {
                        node {
                            uuid
                            title
                            slug
                            summary
                            author {
                                username
                                profile {
                                    realName
                                    userAvatar
                                }
                            }
                            byLeetcode
                            isMyFavorite
                            isMostPopular
                            isEditorsPick
                            topic {
                                id
                            }
                            upvoteCount
                            reactionsV2 {
                                count
                                reactionType
                            }
                            tags {
                                name
                                nameTranslated
                                slug
                            }
                            createdAt
                            thumbnail
                        }
                    }
                }
            }
        `;
        return this.postGraphql(query, {
            questionSlug: titleSlug,
            skip,
            first: limit,
            orderBy: 'MOST_UPVOTE'
        });
    }

    /**
     * 获取单个题解详情
     */
    async getSolutionArticle(slug: string): Promise<any> {
        const query = `
            query solutionArticleContent($slug: String!) {
                solutionArticle(slug: $slug) {
                    uuid
                    title
                    content
                    author {
                        username
                        profile {
                            realName
                            userAvatar
                        }
                    }
                    byLeetcode
                    upvoteCount
                    createdAt
                    tags {
                        name
                        nameTranslated
                        slug
                    }
                }
            }
        `;
        return this.postGraphql(query, { slug });
    }
}
